/**
 * sound/NoiseCraftBridge.ts — NoiseCraft in a hidden (or visible) iframe, umwelt's way (docs/sound-logic.md §8b).
 *
 * Ported from umwelt/src/audio/NoiseCraftBridge.ts. One bridge per page (singleton), one iframe: the embed
 * (`/noisecraft/public/embedded.html`, served statically by Next through apps/web/public/noisecraft → ../noisecraft)
 * loads a patch from `/noisecraft/examples/<file>` with the full editor (`ui=full`), hidden off-screen when only the
 * sound is wanted, shown in a container on the manager page (/v2/sound). Protocol (postMessage, both ways):
 *   → noiseCraft:play / stop · setParams [{nodeId, paramName, value}] · setSequence {nodeId: moduleId, pitches, gates}
 *     · updateModules [{id, name}] · enableAutoSave {filename} · redraw
 *   ← noiseCraft:projectLoaded · audioState {status} · clockPulse {nodeId, pulseTime} (a ClockOut node in the patch)
 *     · audioStreamReady (the embed exposes window.noiseCraftMediaStream for an analyser) · saveStatus · nodeSelection
 * The mapping of our signals to the patch is CODE (noisecraftMap.ts), not a UI; the driver (noisecraftDriver.ts)
 * pushes sequences and knob values through this bridge.
 */

export interface NoiseCraftModule {
  id: string;
  name: string;
}

export interface NoiseCraftParam {
  nodeId: string;
  paramName?: string;
  value: number;
}

export type NoiseCraftAudioStatus = "idle" | "loading" | "ready" | "playing" | "blocked" | "stopped";

/** The modules our sequencer feeds (the AI_Seq / AI_Poly nodes of a patch pick one of these). */
export const PARLIAMENT_MODULES: NoiseCraftModule[] = [
  { id: "parliament", name: "parliament (poly: 0 나 · 1–3 이웃)" },
  { id: "me", name: "me (내 모티프, mono)" },
  { id: "n1", name: "n1 (가장 가까운 이웃)" },
  { id: "n2", name: "n2 (두 번째 이웃)" },
  { id: "n3", name: "n3 (세 번째 이웃)" },
  { id: "bass", name: "bass (길 위의 근음)" },
  { id: "pad", name: "pad (함께 머물 때의 코드, poly 4)" },
];

export class NoiseCraftBridge {
  private iframe: HTMLIFrameElement | null = null;
  private messageHandler: ((e: MessageEvent) => void) | null = null;
  private _editorVisible = false;
  private _loaded = false;
  private _status: NoiseCraftAudioStatus = "idle";
  private currentPatchFilename = "nc_noise_patch.ncft";
  private analyser: AnalyserNode | null = null;
  private frequencyData: Float32Array<ArrayBuffer> | null = null;
  private streamSourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private modules: NoiseCraftModule[] = PARLIAMENT_MODULES;

  /** A rising edge of the patch's ClockOut (CLOCK_PPS = 6 per 16th step). */
  public onClockPulse?: (nodeId: string, pulseTime: number) => void;
  /** The embed loaded its project (nodes exist; sequences / params may be sent). */
  public onProjectLoaded?: () => void;
  public onStatus?: (status: NoiseCraftAudioStatus) => void;

  get iframeElement(): HTMLIFrameElement | null {
    return this.iframe;
  }
  get loaded(): boolean {
    return this._loaded;
  }
  get status(): NoiseCraftAudioStatus {
    return this._status;
  }
  get isPlaying(): boolean {
    return this._status === "playing";
  }
  get editorVisible(): boolean {
    return this._editorVisible;
  }
  get patch(): string {
    return this.currentPatchFilename;
  }

  noisecraftUrl(filename = this.currentPatchFilename): string {
    return `/noisecraft/public/embedded.html?src=${encodeURIComponent(`/noisecraft/examples/${filename}`)}&ui=full`;
  }

  /** Create (or move) the iframe into `container`; hidden off-screen unless `visible`. Reloads on a new patch. */
  createIframe(container: HTMLElement, visible = false, filename?: string): HTMLIFrameElement {
    if (filename) this.currentPatchFilename = filename;
    if (!this.iframe) {
      this.iframe = document.createElement("iframe");
      this.iframe.src = this.noisecraftUrl();
      this.iframe.id = "noisecraft-iframe";
      this.iframe.allow = "autoplay; microphone";
      this.messageHandler = (e: MessageEvent) => this.handleMessage(e);
      window.addEventListener("message", this.messageHandler);
      this._status = "loading";
    } else if (filename) {
      const url = this.noisecraftUrl(filename);
      if (!this.iframe.src.endsWith(url)) {
        this.iframe.src = url;
        this._loaded = false;
        this._status = "loading";
        this.disconnectAnalyser();
      }
    }
    if (this.iframe.parentElement !== container) container.appendChild(this.iframe);
    this._editorVisible = visible;
    this.applyIframeStyles(visible);
    return this.iframe;
  }

  private applyIframeStyles(visible: boolean): void {
    if (!this.iframe) return;
    if (!visible) {
      Object.assign(this.iframe.style, {
        position: "fixed",
        left: "-9999px",
        top: "-9999px",
        width: "1px",
        height: "1px",
        border: "none",
        opacity: "0",
        pointerEvents: "none",
      });
    } else {
      Object.assign(this.iframe.style, {
        position: "relative",
        left: "0",
        top: "0",
        width: "100%",
        height: "100%",
        border: "none",
        opacity: "1",
        pointerEvents: "auto",
        background: "#111",
      });
    }
  }

  setEditorVisible(visible: boolean): void {
    this._editorVisible = visible;
    this.applyIframeStyles(visible);
    if (visible) setTimeout(() => this.postMessage({ type: "noiseCraft:redraw" }), 200);
  }

  loadPatch(filename: string): void {
    if (this.currentPatchFilename === filename && this.iframe) return;
    this.currentPatchFilename = filename;
    if (this.iframe) {
      this.iframe.src = this.noisecraftUrl(filename);
      this._loaded = false;
      this._status = "loading";
      this.disconnectAnalyser();
    }
  }

  private handleMessage(e: MessageEvent): void {
    const d = e.data as { type?: string; status?: string; nodeId?: string; pulseTime?: number } | null;
    if (!d || typeof d !== "object" || !this.iframe || e.source !== this.iframe.contentWindow) return;
    switch (d.type) {
      case "noiseCraft:projectLoaded":
        this._loaded = true;
        this._status = "ready";
        this.postMessage({ type: "noiseCraft:updateModules", modules: this.modules });
        this.postMessage({ type: "noiseCraft:enableAutoSave", enabled: true, filename: this.currentPatchFilename });
        this.onProjectLoaded?.();
        this.onStatus?.(this._status);
        break;
      case "noiseCraft:audioStreamReady":
        this.tryConnectAnalyser();
        break;
      case "noiseCraft:audioStreamStopped":
        this.disconnectAnalyser();
        break;
      case "noiseCraft:audioState":
        if (d.status === "playing") this._status = "playing";
        else if (d.status === "blocked") this._status = "blocked";
        else if (d.status === "stopped") this._status = "stopped";
        else if (d.status === "ready") this._status = this._loaded ? "ready" : this._status;
        this.onStatus?.(this._status);
        break;
      case "noiseCraft:clockPulse":
        // (the editor posts nodeId as `this.id`, which this fork leaves undefined — the pulse is what matters)
        this.onClockPulse?.(String(d.nodeId ?? ""), Number(d.pulseTime ?? 0));
        break;
    }
  }

  /** The embed exposes its MediaStream for an analyser (spectral data for a visual, as umwelt used it). */
  private tryConnectAnalyser(retry = 0): void {
    if (this.analyserRetryTimer) clearTimeout(this.analyserRetryTimer);
    this.analyserRetryTimer = null;
    const w = this.iframe?.contentWindow as (Window & { noiseCraftMediaStream?: MediaStream; noiseCraftAudioContext?: AudioContext }) | null | undefined;
    const stream = w?.noiseCraftMediaStream;
    const ctx = w?.noiseCraftAudioContext;
    if (!stream || !ctx) {
      if (retry < 30) this.analyserRetryTimer = setTimeout(() => this.tryConnectAnalyser(retry + 1), 500);
      return;
    }
    try {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.85;
      this.frequencyData = new Float32Array(this.analyser.frequencyBinCount);
      this.streamSourceNode = ctx.createMediaStreamSource(stream);
      this.streamSourceNode.connect(this.analyser);
    } catch {
      if (retry < 30) this.analyserRetryTimer = setTimeout(() => this.tryConnectAnalyser(retry + 1), 500);
    }
  }

  private disconnectAnalyser(): void {
    if (this.analyserRetryTimer) clearTimeout(this.analyserRetryTimer);
    this.analyserRetryTimer = null;
    try {
      this.streamSourceNode?.disconnect();
    } catch {
      /* ignore */
    }
    this.streamSourceNode = null;
    this.analyser = null;
  }

  /** Spectral bands 0..1 (low / mid / high) of what the patch plays, or null before the stream exists. */
  getSpectralData(): { low: number; mid: number; high: number } | null {
    if (!this.analyser || !this.frequencyData) return null;
    this.analyser.getFloatFrequencyData(this.frequencyData);
    const n = this.frequencyData.length;
    const band = (a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += this.frequencyData![i];
      const db = s / Math.max(1, b - a);
      return Math.max(0, Math.min(1, (db + 100) / 70));
    };
    return { low: band(0, Math.floor(n * 0.1)), mid: band(Math.floor(n * 0.1), Math.floor(n * 0.4)), high: band(Math.floor(n * 0.4), n) };
  }

  postMessage(message: Record<string, unknown>): void {
    try {
      this.iframe?.contentWindow?.postMessage(message, "*");
    } catch {
      /* ignore */
    }
  }

  play(): void {
    this.postMessage({ type: "noiseCraft:play" });
  }

  stop(): void {
    this.postMessage({ type: "noiseCraft:stop" });
  }

  setModules(mods: NoiseCraftModule[]): void {
    this.modules = mods;
    if (this._loaded) this.postMessage({ type: "noiseCraft:updateModules", modules: mods });
  }

  setParams(params: NoiseCraftParam[]): void {
    if (params.length) this.postMessage({ type: "noiseCraft:setParams", params });
  }

  /** A sequence (mono: number[]; poly: number[][] per step) to every AI_Seq / AI_Poly node that picked `moduleId`. */
  setSequence(moduleId: string, pitches: (number | number[])[], gates: (number | number[])[]): void {
    this.postMessage({ type: "noiseCraft:setSequence", nodeId: moduleId, pitches, gates });
  }

  dispose(): void {
    this.disconnectAnalyser();
    if (this.messageHandler) window.removeEventListener("message", this.messageHandler);
    this.messageHandler = null;
    this.iframe?.remove();
    this.iframe = null;
    this._loaded = false;
    this._status = "idle";
  }
}

let singleton: NoiseCraftBridge | null = null;

/** The page's bridge (one iframe per page, like umwelt's getNoiseCraftBridge). */
export function getNoiseCraftBridge(): NoiseCraftBridge {
  if (!singleton) singleton = new NoiseCraftBridge();
  return singleton;
}

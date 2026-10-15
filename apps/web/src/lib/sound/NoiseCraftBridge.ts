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
  { id: "parliament", name: "parliament (4성: 0 근음 · 1 색채음(3도) · 2 5도 · 3 네 번째 음 — noisecraftMap.ts)" },
  { id: "harmony", name: "harmony (코드 위 4성 홀드 — 사람들 사이·건물 존에서만 게이트)" },
  { id: "bass", name: "bass (= parliament 0, 근음 혼자)" },
  { id: "texture", name: "texture (코드 음 집합 4개 — 음높이만, 게이트는 패치의 트리거로)" },
  { id: "line", name: "line (비어 있음 — A8 Magenta 선 / A9 오스티나토)" },
  { id: "traces", name: "traces (GateSeq 이름으로: 나·이웃들의 리듬 셀, 행 = 사람)" },
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
  /** The embed's output as a MediaStream (null when it stops): the engine takes it into its own bus. */
  public onStream?: (stream: MediaStream | null) => void;
  /** A node was clicked in the editor (umwelt used it to auto-fill a mapping; the workspace shows its rule). */
  public onNodeClicked?: (nodeId: string) => void;

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
    // a hidden iframe (the player tab) asks the embed to run without its editor view (view=hidden): no DOM work.
    // The patch plays through its OWN output (v4 A2: a static machine with its own sound; no stream routing).
    return `/noisecraft/public/embedded.html?src=${encodeURIComponent(`/noisecraft/examples/${filename}`)}&ui=full${this._editorVisible ? "" : "&view=hidden"}`;
  }

  /** Create (or move) the iframe into `container`; hidden off-screen unless `visible`. Reloads on a new patch. */
  createIframe(container: HTMLElement, visible = false, filename?: string): HTMLIFrameElement {
    if (filename) this.currentPatchFilename = filename;
    this._editorVisible = visible; // before the URL: a hidden iframe is opened without its editor view
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
        // only the editor the artist can see saves the patch file; a hidden instrument never writes it
        this.postMessage({ type: "noiseCraft:enableAutoSave", enabled: this._editorVisible, filename: this.currentPatchFilename });
        this.onProjectLoaded?.();
        this.onStatus?.(this._status);
        break;
      case "noiseCraft:audioStreamReady":
        this.tryConnectAnalyser();
        this.onStream?.(this.stream);
        break;
      case "noiseCraft:audioStreamStopped":
        this.disconnectAnalyser();
        this.onStream?.(null);
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
      case "noiseCraft:nodeClicked":
        if (d.nodeId != null) this.onNodeClicked?.(String(d.nodeId));
        break;
    }
  }

  /** A node of the loaded patch as the embed holds it (same origin), for the workspace's inspector; null if unknown. */
  nodeInfo(nodeId: string): { type: string; name: string; min?: number; max?: number; value?: number } | null {
    try {
      const w = this.iframe?.contentWindow as (Window & { noiseCraftApp?: { model: { state: { nodes: Record<string, { type: string; name?: string; params?: Record<string, unknown> }> } } } }) | null | undefined;
      const n = w?.noiseCraftApp?.model.state.nodes[nodeId];
      if (!n) return null;
      const p = n.params ?? {};
      return { type: n.type, name: n.name ?? n.type, min: typeof p.minVal === "number" ? p.minVal : undefined, max: typeof p.maxVal === "number" ? p.maxVal : undefined, value: typeof p.value === "number" ? p.value : undefined };
    } catch {
      return null;
    }
  }

  /** The embed's output stream (window.noiseCraftMediaStream), or null before audio starts. */
  get stream(): MediaStream | null {
    const w = this.iframe?.contentWindow as (Window & { noiseCraftMediaStream?: MediaStream }) | null | undefined;
    return w?.noiseCraftMediaStream ?? null;
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

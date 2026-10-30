/**
 * sound/output.ts — WHERE each sound goes, and a limiter so two of them never clip (2026-10-30, the artist: "퍼스널이랑
 * 글로벌 스플릿뷰로 같이 켜면 퍼스널 사운드도 갑자기 왜곡" — docs/sound-logic.md §10c).
 *
 *   ROLES      "headset" = the personal view's engine (engine.ts), "speakers" = the room's speakers under the global
 *              views (global.ts). On the exhibition iMac both run in one Chrome; without routing both go to the
 *              system's default output and add up there.
 *   CHOICE     a rehearsal page (/v2/sound/output) lists the audio outputs and stores one per role in localStorage
 *              (id + label; the id is per origin, so choose on the address the show runs on). The engines apply it
 *              with AudioContext.setSinkId (Chrome 110+) when they start and whenever it changes (storage event).
 *              No choice / unsupported browser / device gone = the system default, as before.
 *   LIMITER    each engine's master goes through a brick-wall-ish compressor before the device: the sum of two engines
 *              (or one loud moment) is held under 0 dBFS instead of clipping into distortion.
 */

export type OutputRole = "headset" | "speakers";

export interface OutputChoice {
  /** MediaDeviceInfo.deviceId ("" / "default" = the system default). */
  id: string;
  /** Its label when chosen (devices are matched by label when the id changed). */
  label: string;
}

const KEY = (role: OutputRole) => `anthropocene:sound:output:${role}:v1`;

export const ROLE_LABEL: Record<OutputRole, string> = { headset: "헤드셋 (퍼스널 뷰)", speakers: "스피커 (글로벌 뷰)" };

export function loadOutput(role: OutputRole): OutputChoice | null {
  try {
    const raw = window.localStorage.getItem(KEY(role));
    const v = raw ? (JSON.parse(raw) as OutputChoice) : null;
    return v && typeof v.id === "string" ? v : null;
  } catch {
    return null;
  }
}

export function saveOutput(role: OutputRole, choice: OutputChoice | null): void {
  try {
    if (choice && choice.id && choice.id !== "default") window.localStorage.setItem(KEY(role), JSON.stringify(choice));
    else window.localStorage.removeItem(KEY(role));
  } catch {
    /* storage blocked: the default output */
  }
}

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };

/** Whether this browser can send an AudioContext to a chosen device. */
export function canChooseOutput(): boolean {
  return typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
}

/** The audio outputs (labels are empty until the page has had microphone permission once — see unlockLabels). */
export async function listOutputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audiooutput");
}

/** Ask for the microphone once (and stop it at once): Chrome then shows the outputs' names and ids for this origin. */
export async function unlockLabels(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

/** The device id to use for a choice now: the stored id if it still exists, else a device with the same label. */
export async function resolveOutput(choice: OutputChoice | null): Promise<string> {
  if (!choice || !choice.id || choice.id === "default") return "";
  try {
    const outs = await listOutputs();
    if (outs.some((d) => d.deviceId === choice.id)) return choice.id;
    const byLabel = outs.find((d) => d.label && d.label === choice.label);
    return byLabel?.deviceId ?? "";
  } catch {
    return "";
  }
}

/** Send `ctx` to the role's chosen output (or the default). Returns what it is playing on, for a status line. */
export async function applyOutput(ctx: AudioContext, role: OutputRole): Promise<string> {
  const c = ctx as SinkContext;
  if (!c.setSinkId) return "기본 출력 (이 브라우저는 장치 선택 불가)";
  const choice = loadOutput(role);
  const id = await resolveOutput(choice);
  try {
    if ((c.sinkId ?? "") !== id) await c.setSinkId(id);
    return id ? choice?.label || "선택한 장치" : "기본 출력";
  } catch {
    try {
      await c.setSinkId("");
    } catch {
      /* stay where it is */
    }
    return "기본 출력 (선택한 장치를 못 씀)";
  }
}

/** Calls `cb` when another tab (the rehearsal page) changes the role's output. Returns the unsubscribe. */
export function onOutputChange(role: OutputRole, cb: () => void): () => void {
  const h = (e: StorageEvent) => {
    if (e.key === KEY(role)) cb();
  };
  window.addEventListener("storage", h);
  return () => window.removeEventListener("storage", h);
}

/** The limiter after a master: −3 dB ceiling, hard ratio, fast attack — the sum never clips. */
export function makeLimiter(ctx: BaseAudioContext): DynamicsCompressorNode {
  const l = ctx.createDynamicsCompressor();
  l.threshold.value = -3;
  l.knee.value = 0;
  l.ratio.value = 20;
  l.attack.value = 0.003;
  l.release.value = 0.1;
  return l;
}

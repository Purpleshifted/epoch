/**
 * sound/output.ts — which window plays, and through which device (docs/sound-logic.md §8, §11).
 *
 * Every view (the player's headset, the room's speakers) has its own AudioContext, so on one machine with both
 * windows open they simply mix on the same output. Two things keep them apart:
 *   SOLO     one window can claim the sound ("이 창만 듣기"): the claim is shared through localStorage, and every
 *            other window mutes while it stands. For monitoring on one laptop.
 *   SINK     each window can be sent to its own output device (AudioContext.setSinkId, Chromium ≥ 110): the
 *            exhibition PC routes the player view to the headset and the global view to the speakers.
 */

export type SoundView = "mobile" | "global" | "manager";

export const LS_SOLO_KEY = "anthropocene:sound:solo:v1";

/** Which view has claimed the sound (null = none). */
export function readSolo(): SoundView | null {
  try {
    const v = localStorage.getItem(LS_SOLO_KEY);
    return v === "mobile" || v === "global" || v === "manager" ? v : null;
  } catch {
    return null;
  }
}

export function setSolo(view: SoundView | null): void {
  try {
    if (view) localStorage.setItem(LS_SOLO_KEY, view);
    else localStorage.removeItem(LS_SOLO_KEY);
  } catch {
    /* storage unavailable: this window only */
  }
}

/** True when another view holds the solo, so this one must stay quiet. */
export function mutedBySolo(me: SoundView): boolean {
  const s = readSolo();
  return s !== null && s !== me;
}

export interface OutputDevice {
  id: string;
  label: string;
}

/** The audio output devices the browser lets us see (labels appear once any media permission was granted). */
export async function listOutputs(): Promise<OutputDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const outs = all.filter((d) => d.kind === "audiooutput");
    return outs.map((d, i) => ({ id: d.deviceId, label: d.label || (d.deviceId === "default" ? "기본 출력" : `출력 ${i + 1}`) }));
  } catch {
    return [];
  }
}

type SinkCtx = AudioContext & { setSinkId?: (id: string | { type: "none" }) => Promise<void>; sinkId?: string };

/** Route a context to an output device; false when the browser cannot (then it stays on the default output). */
export async function applySink(ctx: AudioContext, id: string): Promise<boolean> {
  const c = ctx as SinkCtx;
  if (typeof c.setSinkId !== "function") return false;
  try {
    await c.setSinkId(id === "default" ? "" : id);
    return true;
  } catch {
    return false;
  }
}

export const canPickOutput = (): boolean => typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;

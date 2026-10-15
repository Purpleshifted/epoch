/**
 * sound/desk.ts — the DESK: every sound control of the work in one live state (docs/sound-logic.md §9).
 *
 * The artist asked for all sound Leva to live in the workspace (/v2/sound) and for that workspace to be linked
 * to the player in real time. So the controls are no longer on the player's or the speakers' pages: the
 * workspace holds them (SoundControls.tsx), and every change is written here — to localStorage (the `storage`
 * event reaches every other tab at once, and a tab that opens later reads it on load) and posted on the bus
 * (bus.ts, type "desk"). The player tab (useSound.ts) and the speakers (GlobalSound.tsx) read it and nothing
 * else. umwelt did the same with its mapping store (autosave to localStorage on every change, Cmd+S to download).
 */

import { DEFAULT_SOUND, type SoundParams } from "./engine";
import { DEFAULT_GLOBAL, type GlobalParams } from "./global";
import { DEFAULT_SIGNALS } from "./signals";

export interface DeskState {
  /** The headset (player) engine's parameters. */
  headset: SoundParams;
  /** The player: sound on, its output device, the NoiseCraft patch it plays, the building's dull radius. */
  on: boolean;
  output: string;
  ncPatch: string;
  sealRadius: number;
  /** The room's speakers (every global view). */
  speakers: GlobalParams;
  speakersOn: boolean;
  speakersOutput: string;
  /** Patch knobs held by hand (node id → value): the coded mapping leaves them alone. */
  overrides: Record<string, number>;
  /** When the desk last changed (Date.now()). */
  at: number;
}

export const DEFAULT_DESK: DeskState = {
  headset: DEFAULT_SOUND,
  on: true,
  output: "default",
  ncPatch: "nc_noise_patch.ncft",
  sealRadius: DEFAULT_SIGNALS.sealRadius,
  speakers: DEFAULT_GLOBAL,
  speakersOn: false,
  speakersOutput: "default",
  overrides: {},
  at: 0,
};

export const DESK_KEY = "anthropocene:sound:desk:v1";
export const DESK_SNAPSHOT_KEY = "anthropocene:sound:desk:snapshot:v1";

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** `raw` merged over the defaults: unknown keys dropped, wrong kinds ignored, so an old desk never breaks a page. */
export function mergeDesk(raw: unknown, base: DeskState = DEFAULT_DESK): DeskState {
  if (!isObj(raw)) return base;
  const pick = <T extends object>(def: T, src: unknown): T => {
    if (!isObj(src)) return def;
    const out: Record<string, unknown> = { ...(def as Record<string, unknown>) };
    for (const [k, v] of Object.entries(def)) if (k in src && typeof src[k] === typeof v) out[k] = src[k];
    return out as T;
  };
  const overrides: Record<string, number> = {};
  if (isObj(raw.overrides)) for (const [k, v] of Object.entries(raw.overrides)) if (typeof v === "number" && Number.isFinite(v)) overrides[k] = v;
  return {
    headset: pick(base.headset, raw.headset),
    on: typeof raw.on === "boolean" ? raw.on : base.on,
    output: typeof raw.output === "string" ? raw.output : base.output,
    ncPatch: typeof raw.ncPatch === "string" && raw.ncPatch ? raw.ncPatch : base.ncPatch,
    sealRadius: typeof raw.sealRadius === "number" ? raw.sealRadius : base.sealRadius,
    speakers: pick(base.speakers, raw.speakers),
    speakersOn: typeof raw.speakersOn === "boolean" ? raw.speakersOn : base.speakersOn,
    speakersOutput: typeof raw.speakersOutput === "string" ? raw.speakersOutput : base.speakersOutput,
    overrides,
    at: typeof raw.at === "number" ? raw.at : 0,
  };
}

export function readDesk(key = DESK_KEY): DeskState {
  if (typeof window === "undefined") return DEFAULT_DESK;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? mergeDesk(JSON.parse(raw)) : DEFAULT_DESK;
  } catch {
    return DEFAULT_DESK;
  }
}

export function writeDesk(desk: DeskState, key = DESK_KEY): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(desk));
  } catch {
    /* storage unavailable: this tab only */
  }
}

/** The desk as a file the artist can keep (and load back with loadDesk). */
export function exportDesk(desk: DeskState): string {
  return JSON.stringify({ kind: "parliament-sound-desk", version: 1, savedAt: new Date().toISOString(), desk }, null, 2);
}

export function parseDeskFile(text: string): DeskState | null {
  try {
    const j = JSON.parse(text) as { desk?: unknown };
    return isObj(j) && "desk" in j ? mergeDesk(j.desk) : mergeDesk(j);
  } catch {
    return null;
  }
}

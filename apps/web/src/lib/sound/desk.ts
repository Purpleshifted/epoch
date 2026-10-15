/**
 * sound/desk.ts — the DESK: every sound control of the work in one state (docs/sound-logic.md §9).
 *
 * The defaults here are the work's values (DEFAULT_SOUND, DEFAULT_GLOBAL, and the switches around them). The
 * player page's Leva (useSoundLeva.ts) and the bench start from them; the speakers read their own folder.
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
  /** Patch knobs held by hand (node id → value): the coded mapping leaves them alone (the bench). */
  overrides: Record<string, number>;
  /** When the desk last changed (Date.now(); 0 = the defaults). */
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

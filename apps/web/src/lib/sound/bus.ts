/**
 * sound/bus.ts — the player tab tells the other windows what it hears (docs/sound-logic.md §8b).
 *
 * A BroadcastChannel (same origin). The player tab publishes its state twice a second: who it is, the signals,
 * the parameters, the epoch and the camera yaw — everything a headless SoundEngine needs to plan the same bars.
 * The manager page (/v2/sound) listens, runs such an engine and drives the NoiseCraft editor it shows, so the
 * artist edits the patch while hearing the player's actual walk in the split view.
 */

import type { SoundParams } from "./engine";
import type { PersonalSignals } from "./signals";

export const SOUND_BUS = "parliament-sound-v1";

export interface BusState {
  type: "state";
  myId: string;
  sig: PersonalSignals;
  params: SoundParams;
  epochMs: number;
  yaw: number;
  /** When the player tab sent it (Date.now()). */
  at: number;
}

export type BusMessage = BusState;

export function openBus(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(SOUND_BUS);
  } catch {
    return null;
  }
}

/**
 * sound/noisecraftMap.ts — the MAPPING, written by hand (docs/sound-logic.md §8b).
 *
 * umwelt mapped sensors to knobs through a UI (NodeMappingPanel); here the mapping is CODE, so it can reach the
 * sound logic directly: every knob rule sees the player's signals, the MODE the signals imply and the bar that is
 * about to play, and every bar plan (sequencer.ts) becomes AI_Seq / AI_Poly sequences. Tables per patch; the
 * artist's patches (nc_noise_patch, Feedback_Synth) share their knob ids (both grew from intersection's
 * "Falling in Love With Waterfalls"), global_audio has its own.
 *
 * Rules give a 0..1 DRIVE; the knob's own range (min / max from the patch) scales it. Pure.
 */

import type { NoiseCraftParam } from "./NoiseCraftBridge";
import type { BarPlan } from "./sequencer";
import type { PersonalSignals } from "./signals";

/** The four states of a walk that the sound declares (harmonizer's node / edge / face, in our terms). */
export type SoundMode = "open" | "path" | "build" | "building";

export interface MapContext {
  sig: PersonalSignals;
  mode: SoundMode;
  /** The bar about to play (null before the first). */
  plan: BarPlan | null;
  /** Master level 0..1 (Leva). */
  master: number;
  /** Seconds per bar (Leva barSec): the patch's sequencer clock follows it (CLOCK_RULE). */
  barSec: number;
}

export interface KnobRule {
  nodeId: string;
  label: string;
  /** The knob's range in the patch (the sent value is min + drive × (max − min)). */
  min: number;
  max: number;
  drive: (c: MapContext) => number;
  /** Send only when the value moved by more than this share of the range (keeps postMessage traffic low). */
  deadband?: number;
}

export interface PatchMap {
  knobs: KnobRule[];
  /** Which modules the patch's receivers are expected to pick (for the editor's dropdown and the doc). */
  modules: string[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const company = (s: PersonalSignals) => Math.min(1, s.neighbours.length / 2);

/** Roughness as sequencer.ts computes it (kept local so this table stays pure and small). */
export function roughOf(s: PersonalSignals): number {
  const stable = Math.max(s.pathP, s.stay * company(s), s.sealed * 0.7);
  const moving = Math.min(1, s.speed / 2.1);
  return (1 - stable) * (0.35 + 0.65 * s.grass) * (0.4 + 0.6 * moving);
}

/**
 * The mode a signal set implies. Plain thresholds for now; the debounced ThresholdLogic (harmonizer) comes with
 * the mode presets (sound-review-2026-10-15.md, phase 2).
 */
export function modeOf(s: PersonalSignals): SoundMode {
  if (s.sealed >= 0.3) return "building";
  if (s.stay > 0.5 && s.neighbours.length > 0) return "build";
  if (s.pathP >= 0.25) return "path";
  return "open";
}

/**
 * The sequencer clock of nc_noise_patch: a Knob "clock" (Hz) → Pulse "seq clock" → every AI_Seq, the GateSeq and
 * the ClockOut. A step is 6 rising edges and a bar 16 steps, so the knob is PULSES_PER_BAR / barSec Hz: 48 Hz for
 * the 2 s bar, the still visitor's 3 s bar 32 Hz, the running one's 1.2 s bar 80 Hz. The artist's own Pulse 173
 * (BPM 120 → 2 Hz) keeps driving the patch's random triggers and is no longer the sequencer's clock.
 */
export const CLOCK_KNOB = { nodeId: "306", min: 16, max: 128 };
export const CLOCK_RULE: KnobRule = {
  nodeId: CLOCK_KNOB.nodeId,
  label: "clock (Hz) — 96 / barSec",
  min: CLOCK_KNOB.min,
  max: CLOCK_KNOB.max,
  drive: (c) => (PULSES_PER_BAR / Math.max(0.5, c.barSec) - CLOCK_KNOB.min) / (CLOCK_KNOB.max - CLOCK_KNOB.min),
  deadband: 0.002,
};

/** nc_noise_patch.ncft and Feedback_Synth.ncft (same knob ids). */
export const HEADSET_MAP: PatchMap = {
  modules: ["parliament", "bass", "pad"],
  knobs: [
    { nodeId: "70", label: "vol (master)", min: 0, max: 0.5, drive: (c) => c.master },
    {
      nodeId: "183",
      label: "Vol CHORDS — building together",
      min: 0,
      max: 1,
      drive: (c) => (c.mode === "build" || c.mode === "building" ? clamp01(0.6 + 0.4 * c.sig.stay * company(c.sig)) : 0.15),
    },
    {
      nodeId: "163",
      label: "REVERB WET — the hall opens while building",
      min: 0,
      max: 2,
      drive: (c) => ({ open: 0.15, path: 0.2, build: clamp01(0.45 + 0.3 * c.sig.stay * company(c.sig)), building: 0.4 })[c.mode],
    },
    { nodeId: "166", label: "DRY", min: 0, max: 1, drive: (c) => (c.mode === "build" ? 0.6 : 1) },
    {
      nodeId: "84",
      label: "Del Vol — a path echoes steadily, vegetation smears",
      min: 0,
      max: 1,
      drive: (c) => ({ open: clamp01(0.35 + 0.5 * roughOf(c.sig)), path: 0.8, build: 0.5, building: 0.6 })[c.mode],
    },
    { nodeId: "171", label: "amt (distortion) — rough", min: 0, max: 1, drive: (c) => clamp01(0.1 + 0.6 * roughOf(c.sig) + (c.mode === "building" ? 0.2 : 0)) },
    { nodeId: "206", label: "fact (detune) — rough", min: 0, max: 0.1, drive: (c) => clamp01(0.1 + 0.9 * roughOf(c.sig)) },
    { nodeId: "138", label: "FB (delay feedback 1) — steady on a path", min: 0, max: 0.9, drive: (c) => (c.mode === "path" ? 0.78 : 0.55) },
    { nodeId: "152", label: "FB (delay feedback 2)", min: 0, max: 0.9, drive: (c) => (c.mode === "path" ? 0.75 : 0.55) },
    { nodeId: "132", label: "Dist [m] 1 — walls close in on concrete", min: 2, max: 200, drive: (c) => clamp01(0.75 - 0.6 * c.sig.sealed) },
    { nodeId: "146", label: "Dist [m] 2", min: 2, max: 200, drive: (c) => clamp01(0.8 - 0.6 * c.sig.sealed) },
  ],
};

/** global_audio.ncft (the room's speakers; MonoSeq bass / baritone / tenor, same knob ids). */
export const GLOBAL_MAP: PatchMap = {
  modules: ["parliament"],
  knobs: [
    { nodeId: "70", label: "vol (master)", min: 0, max: 0.5, drive: (c) => c.master },
    { nodeId: "163", label: "REVERB WET", min: 0, max: 2, drive: () => 0.5 },
    { nodeId: "183", label: "Vol CHORDS", min: 0, max: 1, drive: (c) => clamp01(0.3 + 0.7 * company(c.sig)) },
  ],
};

/** nc_noise_patch.ncft: the headset knobs plus its sequencer clock. */
export const NC_NOISE_MAP: PatchMap = { modules: HEADSET_MAP.modules, knobs: [...HEADSET_MAP.knobs, CLOCK_RULE] };

export const PATCH_MAPS: Record<string, PatchMap> = {
  "nc_noise_patch.ncft": NC_NOISE_MAP,
  "Feedback_Synth.ncft": HEADSET_MAP,
  "global_audio.ncft": GLOBAL_MAP,
};

export function mapFor(patch: string): PatchMap {
  return PATCH_MAPS[patch] ?? HEADSET_MAP;
}

/** Knob values for a context; `last` lets a caller send only what moved beyond the deadband. */
export function knobParams(map: PatchMap, c: MapContext, last?: Map<string, number>): NoiseCraftParam[] {
  const out: NoiseCraftParam[] = [];
  for (const r of map.knobs) {
    const value = +(r.min + (r.max - r.min) * clamp01(r.drive(c))).toFixed(4);
    const prev = last?.get(r.nodeId);
    const dead = (r.deadband ?? 0.01) * (r.max - r.min);
    if (prev != null && Math.abs(prev - value) <= dead) continue;
    last?.set(r.nodeId, value);
    out.push({ nodeId: r.nodeId, paramName: "value", value });
  }
  return out;
}

/**
 * THE RHYTHM. A bar is 16 AI_Seq steps (a step = CLOCK_PPS = 6 rising edges of the patch's sequencer clock,
 * noisecraft/public/music.js), so a motif's 8-step cycle keeps its cell when the bar holds it twice (density 2,
 * sequencer.placeInBar) and the half-bar pad / bass land on the grid. A gate is not on / off but a LENGTH IN STEPS
 * (motif.ts: a note lasts 85 % of the way to the next onset): the fork's AI_Seq / AI_Poly hold their gate that long
 * (gateT input = a multiplier, default 1), so envelopes breathe with the cell instead of blipping — the legato and
 * the rests of the leitmotif as the Web Audio instrument played them.
 */
export const STEPS_PER_BAR = 16;
export const PULSES_PER_STEP = 6;
export const PULSES_PER_BAR = STEPS_PER_BAR * PULSES_PER_STEP;
/** Shortest gate (steps) so an envelope still opens on a very short note. */
export const MIN_GATE_STEPS = 0.5;

/**
 * A voice's notes (onset 0..1 of the bar, MIDI, length 0..1 of the bar) on the grid: pitch per step (held), gate on
 * onsets with the note's length in steps (capped at the bar; a note with no length lasts one step).
 */
export function notesToSteps(notes: readonly { at: number; pitch: number; len?: number }[], steps = STEPS_PER_BAR): { pitches: number[]; gates: number[] } {
  const pitches = new Array<number>(steps).fill(0);
  const gates = new Array<number>(steps).fill(0);
  const byStep = new Map<number, { pitch: number; len: number }>();
  for (const n of notes) {
    const len = n.len == null ? 1 : Math.max(MIN_GATE_STEPS, Math.min(steps, n.len * steps));
    byStep.set(Math.min(steps - 1, Math.round(n.at * steps)), { pitch: n.pitch, len: +len.toFixed(2) });
  }
  let last = 0;
  const first = byStep.size ? Math.min(...byStep.keys()) : -1;
  if (first >= 0) last = byStep.get(first)!.pitch;
  for (let i = 0; i < steps; i++) {
    const n = byStep.get(i);
    if (n) {
      last = n.pitch;
      gates[i] = n.len;
    }
    pitches[i] = last;
  }
  return { pitches, gates };
}

export interface PatchSequences {
  /** AI_Poly "parliament": per step [me, n1, n2, n3]. */
  parliament: { pitches: number[][]; gates: number[][] };
  me: { pitches: number[]; gates: number[] };
  n1: { pitches: number[]; gates: number[] };
  n2: { pitches: number[]; gates: number[] };
  n3: { pitches: number[]; gates: number[] };
  bass: { pitches: number[]; gates: number[] };
  /** AI_Poly "pad": the chord held (a half-bar gate on the downbeat and the half bar). */
  pad: { pitches: number[][]; gates: number[][] };
}

/** A bar plan (sequencer.ts) as the sequences the patch's receivers take. */
export function planToSequences(plan: BarPlan): PatchSequences {
  const me = notesToSteps(plan.me);
  const others = [0, 1, 2].map((k) => notesToSteps(plan.others[k]?.notes ?? []));
  const voices = [me, ...others];
  const parliament = {
    pitches: Array.from({ length: STEPS_PER_BAR }, (_, i) => voices.map((v) => v.pitches[i])),
    gates: Array.from({ length: STEPS_PER_BAR }, (_, i) => voices.map((v) => v.gates[i])),
  };
  // the walking bass: a soft pulse, a step and a half
  const bass = notesToSteps(plan.bass.map((b) => ({ at: b.at, pitch: b.pitch, len: 1.5 / STEPS_PER_BAR })));
  const padPitches = plan.pad.level > 0 ? plan.pad.pitches.slice(0, 4) : [];
  while (padPitches.length && padPitches.length < 4) padPitches.push(padPitches[padPitches.length - 1]);
  const pad = {
    pitches: Array.from({ length: STEPS_PER_BAR }, () => (padPitches.length ? padPitches.slice() : [0, 0, 0, 0])),
    // held for the half bar it starts: a chord that breathes twice a bar, not two blips
    gates: Array.from({ length: STEPS_PER_BAR }, (_, i) => (padPitches.length && (i === 0 || i === STEPS_PER_BAR / 2) ? [STEPS_PER_BAR / 2, STEPS_PER_BAR / 2, STEPS_PER_BAR / 2, STEPS_PER_BAR / 2] : [0, 0, 0, 0])),
  };
  return { parliament, me, n1: others[0], n2: others[1], n3: others[2], bass, pad };
}

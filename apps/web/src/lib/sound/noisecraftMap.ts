/**
 * sound/noisecraftMap.ts — what our logic gives the artist's NoiseCraft patch (docs/sound-logic.md §8b, v4 A2).
 *
 * The patch (`nc_noise_patch`) is a STATIC MACHINE: nothing in here turns its knobs (a few knobs do follow the
 * interaction, gliding within their ranges — noisecraftKnobs.ts, v4 A5a). Two things cross into it from here:
 *
 *   THE MUSIC CLOCK   the bar length is decided outside (the engine: Leva + interaction), and the patch's sequencer
 *                     clock knob RECEIVES it (pulses/s, 96 a bar). (The patch's own
 *                     BPM knob, which paces its random triggers, the artist locked at 120: it is not touched — a
 *                     value outside a knob's range breaks the patch on its next load.)
 *   HARMONIC SEQUENCES per bar, 16 steps, pitch per step (MIDI) and gate = note length in steps — to the receivers
 *                     (AI_Seq / AI_Poly / GateSeq nodes that picked a module name). The patch decides how much of
 *                     each voice is heard: some envelopes follow our gates exactly, some are fired by the patch's own
 *                     random triggers (each voice its own play ratio) and only take our pitch.
 *
 * The voices of nc_noise_patch and what each receives (`parliament` = AI_Poly-style 4 voices via AI_Seq[voice]):
 *   v0  ROOT      sine + saw → distortion; envelope = OUR gate.  The chord root: a breath in the open, the walking
 *                 pulse on a path, a hold while building.
 *   v1  COLOUR    sine swell (envelope = our gate) + a saw the patch fires itself (~25 %).  The chord's colour tone
 *                 (its third): swells when the chord changes and while building; bubbles on its own otherwise.
 *   v2  FIFTH     saw + sine the patch fires rarely (~20 % at a slow rate); pitch only.  The chord's fifth.
 *   v3  (free)    the chord's fourth tone, pitch only, for a patch that wants it.
 *   harmony       four sines with a slow swell (AI_Poly); gated only among people / in a building zone.
 *   line          empty for now (A8 Magenta line / A9 ostinato).
 *   traces        rhythm rows (GateSeq): my cell and the neighbours', for the editor to show.
 */

import type { NoiseCraftParam } from "./NoiseCraftBridge";
import type { BarPlan } from "./sequencer";

export const STEPS_PER_BAR = 16;
export const PULSES_PER_STEP = 6;
export const PULSES_PER_BAR = STEPS_PER_BAR * PULSES_PER_STEP;
/** Shortest gate (steps) so an envelope still opens on a very short note. */
export const MIN_GATE_STEPS = 0.5;

/** nc_noise_patch: the sequencer clock knob (Pulse "seq clock" rate, pulses/s) and its range in the patch. */
export const CLOCK_KNOB = { nodeId: "306", min: 16, max: 128 } as const;

/** The music clock as the patch receives it: `barSec` seconds a bar → pulses/s, within the knob's range. */
export function clockParams(barSec: number): NoiseCraftParam[] {
  const hz = Math.max(CLOCK_KNOB.min, Math.min(CLOCK_KNOB.max, PULSES_PER_BAR / Math.max(0.25, barSec)));
  return [{ nodeId: CLOCK_KNOB.nodeId, paramName: "value", value: +hz.toFixed(3) }];
}

/**
 * A voice's notes (onset 0..1 of the bar, MIDI, length 0..1 of the bar) on the grid: pitch per step (held), gate on
 * onsets with the note's length in steps (capped at the bar; a note with no length lasts one step).
 */
export function notesToSteps(notes: readonly { at: number; pitch: number; len?: number }[], steps = STEPS_PER_BAR): Mono {
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

export type Mono = { pitches: number[]; gates: number[] };
export type Poly = { pitches: number[][]; gates: number[][] };

export interface PatchSequences {
  /** Four voices per step: [root, colour, fifth, fourth tone] — see the header. */
  parliament: Poly;
  /** The chord's four upper tones held a bar, re-attacked each bar; gated only among people / in a zone. */
  harmony: Poly;
  /** = the root voice alone (a patch with a "bass" receiver). */
  bass: Mono;
  /** The chord's tones over two octaves, pitch only (a patch with a "texture" receiver). */
  texture: Poly;
  /** Empty until A8 / A9. */
  line: Mono;
  /** Rhythm rows: my cell, then the neighbours' (gates 1 on onsets). */
  traces: Poly;
}

/** Where the plan says we are: among people building, on a path, or in the open. */
export type PlaceMode = "build" | "path" | "open";

export function modeOfPlan(plan: Pick<BarPlan, "pad" | "bass">): PlaceMode {
  if (plan.pad.level > 0.2) return "build";
  if (plan.bass.length) return "path";
  return "open";
}

const silent = (): Mono => ({ pitches: new Array<number>(STEPS_PER_BAR).fill(0), gates: new Array<number>(STEPS_PER_BAR).fill(0) });
const poly = (voices: Mono[]): Poly => ({
  pitches: Array.from({ length: STEPS_PER_BAR }, (_, i) => voices.map((v) => v.pitches[i])),
  gates: Array.from({ length: STEPS_PER_BAR }, (_, i) => voices.map((v) => v.gates[i])),
});
/** A pitch held from the downbeat for `steps` steps (0 = pitch only, no gate). */
const hold = (pitch: number, steps = STEPS_PER_BAR): Mono => ({ pitches: new Array<number>(STEPS_PER_BAR).fill(pitch), gates: [pitch > 0 && steps > 0 ? Math.min(STEPS_PER_BAR, steps) : 0, ...new Array<number>(STEPS_PER_BAR - 1).fill(0)] });

const sameChord = (a: BarPlan["chord"] | null | undefined, b: BarPlan["chord"]) => !!a && a.rootClass === b.rootClass && a.classes.join() === b.classes.join();

/**
 * A bar plan (sequencer.ts) as the sequences the patch's receivers take. `prev` = the previous bar's plan (the
 * colour voice swells when the chord changes).
 */
export function planToSequences(plan: BarPlan, prev: BarPlan | null = null): PatchSequences {
  const mode = modeOfPlan(plan);
  const c = plan.chord;
  const tones = c.classes.length ? c.classes : [c.rootClass];
  const colour = tones[1] ?? tones[0];
  const fifth = tones[2] ?? tones[0];
  const fourth = tones[3] ?? tones[0];
  const rootPitch = 36 + c.rootClass;
  const changed = !sameChord(prev?.chord, c);

  // v0 ROOT: the walking pulse on a path (the plan's bass), a hold while building, a breath every other bar in the open
  let root: Mono;
  if (mode === "path") root = notesToSteps(plan.bass.map((b) => ({ at: b.at, pitch: b.pitch, len: 1.5 / STEPS_PER_BAR })));
  else if (mode === "build") root = hold(rootPitch, STEPS_PER_BAR);
  else root = hold(rootPitch, plan.bar % 2 === 0 ? STEPS_PER_BAR / 2 : 0);
  // v1 COLOUR: a swell on a chord change and while building; otherwise the patch's own triggers bubble it
  const colourVoice = hold(60 + colour, changed || mode === "build" ? STEPS_PER_BAR : 0);
  // v2 FIFTH and v3: pitch only — the patch fires them in its own time
  const fifthVoice = hold(48 + fifth + 12, 0);
  const fourthVoice = hold(60 + fourth, 0);
  const parliament = poly([root, colourVoice, fifthVoice, fourthVoice]);

  // harmony: the pad's upper four tones, held a bar, only while building (the light engine's pad rule)
  const upper = plan.pad.pitches.length > 1 ? plan.pad.pitches.slice(1, 5) : tones.map((t) => 48 + t);
  while (upper.length < 4) upper.push(upper[upper.length - 1]);
  const harmony = poly(upper.map((p) => hold(p, mode === "build" ? STEPS_PER_BAR : 0)));

  const texture = poly(tones.slice(0, 4).concat(new Array(Math.max(0, 4 - tones.length)).fill(tones[0])).map((t, i) => hold(60 + t + (i % 2) * 12, 0)));
  const onsets = (notes: readonly { at: number }[]): Mono => {
    const m = silent();
    for (const n of notes) m.gates[Math.min(STEPS_PER_BAR - 1, Math.round(n.at * STEPS_PER_BAR))] = 1;
    return m;
  };
  const traces = poly([onsets(plan.me), ...[0, 1, 2].map((k) => onsets(plan.others[k]?.notes ?? []))]);
  return { parliament, harmony, bass: root, texture, line: silent(), traces };
}

/**
 * sound/noisecraftKnobs.ts — the patch's REAL-TIME KNOBS (v4 A5a, docs/sound-logic.md §8d). The artist: "ncft 패치
 * 안에도 실시간 상수 받아오면 리소스 적게 드는 노브들 몇 개 있었던 것 같은데… 매핑 작업을 어떤 식으로 해야할지 모르겠네".
 *
 * WHY A KNOB IS CHEAP   a Knob node compiles to `nodes[id].params.value`, read every sample; setting it is one
 *                       postMessage into the iframe and one SET_PARAM message into the worklet — no recompile, no
 *                       allocation, no DOM (the hidden instrument has no editor). A sequence, by contrast, is
 *                       16 pitches + 16 gates a bar. So a knob may follow the interaction at a few updates a second.
 * WHAT A KNOB CANNOT DO the worklet does not smooth a knob: a step is a step. The mapping therefore GLIDES — at most
 *                       `slew` of the range per update, four updates a second — and never maps a DELAY TIME (the two
 *                       `Dist [m]` knobs set the echo network's delay; a stepped delay zips and clicks).
 * THE MAPPING           declarative: one row = one knob ← one SOURCE. A source is a number the engine already has,
 *                       −1..1, where 0 is the idle state. `hi` = the knob's value at source +1, `lo` (bipolar sources)
 *                       at −1, and 0 = the knob's REST = the value the artist saved in the patch. The rest is read
 *                       from the LOADED patch (`learn`), so re-tuning a knob in the editor moves its rest; the table's
 *                       rest is only the fallback. Leva `depth` scales every departure from the rest; mapping off (or
 *                       the patch stopped) → everything glides back to the rest.
 * SAFETY                every value is clamped to the knob's own range — a value outside it gets autosaved and breaks
 *                       the next load (A2). The hidden instrument never autosaves, and SetParam "value" is excluded
 *                       from autosave in the embed anyway. The bench (visible editor) does not run the mapping, so a
 *                       hand-turned knob there is saved with the artist's values, not ours.
 */

import type { NoiseCraftParam } from "./NoiseCraftBridge";

/** What the engine knows that a knob may follow (0 = idle). */
export interface KnobSources {
  /** People within earshot: 0 alone … 1 three or more. */
  company: number;
  /** Where I stand in a building's harmony: 0 outside, 0.5 in the ring, 1 in the zone. */
  zone: number;
  /** Open space, bipolar: −1 standing on concrete … +1 the arrival's glow (the hall opening). */
  space: number;
  /** 0..1 how close concrete is. */
  sealed: number;
  /** 0..1 my speed over the running speed. */
  speed: number;
  /** 1 while my weight really counts on a building with others (coBuilders), else 0. */
  together: number;
  /** 0..1 the lifespan's last stretch. */
  dying: number;
}

export const IDLE_SOURCES: KnobSources = { company: 0, zone: 0, space: 0, sealed: 0, speed: 0, together: 0, dying: 0 };

export interface KnobMap {
  /** The Knob node in nc_noise_patch. */
  nodeId: string;
  /** Its label in the patch (and what it does). */
  name: string;
  /** The knob's range in the patch (fallback; `learn` reads the loaded patch). */
  min: number;
  max: number;
  /** The artist's saved value = source 0 (fallback; `learn` reads the loaded patch). */
  rest: number;
  source: keyof KnobSources;
  /** The knob's value at source +1. */
  hi: number;
  /** The knob's value at source −1 (bipolar sources). */
  lo?: number;
  /** The largest change per update as a share of the range (default 0.04 → a full sweep in ~6 s at 4 Hz). */
  slew?: number;
  /** One line: what the listener hears. */
  why: string;
}

/** The default slew: a share of the knob's range per update. */
export const DEFAULT_SLEW = 0.04;
/** Changes smaller than this share of the range are not sent (the knob is "there"). */
export const DEAD_BAND = 0.002;

/**
 * nc_noise_patch's real-time knobs. Rests are the patch's saved values (2026-10-18); `learn` refreshes them.
 * Not mapped on purpose: BPM 22 (locked), clock 306 (the music clock, noisecraftDriver), the two `Dist [m]` (delay
 * times zip), the ADSR knobs (an envelope's shape is the artist's), `Vol CHORDS` 183 (their mix).
 */
export const KNOB_MAPS: readonly KnobMap[] = [
  { nodeId: "40", name: "% (v1 colour's random trigger)", min: 0, max: 1, rest: 0.248, source: "company", hi: 0.55, why: "the colour tone bubbles more among people (≈ 25 % alone → ≈ 55 % with three)" },
  { nodeId: "112", name: "% (v2 fifth's random trigger)", min: 0, max: 1, rest: 0.196, source: "zone", hi: 0.42, why: "the far bells ring more inside a building's zone" },
  { nodeId: "330", name: "harm vol", min: 0, max: 1, rest: 0.4, source: "zone", hi: 0.7, why: "the harmony layer comes forward in the zone" },
  { nodeId: "163", name: "REVERB WET", min: 0, max: 2, rest: 1.0, source: "space", lo: 0.45, hi: 1.7, slew: 0.08, why: "concrete dries the patch; the arrival opens it (with the engine's hall)" },
  { nodeId: "166", name: "DRY", min: 0, max: 1, rest: 0.377, source: "sealed", hi: 0.62, why: "inside a building the dry voice stands close while the echo retreats" },
  { nodeId: "171", name: "amt (distortion)", min: 0, max: 1, rest: 0.41, source: "speed", hi: 0.68, why: "running grinds the root's distortion" },
  { nodeId: "138", name: "FB (echo 1 feedback)", min: 0, max: 0.9, rest: 0.695, source: "dying", hi: 0.88, why: "the dying smears the patch's echo, as it smears the motif's" },
  { nodeId: "152", name: "FB (echo 2 feedback)", min: 0, max: 0.9, rest: 0.668, source: "dying", hi: 0.88, why: "(the second echo line)" },
  { nodeId: "141", name: "< (echo 1 band's upper edge)", min: 0, max: 1, rest: 0.812, source: "together", hi: 0.95, slew: 0.03, why: "building together opens the echo's highs (the artist: the patch's highs are quiet)" },
  { nodeId: "155", name: "< (echo 2 band's upper edge)", min: 0, max: 1, rest: 0.797, source: "together", hi: 0.95, slew: 0.03, why: "(the second echo line)" },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The knob's target for a source value and a depth (0 = rest), within its range. */
export function knobTarget(m: KnobMap, s: number, depth: number): number {
  const sv = clamp(s, -1, 1);
  const d = clamp(depth, 0, 1);
  const end = sv >= 0 ? m.hi : (m.lo ?? m.rest);
  return clamp(m.rest + d * Math.abs(sv) * (end - m.rest), m.min, m.max);
}

/**
 * Glides the mapped knobs toward their targets, one `step` per update: returns only the knobs that moved, each
 * within its range. `step(null, …)` = everything back to the rest (mapping off / patch stopped).
 */
export class KnobMapper {
  readonly maps: KnobMap[];
  /** The value last sent per knob (the patch holds it); absent = at the rest. */
  private sent = new Map<string, number>();

  constructor(maps: readonly KnobMap[] = KNOB_MAPS) {
    this.maps = maps.map((m) => ({ ...m }));
  }

  /** The loaded patch's own range and rest for each knob (the editor may have re-tuned it); unknown knobs keep the table. */
  learn(info: (nodeId: string) => { min?: number; max?: number; value?: number } | null | undefined): void {
    for (const m of this.maps) {
      const n = info(m.nodeId);
      if (!n) continue;
      if (typeof n.min === "number" && typeof n.max === "number" && n.max > n.min) {
        m.min = n.min;
        m.max = n.max;
      }
      if (typeof n.value === "number" && Number.isFinite(n.value)) m.rest = clamp(n.value, m.min, m.max);
    }
  }

  /** The patch was (re)loaded: its knobs sit at their rests again. */
  reset(): void {
    this.sent.clear();
  }

  /** The value the patch holds now for a knob. */
  current(nodeId: string): number {
    const m = this.maps.find((x) => x.nodeId === nodeId);
    return this.sent.get(nodeId) ?? m?.rest ?? 0;
  }

  /** How many knobs are away from their rest. */
  get moved(): number {
    let n = 0;
    for (const m of this.maps) {
      const v = this.sent.get(m.nodeId);
      if (v != null && Math.abs(v - m.rest) > DEAD_BAND * (m.max - m.min)) n++;
    }
    return n;
  }

  step(src: KnobSources | null, depth: number): NoiseCraftParam[] {
    const out: NoiseCraftParam[] = [];
    for (const m of this.maps) {
      const range = m.max - m.min;
      const target = src ? knobTarget(m, src[m.source], depth) : m.rest;
      const cur = this.sent.get(m.nodeId) ?? m.rest;
      const delta = target - cur;
      if (Math.abs(delta) < DEAD_BAND * range) continue;
      const maxStep = (m.slew ?? DEFAULT_SLEW) * range;
      const next = clamp(cur + clamp(delta, -maxStep, maxStep), m.min, m.max);
      const value = +next.toFixed(4);
      this.sent.set(m.nodeId, value);
      out.push({ nodeId: m.nodeId, paramName: "value", value });
    }
    return out;
  }
}

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
  // ── THE PATCH REACTS TO CHANGES (§8e — the artist, 2026-11-27: "noisecraft 패치 노브도 변화에 반응하는 식으로 좀 더
  // 개입"; the redesigned view only, each behind its own switch; 0 whenever off) ──
  /** 0..1 how far a tense phrase has climbed: 0 on its first bar … 1 on its dominant; back to 0 the moment home comes. */
  tension: number;
  /** 0..1 the echo hanging on: a question just called (a fast rise, a slow fall), or the tension (part of it). */
  hang: number;
  /** 0..1 a pluck: the chord just changed on this bar (more for a tense chord), or my answer just began. */
  pluck: number;
  /** 1 while the ensemble plays, else 0. */
  ensemble: number;
  /** 0..1 a resolution just landed (home after a held tension, the arrival's tonic, the amen): a bloom over ~3 s. */
  bloom: number;
  /** 0..1 how much a formed path is under my feet. */
  path: number;
  /** 0..1 a found word's melody just began (the leaver's): a shimmer over ~4 s. */
  found: number;
  // (each reacting source comes already scaled by its Leva width, 0 … 2 — so it may reach 2: twice the row's departure)
}

export const IDLE_SOURCES: KnobSources = { company: 0, zone: 0, space: 0, sealed: 0, speed: 0, together: 0, tension: 0, hang: 0, pluck: 0, ensemble: 0, bloom: 0, path: 0, found: 0 };

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
  /** The same on the way back toward the rest (default = slew): fast = a release that opens at once, slow = a tail. */
  release?: number;
  /** The highest value ever sent, below the knob's own max (a feedback stays short of running away, whatever the width). */
  cap?: number;
  /** One line: what the listener hears. */
  why: string;
}

/** The default slew: a share of the knob's range per update. */
export const DEFAULT_SLEW = 0.04;
/** Changes smaller than this share of the range are not sent (the knob is "there"). */
export const DEAD_BAND = 0.002;

/**
 * nc_noise_patch's real-time knobs. Rests are the patch's saved values (2026-10-18); `learn` refreshes them.
 * Not mapped on purpose: BPM 22 and clock 306 (the music clock writes both, noisecraftDriver), the two `Dist [m]` (delay
 * times zip), the ADSR knobs (an envelope's shape is the artist's), the cross-delay times 74 · 79 (delay times again).
 */
export const KNOB_MAPS: readonly KnobMap[] = [
  { nodeId: "40", name: "% (v1 colour's random trigger)", min: 0, max: 1, rest: 0.248, source: "company", hi: 0.55, why: "the colour tone bubbles more among people (≈ 25 % alone → ≈ 55 % with three)" },
  { nodeId: "112", name: "% (v2 fifth's random trigger)", min: 0, max: 1, rest: 0.196, source: "together", hi: 0.45, slew: 0.06, why: "building together: the far bells ring about twice as often (≈ 20 % → 45 %)" },
  { nodeId: "330", name: "harm vol", min: 0, max: 1, rest: 0.4, source: "together", hi: 0.85, slew: 0.06, why: "building together: the harmony layer comes right forward" },
  { nodeId: "183", name: "Vol CHORDS", min: 0, max: 1, rest: 0.373, source: "zone", hi: 0.6, why: "the chords layer (the colour swell, the harmony) lifts in the zone" },
  { nodeId: "163", name: "REVERB WET", min: 0, max: 2, rest: 1.0, source: "space", lo: 0.45, hi: 1.7, slew: 0.08, why: "concrete dries the patch; the arrival opens it (with the engine's hall)" },
  { nodeId: "166", name: "DRY", min: 0, max: 1, rest: 0.377, source: "sealed", hi: 0.62, why: "inside a building the dry voice stands close while the echo retreats" },
  { nodeId: "171", name: "amt (distortion)", min: 0, max: 1, rest: 0.41, source: "speed", hi: 0.68, why: "running grinds the root's distortion" },
  { nodeId: "141", name: "< (echo 1 band's upper edge)", min: 0, max: 1, rest: 0.812, source: "together", hi: 0.95, slew: 0.03, why: "building together opens the echo's highs (the artist: the patch's highs are quiet)" },
  { nodeId: "155", name: "< (echo 2 band's upper edge)", min: 0, max: 1, rest: 0.797, source: "together", hi: 0.95, slew: 0.03, why: "(the second echo line)" },
  // ── reacting to changes (§8e) ──
  // TENSION AS TIMBRE: while a tense phrase climbs to its dominant the voices grow edgier (more saw), beat (detune) and
  // darken (cutoff base down); the moment home comes, all of it opens back at once (a fast release)
  { nodeId: "241", name: "Knob (v0 root's saw level)", min: 0, max: 1, rest: 0.755, source: "tension", hi: 1, release: 0.25, why: "the root grows edgier as the tension climbs" },
  { nodeId: "247", name: "Knob (v1 colour's first saw level)", min: 0, max: 1, rest: 0.502, source: "tension", hi: 0.8, release: 0.25, why: "the colour tone grows edgier" },
  { nodeId: "249", name: "Knob (v1 colour's second saw level)", min: 0, max: 1, rest: 0.502, source: "tension", hi: 0.8, release: 0.25, why: "(the second saw)" },
  { nodeId: "256", name: "Knob (v2 fifth's saw level)", min: 0, max: 1, rest: 0.404, source: "tension", hi: 0.7, release: 0.25, why: "the far bell grows edgier" },
  { nodeId: "206", name: "fact (detune)", min: 0, max: 0.1, rest: 0.023, source: "tension", hi: 0.06, release: 0.25, why: "the voices beat against each other as the tension climbs" },
  { nodeId: "57", name: "+ (v0 root's cutoff base)", min: 0, max: 1, rest: 0.148, source: "tension", hi: 0.08, release: 0.25, why: "the root darkens while it leans, and opens when home comes" },
  { nodeId: "64", name: "+ (v1 colour's cutoff base)", min: 0, max: 1, rest: 0.276, source: "tension", hi: 0.17, release: 0.25, why: "the colour tone darkens while it leans" },
  // THE ECHO HANGS ON: a question just called (and part of the tension) — more feedback in both echo lines, a slow fall
  { nodeId: "138", name: "FB (echo 1 feedback)", min: 0, max: 0.9, rest: 0.695, source: "hang", hi: 0.84, slew: 0.12, release: 0.03, cap: 0.86, why: "a question stays in the air" },
  { nodeId: "152", name: "FB (echo 2 feedback)", min: 0, max: 0.9, rest: 0.668, source: "hang", hi: 0.84, slew: 0.12, release: 0.03, cap: 0.86, why: "(the second echo line)" },
  // A PLUCK: the chord changed on this bar, or my answer began — each note's filter opens wider for a moment
  { nodeId: "56", name: "* (v0 root's filter envelope depth)", min: 0, max: 1, rest: 0.568, source: "pluck", hi: 0.9, slew: 0.35, release: 0.05, why: "a chord change (or my answer) plucks the root bright" },
  { nodeId: "63", name: "* (v1 colour's filter envelope depth)", min: 0, max: 1, rest: 0.394, source: "pluck", hi: 0.75, slew: 0.35, release: 0.05, why: "and the colour tone" },
  { nodeId: "121", name: "* (v2 fifth's filter envelope depth)", min: 0, max: 1, rest: 0.373, source: "pluck", hi: 0.7, slew: 0.35, release: 0.05, why: "and the far bell" },
  // THE ENSEMBLE SHARES A ROOM: more of the patch into the cross-delay while it plays
  { nodeId: "301", name: "Knob (into the cross-delay)", min: 0, max: 1, rest: 0.483, source: "ensemble", hi: 0.78, why: "while the ensemble plays the patch sits in one shared room" },
  // A BLOOM WHEN IT RESOLVES: the cross-delay feeds back longer and the chords layer opens — the resolved chord blooms
  // and repeats round the room, then settles (the loop gain 76 × 81 stays below 1: cap)
  { nodeId: "76", name: "fact (cross-delay feedback L)", min: 0, max: 1, rest: 0.723, source: "bloom", hi: 0.86, slew: 0.2, release: 0.03, cap: 0.92, why: "a resolution rings on round the room" },
  { nodeId: "81", name: "fact (cross-delay feedback R)", min: 0, max: 1, rest: 0.741, source: "bloom", hi: 0.86, slew: 0.2, release: 0.03, cap: 0.92, why: "(the other side)" },
  { nodeId: "287", name: "* (chords layer's filter envelope depth)", min: 0, max: 1, rest: 0.3, source: "bloom", hi: 0.65, slew: 0.3, release: 0.05, why: "the chords layer opens on the resolved chord" },
  { nodeId: "288", name: "+ (chords layer's cutoff base)", min: 0, max: 1, rest: 0.184, source: "bloom", hi: 0.34, slew: 0.2, release: 0.04, why: "and brightens" },
  // CLEAR ON A PATH: the echo's low end thins and the far bell brightens — the rhythm of walking a path stands out
  { nodeId: "142", name: "> (echo 1 band's lower edge)", min: 0, max: 1, rest: 0.588, source: "path", hi: 0.72, why: "on a path the echo thins: less murk, the pulse clearer" },
  { nodeId: "156", name: "> (echo 2 band's lower edge)", min: 0, max: 1, rest: 0.547, source: "path", hi: 0.7, why: "(the second echo line)" },
  { nodeId: "122", name: "+ (v2 fifth's cutoff base)", min: 0, max: 1, rest: 0.206, source: "path", hi: 0.3, why: "the far bell brightens on a path" },
  // A FOUND WORD SHIMMERS: the far bell's pitch wavers on each note and its sine comes forward while the leaver's melody plays
  { nodeId: "271", name: "fact (v2 fifth's pitch envelope)", min: 0, max: 0.1, rest: 0.015, source: "found", hi: 0.05, slew: 0.3, release: 0.04, why: "the bell wavers while a found word sounds" },
  { nodeId: "254", name: "Knob (v2 fifth's sine level)", min: 0, max: 1, rest: 0.6, source: "found", hi: 0.85, slew: 0.2, release: 0.04, why: "and comes forward" },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The knob's target for a source value and a depth (0 = rest), within its range. */
export function knobTarget(m: KnobMap, s: number, depth: number): number {
  // (a source may reach 2: a Leva width of twice the row's departure — §8e; still within the knob's range and cap)
  const sv = clamp(s, -2, 2);
  const d = clamp(depth, 0, 1);
  const end = sv >= 0 ? m.hi : (m.lo ?? m.rest);
  return clamp(m.rest + d * Math.abs(sv) * (end - m.rest), m.min, Math.min(m.max, m.cap ?? m.max));
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
      // (on the way back toward the rest a row may glide at its own pace: a release that opens at once, or a tail)
      const back = Math.abs(target - m.rest) < Math.abs(cur - m.rest);
      const maxStep = ((back ? m.release : undefined) ?? m.slew ?? DEFAULT_SLEW) * range;
      const next = clamp(cur + clamp(delta, -maxStep, maxStep), m.min, m.max);
      const value = +next.toFixed(4);
      this.sent.set(m.nodeId, value);
      out.push({ nodeId: m.nodeId, paramName: "value", value });
    }
    return out;
  }
}

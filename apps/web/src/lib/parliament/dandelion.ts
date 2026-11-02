/**
 * parliament/dandelion.ts — what an answer leaves (the artist, 2026-11-01: "민들레 홀씨 같은 거", then: on the wall only,
 * longer and plainly, powder flying when it is born; in the player's frame only a burst of points, gone in a moment).
 * When a visitor answers someone (SessionHud → RoleField) one `k = "s"` event goes in the log where they stood, with the
 * role "tree", so the fold, the vegetation and the sound do not count it as presence. The wall draws a seed head from it
 * at the height of its time (Dandelions.tsx): large at first, smaller once its powder has flown, and where the layer
 * fossilises some heads go and some stay. No two are quite alike (SeedJitter). The wind carries the word to a few other
 * places: there, and at the head, the next one who passes finds it ("(기호)가 남긴 말 발견").
 *
 * Pure and deterministic: everything about a head or a burst follows from its id and its age.
 */

import { hashString, rng } from "@/lib/sound/motif";
import type { PEvent } from "./types";
import { wrapCoord } from "./world";

export interface Dandelion {
  id: string;
  o: string;
  x: number;
  z: number;
  s: number;
}

/** A place someone's word can be found. */
export interface WordSpot {
  o: string;
  x: number;
  z: number;
}

/** The most spokes a head can have (the wall's buffers are sized by it). */
export const MAX_SPOKES = 64;
/** The places the wind carries a head's word to: when each is reached (s after the answer) and how far it is (world). */
const LANDINGS = 6;
const LAND_MIN = 18;
const LAND_SPREAD = 22;
const CARRY_MIN = 5;
const CARRY_SPREAD = 12;
const TAU = Math.PI * 2;

const ease = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));
/** A draw u (0 … 1) as a multiplier: 1 at amount 0; a third to three times at amount 1. */
const spread = (amount: number, u: number) => 3 ** (amount * (2 * u - 1));

/** The heads in the log. */
export function dandelionsIn(events: readonly PEvent[]): Dandelion[] {
  const out: Dandelion[] = [];
  for (const e of events) if (e.k === "s") out.push({ id: e.id, o: e.o, x: e.x, z: e.z, s: e.s });
  return out;
}

/** How much the heads differ from one another, each thing on its own (0: all alike … 1: a third to three times). */
export interface SeedJitter {
  /** The whole head. */
  size: number;
  /** The stem and each spoke. */
  shape: number;
  /** Each seed and each grain of powder. */
  dot: number;
  /** How many spokes a head has. */
  spokes: number;
  /** How bright a head is: 0: all full … 1: from black to full. */
  light: number;
  dustCount: number;
  dustReach: number;
  dustSec: number;
}

export const NO_JITTER: SeedJitter = { size: 0, shape: 0, dot: 0, spokes: 0, light: 0, dustCount: 0, dustReach: 0, dustSec: 0 };

/** One head's own share of the jitter (multipliers), and what decides its end. */
export interface HeadVariation {
  size: number;
  stem: number;
  spokes: number;
  /** 0 … 1. */
  light: number;
  dustCount: number;
  dustReach: number;
  dustSec: number;
  /** 0 … 1: below the keep share, it stays. */
  fate: number;
  /** −1 … 1: whether it fossilises above or below the others. */
  early: number;
}

export function headVariation(id: string, j: SeedJitter): HeadVariation {
  const r = rng(hashString(`${id}:v`));
  return {
    size: spread(j.size, r()),
    stem: spread(j.shape, r()),
    spokes: spread(j.spokes, r()),
    light: 1 - j.light * r(),
    dustCount: spread(j.dustCount, r()),
    dustReach: spread(j.dustReach, r()),
    dustSec: spread(j.dustSec, r()),
    fate: r(),
    early: 2 * r() - 1,
  };
}

/** A head's life on the wall. */
export interface HeadLife {
  /** How long a new head takes to grow to its full size (s; 0: there at once). */
  growSec: number;
  /** What it shrinks to once its powder has flown (× its size), and how long that takes (s). */
  settle: number;
  settleSec: number;
  /** How far below the present (steps) it fossilises, and how much that differs between heads (steps, ±). */
  fossilDepth: number;
  fossilSpread: number;
  /** The share of the heads that stay when they fossilise; how many steps the change takes. */
  keep: number;
  goneSteps: number;
  /** What the ones that stay become: their size and brightness (× what they were), and the share of their spokes left. */
  fossilScale: number;
  fossilLight: number;
  fossilSpokes: number;
}

/** A head now: its size (×; 0: gone), its brightness (×) and the share of its spokes left. */
export interface HeadState {
  scale: number;
  light: number;
  spokes: number;
}

/**
 * A head's state now. `sinceBornSec`: since the wall first read it (null: it was there already, so it has long settled);
 * `depth`: its steps below the present; `dustEndSec`: when its own powder has all flown.
 */
export function headState(v: HeadVariation, sinceBornSec: number | null, depth: number, dustEndSec: number, c: HeadLife): HeadState {
  let scale = c.settle;
  if (sinceBornSec !== null) {
    if (sinceBornSec < dustEndSec + c.settleSec) scale = 1 + (c.settle - 1) * ease(clamp01((sinceBornSec - dustEndSec) / Math.max(0.01, c.settleSec)));
    if (c.growSec > 0) scale *= ease(clamp01(sinceBornSec / c.growSec));
  }
  const t = clamp01((depth - (c.fossilDepth + c.fossilSpread * v.early)) / Math.max(0.01, c.goneSteps));
  if (v.fate >= c.keep) return { scale: scale * (1 - t), light: 1, spokes: 1 };
  return { scale: scale * (1 + (c.fossilScale - 1) * t), light: 1 + (c.fossilLight - 1) * t, spokes: 1 + (c.fossilSpokes - 1) * t };
}

/** What a head is drawn at. */
export interface HeadDraw {
  /** The stem's length and the ball's radius (world). */
  stem: number;
  radius: number;
  /** How many spokes, and the share of them still there. */
  spokes: number;
  keepSpokes: number;
  /** Where they gather: 0: all over the ball … 1: the upper half only. */
  dome: number;
  /** The jitter of each spoke's length. */
  shape: number;
  /** A seed's world size and its jitter. */
  dot: number;
  dotJitter: number;
}

/**
 * One head, its foot at (x, y, z): the stem and the spokes go into `lines` (x, y, z pairs), the seeds into `dots` (x, y, z)
 * and their world sizes into `dotSizes`. Returns the height of the middle of its ball.
 */
export function dandelionShape(id: string, x: number, y: number, z: number, h: HeadDraw, lines: number[], dots: number[], dotSizes: number[]): number {
  const cy = y + h.stem;
  const r = rng(hashString(id));
  const turn = r() * TAU;
  const n = Math.max(1, Math.min(MAX_SPOKES, Math.round(h.spokes)));
  lines.push(x, y, z, x, cy, z);
  for (let i = 0; i < n; i++) {
    const long = spread(h.shape, r()) * h.radius;
    const dot = h.dot * spread(h.dotJitter, r());
    const there = r();
    if (there >= h.keepSpokes) continue;
    // spokes spread evenly over the ball (a golden spiral), or over its upper part
    const dy = 1 - ((2 - h.dome) * (i + 0.5)) / n;
    const ring = Math.sqrt(Math.max(0, 1 - dy * dy));
    const a = i * 2.399963 + turn;
    const tx = x + Math.cos(a) * ring * long, ty = cy + dy * long, tz = z + Math.sin(a) * ring * long;
    lines.push(x, cy, z, tx, ty, tz);
    dots.push(tx, ty, tz);
    dotSizes.push(dot);
  }
  return cy;
}

/** Points thrown from one place: fast at first, then hanging in the air, each gone at a time of its own. */
export interface Scatter {
  count: number;
  /** The farthest a point gets (world). */
  reach: number;
  /** The longest a point lasts (s). */
  lifeSec: number;
  /** 0: every way alike … 1: all downwind (the wind's heading follows from the id). */
  wind: number;
  /** How far they have risen by the end, and how widely they waver on the way (world). */
  rise: number;
  waver: number;
  /** How far from the centre they start (world). */
  from: number;
  /** The wind's heading (radians), and how much it differs per id (0: exactly this … 1: any way). Without it: any way. */
  heading?: number;
  headingSpread?: number;
  /** How hard they leave: 1: steadily … 5: a hard burst, then hanging (default 3). */
  burst?: number;
  /** 0: all thrown at once … 1: thrown over a whole life, so it lasts twice as long. */
  emit?: number;
  /** How much their lives differ: 0: all the longest … 1: from nothing up to the longest (default 0.7). */
  lifeSpread?: number;
  /** How their light goes: below 1 late, above 1 early (default 1.5). */
  fade?: number;
  /** For `out.size`: a point's world size and its jitter. */
  dot?: number;
  dotJitter?: number;
}

/** When the last point of a scatter is gone (s). */
export const scatterEndSec = (c: Pick<Scatter, "lifeSec" | "emit">): number => c.lifeSec * (1 + (c.emit ?? 0));

/** Where a scatter is written: x, y, z per point, and if wanted its light (1 fading to 0) and world size. */
export interface ScatterOut {
  pos: Float32Array;
  light?: Float32Array;
  size?: Float32Array;
}

/** The points of a scatter still in the air at `ageSec`, written from point index `start`. Returns the index after the last one; stops when `pos` is full. */
export function scatterPoints(id: string, ageSec: number, x: number, y: number, z: number, c: Scatter, out: ScatterOut, start = 0): number {
  const age = Math.max(0, ageSec);
  const r = rng(hashString(id));
  const own = r();
  const heading = c.heading === undefined ? own * TAU : c.heading + (own - 0.5) * TAU * (c.headingSpread ?? 1);
  const wx = Math.cos(heading), wz = Math.sin(heading);
  const burst = c.burst ?? 3, emit = c.emit ?? 0, lifeSpread = c.lifeSpread ?? 0.7, fade = c.fade ?? 1.5;
  const { pos, light, size } = out;
  const room = Math.floor(pos.length / 3);
  let n = start;
  for (let i = 0; i < c.count && n < room; i++) {
    // the same draws for every point, gone or not, so each keeps its way
    const dy = 2 * r() - 1;
    const a = r() * TAU;
    const life = c.lifeSec * (1 - lifeSpread + lifeSpread * r());
    const far = c.reach * (0.25 + 0.75 * r());
    const phase = r() * TAU;
    const grain = r();
    const t = age - emit * c.lifeSec * r();
    if (t < 0 || t >= life) continue;
    const ring = Math.sqrt(1 - dy * dy);
    const dx = Math.cos(a) * ring, dz = Math.sin(a) * ring;
    const u = t / life;
    const go = far * (1 - (1 - u) ** burst);
    const sway = c.waver * u * Math.sin(phase + u * 9);
    pos[n * 3] = x + dx * c.from + (dx * (1 - c.wind) + wx * c.wind) * go - wz * sway;
    pos[n * 3 + 1] = y + dy * c.from + dy * (1 - c.wind) * go + c.rise * u;
    pos[n * 3 + 2] = z + dz * c.from + (dz * (1 - c.wind) + wz * c.wind) * go + wx * sway;
    if (light) light[n] = (1 - u) ** fade;
    if (size) size[n] = (c.dot ?? 0.1) * spread(c.dotJitter ?? 0, grain);
    n++;
  }
  return n;
}

/** Where others' words can be found now: at each head, and in the places the wind has carried them to by now. */
export function wordSpots(heads: readonly Dandelion[], meId: string, sNow: number): WordSpot[] {
  const out: WordSpot[] = [];
  for (const d of heads) {
    if (d.o === meId) continue;
    out.push({ o: d.o, x: d.x, z: d.z });
    const age = sNow - d.s;
    const r = rng(hashString(d.id));
    const wind = r() * TAU;
    for (let i = 0; i < LANDINGS; i++) {
      const angle = wind + (r() - 0.5) * 1.2;
      const carry = CARRY_MIN + r() * CARRY_SPREAD;
      const at = LAND_MIN + r() * LAND_SPREAD;
      if (age >= at) out.push({ o: d.o, x: wrapCoord(d.x + Math.cos(angle) * carry), z: wrapCoord(d.z + Math.sin(angle) * carry) });
    }
  }
  return out;
}

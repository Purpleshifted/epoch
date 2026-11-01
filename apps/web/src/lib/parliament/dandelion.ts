/**
 * parliament/dandelion.ts — what an answer leaves (the artist, 2026-11-01: "민들레 홀씨 같은 거"): when a visitor answers
 * someone (SessionHud → RoleField) a seed head stands where they stood, in the event log as one `k = "s"` event with the
 * role "tree", so the fold, the vegetation and the sound do not count it as presence. The wind takes its seeds one by one;
 * each comes down somewhere else and stays there as a dot. Where a seed has landed, the next one who passes finds a word
 * ("(기호)가 남긴 말 발견"). The personal view and the wall draw the same shape from the same event (Dandelions.tsx).
 *
 * Pure and deterministic: everything about a head follows from its event's id and its age.
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

export const SEEDS_PER_HEAD = 14;
/** These stay on the head for good: it thins but never quite goes bald. */
const SEEDS_KEPT = 4;
const STEM = 0.9;
const SPOKE = 0.55;
/** Seconds between one seed leaving and the next, at most; and how long a seed is in the air. */
const LEAVE_EVERY = 7;
const FLIGHT_MIN = 18;
const FLIGHT_SPREAD = 22;
/** How far the wind carries a seed (world). */
const CARRY_MIN = 5;
const CARRY_SPREAD = 12;

interface Seed {
  /** Unit direction of its spoke. */
  dx: number;
  dy: number;
  dz: number;
  /** Age (s) it leaves the head (Infinity: never), and how long it flies. */
  leaves: number;
  flies: number;
  /** Where it lands, from the head (world), and how high the wind lifts it on the way. */
  landX: number;
  landZ: number;
  lift: number;
}

const plans = new Map<string, Seed[]>();

function planOf(id: string): Seed[] {
  const cached = plans.get(id);
  if (cached) return cached;
  const r = rng(hashString(id));
  const wind = r() * Math.PI * 2;
  const seeds: Seed[] = [];
  let leaves = 0.5;
  for (let i = 0; i < SEEDS_PER_HEAD; i++) {
    // spokes spread evenly over the ball (a golden spiral)
    const y = 1 - (2 * (i + 0.5)) / SEEDS_PER_HEAD;
    const ring = Math.sqrt(1 - y * y);
    const a = i * 2.399963 + wind;
    const angle = wind + (r() - 0.5) * 1.2;
    const carry = CARRY_MIN + r() * CARRY_SPREAD;
    leaves += r() * LEAVE_EVERY;
    seeds.push({
      dx: Math.cos(a) * ring,
      dy: y,
      dz: Math.sin(a) * ring,
      leaves: i < SEEDS_PER_HEAD - SEEDS_KEPT ? leaves : Infinity,
      flies: FLIGHT_MIN + r() * FLIGHT_SPREAD,
      landX: Math.cos(angle) * carry,
      landZ: Math.sin(angle) * carry,
      lift: 0.6 + r() * 1.4,
    });
  }
  plans.set(id, seeds);
  return seeds;
}

/** The heads in the log. */
export function dandelionsIn(events: readonly PEvent[]): Dandelion[] {
  const out: Dandelion[] = [];
  for (const e of events) if (e.k === "s") out.push({ id: e.id, o: e.o, x: e.x, z: e.z, s: e.s });
  return out;
}

const ease = (u: number) => u * u * (3 - 2 * u);

/**
 * One head at `ageSec`, its foot at (x, y, z): the stem and the spokes still on it go into `lines` (x, y, z pairs), the
 * seeds, on the head, in the air and landed, into `dots` (x, y, z).
 */
export function dandelionShape(id: string, ageSec: number, x: number, y: number, z: number, size: number, lines: number[], dots: number[]): void {
  const age = Math.max(0, ageSec);
  const cy = y + STEM * size;
  lines.push(x, y, z, x, cy, z);
  for (const s of planOf(id)) {
    const tx = x + s.dx * SPOKE * size, ty = cy + s.dy * SPOKE * size, tz = z + s.dz * SPOKE * size;
    if (age < s.leaves) {
      lines.push(x, cy, z, tx, ty, tz);
      dots.push(tx, ty, tz);
      continue;
    }
    const u = Math.min(1, (age - s.leaves) / s.flies);
    const e = ease(u);
    dots.push(tx + (x + s.landX - tx) * e, ty + (y - ty) * e + s.lift * size * Math.sin(Math.PI * u), tz + (z + s.landZ - tz) * e);
  }
}

/** Where others' words can be found now: at each head, and where its seeds have come down. */
export function wordSpots(heads: readonly Dandelion[], meId: string, sNow: number): WordSpot[] {
  const out: WordSpot[] = [];
  for (const d of heads) {
    if (d.o === meId) continue;
    out.push({ o: d.o, x: d.x, z: d.z });
    const age = sNow - d.s;
    for (const s of planOf(d.id)) if (age >= s.leaves + s.flies) out.push({ o: d.o, x: wrapCoord(d.x + s.landX), z: wrapCoord(d.z + s.landZ) });
  }
  return out;
}

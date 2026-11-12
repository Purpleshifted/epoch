/**
 * ARRIVAL: WHEN A PART WAS FIRST THERE (the artist, 2026-11-12: "건물 지어지는 거 좀 더 연속적으로 보이게 가능한가?").
 *
 * The model (spaceModel.ts computeParts) regenerates a building's parts whenever its key changes and hands the wall
 * whole instance buffers, so a part simply existed from one result to the next: it popped. Here every part gets the
 * time it was first seen; the wall's shader lets it come in from that time on (arriveMaterial.ts).
 *
 * WHY A "BORN AT" PER INSTANCE IN THE SHADER (and not arriving instances animated on the main thread): the instance
 * buffers are already uploaded only when a result changes them, and one more attribute rides along with them — after
 * that the motion costs one uniform (the time) per frame, nothing per part, whether one part arrives or ten thousand,
 * and the wall's main thread (the bottleneck of 10/29) does no per-part work at all.
 *
 * IDENTITY: seed id + slot + kind + the part's index within that kind and slot, in the order boxesOfSeed emitted it
 * (the key its draws are made from, so it is stable while the building grows). A regenerated building's parts that
 * were already there keep their time, so nothing replays when a neighbour changes or a building gains a slot; only
 * the indexes beyond what the slot had are new. What is NOT building — the first result after a load or a reset, a
 * knob of the parts turned, a building drawn at another level of detail because the camera moved — is `quiet`: its
 * parts are simply there.
 *
 * Kept small: per building only how many parts each (slot, kind) had, and the times of those that arrived within
 * KEEP_S (the rest are long done). Pure but for the clock handed in; boxesOfSeed is not touched.
 */

import { PART_KINDS, type Box, type PartKind } from "./seeds";

/** A part that was there before anybody looked: born long ago (seconds on the model's arrival clock). */
export const ARRIVED = -1e6;
/** How long an arrival's time is remembered (s): longer than any duration + stagger the wall's knobs allow. */
export const KEEP_S = 90;

/**
 * THE ORDER OF BUILDING WITHIN A SLOT, as on a site: what is in the ground, the plinth, the columns, the masses, the
 * beams and braces, the floor plates, and last what hangs from them.
 */
const RANK: Record<PartKind, number> = { basement: 0, pile: 0, plinth: 1, column: 2, mass: 3, beam: 4, brace: 4, slab: 5, drip: 6 };
const RANKS = 6;
const KIND_INDEX = Object.fromEntries(PART_KINDS.map((k, i) => [k, i])) as Record<PartKind, number>;

/** Where in its slot's order a part starts (0 first … 1 last): half by its kind, half spread within the kind. */
export function arriveOrder(kind: PartKind, index: number): number {
  const spread = (index * 0.6180339887) % 1;
  return 0.5 * (RANK[kind] / RANKS) + 0.5 * spread;
}

interface Known {
  level: number;
  /** Parts per (slot, kind). */
  count: Map<number, number>;
  /** Parts that arrived within KEEP_S: key → [born, order]. */
  fresh: Map<number, [number, number]>;
}

export class Arrivals {
  private seeds = new Map<number, Known>();
  private at = new WeakMap<Box, [number, number]>();
  private last = -Infinity;

  /**
   * A building's parts were (re)generated at `now` (s) at this level of detail. `quiet`: whatever is new is not being
   * built (a load, a knob): it is simply there.
   */
  note(seed: number, level: number, parts: readonly Box[], now: number, quiet: boolean): void {
    const prev = this.seeds.get(seed);
    // another level of detail is another drawing of the same building, not building
    const still = quiet || (prev !== undefined && prev.level !== level);
    const count = new Map<number, number>();
    const fresh = new Map<number, [number, number]>();
    // THE TICK (the artist, 2026-11-12: "저렇게 하면 procedural 한 느낌 좀 죽는 거 아냐?" → parts appear whole, one a
    // tick, in the order the grammar made them): the n-th part that is new in this building now is n — the whole part
    // of a part's order; its fraction is the staged order (arriveOrder), for the ways that grow
    let seq = 0;
    for (const b of parts) {
      const sk = b.slot * 16 + KIND_INDEX[b.kind];
      const i = count.get(sk) ?? 0;
      count.set(sk, i + 1);
      const key = sk * 65536 + i;
      let a = prev?.fresh.get(key);
      if (a && now - a[0] > KEEP_S) a = undefined;
      if (!a && !still && !(prev && i < (prev.count.get(sk) ?? 0))) {
        a = [now, seq++ + Math.min(0.999, arriveOrder(b.kind, i))];
        this.last = now;
      }
      if (!a) continue;
      fresh.set(key, a);
      this.at.set(b, a);
    }
    this.seeds.set(seed, { level, count, fresh });
  }

  /** Whether anything may still be arriving at `now` (nothing: `of` need not be asked part by part). */
  any(now: number): boolean {
    return now - this.last <= KEEP_S;
  }

  /** [born (s), order] of a part still arriving — order = its number among the building's new parts (whole part) +
   *  its staged place 0 … 1 (fraction); undefined = it is there (ARRIVED). */
  of(b: Box): [number, number] | undefined {
    return this.at.get(b);
  }

  /** Buildings that are gone are forgotten (should one come back, it is built again). */
  keep(live: ReadonlySet<number>): void {
    for (const id of this.seeds.keys()) if (!live.has(id)) this.seeds.delete(id);
  }

  clear(): void {
    this.seeds.clear();
    this.last = -Infinity;
  }
}

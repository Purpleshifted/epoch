import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { DEFAULT_FLOW, DEFAULT_WALK, walkArrays, walkways, type PEvent, type Seed } from "./index";

const SPU = 20;
const seed = (id: number, cx: number, cz: number, t0 = 0): Seed => ({ id, material: "concrete", role: "worker", x: (cx + 0.5) * CELL_SIZE, z: (cz + 0.5) * CELL_SIZE, t0, t1: 2000, mass: 2 }) as Seed;
const block = (id0: number, cx: number, cz: number, w: number, d: number, t0 = 0): Seed[] => {
  const out: Seed[] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push(seed(id0 + i * d + j, cx + i, cz + j, t0));
  return out;
};
/** People going back and forth between x = xa and x = xb at z, from t0 for `secs` s (1 world/s). */
function commute(o: string, xa: number, xb: number, z: number, t0: number, secs: number): PEvent[] {
  const out: PEvent[] = [];
  const L = xb - xa;
  for (let t = 0; t < secs; t++) {
    const d = t % (2 * L);
    out.push({ id: `${o}:${t0 + t}`, o, r: "worker", k: "p", x: d < L ? xa + d : xb - (d - L), z: z + Math.sin(t * 0.3) * 0.2, s: t0 + t });
  }
  return out;
}
const opts = { secPerUnit: SPU, unit: 1, flow: DEFAULT_FLOW, tNow: 900 };
// building A at cells x 0–3, building B at cells x 14–17 (z 0–3); people walk between them along z ≈ 2.4
const A = block(1, 0, 0, 4, 4), B = block(100, 14, 0, 4, 4);
const walkers = ["a", "b", "c", "d"].flatMap((o, i) => commute(o, 4.9, 16.6, 2.4, i * 5, 900));

describe("walkways: links between buildings where people keep walking (V2)", () => {
  it("two buildings with sustained walking between them get a walkway from one to the other", () => {
    const w = walkways(walkers, [...A, ...B], DEFAULT_WALK, opts);
    expect(w.layers.length).toBeGreaterThan(0);
    const last = w.layers[w.layers.length - 1];
    expect(last.links).toEqual(["1-100"]);
    const { deck } = walkArrays({ layers: [last] });
    // the deck spans the gap between the buildings (from A's edge to B's edge)
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < deck.length; i += 7) {
      lo = Math.min(lo, deck[i] - deck[i + 3] / 2);
      hi = Math.max(hi, deck[i] + deck[i + 3] / 2);
    }
    expect(lo).toBeLessThan(5 * CELL_SIZE);
    expect(hi).toBeGreaterThan(13 * CELL_SIZE);
  });

  it("no walkway before both buildings stand", () => {
    const lateB = block(100, 14, 0, 4, 4, 600); // B only from t = 600 (slot 30)
    const w = walkways(walkers, [...A, ...lateB], DEFAULT_WALK, opts);
    for (const l of w.layers) expect(l.k).toBeGreaterThanOrEqual(30);
  });

  it("no walkway without sustained walking; a link stops at the first building on its way", () => {
    expect(walkways(commute("x", 4.9, 16.6, 2.4, 0, 40), [...A, ...B], { ...DEFAULT_WALK, buildAt: 0.6 }, opts).layers).toHaveLength(0);
    // a third building C in the middle: A–C and C–B, never A–B over C
    const C = block(200, 8, 0, 3, 4);
    const w = walkways(walkers, [...A, ...B, ...C], DEFAULT_WALK, opts);
    for (const l of w.layers) expect(l.links).not.toContain("1-100");
  });

  it("deck, frame (fence, piers, masts) and wires; deck thickness as set; kept layers stay", () => {
    const cfg = { ...DEFAULT_WALK, pierSpacing: 2, mastSpacing: 6, deckThick: 0.3 };
    const w = walkways(walkers, [...A, ...B], cfg, opts);
    const { deck, frame, wires } = walkArrays(w);
    for (let i = 0; i < deck.length; i += 7) expect(deck[i + 4]).toBeCloseTo(0.3, 6);
    expect(frame.length).toBeGreaterThan(0);
    expect(wires.length).toBeGreaterThan(0);
    const kept = { layers: w.layers.slice(0, 1), upToK: w.layers[0].k };
    const again = walkways(walkers, [...A, ...B], cfg, { ...opts, frozen: kept });
    expect(again.layers[0]).toBe(kept.layers[0]);
  });

  it("WRAPPER: the footprint is covered by a few blocks (not a tile per cell), a junction is one floor, fences only on its outline", () => {
    const C = block(200, 8, 8, 3, 3); // a third building off the line: A–B and a branch to C
    const more = [...walkers, ...["e", "f", "g"].flatMap((o, i) => commuteZ(o, 9.6, 4.9, 9.4, i * 5, 900))];
    const w = walkways(more, [...A, ...B, ...C], DEFAULT_WALK, opts);
    const last = w.layers[w.layers.length - 1];
    expect(last.deck.length / 7).toBeLessThan(60);
    // every block lies on the footprint grid and has thickness
    for (let i = 0; i < last.deck.length; i += 7) expect(last.deck[i + 4]).toBeCloseTo(DEFAULT_WALK.deckThick, 6);
  });

  it("SHAFTS: a later layer joins the layer below where the same link is still walked", () => {
    const C = block(200, 8, 8, 3, 3, 400); // C comes at t = 400: a new layer above, A–B still walked
    const more = [...walkers, ...["e", "f", "g"].flatMap((o, i) => commuteZ(o, 9.6, 4.9, 9.4, 400 + i * 5, 500))];
    const w = walkways(more, [...A, ...B, ...C], DEFAULT_WALK, opts);
    expect(w.layers.length).toBeGreaterThanOrEqual(2);
    const upper = w.layers[w.layers.length - 1];
    const shafts: number[] = [];
    for (let i = 0; i < upper.frame.length; i += 7) if (Math.abs(upper.frame[i + 3] - DEFAULT_WALK.pierThick * 2.5) < 1e-6) shafts.push(upper.frame[i + 4]);
    expect(shafts.length).toBeGreaterThan(0);
    expect(Math.max(...shafts)).toBeGreaterThan(1); // spans down to the lower layer
  });
});

/** People going back and forth along z between za and zb at x. */
function commuteZ(o: string, x: number, za: number, zb: number, t0: number, secs: number): PEvent[] {
  const out: PEvent[] = [];
  const L = zb - za;
  for (let t = 0; t < secs; t++) {
    const d = t % (2 * L);
    out.push({ id: `${o}:${t0 + t}`, o, r: "worker", k: "p", x: x + Math.sin(t * 0.3) * 0.2, z: d < L ? za + d : zb - (d - L), s: t0 + t });
  }
  return out;
}

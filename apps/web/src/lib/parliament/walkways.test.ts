import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { DEFAULT_FLOW, DEFAULT_WALK, pathLines, walkways, type PEvent, type Seed } from "./index";

const ev = (o: string, x: number, z: number, s: number): PEvent => ({ id: `${o}:${s}`, o, r: "worker", k: "p", x, z, s });
/** People walking back and forth along x ∈ [0, 20] at z = 5.3, from t0, for `secs` s. */
function shuttle(o: string, t0: number, secs: number): PEvent[] {
  const out: PEvent[] = [];
  for (let t = 0; t < secs; t++) {
    const d = t % 40;
    out.push(ev(o, d < 20 ? d : 40 - d, 5.3, t0 + t));
  }
  return out;
}
const opts = { secPerUnit: 20, unit: 1, flow: DEFAULT_FLOW, tNow: 900 };
const route = ["a", "b", "c", "d"].flatMap((o, i) => shuttle(o, i * 7, 900));
const isDeck = (b: Float32Array, i: number) => Math.abs(b[i + 4] - DEFAULT_WALK.deckThick) < 1e-6 && b[i + 5] > 0.1;

describe("path centre lines", () => {
  it("a band of cells three wide becomes one straight line along its middle", () => {
    const cells: [number, number][] = [];
    for (let x = 0; x < 15; x++) for (let z = 4; z <= 6; z++) cells.push([x, z]);
    const lines = pathLines(cells);
    expect(lines).toHaveLength(1);
    const l = lines[0];
    expect(l.length / 3).toBe(2); // simplified to its two ends
    expect(l[1]).toBeCloseTo(5.5 * CELL_SIZE, 6);
    expect(l[4]).toBeCloseTo(5.5 * CELL_SIZE, 6);
    expect(l[2]).toBeGreaterThan(CELL_SIZE * 0.4); // half-width from the band
  });
  it("an L becomes two stretches meeting at the corner", () => {
    const cells: [number, number][] = [];
    for (let x = 0; x < 10; x++) cells.push([x, 0]);
    for (let z = 1; z < 10; z++) cells.push([9, z]);
    const pts = pathLines(cells).reduce((a, l) => a + l.length / 3, 0);
    expect(pts).toBeLessThanOrEqual(4);
  });
});

describe("walkways: sustained paths built as light bridges along their centre lines (V2)", () => {
  it("a kept-up route gets long slabs with thickness along its line (not a tile per cell), laid once while it stays", () => {
    const w = walkways(route, [], DEFAULT_WALK, opts);
    expect(w.layers.length).toBeGreaterThanOrEqual(1);
    expect(w.layers.length).toBeLessThanOrEqual(3);
    const decks: number[] = [];
    for (let i = 0; i < w.boxes.length; i += 7) if (isDeck(w.boxes, i)) decks.push(i);
    expect(decks.length).toBeGreaterThan(0);
    const perLayer = decks.length / w.layers.length;
    expect(perLayer).toBeLessThan(5); // a few long stretches, not ~17 tiles
    for (const i of decks) {
      expect(Math.abs(Math.sin(w.boxes[i + 6]))).toBeLessThan(0.2); // along x
      expect(w.boxes[i + 3]).toBeGreaterThan(CELL_SIZE * 3); // long
    }
  });

  it("piers reach down, masts up, wires come down from the masts to the deck", () => {
    const w = walkways(route, [], { ...DEFAULT_WALK, pierSpacing: 2, mastSpacing: 6 }, opts);
    const k = w.layers[w.layers.length - 1]; // the latest layer (the first may have had too little to draw)
    const tall: number[] = [];
    for (let i = 0; i < w.boxes.length; i += 7) if (w.boxes[i + 4] > 1) tall.push(w.boxes[i + 1]);
    expect(tall.some((y) => y < k && y > k - DEFAULT_WALK.pierDepth)).toBe(true); // a pier hangs below that deck
    expect(tall.some((y) => y > k + 0.5)).toBe(true); // a mast stands above it
    expect(w.wires.length).toBeGreaterThan(0);
    for (let i = 0; i < w.wires.length; i += 6) expect(w.wires[i + 1]).toBeGreaterThan(w.wires[i + 4]);
  });

  it("nothing without sustained flow; off = nothing", () => {
    expect(walkways(shuttle("x", 0, 30), [], DEFAULT_WALK, opts).boxes.length).toBe(0);
    expect(walkways(route, [], { ...DEFAULT_WALK, enabled: false }, opts).boxes.length).toBe(0);
    const seeds = [{ id: 1, material: "concrete", role: "worker", x: 10.2, z: 5.3, t0: 0, t1: 900, mass: 2 } as Seed];
    expect(walkways(route, seeds, DEFAULT_WALK, opts).boxes.length).toBeGreaterThanOrEqual(0);
  });
});

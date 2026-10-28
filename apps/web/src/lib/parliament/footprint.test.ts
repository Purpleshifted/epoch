import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { WORLD_HALF, footprintLayout, type Ledger, type LedgerCell } from "./index";

const cell = (cx: number, cz: number, over: Partial<LedgerCell> = {}): LedgerCell => ({
  key: `${cx},${cz}`, cx, cz, grass: 0.8, firstT: 0, s: 0, sPeak: 0, pressMine: 0, pressPeak: 0, pressAll: 0, g: 0, pathP: 0, visits: 0, trodT: null, prePath: false, slab: null, slabSeenT: null, ...over,
});
const ledger = (cells: LedgerCell[], trail: { x: number; z: number; t: number }[]): Ledger => ({
  t: 0, sNow: 0, sStart: 0, cells: new Map(cells.map((c) => [c.key, c])), trail, walkedM: 0,
  grass: { pressed: 0, recovered: 0, underPaths: 0, underSlabs: 0, cells: 0 },
  ground: { cells: 0, newPath: 0, prePath: 0, prePathVisits: 0 },
  concrete: { cells: 0, mine: 0, total: 0, with: [], firstT: null, underMe: false },
  world: { pathCells: 0, slabCells: 0, pathTrodden: 0 },
  alone: { since: null, longest: 0 },
});

describe("the footprint map", () => {
  it("fits everything into the square, north up, in drawing order", () => {
    const l = ledger(
      [cell(0, 0, { sPeak: 1, pressPeak: 0.5 }), cell(3, 0, { trodT: 1, g: 2, pathP: 0.6 }), cell(0, 4, { slab: { mine: 5, total: 15, h: 1, bornS: 0, with: [] } })],
      [{ x: 0.6, z: 0.6, t: 0 }, { x: 4 * CELL_SIZE, z: 0.6, t: 1 }, { x: 0.6, z: 5 * CELL_SIZE, t: 2 }],
    );
    const f = footprintLayout(l, 160)!;
    expect(f).not.toBeNull();
    expect(f.cells.map((c) => c.kind)).toEqual(["press", "tread", "path", "slab"]);
    for (const c of f.cells) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(160.001);
      expect(c.y + c.w).toBeLessThanOrEqual(160.001);
    }
    for (const [x, y] of f.trail) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(160);
      expect(y).toBeLessThanOrEqual(160);
    }
    // north up: the cell at z = 4 is drawn above the one at z = 0
    const slab = f.cells.find((c) => c.kind === "slab")!, press = f.cells.find((c) => c.kind === "press")!;
    expect(slab.y).toBeLessThan(press.y);
    expect(f.end).toEqual(f.trail[2]);
    expect(f.cellPx).toBeGreaterThan(2);
  });

  it("a life across the world's edge stays one small picture", () => {
    const l = ledger([], [{ x: WORLD_HALF - 1, z: 0, t: 0 }, { x: -WORLD_HALF + 1, z: 0, t: 1 }, { x: -WORLD_HALF + 3, z: 1, t: 2 }]);
    const f = footprintLayout(l, 160)!;
    expect(f.cellPx).toBeGreaterThan(10); // a few cells, not the whole world
    expect(Math.abs(f.trail[0][0] - f.trail[1][0])).toBeLessThan(40);
  });

  it("nothing to draw → null", () => {
    expect(footprintLayout(ledger([], [{ x: 0, z: 0, t: 0 }]), 160)).toBeNull();
  });
});

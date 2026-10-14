import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/lib/stratum/field";
import { DEFAULT_FLOW, DEFAULT_WALK, otherLineNear, walkSegments, walkways, type PEvent, type Seed } from "./index";

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
const NO_RESURFACE = { ...DEFAULT_WALK, resurface: -1 };
/** Whether a layer's line starts or ends below the layer (a ramp from a line below). */
const rampsIn = (l: { k: number; lines: Float32Array[] }) => l.lines.some((line) => line[1] < l.k - 1e-3 || line[line.length - 2] < l.k - 1e-3);
/** The layers drawing the A–B line (z ≈ 2.4 between the buildings). */
const abLayersOf = (layers: { lines: Float32Array[] }[]) =>
  layers.filter((l) =>
    l.lines.some((line) => {
      let n = 0;
      for (let i = 0; i < line.length; i += 3) if (Math.abs(line[i + 2] - 2.4) < 1.5 && line[i] > 6 && line[i] < 16) n++;
      return n > line.length / 3 / 2;
    }),
  );

describe("walkways: the pre-layer as lines between buildings where people keep walking (V2)", () => {
  const allPts = (lines: Float32Array[]) => lines.flatMap((l) => Array.from({ length: l.length / 3 }, (_, i) => [l[i * 3], l[i * 3 + 1], l[i * 3 + 2]]));

  it("two buildings with sustained walking between them get a line from one to the other", () => {
    const w = walkways(walkers, [...A, ...B], DEFAULT_WALK, opts);
    expect(w.layers.length).toBeGreaterThan(0);
    const last = w.layers[w.layers.length - 1];
    expect(last.links).toEqual(["1-100"]);
    const xs = allPts(w.layers.flatMap((l) => l.lines)).map((p) => p[0]);
    expect(Math.min(...xs)).toBeLessThan(5 * CELL_SIZE);
    expect(Math.max(...xs)).toBeGreaterThan(13 * CELL_SIZE);
  });

  it("no line before both buildings stand", () => {
    const lateB = block(100, 14, 0, 4, 4, 600); // B only from t = 600 (slot 30)
    const w = walkways(walkers, [...A, ...lateB], DEFAULT_WALK, opts);
    for (const l of w.layers) expect(l.k).toBeGreaterThanOrEqual(30);
  });

  it("no line without sustained walking; a link stops at the first building on its way", () => {
    expect(walkways(commute("x", 4.9, 16.6, 2.4, 0, 40), [...A, ...B], { ...DEFAULT_WALK, buildAt: 0.6 }, opts).layers).toHaveLength(0);
    const C = block(200, 8, 0, 3, 4);
    const w = walkways(walkers, [...A, ...B, ...C], DEFAULT_WALK, opts);
    for (const l of w.layers) expect(l.links).not.toContain("1-100");
  });

  it("the line is smooth (not only grid directions) and never on a building cell", () => {
    const C = block(200, 8, 8, 3, 3);
    const more = [...walkers, ...["e", "f", "g"].flatMap((o, i) => commuteZ(o, 9.6, 4.9, 9.4, i * 5, 900))];
    const seeds = [...A, ...B, ...C];
    const w = walkways(more, seeds, DEFAULT_WALK, opts);
    const built = new Set(seeds.map((s) => `${Math.floor(s.x / CELL_SIZE)},${Math.floor(s.z / CELL_SIZE)}`));
    const angles = new Set<number>();
    for (const l of w.layers.flatMap((x) => x.lines)) {
      for (let i = 0; i + 5 < l.length; i += 3) {
        const dx = l[i + 3] - l[i], dz = l[i + 5] - l[i + 2];
        if (Math.hypot(dx, dz) > 1e-4) angles.add(Math.round((Math.atan2(dz, dx) * 180) / Math.PI));
      }
      for (let i = 0; i < l.length; i += 3) expect(built.has(`${Math.floor(l[i] / CELL_SIZE)},${Math.floor(l[i + 2] / CELL_SIZE)}`)).toBe(false);
    }
    expect([...angles].some((a) => a % 45 !== 0)).toBe(true);
  });

  it("a later layer does not redraw a link still walked below; its new link RAMPS up from it", () => {
    const C = block(200, 8, 8, 3, 3, 400); // C comes at t = 400: a new link above, A–B still walked below
    const more = [...walkers, ...["e", "f", "g"].flatMap((o, i) => commuteZ(o, 9.6, 4.9, 9.4, 400 + i * 5, 500))];
    const w = walkways(more, [...A, ...B, ...C], NO_RESURFACE, opts);
    const first = w.layers.find((l) => l.drawn.includes("1-100"))!;
    const later = w.layers.filter((l) => l.k > first.k && l.drawn.length);
    expect(later.length).toBeGreaterThan(0);
    for (const l of later) expect(l.drawn).not.toContain("1-100");
    // a line of a later layer starts (or ends) lower than its layer: the ramp from the link below
    expect(later.some(rampsIn)).toBe(true);
  });

  it("a link walked all along is drawn once, however many later changes add layers", () => {
    const C = block(200, 8, 8, 3, 3, 300), D = block(300, 14, 8, 3, 3, 650);
    const more = [
      ...walkers,
      ...["e", "f", "g"].flatMap((o, i) => commuteZ(o, 9.6, 4.9, 9.4, 300 + i * 5, 600)),
      ...["h", "i", "j"].flatMap((o, i) => commuteZ(o, 18.6, 4.9, 9.4, 650 + i * 5, 250)),
    ];
    const w = walkways(more, [...A, ...B, ...C, ...D], NO_RESURFACE, opts);
    const firstDraws = w.layers.filter((l) => l.drawn.length).length;
    expect(firstDraws).toBeGreaterThanOrEqual(2);
    // the A–B line (y ≈ 2.4) is drawn in one layer only
    expect(abLayersOf(w.layers)).toHaveLength(1);
  });

  it("kept layers (below the present) stay; the ones above are drawn anew", () => {
    const w = walkways(walkers, [...A, ...B], DEFAULT_WALK, opts);
    const kept = { layers: w.layers.slice(0, 1), upToK: w.layers[0].k };
    const again = walkways(walkers, [...A, ...B], DEFAULT_WALK, { ...opts, frozen: kept });
    expect(again.layers[0]).toBe(kept.layers[0]);
    const seg = walkSegments(again, w.layers[0].k + 1);
    expect(seg.kept.length + seg.live.length).toBeGreaterThan(0);
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

describe("walkways arrive where there are parts", () => {
  it("no line in a slot where one of its buildings is in empty time", () => {
    // B is used only until t = 300 and again from 600: slots 15–29 are empty time for it
    const Bgap = block(100, 14, 0, 4, 4).map((s) => ({ ...s, spans: [[0, 300], [600, 2000]] as [number, number][] }));
    const w = walkways(walkers, [...A, ...Bgap], DEFAULT_WALK, opts);
    for (const l of w.layers) if (l.drawn.length) expect(l.k < 16 || l.k >= 30).toBe(true);
  });
});

describe("walkways: what joins what (in use, change, reach, re-surfacing)", () => {
  const C = block(200, 8, 8, 3, 3, 400);
  const branch = [...walkers, ...["e", "f", "g"].flatMap((o, i) => commuteZ(o, 9.6, 4.9, 9.4, 400 + i * 5, 500))];

  it("a long-used walkway is laid again every `resurface` slots (whole, flat), not only once", () => {
    const w = walkways(walkers, [...A, ...B], { ...DEFAULT_WALK, resurface: 10 }, opts);
    const ab = w.layers.filter((l) => l.drawn.includes("1-100"));
    expect(ab.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ab.length; i++) expect(ab[i].k - ab[i - 1].k).toBeGreaterThanOrEqual(10);
    for (const l of ab.slice(1)) {
      expect(l.resurfaced).toContain("1-100");
      expect(rampsIn(l)).toBe(false);
    }
  });

  it("a change joins only lines within `reach`: older ones are past, the new link is drawn whole", () => {
    const near = walkways(branch, [...A, ...B, ...C], { ...NO_RESURFACE, reach: 40, minorShare: 0 }, opts);
    expect(near.layers.some((l) => l.drawn.length && rampsIn(l))).toBe(true);
    const far = walkways(branch, [...A, ...B, ...C], { ...NO_RESURFACE, reach: 2, minorShare: 0 }, opts);
    expect(far.layers.some((l) => l.drawn.length)).toBe(true);
    for (const l of far.layers) expect(rampsIn(l)).toBe(false);
  });

  it("a new link mostly elsewhere (below `minorShare`) is a walkway of its own: no ramp", () => {
    const w = walkways(branch, [...A, ...B, ...C], { ...NO_RESURFACE, reach: 40, minorShare: 1.01 }, opts);
    expect(w.layers.filter((l) => l.k > 20).some((l) => l.drawn.length)).toBe(true);
    for (const l of w.layers) expect(rampsIn(l)).toBe(false);
  });

  it("a walkway left unused longer than `grace` is gone: taken again, it is drawn anew; within grace it is the same", () => {
    // A–B walked until t = 300, nobody from 300 to 700 (regrowth: tauSec), walked again from 700
    const gap = ["a", "b", "c", "d"].flatMap((o, i) => [...commute(o, 4.9, 16.6, 2.4, i * 5, 300), ...commute(o, 4.9, 16.6, 2.4, 700 + i * 5, 200)]);
    const o2 = { ...opts, flow: { ...DEFAULT_FLOW, tauSec: 60 } };
    const short = walkways(gap, [...A, ...B], { ...NO_RESURFACE, grace: 2 }, o2);
    expect(abLayersOf(short.layers).length).toBe(2);
    const long = walkways(gap, [...A, ...B], { ...NO_RESURFACE, grace: 40 }, o2);
    expect(abLayersOf(long.layers).length).toBe(1);
  });
});

describe("walkway segments: weights and free ends", () => {
  it("an end that arrives at nothing is listed as a free end (for a dot); decay lowers the weight of the whole line", () => {
    const w = walkways(walkers, [...A, ...B], DEFAULT_WALK, opts);
    const full = walkSegments(w, 0);
    expect(full.liveW.length).toBe(full.live.length / 3);
    expect(Math.min(...full.liveW)).toBe(1);
    expect(full.liveEnds.length).toBe(0);
    // only the A end holds: B has gone — the B end is free
    const line = w.layers[0].lines[0];
    const bEnd = [line[line.length - 3], line[line.length - 1]];
    const t = walkSegments(w, 0, { anchored: (x: number, _y: number, z: number) => Math.hypot(x - bEnd[0], z - bEnd[1]) > 2, decayOf: () => 0 });
    expect(t.liveEnds.length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...t.liveW)).toBe(1); // no fading out
    const old = walkSegments(w, 0, { anchored: () => true, decayOf: () => 0.5 });
    expect(Math.max(...old.liveW)).toBeCloseTo(0.5, 6);
  });
});

describe("walkway ends: a dot only where nothing is arrived at", () => {
  it("a ramp's foot stands on the line it leaves (no dot there); an end with nothing under it is free", () => {
    const C = block(200, 8, 8, 3, 3, 400);
    const more = [...walkers, ...["e", "f", "g"].flatMap((o, i) => commuteZ(o, 9.6, 4.9, 9.4, 400 + i * 5, 500))];
    const w = walkways(more, [...A, ...B, ...C], { ...DEFAULT_WALK, resurface: -1, reach: 40, minorShare: 0 }, opts);
    const onLine = otherLineNear(w, 1);
    // no parts at all: only the lines hold ends up
    const seg = walkSegments(w, 0, { anchored: (x, y, z, own) => onLine(x, y, z, own), decayOf: () => 0 });
    let id = -1, feet = 0;
    for (const l of w.layers)
      for (const line of l.lines) {
        id++;
        for (const i of [0, line.length / 3 - 1]) {
          if (line[i * 3 + 1] < l.k - 1e-3) {
            feet++;
            expect(onLine(line[i * 3], line[i * 3 + 1], line[i * 3 + 2], id)).toBe(true); // a ramp's foot
          }
        }
      }
    expect(feet).toBeGreaterThan(0);
    // and the dots are fewer than all ends: the feet are not among them
    const ends = w.layers.reduce((n, l) => n + l.lines.length * 2, 0);
    expect((seg.liveEnds.length + seg.keptEnds.length) / 4).toBeLessThanOrEqual(ends - feet);
  });
});

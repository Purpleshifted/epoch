import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEAD_BAND, DEFAULT_SLEW, IDLE_SOURCES, KNOB_MAPS, KnobMapper, knobTarget, type KnobMap } from "./noisecraftKnobs";

type Patch = { nodes: Record<string, { type: string; name?: string; params: { minVal?: number; maxVal?: number; value?: number } }> };
const patch = JSON.parse(readFileSync(path.join(process.cwd(), "public/noisecraft/examples/nc_noise_patch.ncft"), "utf8")) as Patch;

describe("the table: every mapped knob exists in nc_noise_patch and stays inside its range", () => {
  it("names real Knob nodes with the patch's own ranges and rests", () => {
    for (const m of KNOB_MAPS) {
      const n = patch.nodes[m.nodeId];
      expect(n, `knob ${m.nodeId} (${m.name})`).toBeDefined();
      expect(n.type).toBe("Knob");
      expect(n.params.minVal).toBe(m.min);
      expect(n.params.maxVal).toBe(m.max);
      expect(Math.abs((n.params.value ?? NaN) - m.rest), `rest of ${m.name}`).toBeLessThan(0.002);
    }
  });

  it("never maps the two clock knobs (the music clock writes them) or a delay time", () => {
    const ids = KNOB_MAPS.map((m) => m.nodeId);
    for (const forbidden of ["22", "306", "132", "146"]) expect(ids).not.toContain(forbidden);
  });

  it("keeps hi and lo within the knob's range", () => {
    for (const m of KNOB_MAPS) {
      expect(m.hi).toBeGreaterThanOrEqual(m.min);
      expect(m.hi).toBeLessThanOrEqual(m.max);
      if (m.lo != null) {
        expect(m.lo).toBeGreaterThanOrEqual(m.min);
        expect(m.lo).toBeLessThanOrEqual(m.max);
      }
    }
  });
});

describe("knobTarget", () => {
  const m: KnobMap = { nodeId: "x", name: "x", min: 0, max: 2, rest: 1, source: "space", lo: 0.4, hi: 1.8, why: "" };
  it("is the rest at source 0, hi at +1, lo at −1, scaled by depth, clamped to the range", () => {
    expect(knobTarget(m, 0, 1)).toBe(1);
    expect(knobTarget(m, 1, 1)).toBeCloseTo(1.8);
    expect(knobTarget(m, -1, 1)).toBeCloseTo(0.4);
    expect(knobTarget(m, 0.5, 1)).toBeCloseTo(1.4);
    expect(knobTarget(m, 1, 0.5)).toBeCloseTo(1.4);
    expect(knobTarget(m, 1, 0)).toBe(1);
    expect(knobTarget({ ...m, hi: 5 }, 1, 1)).toBe(2); // a careless hi never leaves the range
    expect(knobTarget(m, 3, 1)).toBe(2); // a careless source is clamped too: twice at most (a width of 2), then the range
    expect(knobTarget({ ...m, cap: 1.5 }, 2, 1)).toBe(1.5); // and the cap
  });
  it("a unipolar knob at −1 stays at the rest", () => {
    expect(knobTarget({ ...m, lo: undefined }, -1, 1)).toBe(1);
  });
});

describe("KnobMapper", () => {
  it("sends nothing while idle, glides toward a target in bounded steps, then holds", () => {
    const k = new KnobMapper();
    expect(k.step(IDLE_SOURCES, 1)).toEqual([]);
    expect(k.step(null, 1)).toEqual([]);
    const colour = KNOB_MAPS.find((m) => m.nodeId === "40")!;
    const values: number[] = [];
    for (let i = 0; i < 40; i++) {
      const out = k.step({ ...IDLE_SOURCES, company: 1 }, 1);
      const p = out.find((x) => x.nodeId === "40");
      if (p) values.push(p.value as number);
      expect(out.every((x) => x.paramName === "value")).toBe(true);
    }
    expect(values.length).toBeGreaterThan(3);
    for (let i = 1; i < values.length; i++) expect(values[i] - values[i - 1]).toBeLessThanOrEqual(DEFAULT_SLEW * (colour.max - colour.min) + 1e-6);
    expect(values[values.length - 1]).toBeCloseTo(colour.hi, 3);
    expect(k.step({ ...IDLE_SOURCES, company: 1 }, 1)).toEqual([]); // there: nothing more to send
    expect(k.moved).toBe(1);
  });

  it("a bipolar source pulls below the rest and never outside the range; the rest returns when the source is gone", () => {
    const k = new KnobMapper();
    const wet = KNOB_MAPS.find((m) => m.nodeId === "163")!;
    for (let i = 0; i < 40; i++) k.step({ ...IDLE_SOURCES, space: -1 }, 1);
    expect(k.current("163")).toBeCloseTo(wet.lo!, 3);
    for (let i = 0; i < 40; i++) k.step({ ...IDLE_SOURCES, space: 1 }, 1);
    expect(k.current("163")).toBeCloseTo(wet.hi, 3);
    expect(k.current("163")).toBeLessThanOrEqual(wet.max);
    for (let i = 0; i < 40; i++) k.step(null, 1);
    expect(k.current("163")).toBeCloseTo(wet.rest, 3);
    expect(k.moved).toBe(0);
  });

  it("learns the loaded patch's range and rest, ignores unknown knobs and nonsense, and resets to the rests", () => {
    const k = new KnobMapper([{ nodeId: "40", name: "t", min: 0, max: 1, rest: 0.25, source: "company", hi: 0.55, why: "" }]);
    k.learn((id) => (id === "40" ? { min: 0, max: 0.5, value: 0.3 } : null));
    expect(k.maps[0]).toMatchObject({ min: 0, max: 0.5, rest: 0.3 });
    k.learn(() => ({ min: 1, max: 0, value: NaN })); // an inverted range and NaN change nothing
    expect(k.maps[0]).toMatchObject({ min: 0, max: 0.5, rest: 0.3 });
    for (let i = 0; i < 40; i++) k.step({ ...IDLE_SOURCES, company: 1 }, 1);
    expect(k.current("40")).toBeCloseTo(0.5, 3); // hi 0.55 clamped to the learned max
    k.reset();
    expect(k.current("40")).toBe(0.3);
    expect(k.moved).toBe(0);
  });

  it("depth 0 keeps every knob at the artist's values", () => {
    const k = new KnobMapper();
    for (let i = 0; i < 10; i++) expect(k.step({ company: 1, zone: 1, space: 1, sealed: 1, speed: 1, together: 1, tension: 1, hang: 1, pluck: 1, ensemble: 1, bloom: 1, path: 1, found: 1 }, 0)).toEqual([]);
    expect(DEAD_BAND).toBeLessThan(0.01);
  });
});

describe("the patch reacts to changes (§8e)", () => {
  it("tension climbs at the usual pace and opens back at once when home comes", () => {
    const k = new KnobMapper();
    const saw = KNOB_MAPS.find((m) => m.nodeId === "241")!;
    let ticks = 0;
    while (Math.abs(k.current("241") - saw.hi) > 0.002 && ticks < 100) {
      k.step({ ...IDLE_SOURCES, tension: 1 }, 1);
      ticks++;
    }
    expect(ticks).toBeGreaterThan(4); // a glide, not a jump
    let back = 0;
    while (Math.abs(k.current("241") - saw.rest) > 0.002 && back < 100) {
      k.step({ ...IDLE_SOURCES, tension: 0 }, 1);
      back++;
    }
    expect(back).toBeLessThanOrEqual(2); // the release: at once
  });

  it("a pluck jumps in one update and falls back slowly; a hanging echo stays below the feedback's top", () => {
    const k = new KnobMapper();
    const env = KNOB_MAPS.find((m) => m.nodeId === "56")!;
    k.step({ ...IDLE_SOURCES, pluck: 1 }, 1);
    expect(k.current("56")).toBeCloseTo(env.hi, 3);
    k.step(IDLE_SOURCES, 1);
    expect(k.current("56")).toBeGreaterThan(env.hi - 0.06);
    for (let i = 0; i < 40; i++) k.step({ ...IDLE_SOURCES, hang: 1 }, 1);
    for (const id of ["138", "152"]) expect(k.current(id)).toBeLessThan(0.86);
  });

  it("every reacting row is idle at source 0 (nothing is sent while the switch is off)", () => {
    const k = new KnobMapper(KNOB_MAPS.filter((m) => ["tension", "hang", "pluck", "ensemble", "bloom", "path", "found"].includes(m.source)));
    expect(k.maps.length).toBe(22);
    expect(k.step(IDLE_SOURCES, 1)).toEqual([]);
  });

  it("a width of 2 doubles a departure, yet a feedback never passes its cap", () => {
    const k = new KnobMapper();
    for (let i = 0; i < 40; i++) k.step({ ...IDLE_SOURCES, hang: 2, bloom: 2 }, 1);
    for (const id of ["138", "152"]) expect(k.current(id)).toBeLessThanOrEqual(0.86);
    for (const id of ["76", "81"]) expect(k.current(id)).toBeLessThanOrEqual(0.92);
    const path = KNOB_MAPS.find((m) => m.nodeId === "142")!;
    for (let i = 0; i < 40; i++) k.step({ ...IDLE_SOURCES, path: 2 }, 1);
    expect(k.current("142")).toBeCloseTo(Math.min(path.max, path.rest + 2 * (path.hi - path.rest)), 3);
  });
});

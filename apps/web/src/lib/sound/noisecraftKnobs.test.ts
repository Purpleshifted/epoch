import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEAD_BAND, DEFAULT_SLEW, IDLE_SOURCES, KNOB_MAPS, KnobMapper, knobTarget, type KnobMap } from "./noisecraftKnobs";

type Patch = { nodes: Record<string, { type: string; name?: string; params: { minVal?: number; maxVal?: number; value?: number } }> };
const patch = JSON.parse(readFileSync(path.join(process.cwd(), "noisecraft/examples/nc_noise_patch.ncft"), "utf8")) as Patch;

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

  it("never maps the locked BPM, the music clock or a delay time", () => {
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
    expect(knobTarget(m, 3, 1)).toBeCloseTo(1.8); // a careless source is clamped too
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
    for (let i = 0; i < 10; i++) expect(k.step({ company: 1, zone: 1, space: 1, sealed: 1, speed: 1, together: 1 }, 0)).toEqual([]);
    expect(DEAD_BAND).toBeLessThan(0.01);
  });
});

import { describe, expect, it } from "vitest";
import { crackleDensity, grainDensity, renderCrackle } from "./crackle";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SR = 8000;
const noise = (() => {
  const r = rng(7);
  const out = new Float32Array(SR);
  for (let i = 0; i < out.length; i++) out[i] = r() * 2 - 1;
  return out;
})();

/** Samples written (non-zero) in [a, b) seconds. */
function busy(x: Float32Array, a: number, b: number): number {
  let c = 0;
  for (let i = Math.floor(a * SR); i < Math.min(x.length, Math.floor(b * SR)); i++) if (x[i] !== 0) c++;
  return c;
}

describe("crackle (§13k: the radio crackling as the future meets me)", () => {
  it("arriving, it is thickest while tuning and thins as the signal locks", () => {
    expect(crackleDensity("arrive", 0.3)).toBe(1);
    expect(crackleDensity("arrive", 0.95)).toBeLessThan(0.3);
    expect(grainDensity("arrive", 0.3)).toBe(1);
    const r = renderCrackle({ sampleRate: SR, dur: 10, tail: 3, kind: "arrive", noise, rand: rng(1) });
    expect(r.pops).toBeGreaterThan(60);
    expect(busy(r.crackle, 1.5, 4.5) / 3).toBeGreaterThan(2 * (busy(r.crackle, 8, 10) / 2));
  });

  it("lands with the moment: a spark right at the start", () => {
    const r = renderCrackle({ sampleRate: SR, dur: 10, tail: 3, kind: "arrive", noise, rand: rng(2) });
    expect(busy(r.crackle, 0, 0.05)).toBeGreaterThan(0);
  });

  it("leaving, the static breaks up and is gone by the end", () => {
    const r = renderCrackle({ sampleRate: SR, dur: 5, tail: 3, kind: "leave", noise, rand: rng(3) });
    expect(busy(r.crackle, 0.2, 2)).toBeGreaterThan(0);
    expect(busy(r.crackle, 5.1, 8)).toBe(0);
    expect(busy(r.grains, 5.1, 8)).toBe(0);
  });

  it("stays within bounds (the engine sets the level after)", () => {
    const r = renderCrackle({ sampleRate: SR, dur: 10, tail: 3, kind: "arrive", noise, rand: rng(4) });
    let peak = 0;
    for (const v of r.crackle) peak = Math.max(peak, Math.abs(v));
    for (const v of r.grains) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(4);
  });
});

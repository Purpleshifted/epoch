import { describe, expect, it } from "vitest";
import { BODY, CELL, pixelizeRGBA } from "./pixelize";

/** White background with a red disc (and a stray speck) as a stand-in for a product photo. */
function fake(w = 120, h = 100): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inDisc = (x - 60) ** 2 + (y - 50) ** 2 < 30 * 30;
      const speck = x > 4 && x < 8 && y > 4 && y < 8;
      const c = inDisc || speck ? [200, 30, 30] : [250, 250, 250];
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  return d;
}

describe("pixelizeRGBA", () => {
  const r = pixelizeRGBA(fake(), 120, 100);

  it("removes a plain background and keeps the subject", () => {
    expect(r.bgRemoved).toBe(true);
    expect(r.foreground).toBeGreaterThan(0.2);
    const opaque = Array.from(r.indices).filter((i) => i >= 0).length;
    expect(opaque).toBeGreaterThan(150);
    expect(opaque).toBeLessThan(BODY * BODY + 1);
  });

  it("uses only palette colours with hard alpha, and never black for the body", () => {
    expect(r.rgba.length).toBe(CELL * CELL * 4);
    for (let i = 0; i < CELL * CELL; i++) {
      const a = r.rgba[i * 4 + 3];
      expect(a === 0 || a === 255).toBe(true);
      if (a === 255) expect(r.indices[i]).toBeGreaterThan(0);
    }
  });

  it("maps a red subject to a red palette entry", () => {
    const centre = r.indices[(CELL / 2) * CELL + CELL / 2];
    expect([4, 12]).toContain(centre);
  });

  it("falls back to a centre crop when nothing separates", () => {
    const w = 64, h = 64;
    const noise = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = (i * 97) % 256;
      noise[i * 4] = v; noise[i * 4 + 1] = (v * 3) % 256; noise[i * 4 + 2] = (v * 7) % 256; noise[i * 4 + 3] = 255;
    }
    expect(pixelizeRGBA(noise, w, h).bgRemoved).toBe(false);
  });
});

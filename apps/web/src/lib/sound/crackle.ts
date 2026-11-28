/**
 * sound/crackle.ts — THE RADIO CRACKLING as the future meets me (docs/sound-logic.md §13k). Pure: it writes samples.
 *
 * The artist, 2026-11-28: "미래랑 마주쳤을 때 뭔가... 그래뉼러 노이즈나 파직거리는 전파 느낌 넣는 방법 없나? 전에 삐약 대신에".
 * In the place of the high chord that chirped, two textures, written ahead into two buffers the engine plays once:
 *
 *   CRACKLE   pops: a few samples of noise each, dying at once — most small, a rare big one; now and then a SPARK (파직),
 *             a pop followed by a few more within 25 ms. The first is a spark right at the start, so the crackle lands
 *             with the moment the future looks at me.
 *   GRAINS    granular noise: short windowed grains of noise (15–60 ms), a sandy hiss the engine tunes with its band.
 *
 * Their density follows the tuning: arriving, it rises within the first 15 % of the passing, stays thick until 45 %,
 * then thins as the signal locks (a few late pops into the tail); leaving, the static breaks up and is gone by the end.
 */

/** Pops per second at their thickest. */
export const CRACKLE_RATE = 28;
/** Grains per second at their thickest. */
export const GRAIN_RATE = 45;

export type CrackleKind = "arrive" | "leave";

/** 0 … 1: how thick the crackle is at `u` (time ÷ the passing's length; above 1 is the tail). */
export function crackleDensity(kind: CrackleKind, u: number): number {
  if (u < 0) return 0;
  if (kind === "arrive") {
    if (u < 0.15) return u / 0.15;
    if (u < 0.45) return 1;
    if (u <= 1) return 0.12 + 0.88 * Math.exp(-(u - 0.45) * 5);
    return 0.05;
  }
  if (u < 0.2) return 0.6 + 1.5 * u;
  if (u <= 1) return 0.9 * (1 - (u - 0.2) / 0.8);
  return 0;
}

/** 0 … 1: how thick the grains are at `u`. */
export function grainDensity(kind: CrackleKind, u: number): number {
  if (u < 0 || u > 1) return 0;
  if (kind === "arrive") return u < 0.3 ? u / 0.3 : 1 - 0.8 * ((u - 0.3) / 0.7);
  return 0.7 * (1 - u);
}

export interface CrackleOptions {
  sampleRate: number;
  /** The passing's length (s) and the tail after it (s). */
  dur: number;
  tail: number;
  kind: CrackleKind;
  /** Noise to read the pops and grains from (any length; read at random places). */
  noise: Float32Array;
  rand?: () => number;
}

export interface CrackleSamples {
  crackle: Float32Array;
  grains: Float32Array;
  pops: number;
  grainCount: number;
}

/** Both textures over dur + tail seconds. Sparse: only where an event falls is anything written. */
export function renderCrackle(o: CrackleOptions): CrackleSamples {
  const rand = o.rand ?? Math.random;
  const sr = o.sampleRate;
  const total = Math.max(0.1, o.dur + o.tail);
  const n = Math.ceil(total * sr);
  const crackle = new Float32Array(n);
  const grains = new Float32Array(n);
  const N = o.noise;
  const nl = N.length;
  let pops = 0;
  let grainCount = 0;
  const pop = (at: number, amp: number) => {
    const len = Math.max(8, Math.round((0.0005 + 0.0035 * rand()) * sr));
    const i0 = Math.round(at * sr);
    if (i0 >= n) return;
    const k0 = Math.floor(rand() * nl);
    const sign = rand() < 0.5 ? -1 : 1;
    const tau = len / 3;
    for (let i = 0; i < len && i0 + i < n; i++) crackle[i0 + i] += sign * amp * N[(k0 + i) % nl] * Math.exp(-i / tau);
    pops++;
  };
  const spark = (at: number, amp: number) => {
    pop(at, amp);
    const more = 2 + Math.floor(rand() * 5);
    let t = at;
    let a = amp;
    for (let j = 0; j < more; j++) {
      t += 0.002 + 0.006 * rand();
      a *= 0.7;
      pop(t, a);
    }
  };
  // THE CRACKLE: a thinned Poisson stream at the thickest rate, kept where the density says
  spark(0.02, 1);
  for (let t = -Math.log(1 - rand()) / CRACKLE_RATE; t < total; t += -Math.log(1 - rand()) / CRACKLE_RATE) {
    if (rand() >= crackleDensity(o.kind, t / o.dur)) continue;
    const amp = 0.15 + 0.85 * rand() ** 3;
    if (rand() < 0.22) spark(t, amp);
    else pop(t, amp);
  }
  // THE GRAINS: windowed noise, a sandy hiss
  for (let t = -Math.log(1 - rand()) / GRAIN_RATE; t < total; t += -Math.log(1 - rand()) / GRAIN_RATE) {
    if (rand() >= grainDensity(o.kind, t / o.dur)) continue;
    const len = Math.max(16, Math.round((0.015 + 0.045 * rand()) * sr));
    const i0 = Math.round(t * sr);
    const amp = 0.25 + 0.5 * rand();
    const k0 = Math.floor(rand() * nl);
    for (let i = 0; i < len && i0 + i < n; i++) grains[i0 + i] += amp * N[(k0 + i) % nl] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len));
    grainCount++;
  }
  return { crackle, grains, pops, grainCount };
}

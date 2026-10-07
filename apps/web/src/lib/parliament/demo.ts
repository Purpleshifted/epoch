/**
 * parliament/demo.ts
 *
 * A deterministic crowd of workers for demos and tests: three districts, several visitors per
 * district, each assigned a time offset and staying a while. `?demo=1` seeds it into the log
 * and moves the epoch so that a visitor who arrives now is later than all of them.
 */

import type { PEvent } from "./types";
import { LS_EVENTS_EPOCH_KEY, LS_EVENTS_KEY, LS_PARLIAMENT_EPOCH_KEY } from "./log";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_END_SEC = 450;

const DISTRICTS: { x: number; z: number; visitors: number }[] = [
  { x: 0, z: 0, visitors: 6 },
  { x: 14, z: 6, visitors: 4 },
  { x: -10, z: -12, visitors: 2 },
];

export function buildParliamentDemo(seed = 1): PEvent[] {
  const rand = rng(seed);
  const out: PEvent[] = [];
  let vi = 0;
  for (const d of DISTRICTS) {
    for (let v = 0; v < d.visitors; v++, vi++) {
      const o = `demo${vi}`;
      const start = 20 + rand() * 280;
      const stay = 70 + rand() * 70;
      let x = d.x + (rand() - 0.5) * 3;
      let z = d.z + (rand() - 0.5) * 3;
      let a = rand() * Math.PI * 2;
      let n = 0;
      for (let s = start; s < start + stay; s += 1) {
        a += (rand() - 0.5) * 0.9;
        x += Math.cos(a) * 0.35;
        z += Math.sin(a) * 0.35;
        // a tether to the district centre keeps the walker inside it
        x += (d.x - x) * 0.08;
        z += (d.z - z) * 0.08;
        out.push({ id: `${o}:p${n++}`, o, r: "worker", k: "p", x, z, s });
      }
    }
  }
  return out;
}

/** `?demo=1`: replace the stored world with the demo crowd (once per page load). */
export function seedParliamentDemoIfRequested(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).get("demo") !== "1") return false;
  try {
    const epoch = String(Date.now() - DEMO_END_SEC * 1000);
    localStorage.setItem(LS_EVENTS_KEY, JSON.stringify(buildParliamentDemo()));
    localStorage.setItem(LS_PARLIAMENT_EPOCH_KEY, epoch);
    localStorage.setItem(LS_EVENTS_EPOCH_KEY, epoch);
    return true;
  } catch {
    return false;
  }
}

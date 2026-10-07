import { describe, expect, it } from "vitest";
import { DEFAULT_FOLD, MAX_CATCH_UP, botActor, dueSamples, flockCentre, foldWorld, latestS, seedsFromSnapshot, type Flock, type PEvent } from "./index";

describe("dueSamples: the wall-clock sampler", () => {
  it("nothing is due before one period has passed", () => {
    expect(dueSamples(1000, 1999, 1000)).toEqual([]);
    expect(dueSamples(1000, 2000, 1000)).toEqual([2000]);
  });
  it("a late tick catches up every missed sample, each at its own wall time", () => {
    expect(dueSamples(0, 3500, 1000)).toEqual([1000, 2000, 3000]);
  });
  it("after a long freeze only the latest maxCatchUp samples are emitted", () => {
    const d = dueSamples(0, 1_000_000, 1000, 5);
    expect(d).toEqual([996_000, 997_000, 998_000, 999_000, 1_000_000]);
    expect(dueSamples(0, 1e9, 1000).length).toBe(MAX_CATCH_UP);
  });
  it("is safe for a zero or negative period", () => {
    expect(dueSamples(0, 5000, 0)).toEqual([]);
    expect(dueSamples(0, 5000, -1)).toEqual([]);
  });
});

/** Run the RoleField emitter (bots only) with ticks every `tickMs` of wall time; return the emitted events. */
function runBots(bots: number, seconds: number, tickMs: number, epochAgeSec = 0, flock?: Flock): PEvent[] {
  const start = 1_800_000_000_000;
  const epochMs = start - epochAgeSec * 1000;
  const offset = 60;
  const out: PEvent[] = [];
  let last = start - 1000;
  for (let now = start; now <= start + seconds * 1000; now += tickMs) {
    const due = dueSamples(last, now, 1000);
    if (due.length) last = due[due.length - 1];
    for (const w of due) {
      for (let i = 0; i < bots; i++) {
        const a = botActor(i, "worker", w, start, epochMs, offset, flock);
        out.push({ id: `${a.o}:${w}`, o: a.o, r: a.r, k: "p", x: a.x, z: a.z, s: a.s });
      }
    }
  }
  return out;
}

describe("bots build concrete on their own (regression: bots froze in a hidden player tab)", () => {
  it("five bots nucleate slabs within 90 s, seen from the latest time (as /global/space does)", () => {
    const ev = runBots(5, 90, 250);
    const seeds = seedsFromSnapshot(foldWorld(ev, latestS(ev), DEFAULT_FOLD));
    expect(seeds.length).toBeGreaterThan(0);
  });

  it("a hidden tab ticking once a minute emits exactly the same bot presence as a visible one", () => {
    const live = runBots(5, 180, 250);
    const frozen = runBots(5, 180, 60_000);
    expect(frozen).toEqual(live);
  });

  it("works the same with an epoch that is days old (only the time axis is higher)", () => {
    const ev = runBots(5, 90, 1000, 3 * 86400);
    expect(seedsFromSnapshot(foldWorld(ev, latestS(ev), DEFAULT_FOLD)).length).toBeGreaterThan(0);
  });

  it("two bots alone are not enough (minVisitors = 3)", () => {
    const ev = runBots(2, 120, 1000);
    expect(foldWorld(ev, latestS(ev), DEFAULT_FOLD).slabs).toHaveLength(0);
  });
});

describe("bot flocks: concrete in several places", () => {
  it("one flock with no spread is the old behaviour (everybody around the origin)", () => {
    const a = botActor(3, "worker", 5000, 0, 0, 60);
    const b = botActor(3, "worker", 5000, 0, 0, 60, { groups: 1, spread: 0 });
    expect(b).toEqual(a);
    expect(Math.hypot(a.x, a.z)).toBeLessThan(5);
  });

  /** Seed positions clustered into places more than 6 units apart. */
  const places = (ev: PEvent[]) => {
    const out: [number, number][] = [];
    for (const s of seedsFromSnapshot(foldWorld(ev, latestS(ev), DEFAULT_FOLD))) {
      if (!out.some(([x, z]) => Math.hypot(s.x - x, s.z - z) < 6)) out.push([s.x, s.z]);
    }
    return out.length;
  };

  it("12 bots in 4 flocks build in several separate places; one flock stays in one area", () => {
    expect(places(runBots(12, 120, 1000, 0, { groups: 4, spread: 14 }))).toBeGreaterThanOrEqual(4);
    expect(places(runBots(12, 120, 1000))).toBeLessThanOrEqual(2); // one flock: one ring (up to ~9 units across)
  });
});

describe("bot time: random within a window around the player", () => {
  const start = 1_800_000_000_000;
  const offsets = (spread: number) => Array.from({ length: 40 }, (_, i) => botActor(i, "worker", start + 5000, start, start, 300, { groups: 4, spread: 10, timeSpread: spread }).s - 5);

  it("every bot lies within ±spread/2 of the player, both ahead and behind", () => {
    const o = offsets(60);
    for (const v of o) expect(Math.abs(v - 300)).toBeLessThanOrEqual(30 + 1e-9);
    expect(o.some((v) => v > 300 + 5)).toBe(true);
    expect(o.some((v) => v < 300 - 5)).toBe(true);
    expect(new Set(o.map((v) => v.toFixed(2))).size).toBeGreaterThan(30); // not a fixed pattern
  });

  it("a bot keeps its time slot while the bots are on (no jumping between samples)", () => {
    const a = botActor(7, "worker", start + 5000, start, start, 300, { groups: 4, spread: 10, timeSpread: 60 });
    const b = botActor(7, "worker", start + 65000, start, start, 300, { groups: 4, spread: 10, timeSpread: 60 });
    expect(b.s - a.s).toBeCloseTo(60, 9);
  });

  it("spread 0 puts every bot exactly at the player's time", () => {
    for (const v of offsets(0)) expect(v).toBeCloseTo(300, 9);
  });
});

describe("bot motion: walk and stand, wander, move between flocks", () => {
  const start = 1_800_000_000_000;
  const flock = { groups: 4, spread: 20, timeSpread: 60 };
  const at = (i: number, sec: number) => botActor(i, "worker", start + sec * 1000, start, start, 60, flock);

  it("bots stand still now and then (not one constant circling)", () => {
    let still = 0;
    for (let i = 0; i < 10; i++) {
      for (let t = 1; t < 300; t++) {
        const a = at(i, t), b = at(i, t + 1);
        const [ca, cb] = [flockCentre(i % 4, 4, 20, t), flockCentre(i % 4, 4, 20, t + 1)];
        // standing = moving only as much as the flock's centre drifts
        if (Math.hypot(b.x - cb[0] - (a.x - ca[0]), b.z - cb[1] - (a.z - ca[1])) < 1e-9) still++;
      }
    }
    expect(still).toBeGreaterThan(300);
  });

  it("each bot has its own range: some keep close, some roam", () => {
    const range = (i: number) => {
      let m = 0;
      for (let t = 0; t < 600; t += 5) {
        const a = at(i, t);
        const c = flockCentre(i % 4, 4, 20, t);
        m = Math.max(m, Math.hypot(a.x - c[0], a.z - c[1]));
      }
      return m;
    };
    const r = Array.from({ length: 12 }, (_, i) => range(i));
    expect(Math.max(...r) - Math.min(...r)).toBeGreaterThan(1.5);
  });

  it("over a few minutes some bots move on to another flock", () => {
    let moved = 0;
    for (let i = 0; i < 16; i++) {
      const home = flockCentre(i % 4, 4, 20, 0);
      for (let t = 0; t < 900; t += 10) {
        const a = at(i, t);
        const c = flockCentre(i % 4, 4, 20, t);
        if (Math.hypot(a.x - c[0], a.z - c[1]) > 10 && home) {
          moved++;
          break;
        }
      }
    }
    expect(moved).toBeGreaterThan(2);
  });
});

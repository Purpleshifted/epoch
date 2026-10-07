import { describe, expect, it } from "vitest";
import { DEFAULT_FOLD, MAX_CATCH_UP, botActor, dueSamples, foldWorld, latestS, seedsFromSnapshot, type PEvent } from "./index";

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
function runBots(bots: number, seconds: number, tickMs: number, epochAgeSec = 0): PEvent[] {
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
        const a = botActor(i, "worker", w, start, epochMs, offset);
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

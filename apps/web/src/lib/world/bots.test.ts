import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { botActor, botPlan, walkedSeconds } from "@/lib/parliament/bots";
import { hash2 } from "@/lib/parliament/nature";
import { DEFAULT_FOLD } from "@/lib/parliament/types";
import { BotRun, botRuleOf, stretchFrom, wantsServerBots, type BotRule } from "./bots";
import { cleanEvent, type WorldState } from "./protocol";

const EPOCH = 1_793_628_673_591;
const START = EPOCH + 21_810;
/** The exhibition's saved values, 2026-11-05. */
const SAVED: Record<string, Record<string, unknown>> = {
  "봇 (글로벌에서 돌리기)": { botOn: true, botCount: 17, botRole: "worker", botGroups: 5, botSpread: 60, botTimeSpread: 60, botStayMin: 1.2, botCharacter: 0.7, botOverlapSec: 60 },
  "생성 규칙 (회사원 시공간 밀집)": { radius: 2.5, pourUnit: 100, maxHeight: 15, threshold: 30, windowSec: 600, pathVisits: 5, visitorCap: 32, minVisitors: 4, tauPathYears: 3000, tauSlabYears: 1200, tauFootprintYears: 2000 },
  "길 → 다리.① 땅: 밟힘 → 길 (V2 · 건물과 먼저 온 쪽이 자리)": { pull: 1.6, flowOn: true, tauSec: 300, blockAt: 0.5, staySec: 6, flowUnit: 3, gridShare: 0.3, moveShare: 0.5, stayRadius: 1.5 },
};
const rule = (): BotRule => botRuleOf((g) => SAVED[g] ?? null)!;

describe("walkedSeconds", () => {
  const naive = (i: number, sec: number, segLen: number, share: number) => {
    const s = Math.floor(sec / segLen);
    let walked = 0;
    for (let k = 0; k < s; k++) if (hash2(i, k, 83) < share) walked += segLen;
    if (hash2(i, s, 83) < share) walked += sec - s * segLen;
    return walked;
  };
  it("is exactly the sum counted from the start, in any order of asking", () => {
    for (const sec of [0, 5.5, 100, 99, 1000, 7, 40_000.25, 40_001.25, 3, 234_000]) {
      expect(walkedSeconds(3, sec, 11.7, 0.6)).toBe(naive(3, sec, 11.7, 0.6));
    }
  });
  it("does not mix up a bot's knobs when they change", () => {
    expect(walkedSeconds(4, 500, 10, 0.5)).toBe(naive(4, 500, 10, 0.5));
    expect(walkedSeconds(4, 500, 10, 0.8)).toBe(naive(4, 500, 10, 0.8));
    expect(walkedSeconds(4, 500, 13, 0.8)).toBe(naive(4, 500, 13, 0.8));
  });
});

describe("botRuleOf", () => {
  it("no bots when the wall's are off or nothing is saved", () => {
    expect(botRuleOf(() => null)).toBeNull();
    expect(botRuleOf((g) => (g.startsWith("봇") ? { botOn: false } : null))).toBeNull();
  });
  it("reads the wall's saved knobs and its rule", () => {
    const r = rule();
    expect(r.count).toBe(17);
    expect(r.flock).toMatchObject({ groups: 5, spread: 60, stayMin: 1.2, character: 0.7 });
    expect(r.fold.radius).toBe(2.5);
    expect(r.fold.flow?.enabled).toBe(true);
    expect(r.fold.flow?.pull).toBe(1.6);
  });
});

describe("BotRun", () => {
  const FROM = EPOCH + 3_600_000;
  it("emits what a wall would: every bot on the grid, named by it, at the same places when the ground says nothing", () => {
    const r: BotRule = { ...rule(), fold: { ...DEFAULT_FOLD, flow: undefined } };
    const events = new BotRun(r, EPOCH, START).between(FROM, FROM + 3000);
    expect(events.length).toBe(17 * 3);
    const w = (Math.floor(FROM / 1000) + 1) * 1000;
    const a = botActor(5, "worker", w, START, EPOCH, 0, r.flock);
    expect(events.find((e) => e.id === `bot5:${w}`)).toEqual(cleanEvent({ id: `bot5:${w}`, o: a.o, r: a.r, k: "p", x: a.x, z: a.z, s: a.s }));
    expect(botPlan(5, w, START, EPOCH, 0, r.flock).s).toBe(a.s);
  });
  it("looks the same written all at once or a little at a time", () => {
    const all = new BotRun(rule(), EPOCH, START).between(FROM, FROM + 60_000);
    const piece = new BotRun(rule(), EPOCH, START);
    const pieces = [...piece.between(FROM, FROM + 12_000), ...piece.between(FROM + 12_000, FROM + 40_000), ...piece.between(FROM + 40_000, FROM + 60_000)];
    expect(pieces).toEqual(all);
  });
  it("twenty minutes of an empty world grow the exhibition's ground, and it takes a moment", () => {
    const old = EPOCH + 60 * 24 * 3600_000; // two months on, the case that would slow down most
    const run = new BotRun(rule(), EPOCH, START);
    const t0 = performance.now();
    const events = run.between(old - 1_200_000, old);
    const ms = performance.now() - t0;
    expect(events.length).toBe(17 * 1200);
    const snap = run.fold.snapshot((old - EPOCH) / 1000);
    writeFileSync(process.env.BOTRUN_OUT ?? "/dev/null", JSON.stringify({ ms: Math.round(ms), events: events.length, slabs: snap.slabs.length, paths: snap.paths.length, kb: Math.round(JSON.stringify(events).length / 1024) }));
    expect(snap.paths.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(60_000);
  }, 120_000);
});

describe("what to write", () => {
  const TO = EPOCH + 10_000_000;
  it("goes on from the last stretch", () => {
    expect(stretchFrom(TO, TO - 10_000, TO - 1_200_000, null)).toBe(TO - 10_000);
  });
  it("after a long rest, only what the world still remembers", () => {
    expect(stretchFrom(TO, TO - 90_000_000, TO - 1_200_000, null)).toBe(TO - 1_200_000);
    expect(stretchFrom(TO, null, TO - 1_200_000, null)).toBe(TO - 1_200_000);
  });
  it("not what a wall has already written, and never more than one read holds", () => {
    expect(stretchFrom(TO, TO - 600_000, TO - 1_200_000, TO - 30_000)).toBe(TO - 30_000);
    expect(stretchFrom(TO, null, TO - 7_200_000, null)).toBe(TO - 25 * 60_000);
  });
});

describe("wantsServerBots", () => {
  const state = (host: WorldState["host"]): WorldState => ({ world: "test-x", rev: 1, epochMs: EPOCH, anchor: { r: EPOCH, v: EPOCH, rate: 1 }, keepWindowSec: 1200, botStartMs: START, host });
  it("not while a wall holds the lease", () => {
    expect(wantsServerBots(state({ id: "h", untilMs: 2000 }), 1000)).toBe(false);
  });
  it("when nobody does, or the lease has run out", () => {
    expect(wantsServerBots(state(null), 1000)).toBe(true);
    expect(wantsServerBots(state({ id: "h", untilMs: 500 }), 1000)).toBe(true);
  });
  it("not when switched off", () => {
    process.env.WORLD_SERVER_BOTS = "0";
    expect(wantsServerBots(state(null), 1000)).toBe(false);
    delete process.env.WORLD_SERVER_BOTS;
  });
});

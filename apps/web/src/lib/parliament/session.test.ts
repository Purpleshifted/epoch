import { describe, expect, it } from "vitest";
import {
  DEFAULT_WITNESS,
  ROLE_TAG,
  SESSION_ROLES,
  WitnessLog,
  assignRole,
  bearingOf,
  blinkAt,
  fmtClock,
  hindrance,
  lifeAt,
  nameOf,
  observe,
  planReel,
  reelAt,
  reelDuration,
  type Observation,
  type PEvent,
} from "./index";

describe("assignRole", () => {
  it("covers every session role uniformly and stays in range at the edges", () => {
    expect(assignRole(0)).toBe(SESSION_ROLES[0]);
    expect(assignRole(0.999999)).toBe(SESSION_ROLES[SESSION_ROLES.length - 1]);
    expect(assignRole(1)).toBe(SESSION_ROLES[SESSION_ROLES.length - 1]);
    const seen = new Set(Array.from({ length: 40 }, (_, i) => assignRole(i / 40)));
    expect([...seen].sort()).toEqual([...SESSION_ROLES].sort());
  });
});

describe("the role slot", () => {
  it("stops on the drawn role, whatever it is", () => {
    for (const r of SESSION_ROLES) {
      const plan = planReel(r);
      expect(plan.labels[plan.labels.length - 1]).toBe(ROLE_TAG[r]);
      const end = reelAt(plan, reelDuration(plan) + 0.01);
      expect(end.label).toBe(ROLE_TAG[r]);
      expect(end.settled).toBe(true);
      expect(end.lit).toBe(true);
    }
  });
  it("runs through the roles in strip order, fast at first and slower towards the stop", () => {
    const plan = planReel("car");
    for (let k = 1; k < plan.labels.length; k++) expect(plan.labels[k]).not.toBe(plan.labels[k - 1]);
    // how long each label stays up
    const dwell = new Map<number, number>();
    for (let t = 0; t < plan.stopAt; t += 0.005) {
      const i = reelAt(plan, t).index;
      dwell.set(i, (dwell.get(i) ?? 0) + 0.005);
    }
    const first = dwell.get(1) ?? 0;
    const late = dwell.get(plan.labels.length - 2) ?? 0;
    expect(late).toBeGreaterThan(first * 4);
  });
  it("blinks after the stop, then holds", () => {
    const plan = planReel("tree");
    const lit: boolean[] = [];
    for (let t = plan.stopAt + 0.01; t < plan.stopAt + plan.flashSec; t += 0.02) lit.push(reelAt(plan, t).lit);
    expect(lit).toContain(true);
    expect(lit).toContain(false);
    expect(reelAt(plan, plan.stopAt + 0.01).settled).toBe(false);
  });
});

describe("the lifespan", () => {
  const cfg = { lifeSec: 100, warnSec: 20, endHoldSec: 5 };
  it("does not warn before the last warnSec, then rises to 1 at the end", () => {
    expect(lifeAt(0, cfg).warn).toBe(0);
    expect(lifeAt(80, cfg).warn).toBe(0);
    const a = lifeAt(85, cfg).warn, b = lifeAt(95, cfg).warn;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(lifeAt(100, cfg)).toMatchObject({ warn: 1, over: true, left: 0, frac: 1 });
    expect(lifeAt(99.9, cfg).over).toBe(false);
  });
  it("the cursor blinks faster and shorter as the end comes", () => {
    expect(blinkAt(0).hz).toBeCloseTo(1.2);
    expect(blinkAt(1).hz).toBeGreaterThan(blinkAt(0.5).hz);
    expect(blinkAt(1).duty).toBeLessThan(blinkAt(0).duty);
  });
  it("controls answer normally until the warning, then worse and with dropouts", () => {
    const h0 = hindrance(0, 3);
    expect(h0).toEqual({ gain: 1, response: 1, look: 1, dropped: false });
    const h1 = hindrance(1, 3);
    expect(h1.gain).toBeLessThan(1);
    expect(h1.response).toBeLessThan(1);
    let drops = 0, dropsHalf = 0;
    for (let t = 0; t < 60; t += 0.05) {
      if (hindrance(1, t).dropped) drops++;
      if (hindrance(0.4, t).dropped) dropsHalf++;
    }
    const n = 60 / 0.05;
    expect(drops / n).toBeGreaterThan(0.15);
    expect(drops / n).toBeLessThan(0.9);
    expect(dropsHalf).toBeLessThan(drops);
  });
  it("fmtClock", () => {
    expect(fmtClock(0)).toBe("00:00");
    expect(fmtClock(83.7)).toBe("01:23");
    expect(fmtClock(3600)).toBe("60:00");
  });
});

describe("the witness: a dry record of who is near", () => {
  const me = { id: "v_me", x: 0, z: 0, vx: 0, vz: 0 };
  const p = (o: string, x: number, z: number, s: number, r: PEvent["r"] = "worker"): PEvent => ({ id: `${o}:${s}`, o, r, k: "p", x, z, s });

  it("names and bearings", () => {
    expect(nameOf("bot3", "worker")).toBe("WORKER #03");
    expect(nameOf("v_ab12c", "cat")).toBe("STREET CAT AB12C");
    expect(bearingOf(0, 1)).toBe("N");
    expect(bearingOf(1, 0)).toBe("E");
    expect(bearingOf(-1, -1)).toBe("SW");
  });

  it("observe: who is within the watch radius, whether they move, what the ground is", () => {
    const events = [p("bot1", 1, 0, 9), p("bot1", 1, 0, 10), p("bot2", 0, 2, 9), p("bot2", 0, 3, 10, "car"), p("bot3", 20, 0, 10), p("bot4", 1, 1, 2), p("v_me", 0, 0, 10)];
    const obs = observe({ me, events, sNow: 10, snap: { slabs: [], paths: [{ key: "0,0", x: 0, z: 0, p: 0.5, visits: 9 }] }, t: 5 });
    expect(obs.others.map((o) => o.o)).toEqual(["bot1", "bot2"]); // bot3 too far, bot4 too old, me excluded
    expect(obs.others[0]).toMatchObject({ moving: false, bearing: "E" });
    expect(obs.others[1]).toMatchObject({ moving: true, r: "car", bearing: "N" });
    expect(obs.surface).toBe("trodden");
    expect(obs.moving).toBe(false);
  });

  it("the log: near, a state that holds, gone with how long", () => {
    const log = new WitnessLog({ ...DEFAULT_WITNESS, settleSec: 1 });
    const o = (t: number, others: Observation["others"], moving = false): Observation => ({ t, moving, speed: moving ? 2 : 0, surface: "open", others, sealedNear: 0 });
    const bot = (dist: number, moving: boolean) => ({ o: "bot1", r: "worker" as const, dist, bearing: "E", moving });
    expect(log.push(o(0, []))).toEqual(["T+00:00  YOU  STATIONARY · OPEN GROUND"]);
    expect(log.push(o(1, [bot(3.5, true)]))).toEqual([]); // inside the watch radius, not yet near
    expect(log.push(o(2, [bot(2, true)]))).toEqual(["T+00:02  WORKER #01  NEAR · 2.0 M E · MOVING"]);
    expect(log.push(o(2.5, [bot(2, false)]))).toEqual([]); // not held long enough
    expect(log.push(o(3.6, [bot(2, false)]))).toEqual(["T+00:03  WORKER #01  STATIONARY · 2.0 M E", "T+00:03  YOU  BUILDING TOGETHER · NEAR 1"]);
    expect(log.push(o(4, [bot(3.5, false)]))).toEqual([]); // inside the leave margin: still near
    expect(log.status()).toBe("YOU  STATIONARY 00:04 · OPEN GROUND · NEAR 1");
    expect(log.push(o(50, []))).toEqual(["T+00:50  WORKER #01  GONE · NEAR FOR 00:48", "T+00:50  YOU  BUILDING ENDS"]);
    // a short tap on a key leaves no line, a real walk does
    expect(log.push(o(51, [], true))).toEqual([]);
    expect(log.push(o(51.5, [], false))).toEqual([]);
    log.push(o(53, [], true));
    expect(log.push(o(54.2, [], true))).toEqual(["T+00:54  YOU  MOVING"]);
    const sum = log.summary();
    expect(sum.met).toBe(1);
    expect(sum.nearSec).toBeCloseTo(48); // from 2 (came near) to 50 (gone)
    expect(sum.stillSec).toBeGreaterThan(50);
  });
});

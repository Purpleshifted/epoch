/**
 * The record (witness.ts): who is near, what holds, what the ground is — as structured entries, worded by script.ts
 * (English byte for byte as before 2026-10-20; Korean in the apparatus's voice).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_WITNESS, WitnessLog, bearingOf, formatEntry, formatNearItem, formatStatus, nameIn, nameOf, observe, type LogEntry, type Observation, type Other, type PEvent } from "./index";

const me = { id: "v_me", x: 0, z: 0, vx: 0, vz: 0 };
const p = (o: string, x: number, z: number, s: number, r: PEvent["r"] = "worker"): PEvent => ({ id: `${o}:${s}`, o, r, k: "p", x, z, s });
const en = (es: LogEntry[]) => es.map((e) => formatEntry(e, "en")).map(({ prefix, text }) => `${prefix}  ${text}`);

describe("the witness: a record of who is near", () => {
  it("names and bearings", () => {
    expect(nameOf("bot3", "worker")).toBe("WORKER #03");
    expect(nameOf("v_ab12c", "cat")).toBe("STREET CAT AB12C");
    expect(nameIn("ko", "bot3", "worker")).toBe("회사원 #03");
    expect(nameIn("ko", "v_ab12c", "cat")).toBe("길고양이 AB12C");
    expect(nameIn("en", "bot3", "car")).toBe("CAR #03");
    expect(bearingOf(0, 1)).toBe("N");
    expect(bearingOf(1, 0)).toBe("E");
    expect(bearingOf(-1, -1)).toBe("SW");
  });

  it("observe: who is within the watch radius, whether they move, what the ground is — and who is within the view", () => {
    const events = [p("bot1", 1, 0, 9), p("bot1", 1, 0, 10), p("bot2", 0, 2, 9), p("bot2", 0, 3, 10, "car"), p("bot3", 20, 0, 10), p("bot4", 1, 1, 2), p("v_me", 0, 0, 10)];
    const obs = observe({ me, events, sNow: 10, snap: { slabs: [], paths: [{ key: "0,0", x: 0, z: 0, p: 0.5, visits: 9 }] }, t: 5 });
    expect(obs.others.map((o) => o.o)).toEqual(["bot1", "bot2"]); // bot3 too far, bot4 too old, me excluded
    expect(obs.others[0]).toMatchObject({ moving: false, bearing: "E", ageSec: 0 });
    expect(obs.others[1]).toMatchObject({ moving: true, r: "car", bearing: "N" });
    expect(obs.far.map((o) => o.o)).toEqual(["bot1", "bot2", "bot3"]); // the view (24) holds bot3 too
    expect(obs.far[2]).toMatchObject({ x: 20, z: 0, dist: 20 });
    expect(obs.surface).toBe("trodden");
    expect(obs.moving).toBe(false);
  });

  it("the log: near, a state that holds, gone with how long — the English record as it always read", () => {
    const log = new WitnessLog({ ...DEFAULT_WITNESS, settleSec: 1 });
    const o = (t: number, others: Other[], moving = false): Observation => ({ t, moving, speed: moving ? 2 : 0, surface: "open", others, far: others });
    const bot = (dist: number, moving: boolean): Other => ({ o: "bot1", r: "worker", x: dist, z: 0, dist, bearing: "E", moving, ageSec: 0 });
    expect(en(log.push(o(0, [])))).toEqual(["T+00:00  YOU  STATIONARY · OPEN GROUND"]);
    expect(log.push(o(1, [bot(3.5, true)]))).toEqual([]); // inside the watch radius, not yet near
    expect(en(log.push(o(2, [bot(2, true)])))).toEqual(["T+00:02  WORKER #01  NEAR · 2.0 M E · MOVING"]);
    expect(log.push(o(2.5, [bot(2, false)]))).toEqual([]); // not held long enough
    expect(en(log.push(o(3.6, [bot(2, false)])))).toEqual(["T+00:03  WORKER #01  STATIONARY · 2.0 M E"]);
    expect(log.push(o(4, [bot(3.5, false)]))).toEqual([]); // inside the leave margin: still near
    expect(formatStatus(log.status()!, "en")).toBe("YOU  STATIONARY 00:04 · OPEN GROUND · NEAR 1");
    expect(formatStatus(log.status()!, "ko")).toBe("머묾 00:04 · 열린 땅 · 가까이 1");
    expect(log.nearNow().map((n) => formatNearItem(n, "en"))).toEqual(["WORKER #01 3.5 M E · STATIONARY · 00:02"]);
    expect(en(log.push(o(50, [])))).toEqual(["T+00:50  WORKER #01  GONE · NEAR FOR 00:48"]);
    // a short tap on a key leaves no line, a real walk does
    expect(log.push(o(51, [], true))).toEqual([]);
    expect(log.push(o(51.5, [], false))).toEqual([]);
    log.push(o(53, [], true));
    expect(en(log.push(o(54.2, [], true)))).toEqual(["T+00:54  YOU  MOVING"]);
    const sum = log.summary();
    expect(sum.met).toBe(1);
    expect(sum.nearSec).toBeCloseTo(48); // from 2 (came near) to 50 (gone)
    expect(sum.stillSec).toBeGreaterThan(50);
    // the attempts to stop living are notable (level 1); the ledger's note goes into the same record
    expect(en(log.attempt(60, 2))).toEqual(["T+01:00  YOU  TRIED TO STOP LIVING · NEAR 2", "T+01:00  YOU  FAILED"]);
    expect(log.entries.every((e) => e.key.startsWith("attempt") === (e.level === 1))).toBe(true);
    log.note({ t: 61, key: "path.formed", args: { n: 4 }, level: 2 });
    expect(log.entries.length).toBe(DEFAULT_WITNESS.keep);
    expect(log.entries[log.entries.length - 1].level).toBe(2);
  });

  it("the same record in Korean: no subject on the visitor's own lines, the others by name", () => {
    const near: LogEntry = { t: 2, key: "near", args: { who: { o: "bot1", r: "worker" }, dist: 2, bearing: "E", moving: true }, level: 0 };
    expect(formatEntry(near, "ko")).toEqual({ prefix: "T+00:02", text: "회사원 #01  가까이 · 2.0 m 동 · 이동 중" });
    expect(formatEntry({ t: 0, key: "you.state", args: { moving: false, surface: "open" }, level: 0 }, "ko").text).toBe("머묾 · 열린 땅");
    expect(formatEntry({ t: 0, key: "gone", args: { who: { o: "v_ab12c", r: "cat" }, forSec: 48 }, level: 0 }, "ko").text).toBe("길고양이 AB12C  떠남 · 00:48 동안 가까이");
    const share: LogEntry = { t: 72, key: "concrete.share", args: { n: 1, pct: 23, with: [{ o: "bot3", r: "worker" }, { o: "bot7", r: "worker" }] }, level: 2 };
    expect(formatEntry(share, "ko").text).toContain("회사원 #03·회사원 #07");
    expect(formatEntry(share, "ko").text).toContain("23 %");
    expect(formatEntry(share, "en").text).toBe("CONCRETE  WITH WORKER #03 WORKER #07 · YOUR SHARE 23 %");
  });
});

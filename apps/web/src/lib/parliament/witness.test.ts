/**
 * The record (witness.ts): who is near, what holds, what the ground is, the words — as structured entries, worded by
 * script.ts in the voice of a field note.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_WITNESS, WitnessLog, bearingOf, formatEntry, formatStatus, glyphOf, individualNo, nameIn, observe, type LogEntry, type Observation, type Other, type PEvent } from "./index";

const me = { id: "v_me", x: 0, z: 0, vx: 0, vz: 0 };
const p = (o: string, x: number, z: number, s: number, r: PEvent["r"] = "worker"): PEvent => ({ id: `${o}:${s}`, o, r, k: "p", x, z, s });
const en = (es: LogEntry[]) => es.map((e) => formatEntry(e, "en")).map(({ prefix, text }) => `${prefix}  ${text}`);
const obsAt = (t: number, others: Other[], moving = false, wordsNear: string[] = []): Observation => ({ me: "v_me", t, moving, speed: moving ? 2 : 0, surface: "open", others, far: others, wordsNear });
const bot = (dist: number, o = "bot1"): Other => ({ o, r: "worker", x: dist, z: 0, dist, bearing: "E", moving: false, ageSec: 0 });

describe("the witness: a record of who is near", () => {
  it("names and bearings", () => {
    expect(nameIn("ko", "bot3")).toBe(individualNo("bot3"));
    expect(bearingOf(0, 1)).toBe("N");
    expect(bearingOf(1, 0)).toBe("E");
    expect(bearingOf(-1, -1)).toBe("SW");
  });

  it("observe: who is within the watch radius, whether they move, what the ground is — and who is within the view", () => {
    const events = [p("bot1", 1, 0, 9), p("bot1", 1, 0, 10), p("bot2", 0, 2, 9), p("bot2", 0, 3, 10, "car"), p("bot3", 20, 0, 10), p("bot4", 1, 1, 2), p("v_me", 0, 0, 10)];
    const obs = observe({ me, events, sNow: 10, snap: { slabs: [], paths: [{ key: "0,0", x: 0, z: 0, p: 0.5, visits: 9 }] }, t: 5, words: [{ o: "v_old", x: 2, z: 0 }, { o: "v_far", x: 30, z: 0 }] });
    expect(obs.me).toBe("v_me");
    expect(obs.others.map((o) => o.o)).toEqual(["bot1", "bot2"]); // bot3 too far, bot4 too old, me excluded
    expect(obs.others[0]).toMatchObject({ moving: false, bearing: "E", ageSec: 0 });
    expect(obs.others[1]).toMatchObject({ moving: true, r: "car", bearing: "N" });
    expect(obs.far.map((o) => o.o)).toEqual(["bot1", "bot2", "bot3"]); // the view (24) holds bot3 too
    expect(obs.far[2]).toMatchObject({ x: 20, z: 0, dist: 20 });
    expect(obs.surface).toBe("trodden");
    expect(obs.moving).toBe(false);
    expect(obs.wordsNear).toEqual(["v_old"]);
  });

  it("the log: near with their melody, gone with how long, a state that holds", () => {
    const log = new WitnessLog({ ...DEFAULT_WITNESS, settleSec: 1, wordAfterSec: 1000 });
    expect(en(log.push(obsAt(0, [])))).toEqual(["T+00:00  Standing on grass."]);
    expect(log.push(obsAt(1, [bot(3.5)]))).toEqual([]); // inside the watch radius, not yet near
    const came = log.push(obsAt(2, [bot(2)]));
    expect(en(came)).toEqual(["T+00:02  Someone came near."]);
    expect(came[0].args.dots).toEqual(glyphOf("bot1"));
    expect(log.push(obsAt(4, [bot(3.5)]))).toEqual([]); // inside the leave margin: still near
    expect(formatStatus(log.status()!, "en")).toBe("Staying 00:04 · grass · 1 near");
    expect(formatStatus(log.status()!, "ko")).toBe("머무는 중 00:04 · 풀밭 · 곁에 1명");
    // dropping out for a moment is not leaving: no line, and the contact goes on
    expect(log.push(obsAt(10, []))).toEqual([]);
    expect(log.push(obsAt(10.5, [bot(2)]))).toEqual([]);
    expect(log.push(obsAt(50, []))).toEqual([]);
    expect(en(log.push(obsAt(51, [])))).toEqual(["T+00:51  Someone left · together 48 s"]);
    // a short tap on a key leaves no line, a real walk does
    expect(log.push(obsAt(51.2, [], true))).toEqual([]);
    expect(log.push(obsAt(51.5, [], false))).toEqual([]);
    log.push(obsAt(53, [], true));
    expect(en(log.push(obsAt(54.2, [], true)))).toEqual(["T+00:54  You start walking."]);
    const sum = log.summary();
    expect(sum.met).toBe(1);
    expect(sum.nearSec).toBeCloseTo(49); // from 2 (came near) to 51 (gone)
    expect(sum.stillSec).toBeGreaterThan(50);
    // the attempts to stop living are notable (level 1); the ledger's note goes into the same record
    expect(en(log.attempt(60, 2))).toEqual(["T+01:00  You tried to stop living.", "T+01:00  It failed."]);
    expect(log.entries.every((e) => e.key.startsWith("attempt") === (e.level === 1))).toBe(true);
    log.note({ t: 61, key: "path.formed", args: { n: 4 }, level: 2 });
    expect(log.entries.length).toBe(DEFAULT_WITNESS.keep);
    expect(log.entries[log.entries.length - 1].level).toBe(2);
  });

  it("group life and new words: a long contact only, once per other, one line at a time", () => {
    const log = new WitnessLog({ ...DEFAULT_WITNESS, groupSec: 5, wordAfterSec: 6, wordGapSec: 12 });
    log.push(obsAt(0, []));
    log.push(obsAt(1, [bot(2), bot(2, "bot2")]));
    expect(log.summary().group).toEqual([]);
    log.push(obsAt(6, [bot(2), bot(2, "bot2")]));
    expect(log.summary().group.sort()).toEqual(["bot1", "bot2"]);
    const first = log.push(obsAt(7, [bot(2), bot(2, "bot2")]));
    expect(first.map((e) => e.key)).toEqual(["word.new"]); // only one of the two now
    expect(first[0].level).toBe(2);
    expect(first[0].args.dots).toEqual(glyphOf(first[0].args.who!.o)); // what is heard is theirs
    expect(formatEntry(first[0], "ko").text).toBe("누군가 말을 겁니다:");
    expect(log.push(obsAt(8, [bot(2), bot(2, "bot2")]))).toEqual([]); // the gap
    const second = log.push(obsAt(20, [bot(2), bot(2, "bot2")]));
    expect(second.map((e) => e.key)).toEqual(["word.new"]);
    expect(log.push(obsAt(40, [bot(2), bot(2, "bot2")]))).toEqual([]); // both have spoken
    expect(log.summary().newWords.length).toBe(2);
  });

  it("the ensemble: I stay with someone who stays, for a moment; it ends when either moves on", () => {
    const log = new WitnessLog({ ...DEFAULT_WITNESS, ensembleSec: 3, settleSec: 1, wordAfterSec: 1000 });
    log.push(obsAt(0, []));
    expect(log.push(obsAt(1, [bot(2)])).map((e) => e.key)).toEqual(["near"]);
    expect(log.push(obsAt(3, [bot(2)]))).toEqual([]); // not yet
    const began = log.push(obsAt(4.5, [bot(2)]));
    expect(began.map((e) => e.key)).toEqual(["ensemble.start"]);
    expect(began[0].level).toBe(2);
    expect(formatEntry(began[0], "ko").text).toBe("합주 중… 함께 집을 짓습니다.");
    expect(formatStatus(log.status()!, "ko")).toBe("합주 중 00:03 · 풀밭 · 곁에 1명");
    // walking off ends it
    log.push(obsAt(20, [bot(2)], true));
    log.push(obsAt(21.2, [bot(2)], true));
    const ended = log.push(obsAt(24.5, [bot(2)], true));
    expect(ended.map((e) => e.key)).toEqual(["ensemble.end"]);
    expect(formatEntry(ended[0], "ko").text).toMatch(/^합주가 끝났습니다 · \d+초$/);
    expect(log.summary().ensembleSec).toBeGreaterThan(15);
    expect(log.summary().ensembleSec).toBeLessThan(25);
    // standing near someone who walks is no ensemble
    const alone = new WitnessLog({ ...DEFAULT_WITNESS, ensembleSec: 3, settleSec: 1, wordAfterSec: 1000 });
    alone.push(obsAt(0, []));
    const walker: Other = { ...bot(2), moving: true };
    for (const t of [1, 3, 5, 7, 9]) expect(alone.push(obsAt(t, [walker])).some((e) => e.key === "ensemble.start")).toBe(false);
  });

  it("dying: one line, however often it is said", () => {
    const log = new WitnessLog();
    log.push(obsAt(0, []));
    log.dying(140);
    log.dying(141);
    const lines = log.entries.filter((e) => e.key === "dying");
    expect(lines.length).toBe(1);
    expect(lines[0].level).toBe(2);
    expect(formatEntry(lines[0], "ko").text).toBe("죽어가고 있습니다...");
  });

  it("a left word: found once, with the melody of the one who left it", () => {
    const log = new WitnessLog({ ...DEFAULT_WITNESS, wordGapSec: 12 });
    log.push(obsAt(0, []));
    const found = log.push(obsAt(1, [], false, ["v_old"]));
    expect(found.map((e) => e.key)).toEqual(["word.found"]);
    expect(found[0].args.dots).toEqual(glyphOf("v_old"));
    expect(formatEntry(found[0], "en").text).toBe(`A word left by ${individualNo("v_old")} found:`);
    expect(formatEntry(found[0], "ko").text).toMatch(/^\d{4}[이가] 남긴 말 발견:$/);
    expect(log.push(obsAt(30, [], false, ["v_old"]))).toEqual([]); // once a life
    expect(log.summary().found).toEqual(["v_old"]);
  });

  it("while living the words are plain: no numbers to read, no percentages, nobody's id unless a word was found", () => {
    const near: LogEntry = { t: 2, key: "near", args: { who: { o: "bot1", r: "worker" }, dist: 2, bearing: "E", moving: true }, level: 0 };
    expect(formatEntry(near, "ko")).toEqual({ prefix: "T+00:02", text: "누군가 곁에 왔습니다." });
    expect(formatEntry({ t: 0, key: "you.state", args: { moving: false, surface: "open" }, level: 0 }, "ko").text).toBe("풀밭에 서 있습니다.");
    expect(formatEntry({ t: 0, key: "gone", args: { who: { o: "bot1", r: "worker" }, forSec: 72 }, level: 0 }, "ko").text).toBe("곁에 있던 이가 떠났습니다 · 1분 12초 함께");
    const share: LogEntry = { t: 72, key: "concrete.share", args: { n: 1, pct: 23, with: [{ o: "bot3", r: "worker" }, { o: "bot7", r: "worker" }] }, level: 2 };
    expect(formatEntry(share, "ko").text).toBe("집이 올라갑니다 · 3명이 함께");
    expect(formatEntry(share, "en").text).toBe("A house goes up · 3 together");
  });
});

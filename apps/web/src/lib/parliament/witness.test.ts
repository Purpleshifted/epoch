/**
 * The record (witness.ts): who is near, what holds, what the ground is, the words — as structured entries, worded by
 * script.ts in the voice of a field note.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_WITNESS, WitnessLog, bearingOf, aliveOwners, formatEntry, formatStatus, gatheringIn, glyphOf, observe, sideOf, type LogEntry, type Observation, type Other, type PEvent } from "./index";

const me = { id: "v_me", x: 0, z: 0, vx: 0, vz: 0 };
const p = (o: string, x: number, z: number, s: number, r: PEvent["r"] = "worker"): PEvent => ({ id: `${o}:${s}`, o, r, k: "p", x, z, s });
const en = (es: LogEntry[]) => es.map((e) => formatEntry(e, "en")).map(({ prefix, text }) => `${prefix}  ${text}`);
const obsAt = (t: number, others: Other[], moving = false, wordsNear: string[] = []): Observation => ({ me: "v_me", t, moving, speed: moving ? 2 : 0, surface: "open", others, far: others, wordsNear });
const bot = (dist: number, o = "bot1"): Other => ({ o, r: "worker", x: dist, z: 0, dist, bearing: "E", moving: false, ageSec: 0 });

describe("the witness: a record of who is near", () => {
  it("bearings", () => {
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

  it("who is here: anyone still sending within the assignment window, whatever time slot they live in", () => {
    const seen = new Map<string, { s: number; at: number }>();
    const log = [p("v_gone", 2, 0, 500), p("bot1", 1, 0, 900)];
    expect(aliveOwners(log, "v_me", seen, 0, 6000, 1000, 120).size).toBe(0); // at the first look nobody has moved yet
    const later = [...log, p("bot1", 1, 0, 901), p("bot2", 2, 0, 1050), p("bot9", 3, 0, 1300), p("v_me", 0, 0, 1000)];
    expect([...aliveOwners(later, "v_me", seen, 1000, 6000, 1000, 120)].sort()).toEqual(["bot1", "bot2"]); // bot1 is behind me, bot2 ahead, bot9 outside the window
    expect([...aliveOwners(later, "v_me", seen, 8000, 6000, 1000, 120)]).toEqual([]); // silent for too long
    // and observe sees them there, however far their time is from mine
    const obs = observe({ me, events: later, sNow: 1000, snap: null, t: 5, alive: new Set(["bot1", "bot2"]) });
    expect(obs.others.map((o) => o.o)).toEqual(["bot1", "bot2"]);
    expect(obs.others[0].ageSec).toBe(0);
  });

  it("the log: near with their melody, gone with how long, a state that holds", () => {
    const log = new WitnessLog({ ...DEFAULT_WITNESS, settleSec: 1, wordAfterSec: 1000 });
    expect(en(log.push(obsAt(0, [])))).toEqual(["T+00:00  Standing on grass."]);
    expect(log.push(obsAt(1, [bot(3.5)]))).toEqual([]); // inside the watch radius, not yet near
    const came = log.push(obsAt(2, [bot(2)]));
    expect(en(came)).toEqual(["T+00:02  ({}) comes near"]);
    expect(came[0].args.dots).toEqual(glyphOf("bot1"));
    expect(log.push(obsAt(4, [bot(3.5)]))).toEqual([]); // inside the leave margin: still near
    expect(formatStatus(log.status()!, "en")).toBe("Staying 00:04 · grass · 1 near");
    expect(formatStatus(log.status()!, "ko")).toBe("머무는 중 00:04 · 풀밭 · 곁에 1명");
    // dropping out for a moment is not leaving: no line, and the contact goes on
    expect(log.push(obsAt(10, []))).toEqual([]);
    expect(log.push(obsAt(10.5, [bot(2)]))).toEqual([]);
    expect(log.push(obsAt(50, []))).toEqual([]);
    expect(en(log.push(obsAt(51, [])))).toEqual(["T+00:51  ({}) leaves · together 48 s"]);
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
    // (ensembleSec far off: standing with them would be an ensemble, and nobody speaks to me in one — tested below)
    const log = new WitnessLog({ ...DEFAULT_WITNESS, groupSec: 5, wordAfterSec: 6, wordGapSec: 12, ensembleSec: 1e6 });
    log.push(obsAt(0, []));
    log.push(obsAt(1, [bot(2), bot(2, "bot2")]));
    expect(log.summary().group).toEqual([]);
    log.push(obsAt(6, [bot(2), bot(2, "bot2")]));
    expect(log.summary().group.sort()).toEqual(["bot1", "bot2"]);
    const first = log.push(obsAt(7, [bot(2), bot(2, "bot2")]));
    expect(first.map((e) => e.key)).toEqual(["word.new"]); // only one of the two now
    expect(first[0].level).toBe(2);
    expect(first[0].args.dots).toEqual(glyphOf(first[0].args.who!.o)); // what is heard is theirs
    expect(formatEntry(first[0], "ko").text).toBe("누군가 말을 겁니다: ({}?)");
    expect(log.push(obsAt(8, [bot(2), bot(2, "bot2")]))).toEqual([]); // the gap
    const second = log.push(obsAt(20, [bot(2), bot(2, "bot2")]));
    expect(second.map((e) => e.key)).toEqual(["word.new"]);
  });

  it("the ensemble: I stay with someone who stays, for a moment; it ends when either moves on", () => {
    const log = new WitnessLog({ ...DEFAULT_WITNESS, ensembleSec: 3, settleSec: 1, wordAfterSec: 1000 });
    log.push(obsAt(0, []));
    expect(log.push(obsAt(1, [bot(2)])).map((e) => e.key)).toEqual(["near"]);
    expect(log.push(obsAt(3, [bot(2)]))).toEqual([]); // not yet
    const began = log.push(obsAt(4.5, [bot(2)]));
    expect(began.map((e) => e.key)).toEqual(["ensemble.start"]);
    expect(began[0].level).toBe(2);
    expect(formatEntry(began[0], "ko").text).toBe("합주 중… 2명이 모였습니다.");
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

  it("the ensemble says how many have gathered and how many a house takes, again when more come, and never lower", () => {
    const log = new WitnessLog({ ...DEFAULT_WITNESS, ensembleSec: 3, settleSec: 1, wordAfterSec: 1000, askEverySec: 1e6, buildNeeds: 4 });
    const two = bot(2);
    const third: Other = { ...bot(2), o: "bot8" };
    const fourth: Other = { ...bot(2), o: "bot9" };
    log.push(obsAt(0, []));
    log.push(obsAt(1, [two]));
    log.push(obsAt(3, [two]));
    const said = (t: number, who: Other[]) => log.push(obsAt(t, who)).filter((e) => e.key === "ensemble.start").map((e) => formatEntry(e, "ko").text);
    expect(said(4.5, [two])).toEqual(["합주 중… 2명이 모였습니다."]);
    expect(said(5, [two, third])).toEqual([]); // just come: not yet settled
    expect(said(6.5, [two, third])).toEqual(["합주 중… 3명이 모였습니다."]);
    expect(said(7, [two, third, fourth])).toEqual([]);
    expect(said(8.5, [two, third, fourth])).toEqual(["합주 중… 4명이 모였습니다. 곧 집이 올라갑니다."]);
    // one leaves and comes back: nothing new to say
    expect(said(9, [two, third])).toEqual([]);
    expect(said(11, [two, third])).toEqual([]);
    expect(said(11.5, [two, third, fourth])).toEqual([]);
    expect(said(13, [two, third, fourth])).toEqual([]);
  });

  it("which way people are, from where I look, and the most of them standing together", () => {
    // looking along +z (yaw 0): forward (0, 1), right (−1, 0)
    expect(sideOf(0, 5, 0)).toBe("front");
    expect(sideOf(-5, 5, 0)).toBe("frontRight");
    expect(sideOf(-5, 0, 0)).toBe("right");
    expect(sideOf(5, 0, 0)).toBe("left");
    expect(sideOf(0, -5, 0)).toBe("back");
    // turned to look along +x (yaw π/2): what was on the left is ahead
    expect(sideOf(5, 0, Math.PI / 2)).toBe("front");
    const at = (o: string, x: number, z: number): Other => ({ ...bot(2), o, x, z });
    const me = { x: 0, z: 0 };
    expect(gatheringIn([], me, 0, 6)).toBeNull();
    expect(gatheringIn([at("a", 0, 10)], me, 0, 6)).toEqual({ n: 1, side: "front" });
    // one nearer on the left, three together further off on the right
    expect(gatheringIn([at("a", 8, 0), at("b", -15, 0), at("c", -16, 1), at("d", -15, 2)], me, 0, 6)).toEqual({ n: 3, side: "right" });
  });

  it("someone asks now and then; an open question can be answered once, and that is what leaves a new word", () => {
    const log = new WitnessLog({ ...DEFAULT_WITNESS, wordAfterSec: 6, askEverySec: 16, askJitter: 0, askOpenSec: 7, ensembleSec: 1e6 });
    log.push(obsAt(0, []));
    log.push(obsAt(1, [bot(2)]));
    expect(log.asking()).toBe(false);
    expect(log.answer(2, "v_me")).toBeNull(); // nobody asked
    expect(log.push(obsAt(7, [bot(2)])).map((e) => e.key)).toContain("word.new");
    expect(log.asking()).toBe(true);
    const answered = log.answer(8, "v_me")!;
    expect(formatEntry(answered, "ko").text).toBe("새로운 어휘가 탄생했습니다 ({})");
    expect(answered.args.dots?.length).toBeGreaterThan(0);
    expect(log.asking()).toBe(false);
    expect(log.answer(8.5, "v_me")).toBeNull(); // once
    expect(log.summary().newWords.length).toBe(1);
    // the next question comes later, and goes away unanswered
    expect(log.push(obsAt(20, [bot(2)])).some((e) => e.key === "word.asked")).toBe(false);
    const asked = log.push(obsAt(24, [bot(2)])).find((e) => e.key === "word.asked")!;
    expect(asked.level).toBe(2);
    expect(formatEntry(asked, "ko").text).toContain("{}");
    expect(asked.args.dots).not.toEqual(glyphOf("bot1")); // their melody gone strange
    expect(log.asking()).toBe(true);
    log.push(obsAt(32, [bot(2)]));
    expect(log.asking()).toBe(false);
    expect(log.summary().newWords.length).toBe(1);
    expect(log.summary().asked).toBe(2);
    // nobody near, nobody asks
    const alone = new WitnessLog();
    alone.push(obsAt(0, []));
    expect(alone.push(obsAt(60, [])).some((e) => e.key === "word.asked")).toBe(false);
  });

  it("an ensemble is left alone: nobody asks while it goes on, and after a while it gives a story; the wait before a question is drawn a little random", () => {
    const log = new WitnessLog({ ...DEFAULT_WITNESS, ensembleSec: 3, settleSec: 1, wordAfterSec: 6, wordGapSec: 12, askEverySec: 16, storySec: 20 });
    log.push(obsAt(0, []));
    for (let t = 1; t <= 30; t++) {
      const keys = log.push(obsAt(t, [bot(2), bot(2, "bot2")])).map((e) => e.key);
      expect(keys).not.toContain("word.new");
      expect(keys).not.toContain("word.asked");
      if (t < 20) expect(keys).not.toContain("story.born"); // together since t = 1, storySec 20
    }
    const story = log.entries.filter((e) => e.key === "story.born");
    expect(story.length).toBe(1); // once per ensemble
    expect(formatEntry(story[0], "ko").text).toBe("이야기가 탄생했습니다 ({})");
    expect(story[0].args.dots!.length).toBeGreaterThan(glyphOf("bot1").length); // the melodies as one glyph
    expect(log.asking()).toBe(false);
    // the waits: never the same twice, all within ±35 % of askEverySec
    const alone = new WitnessLog({ ...DEFAULT_WITNESS, wordAfterSec: 6, askEverySec: 16, askOpenSec: 7, ensembleSec: 1e6 });
    alone.push(obsAt(0, []));
    const asks: number[] = [];
    for (let t = 1; t <= 200; t++) if (alone.push(obsAt(t, [bot(2)])).some((e) => e.key === "word.asked")) asks.push(t);
    const gaps = asks.slice(1).map((t, i) => t - asks[i]);
    expect(gaps.length).toBeGreaterThan(3);
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(16 * 0.65 - 1);
      expect(g).toBeLessThanOrEqual(16 * 1.35 + 1);
    }
    expect(new Set(gaps).size).toBeGreaterThan(1);
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

  it("whoever is near at the end keeps watch: one line, the one near for longest; nobody near, no line", () => {
    const log = new WitnessLog({ ...DEFAULT_WITNESS, wordAfterSec: 1000 });
    log.push(obsAt(0, []));
    log.keptWatch(1);
    expect(log.entries.some((e) => e.key === "dying.watched")).toBe(false);
    log.push(obsAt(2, [bot(2)]));
    log.push(obsAt(5, [bot(2), bot(2, "bot2")]));
    log.keptWatch(6);
    log.keptWatch(7);
    const lines = log.entries.filter((e) => e.key === "dying.watched");
    expect(lines.length).toBe(1);
    expect(lines[0].args.dots).toEqual(glyphOf("bot1"));
    expect(formatEntry(lines[0], "ko").text).toBe("({})가 당신의 마지막을 지킵니다...");
  });

  it("a left word: found once, with the melody of the one who left it", () => {
    const log = new WitnessLog({ ...DEFAULT_WITNESS, wordGapSec: 12 });
    log.push(obsAt(0, []));
    const found = log.push(obsAt(1, [], false, ["v_old"]));
    expect(found.map((e) => e.key)).toEqual(["word.found"]);
    expect(found[0].args.dots).toEqual(glyphOf("v_old"));
    expect(formatEntry(found[0], "en").text).toBe("A word left by ({}) found");
    expect(formatEntry(found[0], "ko").text).toBe("({})가 남긴 말 발견");
    expect(log.push(obsAt(30, [], false, ["v_old"]))).toEqual([]); // once a life
    expect(log.summary().found).toEqual(["v_old"]);
  });

  it("while living the words are plain: no numbers to read, no percentages, nobody called anything but their melody", () => {
    const near: LogEntry = { t: 2, key: "near", args: { who: { o: "bot1", r: "worker" }, dist: 2, bearing: "E", moving: true }, level: 0 };
    expect(formatEntry(near, "ko")).toEqual({ prefix: "T+00:02", text: "({}) 접근" });
    expect(formatEntry({ t: 0, key: "you.state", args: { moving: false, surface: "open" }, level: 0 }, "ko").text).toBe("풀밭에 서 있습니다.");
    expect(formatEntry({ t: 0, key: "gone", args: { who: { o: "bot1", r: "worker" }, forSec: 72 }, level: 0 }, "ko").text).toBe("({}) 떠남 · 1분 12초 함께");
    // "together" is who is here now, not everyone who ever passed through those cells
    const share: LogEntry = { t: 72, key: "concrete.share", args: { n: 1, near: 5, with: Array.from({ length: 17 }, (_, i) => ({ o: `bot${i}`, r: "worker" as const })) }, level: 2 };
    expect(formatEntry(share, "ko").text).toBe("집이 올라갑니다 · 지금 5명이 함께");
    expect(formatEntry(share, "en").text).toBe("A house goes up · 5 together now");
    expect(formatEntry({ ...share, args: { n: 1 } }, "ko").text).toBe("집이 올라갑니다.");
    expect(formatEntry({ t: 72, key: "concrete.passed", args: { sec: 372 }, level: 1 }, "ko").text).toBe("누군가 지은 집을 지나갑니다 · 6분 전");
    const alone = (args: LogEntry["args"]) => formatEntry({ t: 72, key: "alone.long", args: { sec: 30, ...args }, level: 1 }, "ko").text;
    expect(alone({ n: 3, bearing: "frontRight" })).toBe("30초째 혼자입니다. 오른쪽 앞에 세 명이 모여 있습니다.");
    expect(alone({ n: 1, bearing: "left" })).toBe("30초째 혼자입니다. 왼쪽에 누군가 있습니다.");
    expect(alone({})).toBe("30초째 혼자입니다. 혼자서는 집을 지을 수 없습니다.");
  });
});

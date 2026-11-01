import { describe, expect, it } from "vitest";
import { ScoreFeed } from "@/lib/parliament/serverWorld";
import type { PEvent, Slab } from "@/lib/parliament";
import { chunkEndMs, chunkOf, CLOSE_GRACE_MS } from "@/lib/world/protocol";
import { homeKey } from "./tonality";
import { presences, scoreDetune, scoreSignature } from "./global";
import { BUILDINGS_EVERY_BARS, BarScore, SCORE_MARGIN_MS } from "./score";

const EPOCH = 1_800_000_000_000;
const BAR_SEC = 2.8;
const WINDOW = 600;
const barStart = (bar: number) => EPOCH + bar * BAR_SEC * 1000;
const ev = (o: string, s: number, x = 0): PEvent => ({ id: `${o}:${s}`, o, r: "worker", k: "p", x, z: 0, s });
const noSlabs = (): readonly Slab[] => [];
const signature = (people: ReturnType<typeof presences>) => scoreSignature(people, (p) => homeKey(p.o));

/** A wall: chunks reach it when `arrive` says, and each bar is written whenever it happens to be queued. */
function play(chunks: Map<number, PEvent[]>, bars: number[], arrive: (chunk: number, bar: number) => boolean): number[] {
  const feed = new ScoreFeed();
  const score = new BarScore(feed, noSlabs);
  const given = new Set<number>();
  return bars.map((bar) => {
    for (const k of [...chunks.keys()].sort((a, b) => a - b)) {
      if (given.has(k) || !arrive(k, bar)) continue;
      given.add(k);
      feed.push(k, chunks.get(k)!);
    }
    return signature(score.at(bar, EPOCH, BAR_SEC, WINDOW).people);
  });
}

describe("the same score on every wall", () => {
  // bots seen in a changing order, someone arriving partway, over a minute of chunks
  const chunks = new Map<number, PEvent[]>();
  const firstChunk = chunkOf(EPOCH);
  for (let k = 0; k < 40; k++) {
    const list: PEvent[] = [];
    for (let i = 0; i < 6; i++) list.push(ev(`bot${(i + k) % 6}`, k * 2 + i * 0.1));
    if (k > 12) list.push(ev("v_late", k * 2));
    chunks.set(firstChunk + k, list);
  }
  const bars = Array.from({ length: 24 }, (_, i) => i + 3);
  /** A chunk is on every wall by the time its bar is written if it closed `lead` before the bar's start. */
  const closedBefore = (lead: number) => (chunk: number, bar: number) => chunkEndMs(chunk) + CLOSE_GRACE_MS <= barStart(bar) - lead;

  it("does not depend on when the chunks arrived, as long as they closed before the margin", () => {
    const prompt = play(chunks, bars, () => true); // everything already here
    const onTime = play(chunks, bars, closedBefore(SCORE_MARGIN_MS)); // each chunk at the last moment it may
    expect(onTime).toEqual(prompt);
  });

  it("changes as the people change", () => {
    const sigs = play(chunks, bars, () => true);
    expect(new Set(sigs).size).toBeGreaterThan(5);
  });

  it("a wall that reads a chunk too late differs only until it has caught up", () => {
    const steady = play(chunks, bars, () => true);
    // this wall misses everything for bars up to 10
    const late = play(chunks, bars, (_, bar) => bar > 10);
    expect(late.slice(0, 7)).not.toEqual(steady.slice(0, 7));
    expect(late.slice(9)).toEqual(steady.slice(9));
  });

  it("every wall has the bar's chunks by the time it plans the bar", () => {
    // planned 3.5 s before the start; the newest chunk it may use closed at least 3 s before that
    expect(SCORE_MARGIN_MS - 3500).toBeGreaterThanOrEqual(3000);
  });
});

describe("the feed", () => {
  it("holds a chunk back until asked for it", () => {
    const f = new ScoreFeed();
    f.push(5, [ev("a", 1)]);
    f.push(6, [ev("b", 2)]);
    f.advanceTo(4);
    expect(f.log.size).toBe(0);
    f.advanceTo(5);
    expect(f.log.size).toBe(1);
    f.advanceTo(9);
    expect(f.log.size).toBe(2);
  });

  it("drops repeats by id and empties with the world", () => {
    const f = new ScoreFeed();
    f.push(1, [ev("a", 1), ev("a", 1)]);
    f.advanceTo(1);
    expect(f.log.size).toBe(1);
    f.push(2, [ev("b", 2)]);
    f.clear();
    f.advanceTo(2);
    expect(f.log.size).toBe(0);
  });
});

describe("waiting for a bar's chunks", () => {
  it("a bar is ready once the chunk it is written from has been read, an empty one too", () => {
    const feed = new ScoreFeed();
    const score = new BarScore(feed, noSlabs);
    const bar = 100;
    const cut = chunkOf(barStart(bar) - SCORE_MARGIN_MS - CLOSE_GRACE_MS) - 1;
    expect(score.ready(bar, EPOCH, BAR_SEC)).toBe(false);
    feed.readTo = cut - 1;
    expect(score.ready(bar, EPOCH, BAR_SEC)).toBe(false);
    feed.readTo = cut;
    expect(score.ready(bar, EPOCH, BAR_SEC)).toBe(true);
  });

  it("a new world waits for its chunks again", () => {
    const feed = new ScoreFeed();
    feed.readTo = 500;
    feed.clear();
    expect(feed.readTo).toBe(-Infinity);
  });
});

describe("the score of a bar", () => {
  it("asks for buildings only on the bars every wall shares", () => {
    const feed = new ScoreFeed();
    feed.log.add(ev("a", 1));
    const asked: number[] = [];
    let bar = 0;
    const score = new BarScore(feed, () => {
      asked.push(bar);
      return [];
    });
    for (bar = 1; bar <= BUILDINGS_EVERY_BARS * 2 + 1; bar++) score.at(bar, EPOCH, BAR_SEC, WINDOW);
    expect(asked).toEqual([1, BUILDINGS_EVERY_BARS, BUILDINGS_EVERY_BARS * 2]);
  });

  it("starts over with a new epoch", () => {
    const feed = new ScoreFeed();
    feed.log.add(ev("a", 1));
    let folds = 0;
    const score = new BarScore(feed, () => {
      folds++;
      return [];
    });
    score.at(5, EPOCH, BAR_SEC, WINDOW);
    score.at(5, EPOCH + 1000, BAR_SEC, WINDOW);
    expect(folds).toBe(2);
  });
});

describe("the voices", () => {
  it("equal weights come in the order of their names, whoever was seen first", () => {
    const a = presences([ev("bot10", 1), ev("bot2", 1), ev("bot1", 1)], WINDOW);
    const b = presences([ev("bot1", 1), ev("bot10", 1), ev("bot2", 1)], WINDOW);
    expect(a.map((p) => p.o)).toEqual(["bot1", "bot2", "bot10"]);
    expect(b.map((p) => p.o)).toEqual(["bot1", "bot2", "bot10"]);
  });

  it("the heavier still come first", () => {
    const p = presences([ev("z", 1), ev("z", 2), ev("a", 1)], WINDOW);
    expect(p.map((x) => x.o)).toEqual(["z", "a"]);
  });

  it("a note's detune is fixed by who, when and which, within ±12 cents", () => {
    expect(scoreDetune("bot1", 5, 0)).toBe(scoreDetune("bot1", 5, 0));
    expect(scoreDetune("bot1", 5, 0)).not.toBe(scoreDetune("bot1", 6, 0));
    for (let i = 0; i < 50; i++) expect(Math.abs(scoreDetune(`bot${i}`, i, i))).toBeLessThanOrEqual(12);
  });
});

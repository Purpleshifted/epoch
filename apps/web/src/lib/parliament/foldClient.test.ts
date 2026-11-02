/** The fold off the main thread answers what the fold itself would, follows the log's forgetting and never piles up. */
import { describe, expect, it } from "vitest";
import { FoldClient, FoldHost, type FoldReply, type FoldRequest } from "./foldClient";
import { FoldState } from "./foldState";
import { EventLog } from "./log";
import { DEFAULT_FOLD, type PEvent } from "./types";

const OPTS = { lateMarginSec: 5 };
const sample = (o: string, s: number, x = 0, z = 0): PEvent => ({ id: `${o}:${s}`, o, r: "worker", k: "p", x, z, s });
const crowd = (from: number, to: number): PEvent[] => {
  const out: PEvent[] = [];
  for (let s = from; s < to; s++) for (let i = 0; i < 6; i++) out.push(sample(`b${i}`, s, (i % 3) + Math.sin(s / 9), (i % 2) + Math.cos(s / 7)));
  return out;
};

/** A client and a host with the messages held until `pump`, as a worker holds them. */
function pair(log: EventLog) {
  const host = new FoldHost(DEFAULT_FOLD, OPTS);
  const sent: FoldRequest[] = [];
  const client = new FoldClient(log, (m) => sent.push(m));
  const pump = () => {
    for (const m of sent.splice(0)) {
      const r: FoldReply | null = host.handle(m);
      if (r) client.receive(r);
    }
  };
  return { client, sent, pump };
}

describe("the fold off the main thread", () => {
  it("answers from the last reading, and that reading is what the fold itself says", () => {
    const log = new EventLog();
    const events = crowd(0, 200);
    log.addMany(events);
    const { client, pump } = pair(log);
    expect(client.at(199)).toEqual({ slabs: [], paths: [] });
    pump();
    const direct = new FoldState(DEFAULT_FOLD, OPTS);
    for (const e of events) direct.add(e);
    expect(client.at(199)).toEqual(direct.snapshot(199));
    expect(client.stats()?.samples).toBe(events.length);
  });

  it("asks for one reading per kind at a time", () => {
    const log = new EventLog();
    log.addMany(crowd(0, 20));
    const { client, sent, pump } = pair(log);
    const reads = () => sent.filter((m) => m.type === "read").length;
    client.at(10);
    client.at(11);
    client.at(12);
    expect(reads()).toBe(1);
    client.at(12, { x: 0, z: 0, r: 5 });
    client.at(12, { x: 1, z: 0, r: 5 }, { tailOf: "b0" });
    expect(reads()).toBe(3);
    pump();
    client.at(13);
    expect(reads()).toBe(1);
  });

  it("asks again when a reading never comes back", () => {
    const log = new EventLog();
    let clock = 0;
    const sent: FoldRequest[] = [];
    const client = new FoldClient(log, (m) => sent.push(m), () => clock);
    client.at(1);
    clock = 5_000;
    client.at(1);
    expect(sent.filter((m) => m.type === "read")).toHaveLength(1);
    clock = 11_000;
    client.at(1);
    expect(sent.filter((m) => m.type === "read")).toHaveLength(2);
  });

  it("follows the log's forgetting without sending the world again", () => {
    const log = new EventLog();
    log.addMany(crowd(0, 100));
    const { client, sent, pump } = pair(log);
    client.at(99);
    pump();
    log.dropBefore(30);
    const fresh = crowd(100, 110);
    log.addMany(fresh);
    client.at(109);
    const events = sent.filter((m): m is Extract<FoldRequest, { type: "events" }> => m.type === "events");
    expect(sent.some((m) => m.type === "drop" && m.cut === 30)).toBe(true);
    expect(events.flatMap((m) => m.events).map((e) => e.id)).toEqual(fresh.map((e) => e.id));
    pump();
    client.at(109);
    pump();
    // the same calls on the fold itself, in the same order
    const direct = new FoldState(DEFAULT_FOLD, OPTS);
    for (const e of crowd(0, 100)) direct.add(e);
    direct.snapshot(99);
    direct.dropBefore(30);
    for (const e of fresh) direct.add(e);
    direct.snapshot(109);
    expect(client.at(109)).toEqual(direct.snapshot(109));
  });

  it("a world cleared forgets its last reading", () => {
    const log = new EventLog();
    log.addMany(crowd(0, 100));
    const { client, sent, pump } = pair(log);
    client.at(99);
    pump();
    expect(client.at(99).slabs.length + client.at(99).paths.length).toBeGreaterThan(0);
    pump();
    log.clear();
    expect(client.at(5)).toEqual({ slabs: [], paths: [] });
    expect(sent.some((m) => m.type === "clear")).toBe(true);
  });
});

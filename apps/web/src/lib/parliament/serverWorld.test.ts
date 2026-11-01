import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventLog, LS_EVENTS_EPOCH_KEY, LS_EVENTS_KEY, LS_KEEP_FROM_KEY, LS_PARLIAMENT_EPOCH_KEY, clearWorld, currentEpochKey, hasWorldMirror, keepWindowSec, keepFromS, saveMerged, setKeepFrom, setKeepWindowSec, setWorldMirror } from "./log";
import { ScoreFeed, WorldAgent, serverWorldName, startServerWorld, stopServerWorld, type WorldCommand, type WorldTransport } from "./serverWorld";
import type { PEvent } from "./types";
import { setRateMirror, setTimeRate, setWallOffset, timeRate, wallNow, worldNow } from "./worldClock";
import { HOST_LEASE_MS, chunkEndMs, chunkOf, lastClosedChunk, type WorldState } from "@/lib/world/protocol";

const T0 = 1_800_000_000_000;

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const ev = (id: string, s: number): PEvent => ({ id, o: id.split(":")[0], r: "worker", k: "p", x: 1, z: 2, s });

/** A server in memory: chunks by number, its clock `skewMs` ahead of this machine's. */
class FakeServer implements WorldTransport {
  skewMs = 0;
  down = false;
  refuse = false;
  rev = 1;
  st: WorldState;
  chunks = new Map<number, PEvent[]>();
  sent: { epochMs: number; events: PEvent[] }[] = [];
  reads: [number, number][] = [];
  windowReads = 0;
  commands: WorldCommand[] = [];
  released: string[] = [];
  /** Pages of the window read: `next` is the chunk the next page starts from. */
  pages: { events: PEvent[]; next: number | null }[] = [{ events: [], next: null }];

  constructor(epochMs: number) {
    this.st = { world: "test-a", rev: this.rev, epochMs, anchor: { r: T0, v: T0, rate: 1 }, keepWindowSec: 1200, botStartMs: null, host: null };
  }
  private guard() {
    if (this.down) throw new Error("down");
  }
  serverMs() {
    return Date.now() + this.skewMs;
  }
  async now() {
    this.guard();
    return this.serverMs();
  }
  async state() {
    this.guard();
    return this.st;
  }
  async send(epochMs: number, events: readonly PEvent[], host?: string) {
    this.guard();
    if (epochMs !== this.st.epochMs) return { ended: true as const, state: this.st };
    this.sent.push({ epochMs, events: [...events] });
    if (host) this.lease(host, false);
    return { ended: false as const, ...(host ? { state: this.st } : {}) };
  }
  release(id: string) {
    this.released.push(id);
    if (this.st.host?.id === id) this.st = { ...this.st, host: null };
  }
  /** As the database does it: the holder, nobody, a lease run out, or by force. The start is set once. */
  lease(id: string, force: boolean) {
    const now = this.serverMs();
    const h = this.st.host;
    if (h && h.id !== id && h.untilMs >= now && !force) return;
    this.st = { ...this.st, host: { id, untilMs: now + HOST_LEASE_MS }, botStartMs: this.st.botStartMs ?? now };
  }
  async range(_epochMs: number, from: number, to: number) {
    this.guard();
    if (to > lastClosedChunk(this.serverMs())) return { early: true as const };
    this.reads.push([from, to]);
    const events: PEvent[] = [];
    for (let k = from; k <= to; k++) events.push(...(this.chunks.get(k) ?? []));
    return { early: false as const, events };
  }
  async window(epochMs: number, cursor: number) {
    this.guard();
    if (epochMs !== this.st.epochMs) return { ended: true as const, state: this.st };
    this.windowReads++;
    const page = this.pages[cursor === 0 ? 0 : this.pages.findIndex((_, i) => i > 0 && this.pages[i - 1].next === cursor)];
    return { ended: false as const, events: page.events, next: page.next, to: lastClosedChunk(this.serverMs()) };
  }
  async command(cmd: WorldCommand) {
    this.guard();
    this.commands.push(cmd);
    if (this.refuse) return null;
    if (cmd.op === "clear") this.newEpoch(this.st.epochMs + 1000);
    if (cmd.op === "rate") this.set({ rate: cmd.rate });
    if (cmd.op === "window") this.st = { ...this.st, rev: ++this.rev, keepWindowSec: cmd.sec };
    if (cmd.op === "host") this.lease(cmd.id, !!cmd.force);
    return this.st;
  }
  newEpoch(epochMs: number) {
    this.st = { ...this.st, rev: ++this.rev, epochMs, botStartMs: null };
  }
  set(a: Partial<WorldState["anchor"]>) {
    const at = this.serverMs();
    const v = this.st.anchor.v + (at - this.st.anchor.r) * this.st.anchor.rate;
    this.st = { ...this.st, rev: ++this.rev, anchor: { r: at, v, rate: a.rate ?? this.st.anchor.rate } };
  }
}

const settle = () => vi.advanceTimersByTimeAsync(0);

/** Runs the agent's loop for `ms` of clock time. */
async function run(agent: WorldAgent, ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 500) {
    agent.tick();
    await vi.advanceTimersByTimeAsync(500);
  }
}

describe("the shared world's agent", () => {
  let server: FakeServer;
  let agent: WorldAgent;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.stubGlobal("localStorage", new MemoryStorage());
    setWorldMirror(null);
    setRateMirror(null);
    setWallOffset(0);
    server = new FakeServer(T0 - 60_000);
    agent = new WorldAgent("test-a", server);
  });

  afterEach(() => {
    setWorldMirror(null);
    setRateMirror(null);
    setWallOffset(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const useAgentAsMirror = () => {
    setWorldMirror({ enqueue: (e) => agent.enqueue(e), clear: () => void agent.command({ op: "clear" }), setKeepWindow: (sec) => void agent.command({ op: "window", sec }) });
    setRateMirror((rate) => void agent.command({ op: "rate", rate }));
  };

  describe("the keys everything reads", () => {
    it("take the server's epoch, clock and window", async () => {
      server.st = { ...server.st, keepWindowSec: 600 };
      await agent.begin();
      expect(currentEpochKey()).toBe(String(server.st.epochMs));
      expect(keepWindowSec()).toBe(600);
      expect(worldNow()).toBe(T0);
    });

    it("the world clock follows the server's, however wrong this machine's is", async () => {
      server.skewMs = 5000;
      server.st = { ...server.st, anchor: { r: T0 + 5000, v: T0 + 5000, rate: 1 } };
      await agent.begin();
      expect(wallNow()).toBe(Date.now() + 5000);
      expect(worldNow()).toBe(Date.now() + 5000);
    });

    it("two machines with different clocks read the same world time", async () => {
      await agent.begin();
      const here = worldNow();
      vi.stubGlobal("localStorage", new MemoryStorage());
      const other = new FakeServer(server.st.epochMs);
      other.skewMs = 7000; // the same server seen from a machine 7 s behind
      other.st = { ...other.st, anchor: { r: T0 + 7000, v: T0, rate: 1 } };
      await new WorldAgent("test-a", other).begin();
      expect(worldNow()).toBe(here);
    });

    it("a slow answer from a busy moment does not move the clock", async () => {
      await agent.begin();
      expect(wallNow()).toBe(Date.now());
      // the next answer takes 2 s, and its time is from the start of that wait
      server.now = async () => {
        const at = Date.now();
        await new Promise((r) => setTimeout(r, 2000));
        return at;
      };
      vi.setSystemTime(Date.now() + 61_000);
      agent.tick();
      await vi.advanceTimersByTimeAsync(2500);
      expect(wallNow()).toBe(Date.now());
    });

    it("the cut-off comes from the shared clock, not from any tab's offset", async () => {
      useAgentAsMirror();
      await agent.begin();
      const cut = keepFromS();
      expect(cut).toBe(60 - 1200);
      setKeepFrom(99_999); // what a player tab does with its own assigned time
      expect(keepFromS()).toBe(cut);
    });

    it("a new epoch from the server replaces what this browser held", async () => {
      localStorage.setItem(LS_PARLIAMENT_EPOCH_KEY, "1");
      localStorage.setItem(LS_EVENTS_EPOCH_KEY, "1");
      localStorage.setItem(LS_EVENTS_KEY, "[]");
      await agent.begin();
      expect(currentEpochKey()).toBe(String(server.st.epochMs));
      expect(localStorage.getItem(LS_EVENTS_KEY)).toBeNull();
    });

    it("an older state from a cache changes nothing", async () => {
      await agent.begin();
      const old = server.st;
      server.set({ rate: 5 });
      await agent.command({ op: "rate", rate: 5 });
      expect(timeRate()).toBe(5);
      server.st = old;
      vi.setSystemTime(Date.now() + 11_000);
      agent.tick();
      await settle();
      expect(timeRate()).toBe(5);
    });
  });

  describe("reading", () => {
    it("starts from the window, then follows the closed chunks in order, one read per chunk", async () => {
      server.pages = [{ events: [ev("a:1", 1)], next: null }];
      await agent.begin();
      const log = new EventLog();
      agent.attach(log);
      await run(agent, 500);
      expect(log.all().map((e) => e.id)).toEqual(["a:1"]);
      const first = lastClosedChunk(Date.now()) + 1;
      server.chunks.set(first, [ev("b:2", 2)]);
      server.chunks.set(first + 1, [ev("c:3", 3)]);
      await run(agent, 8000);
      expect(log.all().map((e) => e.id)).toEqual(["a:1", "b:2", "c:3"]);
      expect(server.windowReads).toBe(1);
      for (const [from, to] of server.reads) expect(from).toBe(to);
    });

    it("reads every page of a long window", async () => {
      server.pages = [
        { events: [ev("a:1", 1)], next: 100 },
        { events: [ev("b:2", 2)], next: null },
      ];
      await agent.begin();
      const log = new EventLog();
      agent.attach(log);
      await run(agent, 2000);
      expect(log.all().map((e) => e.id)).toEqual(["a:1", "b:2"]);
    });

    it("a log attached later gets what is already known", async () => {
      server.pages = [{ events: [ev("a:1", 1)], next: null }];
      await agent.begin();
      await run(agent, 500);
      const log = new EventLog();
      agent.attach(log);
      expect(log.size).toBe(1);
    });

    it("never asks for a chunk that has not closed", async () => {
      await agent.begin();
      await run(agent, 10_000);
      for (const [, to] of server.reads) expect(chunkEndMs(to)).toBeLessThan(Date.now());
    });

    it("catches up by range after an outage, and reads the window after a long one", async () => {
      await agent.begin();
      await run(agent, 2000);
      server.down = true;
      await run(agent, 20_000);
      expect(agent.status().online).toBe(false);
      server.down = false;
      const lost = lastClosedChunk(Date.now()) - 2;
      server.chunks.set(lost, [ev("x:9", 9)]);
      const log = new EventLog();
      agent.attach(log);
      await run(agent, 8000);
      expect(log.all().map((e) => e.id)).toEqual(["x:9"]);
      expect(agent.status().online).toBe(true);
      expect(server.windowReads).toBe(1);
      server.down = true;
      vi.setSystemTime(Date.now() + 30 * 60_000);
      await run(agent, 1000);
      server.down = false;
      await run(agent, 8000);
      expect(server.windowReads).toBe(2);
    });

    it("a hidden tab reads seldom", async () => {
      const hiddenAgent = new WorldAgent("test-a", server, () => true);
      await hiddenAgent.begin();
      await run(hiddenAgent, 30_000);
      expect(server.reads.length + server.windowReads).toBeLessThanOrEqual(4);
    });
  });

  describe("sending", () => {
    it("what this tab writes goes to the server, in batches", async () => {
      useAgentAsMirror();
      await agent.begin();
      saveMerged([ev("me:1", 61), ev("me:2", 62)], server.st.epochMs);
      await run(agent, 500);
      expect(server.sent).toHaveLength(1);
      expect(server.sent[0].events.map((e) => e.id)).toEqual(["me:1", "me:2"]);
      await run(agent, 5000);
      expect(server.sent).toHaveLength(1);
    });

    it("what came from the server does not go back", async () => {
      useAgentAsMirror();
      await agent.begin();
      saveMerged([ev("them:1", 61)], server.st.epochMs, true);
      await run(agent, 3000);
      expect(server.sent).toHaveLength(0);
    });

    it("the mirror copies the server's events into storage for a reload without network", async () => {
      useAgentAsMirror();
      server.pages = [{ events: [ev("a:1", 61)], next: null }];
      await agent.begin();
      await run(agent, 11_000);
      expect(JSON.parse(localStorage.getItem(LS_EVENTS_KEY)!).map((e: PEvent) => e.id)).toEqual(["a:1"]);
      expect(server.sent).toHaveLength(0);
    });

    it("keeps events through an outage and sends them when it is back", async () => {
      useAgentAsMirror();
      await agent.begin();
      server.down = true;
      saveMerged([ev("me:1", 61)], server.st.epochMs);
      await run(agent, 10_000);
      expect(agent.status().outbox).toBe(1);
      expect(server.sent).toHaveLength(0);
      server.down = false;
      await run(agent, 6000);
      expect(server.sent.flatMap((b) => b.events.map((e) => e.id))).toEqual(["me:1"]);
      expect(agent.status().outbox).toBe(0);
    });

    it("drops what it holds when the world has ended, and joins the new one", async () => {
      useAgentAsMirror();
      await agent.begin();
      const log = new EventLog();
      agent.attach(log);
      log.add(ev("old:1", 1));
      saveMerged([ev("me:1", 61)], server.st.epochMs);
      const next = server.st.epochMs + 5000;
      server.newEpoch(next);
      await run(agent, 500);
      expect(currentEpochKey()).toBe(String(next));
      expect(agent.status().outbox).toBe(0);
      expect(log.size).toBe(0);
      expect(server.sent).toHaveLength(0);
    });
  });

  describe("changing the world", () => {
    it("clearing asks the server, and every key follows its answer", async () => {
      useAgentAsMirror();
      await agent.begin();
      const before = server.st.epochMs;
      clearWorld();
      await settle();
      expect(server.commands).toEqual([{ op: "clear" }]);
      expect(currentEpochKey()).toBe(String(before + 1000));
    });

    it("a refused clear leaves the world as it was", async () => {
      useAgentAsMirror();
      server.refuse = true;
      server.pages = [{ events: [ev("a:1", 1)], next: null }];
      await agent.begin();
      await run(agent, 500);
      const log = new EventLog();
      agent.attach(log);
      log.clear(); // the wall does this at once
      expect(await agent.command({ op: "clear" })).toBe(false);
      agent.refeed();
      expect(log.size).toBe(1);
      expect(currentEpochKey()).toBe(String(server.st.epochMs));
    });

    it("a change of rate goes to the server and comes back as the clock", async () => {
      useAgentAsMirror();
      await agent.begin();
      setTimeRate(5);
      await settle();
      expect(server.commands).toEqual([{ op: "rate", rate: 5 }]);
      expect(timeRate()).toBe(5);
    });

    it("setting the rate it already has asks nothing", async () => {
      useAgentAsMirror();
      await agent.begin();
      setTimeRate(1);
      await settle();
      expect(server.commands).toEqual([]);
    });

    it("the window goes to the server once", async () => {
      useAgentAsMirror();
      await agent.begin();
      setKeepWindowSec(1600);
      setKeepWindowSec(1600);
      await settle();
      expect(server.commands).toEqual([{ op: "window", sec: 1600 }]);
      expect(keepWindowSec()).toBe(1600);
    });
  });

  describe("the bot host", () => {
    const wall = (id: string) => new WorldAgent("test-a", server, () => false, id);
    const hostOf = (a: WorldAgent) => a.status().host;

    it("of two walls that want it, one holds the lease and the other waits", async () => {
      const a = wall("a");
      const b = wall("b");
      await a.begin();
      await b.begin();
      a.setWantHost(true);
      await run(a, 500);
      b.setWantHost(true);
      await run(b, 500);
      expect(a.botsAllowed()).toBe(true);
      expect(b.botsAllowed()).toBe(false);
      expect(hostOf(a)).toBe("here");
      expect(hostOf(b)).toBe("other");
    });

    it("a wall that does not want it never takes it, and may not emit", async () => {
      const a = wall("a");
      await a.begin();
      await run(a, 6000);
      expect(a.botsAllowed()).toBe(false);
      expect(server.st.host).toBeNull();
    });

    it("the lease is renewed with the events it sends, without a request of its own", async () => {
      const a = wall("a");
      await a.begin();
      a.setWantHost(true);
      await run(a, 500);
      const first = server.commands.length;
      for (let i = 0; i < 40; i++) {
        a.enqueue([ev(`bot0:${i}`, i)]);
        await run(a, 1000);
      }
      expect(a.botsAllowed()).toBe(true);
      expect(server.commands.length).toBe(first);
    });

    it("without events to send it still looks at its lease, and holds it", async () => {
      const a = wall("a");
      await a.begin();
      a.setWantHost(true);
      await run(a, 40_000);
      expect(a.botsAllowed()).toBe(true);
    });

    it("when the host's lease runs out, the waiting wall takes over with the same start", async () => {
      const a = wall("a");
      const b = wall("b");
      await a.begin();
      await b.begin();
      a.setWantHost(true);
      await run(a, 500);
      const start = a.botStartMs();
      expect(start).not.toBeNull();
      b.setWantHost(true);
      // a's tab is gone: nothing more from it
      let waited = 0;
      while (!b.botsAllowed() && waited < 60_000) {
        await run(b, 500);
        waited += 500;
      }
      expect(waited).toBeLessThanOrEqual(HOST_LEASE_MS + 5000);
      expect(b.botStartMs()).toBe(start);
    });

    it("switching off lets the lease go at once", async () => {
      const a = wall("a");
      await a.begin();
      a.setWantHost(true);
      await run(a, 500);
      a.setWantHost(false);
      expect(server.released).toEqual(["a"]);
      expect(a.botsAllowed()).toBe(false);
    });

    it("a wall can take the bots by force, and the old host stops at its next look", async () => {
      const a = wall("a");
      const b = wall("b");
      await a.begin();
      await b.begin();
      a.setWantHost(true);
      await run(a, 500);
      expect(await b.takeHost()).toBe(true);
      expect(hostOf(b)).toBe("here");
      await run(a, 6000);
      expect(a.botsAllowed()).toBe(false);
    });

    it("force refused: nothing changes", async () => {
      const a = wall("a");
      const b = wall("b");
      await a.begin();
      await b.begin();
      a.setWantHost(true);
      await run(a, 500);
      server.refuse = true;
      expect(await b.takeHost()).toBe(false);
      expect(server.st.host?.id).toBe("a");
    });

    it("with the server silent, a wall runs the bots itself, from a start of its own", async () => {
      const a = wall("a");
      await a.begin();
      a.setWantHost(true);
      server.down = true;
      await run(a, 3000);
      expect(a.botsAllowed()).toBe(false);
      await run(a, 16_000);
      expect(a.botsAllowed()).toBe(true);
      expect(a.botStartMs()).not.toBeNull();
    });

    it("a wall that starts without any server runs the bots after the wait as well", async () => {
      server.down = true;
      const a = wall("a");
      await a.begin().catch(() => {});
      await run(a, 16_000);
      expect(a.botsAllowed()).toBe(true);
    });

    it("a host goes on through an outage without a gap, with its own start", async () => {
      const a = wall("a");
      await a.begin();
      a.setWantHost(true);
      await run(a, 500);
      const start = a.botStartMs();
      server.down = true;
      // every moment of it: past the lease's end (10 s) and before the silence counts for everybody (15 s) included
      for (let t = 0; t < 30; t++) {
        await run(a, 1000);
        expect(a.botsAllowed()).toBe(true);
      }
      expect(a.botStartMs()).toBe(start);
    });

    it("a wall that was not the host waits out the silence before it runs the bots", async () => {
      const a = wall("a");
      const b = wall("b");
      await a.begin();
      await b.begin();
      a.setWantHost(true);
      await run(a, 500);
      b.setWantHost(true);
      await run(b, 500);
      server.down = true;
      await run(b, 12_000);
      expect(b.botsAllowed()).toBe(false);
      await run(b, 5000);
      expect(b.botsAllowed()).toBe(true);
    });

    it("when the network comes back and another wall has the bots, the old host stops", async () => {
      const a = wall("a");
      const b = wall("b");
      await a.begin();
      await b.begin();
      a.setWantHost(true);
      await run(a, 500);
      server.down = true;
      await run(a, 20_000);
      expect(a.botsAllowed()).toBe(true);
      server.down = false;
      b.setWantHost(true);
      await run(b, 500); // a's lease ran out long ago: b gets it
      expect(hostOf(b)).toBe("here");
      await run(a, 6000);
      expect(a.botsAllowed()).toBe(false);
      expect(hostOf(a)).toBe("other");
    });

    it("a new epoch gets a new start from the server", async () => {
      const a = wall("a");
      await a.begin();
      a.setWantHost(true);
      await run(a, 500);
      expect(a.botStartMs()).not.toBeNull();
      await a.command({ op: "clear" });
      expect(a.botStartMs()).toBeNull();
      await run(a, 500);
      expect(a.botStartMs()).not.toBeNull();
    });
  });

  describe("a sound's feed", () => {
    it("takes what is known when attached, then each chunk only when asked", async () => {
      server.pages = [{ events: [ev("a:1", 1)], next: null }];
      await agent.begin();
      await run(agent, 500);
      const feed = new ScoreFeed();
      agent.attachFeed(feed);
      expect(feed.log.size).toBe(1);
      const k = lastClosedChunk(Date.now()) + 1;
      server.chunks.set(k, [ev("b:2", 2)]);
      await run(agent, 6000);
      expect(feed.readTo).toBeGreaterThanOrEqual(k);
      expect(feed.log.size).toBe(1);
      feed.advanceTo(k);
      expect(feed.log.size).toBe(2);
    });

    it("knows a chunk has been read even when it was empty", async () => {
      await agent.begin();
      const feed = new ScoreFeed();
      agent.attachFeed(feed);
      await run(agent, 6000);
      expect(feed.readTo).toBeGreaterThanOrEqual(lastClosedChunk(Date.now()) - 1);
    });

    it("does not grow without end when no sound has started", () => {
      const feed = new ScoreFeed();
      for (let k = 0; k < 500; k++) feed.push(k, [ev(`bot0:${k}`, k)]);
      expect(feed.log.size).toBeGreaterThan(300);
      feed.advanceTo(499);
      expect(feed.log.size).toBe(500);
    });

    it("empties with the world", async () => {
      await agent.begin();
      const feed = new ScoreFeed();
      agent.attachFeed(feed);
      feed.log.add(ev("old:1", 1));
      await agent.command({ op: "clear" });
      expect(feed.log.size).toBe(0);
    });
  });

  describe("without a server", () => {
    it("every hook is empty: storage behaves as before", () => {
      expect(hasWorldMirror()).toBe(false);
      localStorage.setItem(LS_PARLIAMENT_EPOCH_KEY, "1000");
      setKeepFrom(100);
      expect(localStorage.getItem(LS_KEEP_FROM_KEY)).toBe(String(100 - keepWindowSec()));
      clearWorld();
      expect(currentEpochKey()).toBeNull();
      setTimeRate(3);
      expect(timeRate()).toBe(3);
    });

    it("a tab joins only on the shared views, and never with ?sync=0, ?demo=1 or in the lab", () => {
      const at = (pathname: string, search = "") => vi.stubGlobal("window", { location: { pathname, search } });
      vi.stubEnv("NEXT_PUBLIC_WORLD", "rehearsal");
      at("/v2/global/space");
      expect(serverWorldName()).toBe("rehearsal");
      at("/v2/mobile");
      expect(serverWorldName()).toBe("rehearsal");
      at("/v2/global/space", "?world=test-x");
      expect(serverWorldName()).toBe("test-x");
      at("/v2/global/space", "?world=nonsense");
      expect(serverWorldName()).toBe("rehearsal");
      for (const [p, q] of [["/v2/global/space", "?sync=0"], ["/v2/mobile", "?demo=1"], ["/v2/global/lab", ""], ["/global/space", ""], ["/v2/sound", ""]]) {
        at(p, q);
        expect(serverWorldName()).toBeNull();
      }
    });

    it("leaving the shared pages empties every hook, and coming back starts again", async () => {
      vi.stubEnv("NEXT_PUBLIC_WORLD", "rehearsal");
      vi.stubGlobal("window", { location: { pathname: "/v2/global/space", search: "" }, addEventListener: () => {}, removeEventListener: () => {}, alert: () => {} });
      vi.stubGlobal("document", { visibilityState: "visible" });
      vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
      const started = startServerWorld(10);
      await vi.advanceTimersByTimeAsync(20);
      await started;
      expect(hasWorldMirror()).toBe(true);
      stopServerWorld();
      expect(hasWorldMirror()).toBe(false);
      setTimeRate(3);
      expect(timeRate()).toBe(3); // the rate is this browser's own again
      const again = startServerWorld(10);
      await vi.advanceTimersByTimeAsync(20);
      await again;
      expect(hasWorldMirror()).toBe(true);
      stopServerWorld();
    });

    it("no name configured, no shared world", () => {
      vi.stubEnv("NEXT_PUBLIC_WORLD", "");
      vi.stubGlobal("window", { location: { pathname: "/v2/global/space", search: "" } });
      expect(serverWorldName()).toBeNull();
      expect(chunkOf(0)).toBe(0);
    });
  });
});

/**
 * THE BOT SERVER (the artist, 2026-11-17: "봇 자체를 따로 돌려서 늘 어디서 열든 봇은 돌아간 상태여야" — "딜레이 없는 게
 * 제일 중요"). One Durable Object per world steps the herds and villages (apps/web/src/lib/parliament/botWorld.ts)
 * every half second, whether a view is open or not, and sends every view what it writes the moment it writes it.
 * The views only read: the wall, /rehearsal/future, the top view. docs/bot-server.md.
 *
 *   wss://<worker>/<world>          a view: hears the world, sends its knobs (setup), people's samples, a clear
 *   wss://<worker>/<world>?as=visitor  a phone (the personal view): told the world's epoch and clock, sends its
 *                                   visitor's samples — the walls see the visitor and the bots go to them — and hears
 *                                   only what is written near where its visitor last stood (NEAR world units)
 *   https://<worker>/state/<world>  the numbers (bots now, events held, last step), for measuring
 *
 * Kept in the object's storage: the epoch and the clock, the setup, the herds' state, the events in chunks of a few
 * seconds — on waking (a deploy, an eviction) it goes on from there and catches up the seconds it missed.
 */
import { DurableObject } from "cloudflare:workers";
import { BotWorld, DEFAULT_BOT_SETUP, type BotSetup } from "../../../apps/web/src/lib/parliament/botWorld";
import type { PEvent } from "../../../apps/web/src/lib/parliament/types";
import { wrapDist } from "../../../apps/web/src/lib/parliament/world";

const WORLD = /^(redesign|rehearsal|exhibition|(dev|test)-[a-z0-9-]{1,24})$/;
const ALLOWED_ORIGIN = /^https:\/\/anthropocene(-[a-z0-9-]+)?\.vercel\.app$|^https:\/\/homo-inventus(-[a-z0-9-]+)?\.vercel\.app$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MAX_SOCKETS = 64;
const STEP_MS = 500;
const SAVE_MS = 5000;
const MAX_PEOPLE_PER_MSG = 400;
/** Events per message of a joining view's snapshot, and per stored chunk (both well under the limits). */
const SNAPSHOT_PIECE = 3000;
const CHUNK = 800;
/** A phone hears what is written this near its visitor (world units: the view's 24 and the ground read round it). */
const NEAR = 40;
/** What a phone is given of the world round it when its visitor is first seen (the newest-written first). */
const NEAR_FIRST = 4000;

/** World ms = v + (wall ms − r) · rate (worldClock.ts, the same anchor). */
interface Anchor {
  r: number;
  v: number;
  rate: number;
}

interface Meta {
  epochMs: number;
  clock: Anchor;
  setup: BotSetup | null;
}

const worldNow = (a: Anchor, wall = Date.now()) => a.v + (wall - a.r) * a.rate;

export class BotServer extends DurableObject {
  private meta: Meta | null = null;
  private world: BotWorld | null = null;
  private loaded: Promise<void> | null = null;
  /** Events written since the last save (the next chunk). */
  private unsaved: PEvent[] = [];
  private chunkSeq = 0;
  private lastSave = 0;
  private lastStepMs = 0;
  private stepCost = 0;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private load(): Promise<void> {
    if (!this.loaded)
      this.loaded = (async () => {
        const meta = (await this.ctx.storage.get<Meta>("meta")) ?? null;
        const now = Date.now();
        this.meta = meta ?? { epochMs: now, clock: { r: now, v: now, rate: 1 }, setup: null };
        if (!meta) await this.ctx.storage.put("meta", this.meta);
        this.makeWorld();
        const w = this.world!;
        const chunks = await this.ctx.storage.list<PEvent[]>({ prefix: `c:${this.meta.epochMs}:` });
        for (const [key, list] of chunks) {
          this.chunkSeq = Math.max(this.chunkSeq, Number(key.split(":")[2]) + 1);
          for (const e of list) w.add(e);
        }
        const st = await this.ctx.storage.get<{ st: BotWorld["st"]; lastMs: number; rise: ReturnType<BotWorld["riseState"]> }>("st");
        if (st && st.st && st.st.epochMs === this.meta.epochMs) {
          w.st = st.st;
          w.lastMs = st.lastMs;
          w.setRise(st.rise);
        }
        if (this.meta.setup?.on) await this.ctx.storage.setAlarm(Date.now() + STEP_MS);
      })();
    return this.loaded;
  }

  private makeWorld(): void {
    const m = this.meta!;
    this.world = m.setup ? new BotWorld(m.epochMs, m.setup) : null;
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    const url = new URL(request.url);
    if (url.pathname.startsWith("/state/")) {
      const w = this.world;
      return Response.json({
        epochMs: this.meta!.epochMs,
        on: !!this.meta!.setup?.on,
        sockets: this.ctx.getWebSockets().length,
        visitors: this.ctx.getWebSockets("visitor").length,
        events: w?.events.size ?? 0,
        bots: w?.readout() ?? null,
        behindMs: w ? Math.round(worldNow(this.meta!.clock) - w.lastMs) : null,
        lastStepAgoMs: this.lastStepMs ? Date.now() - this.lastStepMs : null,
        stepCostMs: this.stepCost,
        colo: request.cf?.colo ?? null,
      });
    }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response("full", { status: 503 });
    const { 0: client, 1: server } = new WebSocketPair();
    const as = url.searchParams.get("as") === "visitor" ? "visitor" : "view";
    this.ctx.acceptWebSocket(server, [as]);
    this.greet(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** What a view gets on joining (and every view when the world is new): the world, then what it holds in pieces
   *  (a message stays well under the WebSocket limit). */
  private greet(s: WebSocket): void {
    const m = this.meta!, w = this.world;
    // (a phone is told the epoch and the clock only: it does not hold the world)
    const all = w && this.ctx.getTags(s)[0] !== "visitor" ? [...w.events.values()] : [];
    try {
      s.send(JSON.stringify({ t: "hello", epochMs: m.epochMs, clock: m.clock, serverNow: Date.now(), setup: m.setup, held: all.length, rise: w?.riseState() ?? null, kinds: w?.kinds() ?? {}, readout: w?.readout() ?? null }));
      for (let i = 0; i < all.length; i += SNAPSHOT_PIECE) s.send(JSON.stringify({ t: "ev", events: all.slice(i, i + SNAPSHOT_PIECE) }));
    } catch {
      // gone
    }
  }

  private async deleteKeys(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.delete(keys.slice(i, i + 128));
  }

  /** To the phones (or one): the events near where each one's visitor last stood, `max` at most. */
  private sendNear(events: PEvent[], only?: WebSocket, max = Infinity): void {
    for (const s of only ? [only] : this.ctx.getWebSockets("visitor")) {
      const at = s.deserializeAttachment() as { x: number; z: number } | null;
      if (!at) continue;
      const near: PEvent[] = [];
      for (const e of events) {
        if (wrapDist(e.x, e.z, at.x, at.z) <= NEAR) near.push(e);
        if (near.length >= max) break;
      }
      if (!near.length) continue;
      if (only) near.reverse();
      try {
        for (let i = 0; i < near.length; i += SNAPSHOT_PIECE) s.send(JSON.stringify({ t: "ev", events: near.slice(i, i + SNAPSHOT_PIECE) }));
      } catch {
        // gone
      }
    }
  }

  private send(msg: unknown): void {
    const text = JSON.stringify(msg);
    for (const s of this.ctx.getWebSockets("view")) {
      try {
        s.send(text);
      } catch {
        // gone; its close comes on its own
      }
    }
  }

  async webSocketMessage(socket: WebSocket, text: string | ArrayBuffer): Promise<void> {
    await this.load();
    if (typeof text !== "string" || text.length > 2_000_000) return;
    let msg: { t?: string; setup?: BotSetup; events?: PEvent[]; rate?: number };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const m = this.meta!;
    if (msg.t === "setup" && msg.setup && typeof msg.setup === "object") {
      const was = m.setup?.on;
      m.setup = { ...DEFAULT_BOT_SETUP, ...msg.setup } as BotSetup;
      if (this.world) this.world.configure(m.setup);
      else this.makeWorld();
      await this.ctx.storage.put("meta", m);
      this.send({ t: "setup", setup: m.setup });
      if (m.setup.on && !was) await this.ctx.storage.setAlarm(Date.now() + 10);
    } else if (msg.t === "people" && Array.isArray(msg.events) && this.world) {
      const fresh: PEvent[] = [];
      // when they came (the world's seconds): a visitor's own time is the block's, not the clock's (botWorld.add)
      const seen = (worldNow(m.clock, Date.now()) - m.epochMs) / 1000;
      for (const e of msg.events.slice(0, MAX_PEOPLE_PER_MSG)) {
        if (!e || typeof e.id !== "string" || typeof e.o !== "string" || e.o.startsWith("bot") || !Number.isFinite(e.x) || !Number.isFinite(e.z) || !Number.isFinite(e.s)) continue;
        const ev: PEvent = { id: e.id, o: e.o, r: e.r, k: e.k, x: e.x, z: e.z, s: e.s };
        if (this.world.add(ev, seen)) fresh.push(ev);
      }
      // a phone: where its visitor stands now (the first time, the world round them is sent)
      if (this.ctx.getTags(socket)[0] === "visitor") {
        const mine = msg.events.filter((e) => e && typeof e.o === "string" && !e.o.startsWith("bot") && Number.isFinite(e.x) && Number.isFinite(e.z));
        const last = mine[mine.length - 1];
        if (last) {
          const first = !socket.deserializeAttachment();
          socket.serializeAttachment({ x: last.x, z: last.z });
          if (first) this.sendNear([...this.world.events.values()].reverse(), socket, NEAR_FIRST);
        }
      }
      if (fresh.length) {
        this.unsaved.push(...fresh);
        this.send({ t: "ev", events: fresh });
        this.sendNear(fresh);
      }
    } else if (msg.t === "clear") {
      // a new world: the old one's chunks go, the clock keeps its rate
      await this.deleteKeys([...(await this.ctx.storage.list({ prefix: "c:" })).keys()]);
      await this.ctx.storage.delete("st");
      const now = Date.now();
      const v = worldNow(m.clock, now);
      m.epochMs = v;
      m.clock = { r: now, v, rate: m.clock.rate };
      await this.ctx.storage.put("meta", m);
      this.unsaved = [];
      this.chunkSeq = 0;
      this.makeWorld();
      for (const s of this.ctx.getWebSockets()) this.greet(s);
    } else if (msg.t === "rate" && Number.isFinite(msg.rate)) {
      const now = Date.now();
      m.clock = { r: now, v: worldNow(m.clock, now), rate: Math.max(0, Math.min(40, msg.rate!)) };
      await this.ctx.storage.put("meta", m);
      // (the phones too: their samples are on the same clock)
      const text = JSON.stringify({ t: "clock", clock: m.clock, serverNow: now });
      for (const s of this.ctx.getWebSockets()) {
        try {
          s.send(text);
        } catch {
          // gone
        }
      }
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    try {
      socket.close();
    } catch {
      // already closed
    }
  }

  async alarm(): Promise<void> {
    await this.load();
    const m = this.meta!, w = this.world;
    if (!w || !m.setup?.on) return;
    const t0 = Date.now();
    const drops = w.drops;
    const fresh = w.step(worldNow(m.clock, t0));
    this.stepCost = Date.now() - t0;
    this.lastStepMs = t0;
    if (fresh.length || w.drops !== drops) {
      this.unsaved.push(...fresh);
      this.send({ t: "ev", events: fresh, kinds: w.kinds(), readout: w.readout(), rise: w.riseState(), ...(w.drops !== drops ? { keep: m.setup.keep } : {}) });
      this.sendNear(fresh);
    }
    if (t0 - this.lastSave >= SAVE_MS) await this.save();
    // (behind — catching up after a pause: the next slice at once)
    const behind = worldNow(m.clock) - w.lastMs > 2 * w.periodMs;
    await this.ctx.storage.setAlarm(Date.now() + (behind ? 10 : STEP_MS));
  }

  private async save(): Promise<void> {
    const m = this.meta!, w = this.world!;
    this.lastSave = Date.now();
    for (let i = 0; i < this.unsaved.length; i += CHUNK) await this.ctx.storage.put(`c:${m.epochMs}:${this.chunkSeq++}`, this.unsaved.slice(i, i + CHUNK));
    this.unsaved = [];
    // the chunks hold what the block still remembers: the oldest go once they are past it
    const keys = [...(await this.ctx.storage.list<PEvent[]>({ prefix: `c:${m.epochMs}:` })).entries()];
    let held = keys.reduce((n, [, list]) => n + list.length, 0);
    const old: string[] = [];
    for (const [key, list] of keys) {
      if (held - list.length < w.events.size) break;
      held -= list.length;
      old.push(key);
    }
    if (old.length) await this.deleteKeys(old);
    await this.ctx.storage.put("st", { st: w.st, lastMs: w.lastMs, rise: w.riseState() });
  }
}

export default {
  async fetch(request: Request, env: { WORLDS: DurableObjectNamespace }): Promise<Response> {
    const url = new URL(request.url);
    const name = url.pathname.replace(/^\/(state\/)?/, "");
    if (!WORLD.test(name)) return new Response("no such world", { status: 404 });
    const isState = url.pathname.startsWith("/state/");
    if (!isState) {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 426 });
      const origin = request.headers.get("Origin") ?? "";
      if (!ALLOWED_ORIGIN.test(origin)) return new Response("origin", { status: 403 });
    }
    // (placed in Asia on its first request, and never moved: Durable Objects stay where they began)
    const stub = env.WORLDS.get(env.WORLDS.idFromName(name), { locationHint: "apac" });
    return stub.fetch(request);
  },
};

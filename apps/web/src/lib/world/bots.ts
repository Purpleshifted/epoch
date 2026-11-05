/**
 * THE WORLD WITH NO WALL OPEN (the artist, 2026-11-05: it must always run; docs/shared-world-plan.md "벽 없이 도는 세계").
 * A wall holding the lease emits the bots as ever (useGlobalBots.ts), and then nothing here runs. With no wall, whoever
 * looks at the world asks for its state (every tab does, every 10 s), and that request brings the bots up to now: from
 * where they were last written, or as far back as the history window remembers. Their places are a function of the world
 * clock (bots.ts), so nothing has to run while nobody looks, and nobody can tell the difference: what lies further back is
 * forgotten anyway. The database sleeps meanwhile.
 *
 * The events are the same as a wall's, named by the same grid (`bot3:<world ms>`), so an overlap with a wall counts once.
 * Off: WORLD_SERVER_BOTS=0.
 */
import { botActor, botPlan, type Flock } from "@/lib/parliament/bots";
import { sessionSeconds } from "@/lib/parliament/clock";
import { steerBot } from "@/lib/parliament/flow";
import { FoldState } from "@/lib/parliament/foldState";
import { SEAL_H } from "@/lib/parliament/natureHistory";
import { SESSION_ROLES } from "@/lib/parliament/session";
import { DEFAULT_FOLD, type FoldConfig, type PEvent, type RoleId } from "@/lib/parliament/types";
import { WALL_FLOW_GROUP, WALL_FOLD_GROUP, followWallRule } from "@/lib/parliament/wallRule";
import { PRESET_KEY_PREFIX, readPresets } from "@/lib/presets/db";
import { botStart, claimBots, insertBatch, readWindow } from "./db";
import { cleanEvent, joinEventTexts, keepFromAt, lastClosedChunk, pageWindow, worldMsAt, type WorldState } from "./protocol";

/** Where the wall keeps its knobs (levaSave.ts: page path + group). */
const WALL_PAGE = "/v2/global/space";
const BOT_GROUP = "봇 (글로벌에서 돌리기)";
/** useGlobalBots.ts: how often a wall looks at the ground the bots walk on, and how late someone may join its fold. */
const GROUND_EVERY_MS = 5000;
const BOT_FOLD_OPTS = { lateMarginSec: 35 };
/** Written ahead of the clock, so a visitor reads bots who are here now and not some seconds ago. */
const AHEAD_MS = 12_000;
/** A shorter stretch than this is not worth a write: it waits for the next look. */
const MIN_STEP_MS = 4000;
/** One row per this much of the world: a chunk's rows are read together and a function's answer is limited to 4.5 MB. */
const ROW_MS = 60_000;
/** The most that is written at once. A window raised for baking still fits one read (about 2.5 MB at 17 bots). */
const MAX_BACK_MS = 25 * 60_000;
const RULE_FOR_MS = 60_000;
const DROP_EVERY_MS = 60_000;

export interface BotRule {
  count: number;
  role: RoleId | "mixed";
  flock: Flock;
  fold: FoldConfig;
}

type Saved = (group: string) => Record<string, unknown> | null;
const num = (v: unknown, or: number) => (typeof v === "number" && Number.isFinite(v) ? v : or);

/** The wall's saved knobs (with useGlobalBots.ts's defaults). null: its bots are off, so there are none here either. */
export function botRuleOf(saved: Saved): BotRule | null {
  const b = saved(BOT_GROUP);
  if (b?.botOn !== true) return null;
  return {
    count: num(b.botCount, 12),
    role: typeof b.botRole === "string" ? (b.botRole as RoleId | "mixed") : "worker",
    flock: { groups: num(b.botGroups, 4), spread: num(b.botSpread, 14), timeSpread: num(b.botTimeSpread, 60), stayMin: num(b.botStayMin, 0), overlapSec: num(b.botOverlapSec, 60), character: num(b.botCharacter, 0) },
    fold: followWallRule(DEFAULT_FOLD, saved(WALL_FOLD_GROUP), saved(WALL_FLOW_GROUP)),
  };
}

/** The bots' walk from one moment on: what the resident branch of useGlobalBots.ts does, without a page. */
export class BotRun {
  readonly fold: FoldState;
  private ground: { at: number; level: Map<string, number>; built: Set<string> } | null = null;
  private readonly routes = new Map<string, number[]>();

  constructor(
    readonly rule: BotRule,
    readonly epochMs: number,
    readonly startMs: number,
  ) {
    this.fold = new FoldState(rule.fold, BOT_FOLD_OPTS);
  }

  get periodMs(): number {
    return Math.max(50, this.rule.fold.sampleSec * 1000);
  }

  private lookAtGround(w: number): void {
    const flow = this.rule.fold.flow;
    if (!flow?.enabled || (this.ground && w - this.ground.at < GROUND_EVERY_MS)) return;
    const tSess = sessionSeconds(w, this.epochMs, 0);
    const snap = this.fold.snapshot(tSess, undefined, { tail: false });
    const settledTo = Math.min(tSess, this.fold.stats.frontier);
    const level = new Map<string, number>();
    for (const pc of snap.paths) level.set(pc.key, -flow.unit * Math.log(1 - Math.min(0.999, pc.p)));
    const built = new Set<string>();
    for (const sl of snap.slabs) if (sl.h >= SEAL_H && settledTo - sl.lastS <= this.rule.fold.emptyGapSec) built.add(sl.key);
    this.ground = { at: w, level, built };
    if (this.routes.size > Math.max(8, this.rule.count * 4)) this.routes.clear();
  }

  /** Every bot's samples on the grid in (fromMs, toMs], each added to this run's ground as it goes. */
  between(fromMs: number, toMs: number): PEvent[] {
    const { count, role, flock, fold } = this.rule;
    const flow = fold.flow?.enabled ? fold.flow : null;
    const period = this.periodMs;
    const out: PEvent[] = [];
    for (let w = (Math.floor(fromMs / period) + 1) * period; w <= toMs; w += period) {
      this.lookAtGround(w);
      const g = this.ground;
      for (let i = 0; i < count; i++) {
        const a = botActor(i, role === "mixed" ? SESSION_ROLES[i % SESSION_ROLES.length] : role, w, this.startMs, this.epochMs, 0, flock);
        let { x, z } = a;
        if (flow && g) [x, z] = steerBot(a.o, botPlan(i, w, this.startMs, this.epochMs, 0, flock), { level: (k) => g.level.get(k) ?? 0, built: (k) => g.built.has(k) }, flow, this.routes);
        const e = cleanEvent({ id: `${a.o}:${w}`, o: a.o, r: a.r, k: "p", x, z, s: a.s });
        if (!e) continue;
        this.fold.add(e);
        out.push(e);
      }
    }
    return out;
  }
}

/** The stretch to write: never before the world's memory or a wall's last moment, never more than one read can hold. */
export function stretchFrom(toMs: number, lastWrittenMs: number | null, keepFromMs: number, wallLastMs: number | null): number {
  return Math.max(lastWrittenMs ?? -Infinity, keepFromMs, wallLastMs ?? -Infinity, toMs - MAX_BACK_MS);
}

/** Whether this state calls for bots from here: no wall holds them. */
export function wantsServerBots(state: WorldState, nowMs: number): boolean {
  return process.env.WORLD_SERVER_BOTS !== "0" && !(state.host && state.host.untilMs > nowMs);
}

let savedRule: { at: number; text: string; rule: BotRule | null } | null = null;

async function wallBotRule(nowMs: number): Promise<{ text: string; rule: BotRule | null }> {
  if (savedRule && nowMs - savedRule.at < RULE_FOR_MS) return savedRule;
  const rows = (await readPresets(WALL_PAGE)) ?? [];
  const byKey = new Map(rows.map((r) => [r.key, r.json]));
  const saved: Saved = (group) => byKey.get(`${PRESET_KEY_PREFIX}${WALL_PAGE}:${group}`) ?? null;
  const text = JSON.stringify([saved(BOT_GROUP), saved(WALL_FOLD_GROUP), saved(WALL_FLOW_GROUP)]);
  savedRule = { at: nowMs, text, rule: botRuleOf(saved) };
  return savedRule;
}

/** A run kept between looks while this function's instance lives: otherwise the ground is folded again from the window. */
interface Kept {
  run: BotRun;
  rule: string;
  /** Where the bots of this run have got to. */
  toMs: number;
  /** The next chunk to read of what others wrote. */
  cursor: number;
  droppedAt: number;
}
const kept = new Map<string, Kept>();
const busy = new Set<string>();

async function readOthers(world: string, k: Kept, keepFromS: number): Promise<void> {
  for (;;) {
    const r = await readWindow(world, k.run.epochMs, keepFromS, k.cursor);
    if (!r) return;
    const { texts, next } = pageWindow(r.rows);
    if (texts.length) k.run.fold.addMany(JSON.parse(joinEventTexts(texts)) as PEvent[]);
    if (next === null) {
      k.cursor = lastClosedChunk(r.nowMs) + 1;
      return;
    }
    k.cursor = next;
  }
}

/** Brings the bots up to now. Fails quietly into the log: the next look goes on from where the last one wrote. */
export async function advanceBots(world: string, state: WorldState, nowMs: number): Promise<void> {
  if (busy.has(world)) return;
  busy.add(world);
  try {
    const { text, rule } = await wallBotRule(nowMs);
    if (!rule) return;
    const period = Math.max(50, rule.fold.sampleSec * 1000);
    const nowWorld = worldMsAt(state.anchor, nowMs);
    const toMs = Math.floor((nowWorld + AHEAD_MS) / period) * period;
    const claim = await claimBots(world, toMs, MIN_STEP_MS);
    if (!claim) return;
    const keepFromS = keepFromAt(state, nowMs);
    const keepFromMs = Math.max(state.epochMs, state.epochMs + keepFromS * 1000);
    const wallLastMs = claim.hostUntilMs === null ? null : worldMsAt(state.anchor, claim.hostUntilMs) - 10_000;
    const fromMs = Math.floor(stretchFrom(toMs, claim.lastMs, keepFromMs, wallLastMs) / period) * period;
    const startMs = state.botStartMs ?? (await botStart(world, nowMs));
    if (startMs === null) return;
    let k = kept.get(world);
    if (!k || k.rule !== text || k.run.epochMs !== state.epochMs || k.run.startMs !== startMs || k.toMs !== fromMs) {
      k = { run: new BotRun(rule, state.epochMs, startMs), rule: text, toMs: fromMs, cursor: 0, droppedAt: nowMs };
      kept.set(world, k);
    }
    await readOthers(world, k, keepFromS);
    if (nowMs - k.droppedAt > DROP_EVERY_MS) {
      k.droppedAt = nowMs;
      k.run.fold.dropBefore(keepFromS);
    }
    const events = k.run.between(fromMs, toMs);
    k.toMs = toMs;
    // a row for each stretch of the world, in order
    const rowEvery = Math.max(1, Math.floor((ROW_MS / period) * rule.count));
    for (let i = 0; i < events.length; i += rowEvery) await insertBatch(world, state.epochMs, events.slice(i, i + rowEvery));
  } catch (e) {
    kept.delete(world);
    console.error("[world bots]", e);
  } finally {
    busy.delete(world);
  }
}

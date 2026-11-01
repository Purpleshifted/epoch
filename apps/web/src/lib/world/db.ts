/**
 * THE SHARED WORLD'S TABLES (docs/shared-world-plan.md §3), in the same Neon database as the presets (lib/presets/db.ts).
 * `world_state`: one row per world — epoch, world clock, history window, bot host. `world_batches`: one row per POST,
 * the events as they came, under the chunk their arrival falls in (lib/world/protocol.ts). Chunks are stamped by the
 * database's clock and closed by it; the world clock and the lease run on the function's clock, which /api/now hands out.
 * Nothing here runs unless NEXT_PUBLIC_WORLD is set: the routes answer 404 before they get this far, so the tables
 * do not appear in a database whose deployment has the shared world switched off.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { PEvent } from "@/lib/parliament/types";
import { CHUNK_MS, CLOSE_GRACE_MS, DEFAULT_KEEP_WINDOW_SEC, HOST_LEASE_MS, WINDOW_PAGE_ROWS, type WindowRow, type WorldState } from "./protocol";

type Sql = NeonQueryFunction<false, false>;

let ready: Promise<Sql> | null = null;

/** The query function, the tables created on first use (per function instance). null = no database configured. */
function db(): Promise<Sql> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!ready) {
    const sql: Sql = neon(url);
    ready = (async () => {
      // one round trip on an ordinary cold start: the tables are made only when they are missing
      const [row] = (await sql`SELECT to_regclass('world_batches') AS t`) as { t: string | null }[];
      if (!row.t) {
        await sql`CREATE TABLE IF NOT EXISTS world_state (
          world text PRIMARY KEY,
          epoch_ms bigint NOT NULL,
          anchor_r bigint NOT NULL,
          anchor_v double precision NOT NULL,
          rate double precision NOT NULL DEFAULT 1,
          keep_window_sec integer NOT NULL,
          bot_start_ms bigint,
          host_id text,
          host_until bigint,
          updated_at timestamptz NOT NULL DEFAULT now()
        )`;
        await sql`CREATE TABLE IF NOT EXISTS world_batches (
          world text NOT NULL,
          epoch_ms bigint NOT NULL,
          chunk bigint NOT NULL,
          seq bigserial NOT NULL,
          n integer NOT NULL,
          max_s double precision NOT NULL,
          events text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (world, epoch_ms, chunk, seq)
        )`;
        await sql`CREATE INDEX IF NOT EXISTS world_batches_created ON world_batches (created_at)`;
      }
      return sql;
    })();
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

export function hasWorldDb(): boolean {
  return !!process.env.DATABASE_URL;
}

interface StateRow {
  world: string;
  epoch_ms: string | number;
  anchor_r: string | number;
  anchor_v: string | number;
  rate: string | number;
  keep_window_sec: string | number;
  bot_start_ms: string | number | null;
  host_id: string | null;
  host_until: string | number | null;
}

function toState(r: StateRow): WorldState {
  return {
    world: r.world,
    epochMs: Number(r.epoch_ms),
    anchor: { r: Number(r.anchor_r), v: Number(r.anchor_v), rate: Number(r.rate) },
    keepWindowSec: Number(r.keep_window_sec),
    botStartMs: r.bot_start_ms === null ? null : Number(r.bot_start_ms),
    host: r.host_id !== null && r.host_until !== null ? { id: r.host_id, untilMs: Number(r.host_until) } : null,
  };
}

/** The world's state; a world asked for the first time is born here, at this moment, at real speed. */
export async function readState(world: string, nowMs: number): Promise<WorldState | null> {
  const conn = db();
  if (!conn) return null;
  const sql = await conn;
  const rows = (await sql`WITH ins AS (
      INSERT INTO world_state (world, epoch_ms, anchor_r, anchor_v, keep_window_sec)
      VALUES (${world}, ${nowMs}, ${nowMs}, ${nowMs}, ${DEFAULT_KEEP_WINDOW_SEC})
      ON CONFLICT (world) DO NOTHING RETURNING *
    )
    SELECT * FROM ins UNION ALL SELECT * FROM world_state WHERE world = ${world} LIMIT 1`) as StateRow[];
  return rows[0] ? toState(rows[0]) : null;
}

/** One POST's events under the chunk of this moment. null = `epochMs` is not the world's epoch (it has been cleared). */
export async function insertBatch(world: string, epochMs: number, events: readonly PEvent[]): Promise<{ chunk: number } | null> {
  const conn = db();
  if (!conn) return null;
  const sql = await conn;
  let maxS = -Infinity;
  for (const e of events) if (e.s > maxS) maxS = e.s;
  const rows = (await sql`INSERT INTO world_batches (world, epoch_ms, chunk, n, max_s, events)
    SELECT s.world, s.epoch_ms, floor(extract(epoch FROM clock_timestamp()) * 1000 / ${CHUNK_MS}::numeric)::bigint, ${events.length}::int, ${maxS}::double precision, ${JSON.stringify(events)}::text
    FROM world_state s WHERE s.world = ${world} AND s.epoch_ms = ${epochMs}
    RETURNING chunk`) as { chunk: string | number }[];
  return rows[0] ? { chunk: Number(rows[0].chunk) } : null;
}

/** The stored rows of chunks from … to, in order, and the database's time (which decides what is closed). */
export async function readChunks(world: string, epochMs: number, from: number, to: number): Promise<{ nowMs: number; texts: string[] } | null> {
  const conn = db();
  if (!conn) return null;
  const sql = await conn;
  const rows = (await sql`WITH t AS (SELECT extract(epoch FROM clock_timestamp()) * 1000 AS now_ms)
    SELECT t.now_ms, b.events FROM t LEFT JOIN world_batches b
      ON b.world = ${world} AND b.epoch_ms = ${epochMs} AND b.chunk BETWEEN ${from} AND ${to}
    ORDER BY b.chunk, b.seq`) as { now_ms: string | number; events: string | null }[];
  return { nowMs: Number(rows[0].now_ms), texts: rows.flatMap((r) => (r.events === null ? [] : [r.events])) };
}

/** A page of what the history window holds (closed chunks only), from chunk `cursor` on, and the database's time. */
export async function readWindow(world: string, epochMs: number, keepFromS: number, cursor: number): Promise<{ nowMs: number; rows: WindowRow[] } | null> {
  const conn = db();
  if (!conn) return null;
  const sql = await conn;
  const rows = (await sql`WITH t AS (SELECT extract(epoch FROM clock_timestamp()) * 1000 AS now_ms)
    SELECT t.now_ms, b.chunk, b.events FROM t LEFT JOIN LATERAL (
      SELECT chunk, seq, events FROM world_batches
      WHERE world = ${world} AND epoch_ms = ${epochMs} AND chunk >= ${cursor} AND max_s >= ${keepFromS}
        AND (chunk + 1) * ${CHUNK_MS}::numeric + ${CLOSE_GRACE_MS}::numeric <= t.now_ms
      ORDER BY chunk, seq LIMIT ${WINDOW_PAGE_ROWS}
    ) b ON true
    ORDER BY b.chunk, b.seq`) as { now_ms: string | number; chunk: string | number | null; events: string | null }[];
  return {
    nowMs: Number(rows[0].now_ms),
    rows: rows.flatMap((r) => (r.events === null ? [] : [{ chunk: Number(r.chunk), events: r.events }])),
  };
}

/** A new epoch at the present of the world clock; the old epoch's events go. The clock itself runs on. */
export async function clearWorld(world: string, nowMs: number): Promise<WorldState | null> {
  const conn = db();
  if (!conn) return null;
  const sql = await conn;
  const rows = (await sql`UPDATE world_state SET
      epoch_ms = floor(anchor_v + (${nowMs}::bigint - anchor_r) * rate)::bigint,
      bot_start_ms = NULL,
      updated_at = now()
    WHERE world = ${world} RETURNING *`) as StateRow[];
  if (!rows[0]) return null;
  await sql`DELETE FROM world_batches WHERE world = ${world} AND epoch_ms <> ${rows[0].epoch_ms}`;
  return toState(rows[0]);
}

/** A new rate from the current world time on: world time never jumps. */
export async function setRate(world: string, nowMs: number, rate: number): Promise<WorldState | null> {
  const conn = db();
  if (!conn) return null;
  const sql = await conn;
  const rows = (await sql`UPDATE world_state SET
      anchor_v = anchor_v + (${nowMs}::bigint - anchor_r) * rate,
      anchor_r = ${nowMs},
      rate = ${rate}::double precision,
      updated_at = now()
    WHERE world = ${world} RETURNING *`) as StateRow[];
  return rows[0] ? toState(rows[0]) : null;
}

export async function setKeepWindow(world: string, sec: number): Promise<WorldState | null> {
  const conn = db();
  if (!conn) return null;
  const sql = await conn;
  const rows = (await sql`UPDATE world_state SET keep_window_sec = ${sec}, updated_at = now() WHERE world = ${world} RETURNING *`) as StateRow[];
  return rows[0] ? toState(rows[0]) : null;
}

/**
 * Takes or renews the bot host's lease for `id`: when it is already theirs, when nobody holds it, when it has run out,
 * or by force. The bots' start is set the first time and kept. Returns the state whether or not the lease was got.
 */
export async function takeHost(world: string, id: string, nowMs: number, force = false): Promise<WorldState | null> {
  const conn = db();
  if (!conn) return null;
  const sql = await conn;
  const rows = (await sql`UPDATE world_state SET
      host_id = ${id},
      host_until = ${nowMs + HOST_LEASE_MS},
      bot_start_ms = COALESCE(bot_start_ms, floor(anchor_v + (${nowMs}::bigint - anchor_r) * rate)::bigint)
    WHERE world = ${world} AND (host_id = ${id} OR host_id IS NULL OR host_until < ${nowMs} OR ${force}::boolean)
    RETURNING *`) as StateRow[];
  return rows[0] ? toState(rows[0]) : readState(world, nowMs);
}

/** A host leaving on purpose: the next wall need not wait for the lease to run out. */
export async function releaseHost(world: string, id: string): Promise<void> {
  const conn = db();
  if (!conn) return;
  const sql = await conn;
  await sql`UPDATE world_state SET host_id = NULL, host_until = NULL WHERE world = ${world} AND host_id = ${id}`;
}

/** Forgets rows older than `hours` (the history window is far shorter; this bounds the table). */
export async function deleteOldBatches(hours: number): Promise<void> {
  const conn = db();
  if (!conn) return;
  const sql = await conn;
  await sql`DELETE FROM world_batches WHERE created_at < now() - make_interval(hours => ${hours}::int)`;
}

/**
 * THE EXHIBITION'S RECORD, kept to be read afterwards (the artist, 2026-11-10). The world forgets: `world_batches` goes
 * after a day and with every clearing, and a session's beginning and end never reach the server at all. Two tables of
 * their own, in the same database, that nothing else reads and nothing deletes:
 *   analytics_events    what visitors did, copied after the world has stored it (never the bots)
 *   analytics_sessions  one row for each session, from the first gesture on (lib/parliament/sessionLog.ts)
 * Anonymous ids and actions only: no address, no User-Agent, no location.
 *
 * The world comes first. Everything here is separate from the world's own queries, runs after the answer has gone and
 * may fail unnoticed; and the copying stops before it could fill the database the world writes to. Off: WORLD_ANALYTICS=0.
 * Read out with tools/analytics/export.mjs, not through an API.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { PEvent } from "@/lib/parliament/types";

type Sql = NeonQueryFunction<false, false>;

export const SESSION_PHASES = ["notice", "consent", "headset", "name", "live", "ended"] as const;
export type LoggedPhase = (typeof SESSION_PHASES)[number];

export interface SessionLine {
  /** New for every session; what ties the lines of one session together. */
  id: string;
  world: string;
  /** useLifeSession's sessionNo: how many visitors this page has had. */
  no: number;
  /** The visitor in analytics_events, once known. */
  o: string | null;
  /** The furthest the session has got. */
  phase: LoggedPhase;
  device: "phone" | "desktop";
  lang: "ko" | "en";
  /** Opened at the visitors' address (?ui=0), not on the rehearsal page. */
  page: boolean;
  /** The length this life was given, and how much of it was lived (s). */
  lifeSec: number;
  livedSec: number;
  /** Times the visitor tried to stop living, the one that worked included. */
  attempts: number;
  /** "left": the page went away during the life. */
  endedBy: "lifespan" | "self" | "left" | null;
}

export const MAX_LINE_BYTES = 1024;
/** Above this the events are no longer copied (sessions still are): the world's own writes need the room. */
const MAX_DB_BYTES = Number(process.env.WORLD_ANALYTICS_MAX_MB || 350) * 1024 * 1024;
const LOOK_AT_SIZE_MS = 60_000;

const SESSION_ID = /^[a-z0-9]{8,24}$/;
const VISITOR = /^v_[a-z0-9]{1,12}$/;

const inRange = (v: unknown, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
const tenth = (v: number) => Math.round(v * 10) / 10;

/** One line as stored, or null when it is not one. */
export function cleanSessionLine(raw: unknown): SessionLine | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  if (typeof l.id !== "string" || !SESSION_ID.test(l.id) || typeof l.world !== "string") return null;
  if (l.o !== null && (typeof l.o !== "string" || !VISITOR.test(l.o))) return null;
  if (!(SESSION_PHASES as readonly unknown[]).includes(l.phase)) return null;
  if ((l.device !== "phone" && l.device !== "desktop") || (l.lang !== "ko" && l.lang !== "en") || typeof l.page !== "boolean") return null;
  if (l.endedBy !== null && l.endedBy !== "lifespan" && l.endedBy !== "self" && l.endedBy !== "left") return null;
  if (!Number.isSafeInteger(l.no) || !inRange(l.no, 1e6) || !Number.isSafeInteger(l.attempts) || !inRange(l.attempts, 1e4)) return null;
  if (!inRange(l.lifeSec, 86400) || !inRange(l.livedSec, 86400)) return null;
  return { id: l.id, world: l.world, no: l.no, o: l.o as string | null, phase: l.phase as LoggedPhase, device: l.device, lang: l.lang, page: l.page, lifeSec: tenth(l.lifeSec), livedSec: tenth(l.livedSec), attempts: l.attempts, endedBy: l.endedBy };
}

/** Visitors are named by RoleField; everyone else (the bots, on a wall or on the server) is not recorded. */
export function isVisitorEvent(e: PEvent): boolean {
  return VISITOR.test(e.o);
}

export function analyticsOn(): boolean {
  return !!process.env.DATABASE_URL && process.env.WORLD_ANALYTICS !== "0";
}

let ready: Promise<Sql> | null = null;

/** The query function, the tables made the first time. Apart from the world's own (db.ts): this failing touches nothing there. */
function db(): Promise<Sql> | null {
  if (!analyticsOn()) return null;
  if (!ready) {
    const sql: Sql = neon(process.env.DATABASE_URL as string);
    ready = (async () => {
      // no index on the events: they are only appended, and read through once
      await sql`CREATE TABLE IF NOT EXISTS analytics_events (
        seq bigserial NOT NULL,
        world text NOT NULL,
        epoch_ms bigint NOT NULL,
        o text NOT NULL,
        r text NOT NULL,
        k text NOT NULL,
        x real NOT NULL,
        z real NOT NULL,
        s double precision NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS analytics_sessions (
        session_id text PRIMARY KEY,
        world text NOT NULL,
        session_no integer NOT NULL,
        o text,
        phase text NOT NULL,
        device text NOT NULL,
        lang text NOT NULL,
        exhibition_page boolean NOT NULL,
        life_sec real NOT NULL DEFAULT 0,
        lived_sec real NOT NULL DEFAULT 0,
        stop_attempts integer NOT NULL DEFAULT 0,
        ended_by text,
        opened_at timestamptz NOT NULL DEFAULT now(),
        live_at timestamptz,
        ended_at timestamptz
      )`;
      return sql;
    })();
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

let roomUntil = 0;
let full = false;

/** Looked at once a minute per instance. */
async function dbIsFull(sql: Sql): Promise<boolean> {
  const now = Date.now();
  if (now < roomUntil) return full;
  roomUntil = now + LOOK_AT_SIZE_MS;
  const [row] = (await sql`SELECT pg_database_size(current_database()) AS bytes`) as { bytes: string | number }[];
  full = Number(row.bytes) >= MAX_DB_BYTES;
  return full;
}

/** Called after the world has stored `events`. */
export async function copyVisitorEvents(world: string, epochMs: number, events: readonly PEvent[]): Promise<void> {
  const visitors = events.filter(isVisitorEvent);
  if (!visitors.length) return;
  const conn = db();
  if (!conn) return;
  const sql = await conn;
  if (await dbIsFull(sql)) return;
  await sql`INSERT INTO analytics_events (world, epoch_ms, o, r, k, x, z, s)
    SELECT ${world}, ${epochMs}::bigint, u.o, u.r, u.k, u.x, u.z, u.s
    FROM unnest(${visitors.map((e) => e.o)}::text[], ${visitors.map((e) => e.r)}::text[], ${visitors.map((e) => e.k)}::text[],
                ${visitors.map((e) => e.x)}::real[], ${visitors.map((e) => e.z)}::real[], ${visitors.map((e) => e.s)}::double precision[])
      AS u(o, r, k, x, z, s)`;
}

/** A session's row: made by its first line, brought up to date by the others, in whatever order they arrive. */
export async function writeSession(l: SessionLine): Promise<boolean> {
  const conn = db();
  if (!conn) return false;
  const sql = await conn;
  const order = [...SESSION_PHASES];
  await sql`INSERT INTO analytics_sessions AS t
      (session_id, world, session_no, o, phase, device, lang, exhibition_page, life_sec, lived_sec, stop_attempts, ended_by, live_at, ended_at)
    VALUES (${l.id}, ${l.world}, ${l.no}, ${l.o}, ${l.phase}, ${l.device}, ${l.lang}, ${l.page}, ${l.lifeSec}, ${l.livedSec}, ${l.attempts}, ${l.endedBy},
      CASE WHEN ${l.phase}::text = 'live' THEN now() END,
      CASE WHEN ${l.endedBy}::text IS NOT NULL THEN now() END)
    ON CONFLICT (session_id) DO UPDATE SET
      o = COALESCE(EXCLUDED.o, t.o),
      phase = CASE WHEN array_position(${order}::text[], EXCLUDED.phase) >= array_position(${order}::text[], t.phase) THEN EXCLUDED.phase ELSE t.phase END,
      life_sec = GREATEST(t.life_sec, EXCLUDED.life_sec),
      lived_sec = GREATEST(t.lived_sec, EXCLUDED.lived_sec),
      stop_attempts = GREATEST(t.stop_attempts, EXCLUDED.stop_attempts),
      ended_by = COALESCE(EXCLUDED.ended_by, t.ended_by),
      live_at = COALESCE(t.live_at, EXCLUDED.live_at),
      ended_at = COALESCE(EXCLUDED.ended_at, t.ended_at)`;
  return true;
}

/** Whether the record is being kept, and how much of it there is: numbers only. */
export async function analyticsStatus(): Promise<{ sessions: number; events: number; dbMb: number; full: boolean } | null> {
  const conn = db();
  if (!conn) return null;
  const sql = await conn;
  const [row] = (await sql`SELECT (SELECT count(*) FROM analytics_sessions) AS sessions,
      (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM analytics_events_seq_seq) AS events,
      pg_database_size(current_database()) AS bytes`) as { sessions: string | number; events: string | number; bytes: string | number }[];
  const bytes = Number(row.bytes);
  return { sessions: Number(row.sessions), events: Number(row.events), dbMb: Math.round(bytes / (1024 * 1024)), full: bytes >= MAX_DB_BYTES };
}

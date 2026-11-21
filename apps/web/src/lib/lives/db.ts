/**
 * THE LIVES TABLE (the artist, 2026-11-21): a life is kept only when the visitor posts its card (게시하기) or prints it
 * (출력하기 — printing posts too); a life neither posted nor printed is thrown away. One row per posted life: the card's
 * values as the end screen had them (lib/parliament/plate.ts PlateInput — the record's sentences and the worldline's
 * trail and cells), how it was set (face, paper, orientation), how it left (post / print), where, and the recording's
 * URL when there is one (the life-recording session's upload). Neon Postgres like the presets (lib/presets/db.ts):
 * DATABASE_URL; none = nothing is kept and the API says so.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

export type LifeVia = "post" | "print";

export interface LifeRow {
  id: string;
  card: Record<string, unknown>;
  look: Record<string, unknown>;
  via: LifeVia;
  venue: string | null;
  recordingUrl: string | null;
  postedAt: number;
}

let ready: Promise<Sql> | null = null;

function db(): Promise<Sql> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!ready) {
    const sql: Sql = neon(url);
    ready = sql`CREATE TABLE IF NOT EXISTS lives (id text PRIMARY KEY, card jsonb NOT NULL, look jsonb NOT NULL, via text NOT NULL, venue text, recording_url text, posted_at timestamptz NOT NULL DEFAULT now())`.then(() => sql);
  }
  return ready;
}

export function hasLivesDb(): boolean {
  return !!process.env.DATABASE_URL;
}

/** Keep a life (posting the same life again — printed after posting, say — updates it and keeps the first time). */
export async function writeLife(row: Omit<LifeRow, "postedAt">): Promise<LifeRow | null> {
  const conn = db();
  if (!conn) return null;
  const sql = await conn;
  const rows = (await sql`INSERT INTO lives (id, card, look, via, venue, recording_url) VALUES (${row.id}, ${JSON.stringify(row.card)}::jsonb, ${JSON.stringify(row.look)}::jsonb, ${row.via}, ${row.venue}, ${row.recordingUrl})
    ON CONFLICT (id) DO UPDATE SET card = EXCLUDED.card, look = EXCLUDED.look, via = CASE WHEN lives.via = 'print' THEN 'print' ELSE EXCLUDED.via END, recording_url = COALESCE(EXCLUDED.recording_url, lives.recording_url)
    RETURNING id, via, venue, recording_url, posted_at`) as { id: string; via: LifeVia; venue: string | null; recording_url: string | null; posted_at: string | Date }[];
  const r = rows[0];
  return { ...row, via: r.via, recordingUrl: r.recording_url, postedAt: new Date(r.posted_at).getTime() };
}

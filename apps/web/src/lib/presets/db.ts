/**
 * THE PRESETS TABLE (the artist, 2026-10-30: "save in Leva should send the value to the DB, and the exhibition
 * should use the latest save"). One row per Leva group, keyed exactly like localStorage —
 * `parliament.leva:<page path>:<group>` — so the same key names move between the browser, the bundled preset
 * (src/presets/exhibition.json) and the server. Neon Postgres through Vercel's Marketplace store: the connection
 * string is DATABASE_URL (Preview and Production environments; a dev worktree pulls it with
 * `vercel env pull apps/web/.env.local --environment=preview`). No DATABASE_URL = no server presets, nothing breaks.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

export interface PresetRow {
  key: string;
  json: Record<string, unknown>;
  /** ms since the epoch */
  updatedAt: number;
}

export const PRESET_KEY_PREFIX = "parliament.leva:";

let ready: Promise<Sql> | null = null;

/** The query function, the table created on first use (per function instance). null = no database configured. */
function db(): Promise<Sql> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!ready) {
    const sql: Sql = neon(url);
    ready = sql`CREATE TABLE IF NOT EXISTS presets (key text PRIMARY KEY, json jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`.then(() => sql);
  }
  return ready;
}

export function hasPresetsDb(): boolean {
  return !!process.env.DATABASE_URL;
}

/** Every group saved for one page (its path), newest state. */
export async function readPresets(page: string): Promise<PresetRow[] | null> {
  const conn = db();
  if (!conn) return null;
  const sql = await conn;
  const rows = (await sql`SELECT key, json, updated_at FROM presets WHERE key LIKE ${`${PRESET_KEY_PREFIX}${page}:%`}`) as { key: string; json: Record<string, unknown>; updated_at: string | Date }[];
  return rows.map((r) => ({ key: r.key, json: r.json, updatedAt: new Date(r.updated_at).getTime() }));
}

/** One group's values, replacing what the server had under that key. */
export async function writePreset(key: string, json: Record<string, unknown>): Promise<PresetRow | null> {
  const conn = db();
  if (!conn) return null;
  const sql = await conn;
  const rows = (await sql`INSERT INTO presets (key, json, updated_at) VALUES (${key}, ${JSON.stringify(json)}::jsonb, now()) ON CONFLICT (key) DO UPDATE SET json = EXCLUDED.json, updated_at = now() RETURNING key, json, updated_at`) as { key: string; json: Record<string, unknown>; updated_at: string | Date }[];
  const r = rows[0];
  return { key: r.key, json: r.json, updatedAt: new Date(r.updated_at).getTime() };
}

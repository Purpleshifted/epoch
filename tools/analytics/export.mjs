#!/usr/bin/env node
/**
 * The exhibition's record out of the database, to read afterwards (apps/web/src/lib/world/analytics.ts). From the top of
 * the repository, with the connection string of the database in question (Vercel: the project's Storage page):
 *
 *   DATABASE_URL='…' node tools/analytics/export.mjs [--since 2026-11-11] [--world exhibition] [--format csv|json] [--out analytics-export]
 *
 * Writes sessions.csv and events.csv (or .jsonl). A session's `o` is the visitor's `o` in the events; `exhibition_page`
 * is false for sessions opened on the rehearsal page. An event sent twice (a POST retried) comes out once.
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { neon } from "@neondatabase/serverless";

/** Neon answers at most 64 MB at a time. */
const PAGE_ROWS = 100_000;

const { values: opt } = parseArgs({
  options: {
    since: { type: "string", default: "1970-01-01" },
    world: { type: "string" },
    format: { type: "string", default: "csv" },
    out: { type: "string", default: "analytics-export" },
  },
});

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set: see the top of this file");
  process.exit(1);
}
if (opt.format !== "csv" && opt.format !== "json") {
  console.error("--format is csv or json");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
mkdirSync(opt.out, { recursive: true });

const cell = (v) => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

function writer(name, columns) {
  const path = join(opt.out, `${name}.${opt.format === "csv" ? "csv" : "jsonl"}`);
  const out = createWriteStream(path);
  if (opt.format === "csv") out.write(`${columns.join(",")}\n`);
  let n = 0;
  return {
    row(r) {
      n++;
      out.write(opt.format === "csv" ? `${columns.map((c) => cell(r[c])).join(",")}\n` : `${JSON.stringify(r)}\n`);
    },
    close: () => new Promise((done) => out.end(done)).then(() => console.log(`${path}: ${n} rows`)),
  };
}

const world = opt.world ?? null;

const SESSION_COLUMNS = ["session_id", "world", "session_no", "o", "phase", "device", "lang", "exhibition_page", "life_sec", "lived_sec", "stop_attempts", "ended_by", "opened_at", "live_at", "ended_at"];
const sessions = writer("sessions", SESSION_COLUMNS);
const sessionRows = await sql`SELECT * FROM analytics_sessions
  WHERE opened_at >= ${opt.since}::timestamptz AND (${world}::text IS NULL OR world = ${world})
  ORDER BY opened_at`;
for (const r of sessionRows) sessions.row(r);
await sessions.close();

const EVENT_COLUMNS = ["seq", "world", "epoch_ms", "o", "r", "k", "x", "z", "s", "received_at"];
const events = writer("events", EVENT_COLUMNS);
const seen = new Set();
let last = 0;
for (;;) {
  const page = await sql`SELECT * FROM analytics_events
    WHERE seq > ${last}::bigint AND received_at >= ${opt.since}::timestamptz AND (${world}::text IS NULL OR world = ${world})
    ORDER BY seq LIMIT ${PAGE_ROWS}`;
  for (const r of page) {
    const key = `${r.o}|${r.k}|${r.s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.row(r);
  }
  if (page.length < PAGE_ROWS) break;
  last = page[page.length - 1].seq;
}
await events.close();

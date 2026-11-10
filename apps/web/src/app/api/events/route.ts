/**
 * /api/events — the shared world's event log (docs/shared-world-plan.md §3).
 *   POST { world, epoch, events, host? } → { chunk } | 409 { state } when the epoch has ended
 *                                          host: renews this tab's bot lease, and the answer carries the state
 *   GET  ?world&epoch&from&to            → { from, to, events }  closed chunks: kept by the CDN for good
 *                                          425 { lastClosed } when `to` has not closed yet
 *   GET  ?world&epoch&window=1&cursor    → { to, next, events }  what the history window holds: kept for 30 s
 */
import { after, NextResponse } from "next/server";
import { deleteOldBatches, insertBatch, readChunks, readState, readWindow, takeHost } from "@/lib/world/db";
import { copyVisitorEvents } from "@/lib/world/analytics";
import { NO_STORE, notFound, sameOrigin, worldAllowed, worldEnabled } from "@/lib/world/api";
import { HOST_NOTE_MAX, MAX_POST_BYTES, MAX_RANGE_CHUNKS, cleanEvents, isClosed, joinEventTexts, keepFromAt, lastClosedChunk, pageWindow } from "@/lib/world/protocol";

export const dynamic = "force-dynamic";

/** Rows are kept this long (the history window is far shorter); a look at most once a minute per instance. */
const KEEP_HOURS = Number(process.env.WORLD_KEEP_HOURS) || 24;
const CLEAN_EVERY_MS = 60_000;
let lastClean = 0;

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const intParam = (v: string | null): number | null => {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};

function rawJson(text: string, headers: Record<string, string>): Response {
  return new Response(text, { headers: { "content-type": "application/json", ...headers } });
}

export async function GET(req: Request) {
  if (!worldEnabled()) return notFound();
  const q = new URL(req.url).searchParams;
  const world = q.get("world");
  const epoch = intParam(q.get("epoch"));
  if (!worldAllowed(world) || epoch === null) return NextResponse.json({ error: "expected world and epoch" }, { status: 400 });
  try {
    if (q.get("window") === "1") return await windowPage(world, epoch, intParam(q.get("cursor")) ?? 0);
    const from = intParam(q.get("from"));
    const to = intParam(q.get("to"));
    if (from === null || to === null || to < from || to - from >= MAX_RANGE_CHUNKS) return NextResponse.json({ error: "bad range" }, { status: 400 });
    const r = await readChunks(world, epoch, from, to);
    if (!r) return notFound();
    if (!isClosed(to, r.nowMs)) return NextResponse.json({ lastClosed: lastClosedChunk(r.nowMs) }, { status: 425, headers: NO_STORE });
    return rawJson(`{"from":${from},"to":${to},"events":${joinEventTexts(r.texts)}}`, { "cache-control": "public, max-age=3600, s-maxage=31536000, immutable" });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: NO_STORE });
  }
}

async function windowPage(world: string, epoch: number, cursor: number): Promise<Response> {
  const now = Date.now();
  const st = await readState(world, now);
  if (!st || st.epochMs !== epoch) return NextResponse.json({ state: st }, { status: 409, headers: NO_STORE });
  const r = await readWindow(world, epoch, keepFromAt(st, now), cursor);
  if (!r) return notFound();
  const { texts, next } = pageWindow(r.rows);
  return rawJson(`{"to":${lastClosedChunk(r.nowMs)},"next":${next},"events":${joinEventTexts(texts)}}`, { "cache-control": "public, max-age=0, s-maxage=30" });
}

export async function POST(req: Request) {
  if (!worldEnabled()) return notFound();
  if (!sameOrigin(req)) return NextResponse.json({ error: "origin" }, { status: 403 });
  const text = await req.text();
  if (text.length > MAX_POST_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  let body: { world?: unknown; epoch?: unknown; events?: unknown; host?: unknown; note?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { world, epoch, host } = body;
  const events = cleanEvents(body.events);
  if (!worldAllowed(world) || !isInt(epoch) || !events) return NextResponse.json({ error: "expected { world, epoch, events }" }, { status: 400 });
  if (host !== undefined && (typeof host !== "string" || !host || host.length > 40)) return NextResponse.json({ error: "bad host" }, { status: 400 });
  try {
    const now = Date.now();
    const stored = events.length ? await insertBatch(world, epoch, events) : null;
    if (events.length && !stored) return NextResponse.json({ state: await readState(world, now) }, { status: 409, headers: NO_STORE });
    if (stored) after(() => copyVisitorEvents(world, epoch, events).catch(() => {}));
    const state = typeof host === "string" ? await takeHost(world, host, now, false, typeof body.note === "string" && body.note ? body.note.slice(0, HOST_NOTE_MAX) : undefined) : undefined;
    if (now - lastClean > CLEAN_EVERY_MS) {
      lastClean = now;
      after(() => deleteOldBatches(KEEP_HOURS).catch(() => {}));
    }
    return NextResponse.json({ chunk: stored?.chunk ?? null, ...(state ? { state } : {}) }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: NO_STORE });
  }
}

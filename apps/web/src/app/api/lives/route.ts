/**
 * /api/lives — keeping a life (lib/lives/db.ts) and the gallery that shows the kept ones.
 *   POST { id, card, look, via: "post" | "print", venue?, recordingUrl? }  → { kept: true, postedAt } | 503 { kept: false, server: false }
 *   GET  ?limit=60&before=<ms>&trials=1  → { lives: LifeRow[], server }   (newest first; trials only when asked)
 * The card is the end screen's own values (plate.ts PlateInput); it is checked for shape and size only. No auth (like
 * /api/presets): the worst a stranger can do is add a made-up life to the archive.
 *
 * Without a database of its own (like /api/presets): a branch PREVIEW hands a post to its project's production as a
 * trial (kept there, left out of the production gallery) and its gallery reads production's, trials included — so the
 * whole post → gallery → recording way can be tried on a preview (the artist checks there). `next dev` keeps posts in
 * memory until the server restarts. Anything else without one: 503 / an empty gallery.
 */
import { NextResponse } from "next/server";
import { hasLivesDb, readLives, writeLife, type LifeRow, type LifeVia } from "@/lib/lives/db";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000_000;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** The production this preview belongs to (none outside a preview). */
const production = () => (process.env.VERCEL_ENV === "preview" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : undefined);
/** `next dev` with no database: posts kept in this server's memory (lost on restart). */
const devMemory = (): LifeRow[] | null => {
  if (process.env.NODE_ENV !== "development") return null;
  const g = globalThis as { __livesDev?: LifeRow[] };
  return (g.__livesDev ??= []);
};

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "not JSON" }, { status: 400 });
  }
  if (!isObj(body)) return NextResponse.json({ error: "not an object" }, { status: 400 });
  const { id, card, look, via, venue, recordingUrl, trial } = body;
  if (typeof id !== "string" || !/^[\w.:-]{4,120}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (!isObj(card) || !isObj(look)) return NextResponse.json({ error: "card and look must be objects" }, { status: 400 });
  if (via !== "post" && via !== "print") return NextResponse.json({ error: "via must be post or print" }, { status: 400 });
  const url = typeof recordingUrl === "string" && /^https?:\/\//.test(recordingUrl) ? recordingUrl.slice(0, 2000) : null;
  const row = { id, card, look, via: via as LifeVia, venue: typeof venue === "string" ? venue.slice(0, 64) : null, recordingUrl: url, trial: trial === true };

  if (!hasLivesDb()) {
    const prod = production();
    if (prod) {
      // a preview: production keeps it, as a trial
      try {
        const r = await fetch(`https://${prod}/api/lives`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...row, trial: true }), signal: AbortSignal.timeout(8000) });
        return NextResponse.json(await r.json().catch(() => ({ kept: false })), { status: r.status });
      } catch (e) {
        return NextResponse.json({ kept: false, server: false, error: String(e).slice(0, 200) }, { status: 503 });
      }
    }
    const mem = devMemory();
    if (mem) {
      const postedAt = mem.find((l) => l.id === id)?.postedAt ?? Date.now();
      const kept = { ...row, postedAt };
      mem.splice(0, mem.length, kept, ...mem.filter((l) => l.id !== id));
      return NextResponse.json({ kept: true, postedAt, memory: true });
    }
    return NextResponse.json({ kept: false, server: false }, { status: 503 });
  }
  try {
    const kept = await writeLife(row);
    return NextResponse.json({ kept: !!kept, postedAt: kept?.postedAt ?? null });
  } catch (e) {
    return NextResponse.json({ kept: false, error: String(e).slice(0, 200) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const limit = Math.max(1, Math.min(200, Number(q.get("limit")) || 60));
  const before = Number(q.get("before")) || undefined;
  const trials = q.get("trials") === "1";
  const noStore = { "cache-control": "no-store" };
  if (!hasLivesDb()) {
    const prod = production();
    if (prod) {
      try {
        const r = await fetch(`https://${prod}/api/lives?limit=${limit}${before ? `&before=${before}` : ""}&trials=1`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
        if (r.ok) {
          const { lives } = (await r.json()) as { lives?: unknown };
          return NextResponse.json({ lives: Array.isArray(lives) ? lives : [], server: false, from: prod }, { headers: noStore });
        }
      } catch {
        /* production unreachable: an empty gallery */
      }
      return NextResponse.json({ lives: [], server: false, from: prod }, { headers: noStore });
    }
    const mem = devMemory();
    const lives = (mem ?? []).filter((l) => !before || l.postedAt < before).slice(0, limit);
    return NextResponse.json({ lives, server: false, memory: !!mem }, { headers: noStore });
  }
  try {
    const lives = (await readLives({ limit, before, trials })) ?? [];
    return NextResponse.json({ lives, server: true }, { headers: noStore });
  } catch (e) {
    return NextResponse.json({ lives: [], error: String(e).slice(0, 200) }, { status: 500 });
  }
}

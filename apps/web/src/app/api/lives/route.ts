/**
 * /api/lives — keeping a life (lib/lives/db.ts): the end screen posts here when the visitor posts or prints the card.
 *   POST { id, card, look, via: "post" | "print", venue?, recordingUrl? }  → { kept: true, postedAt } | 503 { kept: false, server: false }
 * The card is the end screen's own values (plate.ts PlateInput); it is checked for shape and size only. No auth (like
 * /api/presets): the worst a stranger can do is add a made-up life to the archive.
 */
import { NextResponse } from "next/server";
import { hasLivesDb, writeLife, type LifeVia } from "@/lib/lives/db";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000_000;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

export async function POST(req: Request) {
  if (!hasLivesDb()) return NextResponse.json({ kept: false, server: false }, { status: 503 });
  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "not JSON" }, { status: 400 });
  }
  if (!isObj(body)) return NextResponse.json({ error: "not an object" }, { status: 400 });
  const { id, card, look, via, venue, recordingUrl } = body;
  if (typeof id !== "string" || !/^[\w.:-]{4,120}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (!isObj(card) || !isObj(look)) return NextResponse.json({ error: "card and look must be objects" }, { status: 400 });
  if (via !== "post" && via !== "print") return NextResponse.json({ error: "via must be post or print" }, { status: 400 });
  const url = typeof recordingUrl === "string" && /^https?:\/\//.test(recordingUrl) ? recordingUrl.slice(0, 2000) : null;
  try {
    const row = await writeLife({ id, card, look, via: via as LifeVia, venue: typeof venue === "string" ? venue.slice(0, 64) : null, recordingUrl: url });
    return NextResponse.json({ kept: !!row, postedAt: row?.postedAt ?? null });
  } catch (e) {
    return NextResponse.json({ kept: false, error: String(e).slice(0, 200) }, { status: 500 });
  }
}

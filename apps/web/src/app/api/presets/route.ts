/**
 * /api/presets — the Leva groups shared through the database (lib/presets/db.ts).
 *   GET  ?page=/v2/global/space   → { presets: { "<key>": { json, updatedAt } }, server: true }
 *                                   (server: false and no presets when no database is configured)
 *   PUT  { key, json }            → { preset: { key, json, updatedAt } }   (key must start with parliament.leva:)
 * Minimal on purpose: no auth (the rehearsal wall is the only writer, and the worst a stranger can do is change a
 * slider — see docs/sync-server.md §3), no caching (every wall load asks for the newest save).
 */
import { NextResponse } from "next/server";
import { PRESET_KEY_PREFIX, hasPresetsDb, readPresets, writePreset } from "@/lib/presets/db";

export const dynamic = "force-dynamic";

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

export async function GET(req: Request) {
  const page = new URL(req.url).searchParams.get("page") ?? "";
  if (!page.startsWith("/")) return NextResponse.json({ error: "page must be a path" }, { status: 400 });
  if (!hasPresetsDb()) {
    // A PREVIEW READS THE PRODUCTION'S SAVES (the artist, 2026-11-17: "로컬보다 프로덕션 프리뷰가 더 성능이 좋아서 거기로
    // 확인"): a branch's preview deployment has no database, and a look was judged there on the defaults. With none
    // configured, a preview asks its project's production for the page's saves — read only (a save made on the
    // preview stays in that browser: PUT has no database here).
    const prod = process.env.VERCEL_ENV === "preview" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : undefined;
    if (prod) {
      try {
        const r = await fetch(`https://${prod}/api/presets?page=${encodeURIComponent(page)}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
        if (r.ok) {
          const { presets } = (await r.json()) as { presets?: Record<string, unknown> };
          return NextResponse.json({ presets: isObj(presets) ? presets : {}, server: false, from: prod }, { headers: { "cache-control": "no-store" } });
        }
      } catch {
        /* production unreachable: the defaults, as before */
      }
    }
    return NextResponse.json({ presets: {}, server: false });
  }
  try {
    const rows = (await readPresets(page)) ?? [];
    const presets: Record<string, { json: Record<string, unknown>; updatedAt: number }> = {};
    for (const r of rows) presets[r.key] = { json: r.json, updatedAt: r.updatedAt };
    return NextResponse.json({ presets, server: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!hasPresetsDb()) return NextResponse.json({ error: "no database" }, { status: 503 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!isObj(body) || typeof body.key !== "string" || !body.key.startsWith(PRESET_KEY_PREFIX) || body.key.length > 300 || !isObj(body.json)) {
    return NextResponse.json({ error: "expected { key: 'parliament.leva:…', json: {…} }" }, { status: 400 });
  }
  if (JSON.stringify(body.json).length > 100_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  try {
    const preset = await writePreset(body.key, body.json);
    return NextResponse.json({ preset });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

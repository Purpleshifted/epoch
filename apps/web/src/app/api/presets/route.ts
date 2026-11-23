/**
 * /api/presets — the Leva groups shared through the database (lib/presets/db.ts).
 *   GET  ?page=/v2/global/space   → { presets: { "<key>": { json, updatedAt } }, server: true }
 *                                   (server: false and no presets when no database is configured)
 *   PUT  { key, json }            → { preset: { key, json, updatedAt } }   (key must start with parliament.leva:)
 *   DELETE ?key=parliament.leva:/presets/…  → { deleted: n }   (a NAMED preset only — levaPresets.ts; a folder's own
 *                                   saved set cannot be deleted here)
 * Without a database (a dev server, a branch preview) the mobile view lab's keys go on to the redesign production's
 * (labUpstream).
 * Minimal on purpose: no auth (the rehearsal wall is the only writer, and the worst a stranger can do is change a
 * slider — see docs/sync-server.md §3), no caching (every wall load asks for the newest save).
 */
import { NextResponse } from "next/server";
import { NAMED_PRESET_PREFIX, PRESET_KEY_PREFIX, deleteNamedPreset, hasPresetsDb, readPresets, writePreset } from "@/lib/presets/db";

export const dynamic = "force-dynamic";

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * THE MOBILE VIEW LAB'S VALUES ARE ONE SET, EVERYWHERE (the artist, 2026-11-23: "걍 db 로 바로바로 연동되게 해 어디서든" —
 * components/parliament/mobileLab.ts). A dev server or a branch preview has no database: the lab's keys only
 * (`parliament.leva:/lab/mobile:…`) are read from and written to the redesign production's, which has one — so a value
 * saved on the artist's local lab is the one a preview, another machine and (once this is up there) the exhibition
 * read. Every other key keeps the old rule (a preview reads production's saves, writes nothing).
 */
const LAB_PAGE = "/lab/mobile";
const LAB_UPSTREAM = "https://anthropocene-redesign.vercel.app";
function labUpstream(): string | null {
  if (process.env.PRESETS_UPSTREAM) return process.env.PRESETS_UPSTREAM;
  return process.env.NODE_ENV === "development" || process.env.VERCEL_ENV === "preview" ? LAB_UPSTREAM : null;
}
const isLabKey = (key: string) => key.startsWith(`${PRESET_KEY_PREFIX}${LAB_PAGE}:`);

export async function GET(req: Request) {
  const page = new URL(req.url).searchParams.get("page") ?? "";
  if (!page.startsWith("/")) return NextResponse.json({ error: "page must be a path" }, { status: 400 });
  if (!hasPresetsDb() && page === LAB_PAGE && labUpstream()) {
    try {
      const r = await fetch(`${labUpstream()}/api/presets?page=${encodeURIComponent(page)}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const { presets, server } = (await r.json()) as { presets?: Record<string, unknown>; server?: boolean };
        return NextResponse.json({ presets: isObj(presets) ? presets : {}, server: !!server, from: labUpstream() }, { headers: { "cache-control": "no-store" } });
      }
    } catch {
      /* production unreachable: this browser's values stand */
    }
    return NextResponse.json({ presets: {}, server: false });
  }
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
  if (!hasPresetsDb() && isLabKey(body.key) && labUpstream()) {
    // (the lab's values: written to the production's database — see labUpstream)
    try {
      const r = await fetch(`${labUpstream()}/api/presets`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: body.key, json: body.json }), signal: AbortSignal.timeout(8000) });
      return NextResponse.json(await r.json(), { status: r.status });
    } catch (e) {
      return NextResponse.json({ error: `upstream: ${String(e)}` }, { status: 502 });
    }
  }
  if (!hasPresetsDb()) return NextResponse.json({ error: "no database" }, { status: 503 });
  try {
    const preset = await writePreset(body.key, body.json);
    return NextResponse.json({ preset });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!hasPresetsDb()) return NextResponse.json({ error: "no database" }, { status: 503 });
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!key.startsWith(NAMED_PRESET_PREFIX) || key.length > 300) return NextResponse.json({ error: "only a named preset (parliament.leva:/presets/…) can be deleted" }, { status: 400 });
  try {
    return NextResponse.json({ deleted: (await deleteNamedPreset(key)) ?? 0 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

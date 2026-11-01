/**
 * /api/world — the shared world's state: epoch, world clock, history window, bot host (docs/shared-world-plan.md §3).
 *   GET  ?world                     → { state }   kept by the CDN for 5 s
 *   POST { world, op, … }           → { state }
 *     clear                           a new epoch (admin)
 *     rate { rate }                   the time rate (admin; refused in the exhibition's world, which runs at real speed)
 *     window { sec }                  raising needs nobody's leave (baking raises it, docs §6a); lowering is admin's
 *     host { id, force? }             take or renew the bot lease; force is admin's. The answer says who holds it
 *     release { id }                  a host leaving on purpose (sent with sendBeacon when a tab closes)
 */
import { NextResponse } from "next/server";
import { clearWorld, readState, releaseHost, setKeepWindow, setRate, takeHost } from "@/lib/world/db";
import { NO_STORE, isAdmin, notFound, sameOrigin, worldAllowed, worldEnabled } from "@/lib/world/api";
import { LOCKED_RATE_WORLD, MAX_KEEP_WINDOW_SEC } from "@/lib/world/protocol";
import { MAX_TIME_RATE, MIN_TIME_RATE } from "@/lib/parliament/worldClock";

export const dynamic = "force-dynamic";

const denied = () => NextResponse.json({ error: "admin key required" }, { status: 403, headers: NO_STORE });

export async function GET(req: Request) {
  if (!worldEnabled()) return notFound();
  const world = new URL(req.url).searchParams.get("world");
  if (!worldAllowed(world)) return NextResponse.json({ error: "unknown world" }, { status: 400 });
  try {
    const state = await readState(world, Date.now());
    return NextResponse.json({ state }, { headers: { "cache-control": "public, max-age=0, s-maxage=5" } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req: Request) {
  if (!worldEnabled()) return notFound();
  if (!sameOrigin(req)) return NextResponse.json({ error: "origin" }, { status: 403 });
  let body: { world?: unknown; op?: unknown; rate?: unknown; sec?: unknown; id?: unknown; force?: unknown };
  try {
    body = JSON.parse(await req.text()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { world, op } = body;
  if (!worldAllowed(world)) return NextResponse.json({ error: "unknown world" }, { status: 400 });
  const now = Date.now();
  try {
    const current = await readState(world, now);
    if (!current) return notFound();
    const respond = (state: unknown) => NextResponse.json({ state }, { headers: NO_STORE });
    switch (op) {
      case "clear":
        return isAdmin(req) ? respond(await clearWorld(world, now)) : denied();
      case "rate": {
        const rate = body.rate;
        if (typeof rate !== "number" || !Number.isFinite(rate) || rate < MIN_TIME_RATE || rate > MAX_TIME_RATE) return NextResponse.json({ error: "bad rate" }, { status: 400 });
        if (world === LOCKED_RATE_WORLD && rate !== 1) return NextResponse.json({ error: "this world runs at real speed", state: current }, { status: 423, headers: NO_STORE });
        return isAdmin(req) ? respond(await setRate(world, now, rate)) : denied();
      }
      case "window": {
        const sec = body.sec;
        if (typeof sec !== "number" || !Number.isInteger(sec) || sec < 60 || sec > MAX_KEEP_WINDOW_SEC) return NextResponse.json({ error: "bad window" }, { status: 400 });
        if (sec <= current.keepWindowSec && !isAdmin(req)) return denied();
        return respond(await setKeepWindow(world, sec));
      }
      case "host": {
        const { id, force } = body;
        if (typeof id !== "string" || !id || id.length > 40) return NextResponse.json({ error: "bad id" }, { status: 400 });
        if (force === true && !isAdmin(req)) return denied();
        return respond(await takeHost(world, id, now, force === true));
      }
      case "release": {
        if (typeof body.id !== "string") return NextResponse.json({ error: "bad id" }, { status: 400 });
        await releaseHost(world, body.id);
        return respond(await readState(world, now));
      }
      default:
        return NextResponse.json({ error: "unknown op" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: NO_STORE });
  }
}

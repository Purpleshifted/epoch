/**
 * /api/now — the server's time, by which the shared world's tabs correct their own clocks (docs/shared-world-plan.md §3).
 * No database, and never cached: a tab keeps the answer with the shortest round trip.
 */
import { NextResponse } from "next/server";
import { NO_STORE, notFound, worldEnabled } from "@/lib/world/api";

export const dynamic = "force-dynamic";

export function GET() {
  if (!worldEnabled()) return notFound();
  return NextResponse.json({ now: Date.now() }, { headers: NO_STORE });
}

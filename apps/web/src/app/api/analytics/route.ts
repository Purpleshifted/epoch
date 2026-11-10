/**
 * /api/analytics — one line about a visitor's session (lib/world/analytics.ts). Sent as a beacon: nobody waits for the
 * answer, so a line that cannot be stored is only a line missing from the record.
 *   POST SessionLine → { stored }
 *   GET              → { on, sessions, events, dbMb, full }  whether the record is being kept; numbers, no rows
 */
import { NextResponse } from "next/server";
import { MAX_LINE_BYTES, analyticsOn, analyticsStatus, cleanSessionLine, writeSession } from "@/lib/world/analytics";
import { NO_STORE, sameOrigin, worldAllowed, worldEnabled } from "@/lib/world/api";

export const dynamic = "force-dynamic";

const answer = (body: object, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET() {
  if (!worldEnabled() || !analyticsOn()) return answer({ on: false });
  try {
    const status = await analyticsStatus();
    return answer(status ? { on: true, ...status } : { on: false });
  } catch {
    return answer({ on: true, failing: true });
  }
}

export async function POST(req: Request) {
  if (!worldEnabled() || !analyticsOn()) return answer({ stored: false });
  if (!sameOrigin(req)) return answer({ stored: false }, 403);
  const text = await req.text();
  if (text.length > MAX_LINE_BYTES) return answer({ stored: false }, 413);
  let line = null;
  try {
    line = cleanSessionLine(JSON.parse(text));
  } catch {
    // not JSON
  }
  if (!line || !worldAllowed(line.world)) return answer({ stored: false }, 400);
  try {
    return answer({ stored: await writeSession(line) });
  } catch {
    return answer({ stored: false });
  }
}

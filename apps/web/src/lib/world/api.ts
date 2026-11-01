/**
 * What the shared world's routes have in common: whether the world is on at all, which world names this deployment
 * serves, the origin check, and who may change the world for everybody.
 */
import { NextResponse } from "next/server";
import { hasWorldDb } from "./db";
import { isWorldName } from "./protocol";

/** Off = the routes answer 404 and no table is ever made. Set per environment on Vercel (plan §7.3). */
export function worldEnabled(): boolean {
  return !!process.env.NEXT_PUBLIC_WORLD && hasWorldDb();
}

/** Production serves only its own world; elsewhere a tab may open a rehearsal or test world by name (?world=). */
export function worldAllowed(name: unknown): name is string {
  if (typeof name !== "string" || !isWorldName(name)) return false;
  return process.env.VERCEL_ENV !== "production" || name === process.env.NEXT_PUBLIC_WORLD;
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

/** A browser on another site may not write here. (Not a lock: it only stops the casual.) */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Clearing the world, the rate, a smaller window, taking the bots by force. Open only where nothing is at stake. */
export function isAdmin(req: Request): boolean {
  const key = process.env.WORLD_ADMIN_KEY;
  if (!key) return process.env.VERCEL_ENV !== "production";
  return req.headers.get("x-world-admin") === key;
}

export const NO_STORE = { "cache-control": "no-store" };

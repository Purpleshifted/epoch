/**
 * POST /noisecraft/save-ncft/<filename> — the NoiseCraft embed's save / auto-save endpoint (what its express
 * server used to provide), writing the patch into apps/web/public/noisecraft/examples/. Development only: the exhibition
 * build ships the patch files as they are.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { examplesDir } from "@/lib/sound/noisecraftFiles";

const SAFE = /^[\w.-]+\.ncft$/;

export async function POST(req: Request, ctx: { params: Promise<{ filename: string }> }) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "saving is disabled in production" }, { status: 403 });
  const { filename } = await ctx.params;
  if (!SAFE.test(filename)) return NextResponse.json({ error: "bad filename" }, { status: 400 });
  let body: { data?: unknown };
  try {
    body = (await req.json()) as { data?: unknown };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const data = typeof body.data === "string" ? body.data : JSON.stringify(body.data, null, 2);
  if (!data) return NextResponse.json({ error: "no data" }, { status: 400 });
  try {
    JSON.parse(data);
  } catch {
    return NextResponse.json({ error: "data is not a project" }, { status: 400 });
  }
  const file = path.join(examplesDir(), filename);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, "utf8");
  return NextResponse.json({ ok: true, size: data.length, path: file });
}

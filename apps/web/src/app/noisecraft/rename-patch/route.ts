import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { examplesDir } from "@/lib/sound/noisecraftFiles";

const DIR = examplesDir();
const SAFE = /^[\w.-]+\.ncft$/;
const safeName = (raw: string): string | null => {
  let f = String(raw ?? "").trim().replace(/\s+/g, "_");
  if (!f) return null;
  if (!f.endsWith(".ncft")) f += ".ncft";
  return SAFE.test(f) ? f : null;
};
const closed = () => NextResponse.json({ error: "patch files are read-only in production" }, { status: 403 });

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return closed();
  const { oldFilename, newFilename } = (await req.json()) as { oldFilename?: string; newFilename?: string };
  const from = safeName(oldFilename ?? "");
  const to = safeName(newFilename ?? "");
  if (!from || !to) return NextResponse.json({ error: "bad name" }, { status: 400 });
  try {
    await fs.rename(path.join(DIR, from), path.join(DIR, to));
  } catch {
    return NextResponse.json({ error: "rename failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, filename: to });
}

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
  const { filename } = (await req.json()) as { filename?: string };
  const f = safeName(filename ?? "");
  if (!f) return NextResponse.json({ error: "bad name" }, { status: 400 });
  try {
    await fs.unlink(path.join(DIR, f));
  } catch {
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

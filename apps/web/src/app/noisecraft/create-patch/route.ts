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
  const { name } = (await req.json()) as { name?: string };
  const filename = safeName(name ?? "");
  if (!filename) return NextResponse.json({ error: "bad name" }, { status: 400 });
  const file = path.join(DIR, filename);
  try {
    await fs.access(file);
    return NextResponse.json({ error: "exists" }, { status: 409 });
  } catch {
    /* new */
  }
  // NoiseCraft's own empty project (model.js: title + nodes)
  const empty = JSON.stringify({ title: filename.replace(".ncft", "").slice(0, 50), nodes: {} }, null, 2);
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(file, empty, "utf8");
  return NextResponse.json({ success: true, filename });
}

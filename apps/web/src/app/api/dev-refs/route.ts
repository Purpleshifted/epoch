/**
 * /api/dev-refs?f=<file> — DEV ONLY: one reference still of the mobile view lab (mobileLab.ts LAB_INFO.refs), read from
 * the gitignored `visual_reference_images/mobile_view_refs/` of the main checkout (found by walking up from here, so a
 * worktree finds it too; REFS_DIR overrides). 404 in a production build: the references never leave this machine.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };

function refsDir(): string | null {
  if (process.env.REFS_DIR) return process.env.REFS_DIR;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const here = path.join(dir, "visual_reference_images", "mobile_view_refs");
    if (existsSync(here)) return here;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV !== "development") return new NextResponse(null, { status: 404 });
  const f = new URL(req.url).searchParams.get("f") ?? "";
  const type = TYPES[path.extname(f).toLowerCase()];
  const dir = refsDir();
  // a bare file name of a picture inside the folder, nothing else
  if (!type || !dir || f !== path.basename(f) || f.startsWith(".")) return new NextResponse(null, { status: 404 });
  try {
    const data = await readFile(path.join(dir, f));
    return new NextResponse(new Uint8Array(data), { headers: { "content-type": type, "cache-control": "no-store" } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

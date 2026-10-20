import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { examplesDir } from "@/lib/sound/noisecraftFiles";

const DIR = examplesDir();

export async function GET() {
  try {
    const files = await fs.readdir(DIR);
    const patches = await Promise.all(
      files
        .filter((f) => f.endsWith(".ncft"))
        .map(async (filename) => {
          const st = await fs.stat(path.join(DIR, filename));
          return { filename, size: st.size, lastModified: st.mtimeMs };
        }),
    );
    patches.sort((a, b) => b.lastModified - a.lastModified);
    return NextResponse.json({ patches });
  } catch {
    return NextResponse.json({ patches: [] });
  }
}

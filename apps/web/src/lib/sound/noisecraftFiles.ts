/**
 * sound/noisecraftFiles.ts — where the NoiseCraft patch files are, for the /noisecraft/* routes (server side).
 */
import fsSync from "node:fs";
import path from "node:path";

/** apps/web/noisecraft/examples of this app (next.config.ts pins it; otherwise guessed from the cwd). */
export function examplesDir(): string {
  const pinned = process.env.NOISECRAFT_EXAMPLES_DIR;
  if (pinned) return pinned;
  const cwd = process.cwd();
  for (const c of [path.join(cwd, "noisecraft", "examples"), path.join(cwd, "apps", "web", "noisecraft", "examples")]) {
    if (fsSync.existsSync(c)) return c;
  }
  return path.join(cwd, "noisecraft", "examples");
}

/**
 * sound/noisecraftFiles.ts — where the NoiseCraft patch files are, for the /noisecraft/* routes (server side).
 */
import fsSync from "node:fs";
import path from "node:path";

/**
 * apps/web/public/noisecraft/examples of this app (next.config.ts pins it at build time; on a deployment that absolute
 * path may not exist in the function, so the cwd is tried next).
 */
export function examplesDir(): string {
  const pinned = process.env.NOISECRAFT_EXAMPLES_DIR;
  if (pinned && fsSync.existsSync(pinned)) return pinned;
  const cwd = process.cwd();
  for (const c of [path.join(cwd, "public", "noisecraft", "examples"), path.join(cwd, "apps", "web", "public", "noisecraft", "examples")]) {
    if (fsSync.existsSync(c)) return c;
  }
  return pinned || path.join(cwd, "public", "noisecraft", "examples");
}

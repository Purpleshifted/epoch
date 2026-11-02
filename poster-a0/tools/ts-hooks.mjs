// Lets plain Node import the app's TypeScript: "@/x" → apps/web/src/x, and extensionless paths get ".ts".
import { existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = pathResolve(dirname(fileURLToPath(import.meta.url)), "../../apps/web/src");

export async function resolve(spec, ctx, next) {
  let path = null;
  if (spec.startsWith("@/")) path = pathResolve(SRC, spec.slice(2));
  else if (spec.startsWith(".") && ctx.parentURL?.startsWith("file:")) path = pathResolve(dirname(fileURLToPath(ctx.parentURL)), spec);
  if (path) {
    for (const p of [path, `${path}.ts`, `${path}/index.ts`]) {
      if (existsSync(p) && /\.[cm]?[tj]sx?$/.test(p)) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
  }
  return next(spec, ctx);
}

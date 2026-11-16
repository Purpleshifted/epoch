/**
 * DEV ONLY — the panel's values as they stand in an open tab, written to a file on this machine (the artist,
 * 2026-11-16: "지금 내 브라우저 수치가 융합 빼면 다 마음에 드는 느낌이거든, 그거 그대로 가져와서 실험해봐"). The wall posts
 * its Leva store here while the dev server runs (components/parliament/levaFocus.ts); nothing is kept outside
 * `.leva-live/` (ignored by git), and in a production build the route answers 404.
 */
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return new Response("not found", { status: 404 });
  let body: { tag?: string; page?: string; ua?: string; values?: Record<string, unknown>; readout?: string; errors?: string[] };
  try {
    body = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.values || typeof body.values !== "object") return new Response("no values", { status: 400 });
  const tag = String(body.tag ?? "tab").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "tab";
  const dir = path.join(process.cwd(), ".leva-live");
  await mkdir(dir, { recursive: true });
  const readout = typeof body.readout === "string" ? body.readout.slice(0, 4000) : "";
  const errors = Array.isArray(body.errors) ? body.errors.slice(-8).map((e) => String(e).slice(0, 400)) : [];
  await writeFile(path.join(dir, `${tag}.json`), JSON.stringify({ at: new Date().toISOString(), page: body.page ?? "", ua: body.ua ?? "", readout, errors, values: body.values }, null, 1));
  // THE WALL'S OWN READOUT, AS THE ARTIST'S WINDOW SHOWS IT (2026-11-16: "내가 연 창을 니가 모니터링 하면 안 돼?" — her
  // window may be in any browser): one line a post, so how it goes over the minutes can be read without a tab of
  // Claude's own beside hers. Started again when it has grown past 2 MB.
  if (readout) {
    const log = path.join(dir, `${tag}.log`);
    const size = await stat(log).then((q) => q.size, () => 0);
    const line = `${new Date().toISOString()} ${readout.replace(/\n/g, " | ")}${errors.length ? ` || ERR ${errors.join(" ; ")}` : ""}\n`;
    if (size > 2e6) await writeFile(log, line);
    else await appendFile(log, line);
  }
  return Response.json({ ok: true });
}

/** The values a tab posted, by its tag (dev only): another tab takes them over with this. */
export async function GET(req: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return new Response("not found", { status: 404 });
  const tag = (new URL(req.url).searchParams.get("tag") ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
  if (!tag) return new Response("no tag", { status: 400 });
  try {
    return new Response(await readFile(path.join(process.cwd(), ".leva-live", `${tag}.json`), "utf8"), { headers: { "content-type": "application/json" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

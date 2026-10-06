/**
 * GET /api/sprites/image?url=<thumbnail url>
 *
 * Same-origin proxy for Wikimedia thumbnails, so the browser can read the pixels (canvas)
 * without CORS trouble and Commons sees a proper User-Agent. Only Wikimedia hosts, capped size.
 */

export const dynamic = "force-dynamic";

const UA = "anthropocene-sprite-lab/0.1 (art installation; https://github.com/Purpleshifted/epoch)";
const HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);
const MAX_BYTES = 3_000_000;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) return new Response("url required", { status: 400 });
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (target.protocol !== "https:" || !HOSTS.has(target.hostname)) return new Response("host not allowed", { status: 403 });

  const res = await fetch(target, { headers: { "User-Agent": UA } });
  if (!res.ok) return new Response(`upstream ${res.status}`, { status: 502 });
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return new Response("not an image", { status: 415 });
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return new Response("too large", { status: 413 });
  return new Response(buf, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
}

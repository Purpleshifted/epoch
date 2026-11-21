/**
 * THE RECORDINGS (docs/recording.md): one life's sound as it was heard in the headset, and the moments of the record
 * beside it — kept in R2 by the life's id so the specimen card's QR can play it back anywhere.
 *
 *   PUT  /rec/<id>        the audio (body = the file, ≤ 8 MB, audio/mp4 · audio/webm · audio/ogg)
 *   GET  /rec/<id>        the audio, with Range (a phone's <audio> seeks with it) and its own Content-Type
 *   PUT  /rec/<id>.json   the markers { id, startedAt, seconds, events: [{ t, kind, text }] } (≤ 256 KB)
 *   GET  /rec/<id>.json   the markers
 *
 * Writes only from the app's own origins (the Vercel projects, localhost); reads from anywhere (the QR). A recording
 * is written once: a second PUT of the same id is refused, so nobody overwrites a life after the fact.
 */

interface Env {
  RECS: R2Bucket;
}

const ID = /^[a-z0-9_-]{3,40}$/;
const MAX_AUDIO = 8 * 1024 * 1024;
const MAX_META = 256 * 1024;
const AUDIO_TYPES = /^audio\/(mp4|webm|ogg|mpeg|aac|x-m4a)$/;
const ALLOWED_ORIGIN = /^https:\/\/anthropocene(-[a-z0-9-]+)?\.vercel\.app$|^https:\/\/homo-inventus(-[a-z0-9-]+)?\.vercel\.app$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function cors(origin: string | null, extra: Record<string, string> = {}): Headers {
  const h = new Headers(extra);
  h.set("Access-Control-Allow-Origin", origin && ALLOWED_ORIGIN.test(origin) ? origin : "*");
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "GET, HEAD, PUT, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Range");
  h.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type");
  return h;
}

const say = (status: number, text: string, origin: string | null) => new Response(text, { status, headers: cors(origin, { "Content-Type": "text/plain; charset=utf-8" }) });

/** "bytes=a-b" / "bytes=a-" / "bytes=-n" → R2's range; null = the whole file; "bad" = unsatisfiable. */
function parseRange(h: string | null, size: number): { offset: number; length: number } | null | "bad" {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m) return null;
  let start: number;
  let end: number;
  if (m[1] === "" && m[2] === "") return null;
  if (m[1] === "") {
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(size - 1, Number(m[2]));
  }
  if (start >= size || start > end) return "bad";
  return { offset: start, length: end - start + 1 };
}

async function readCapped(req: Request, cap: number): Promise<ArrayBuffer | null> {
  const declared = Number(req.headers.get("Content-Length") ?? "0");
  if (declared > cap) return null;
  const buf = await req.arrayBuffer();
  return buf.byteLength > cap ? null : buf;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin");
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin, { "Access-Control-Max-Age": "86400" }) });
    const m = /^\/rec\/([^/]+?)(\.json)?$/.exec(url.pathname);
    if (!m) return say(404, "not here", origin);
    const id = decodeURIComponent(m[1]);
    const isMeta = !!m[2];
    if (!ID.test(id)) return say(400, "id", origin);
    const key = isMeta ? `rec/${id}.json` : `rec/${id}`;

    if (req.method === "PUT") {
      if (!origin || !ALLOWED_ORIGIN.test(origin)) return say(403, "origin", origin);
      if (await env.RECS.head(key)) return say(409, "already there", origin);
      if (isMeta) {
        const buf = await readCapped(req, MAX_META);
        if (!buf) return say(413, "too large", origin);
        let parsed: { id?: unknown };
        try {
          parsed = JSON.parse(new TextDecoder().decode(buf));
        } catch {
          return say(400, "json", origin);
        }
        if (parsed.id !== id) return say(400, "id mismatch", origin);
        await env.RECS.put(key, buf, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
        return say(201, "ok", origin);
      }
      const type = (req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
      if (!AUDIO_TYPES.test(type)) return say(415, "audio only", origin);
      const buf = await readCapped(req, MAX_AUDIO);
      if (!buf) return say(413, "too large", origin);
      if (buf.byteLength === 0) return say(400, "empty", origin);
      await env.RECS.put(key, buf, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
      return say(201, "ok", origin);
    }

    if (req.method !== "GET" && req.method !== "HEAD") return say(405, "method", origin);
    const head = await env.RECS.head(key);
    if (!head) return say(404, "no such recording", origin);
    const size = head.size;
    const type = head.httpMetadata?.contentType ?? (isMeta ? "application/json" : "application/octet-stream");
    const base = cors(origin, { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": isMeta ? "public, max-age=60" : "public, max-age=31536000, immutable", ETag: head.httpEtag });
    const range = isMeta ? null : parseRange(req.headers.get("Range"), size);
    if (range === "bad") {
      base.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers: base });
    }
    if (req.method === "HEAD") {
      base.set("Content-Length", String(size));
      return new Response(null, { status: 200, headers: base });
    }
    const obj = await env.RECS.get(key, range ? { range } : undefined);
    if (!obj) return say(404, "no such recording", origin);
    if (range) {
      base.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
      base.set("Content-Length", String(range.length));
      return new Response(obj.body, { status: 206, headers: base });
    }
    base.set("Content-Length", String(size));
    return new Response(obj.body, { status: 200, headers: base });
  },
};

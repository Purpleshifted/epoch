#!/usr/bin/env node
/**
 * The card printer's helper (the gallery machine, 2026-11-21): the end screen's 출력하기 hands the specimen card here as
 * a 300 dpi PNG at the card's size, already stood up (apps/web/src/components/parliament/SpecimenCard.tsx printCard),
 * and this prints it with `lp` at the card's size — no print dialog, no A4. Without it the page falls back to the
 * browser's print.
 *
 *   node tools/card-printer/server.mjs
 *
 *   GET  /status              200 { ok, printer, state } (the page asks first; `lpstat -p`'s line for the printer)
 *   POST /print?w=54&h=86     the PNG as the body → lp -d $PRINTER -o media=Custom.<w>x<h>mm -o ppi=300 → 200 { job }
 *
 * env: PRINTER (default NIIMBOT_B21_Pro), PORT (default 7313), VOFF (driver steps, -20…20: the print up or down on the
 * label), MEDIA ("54x86": the paper's size in mm when it is not the card's). Listens on 127.0.0.1 only. The page is on
 * another origin (Vercel), so it answers CORS and Chrome's local-network preflight; Chrome may ask once whether the
 * page may reach this machine — allow it.
 * If the printer says "in use" and nothing comes out: an earlier job's usb backend still holds it — replug the printer
 * (or `lpstat -o`, `cancel -a`).
 */

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PRINTER = process.env.PRINTER || "NIIMBOT_B21_Pro";
const PORT = Number(process.env.PORT || 7313);
const VOFF = String(Number(process.env.VOFF || 0));
const MEDIA = process.env.MEDIA || "";
const MAX = 8 * 1024 * 1024;

const run = (cmd, args) =>
  new Promise((res) => execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => res({ err, out: String(stdout).trim(), errOut: String(stderr).trim() })));

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Vary", "Origin");
}

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  cors(req, res);
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method === "GET" && url.pathname === "/status") {
    const r = await run("lpstat", ["-p", PRINTER]);
    return send(res, r.err ? 503 : 200, { ok: !r.err, printer: PRINTER, state: r.out || r.errOut });
  }
  if (req.method === "POST" && url.pathname === "/print") {
    const [mw, mh] = (MEDIA || `${url.searchParams.get("w") || 54}x${url.searchParams.get("h") || 86}`).split("x").map(Number);
    if (!(mw > 10 && mw < 300 && mh > 10 && mh < 300)) return send(res, 400, { error: "size" });
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX) return send(res, 413, { error: "too large" });
      chunks.push(c);
    }
    const png = Buffer.concat(chunks);
    if (png.subarray(1, 4).toString() !== "PNG") return send(res, 400, { error: "not a png" });
    const dir = mkdtempSync(join(tmpdir(), "card-"));
    const file = join(dir, "card.png");
    try {
      writeFileSync(file, png);
      const r = await run("lp", ["-d", PRINTER, "-o", `media=Custom.${mw}x${mh}mm`, "-o", `VerticalOffset=${VOFF}`, "-o", "ppi=300", file]);
      console.log(new Date().toISOString(), `${mw}x${mh}mm`, r.err ? `failed: ${r.errOut}` : r.out);
      return r.err ? send(res, 502, { error: r.errOut || String(r.err) }) : send(res, 200, { job: r.out });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  send(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`card printer helper on http://127.0.0.1:${PORT} → ${PRINTER}`));

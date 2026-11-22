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
 * The printer: the label printer plugged in NOW — the system's default if it is a NIIMBOT and not offline, else the
 * first NIIMBOT queue that is not offline — looked up for every print, so swapping printers needs no restart (the
 * artist moved from the B21 Pro to the B2 Pro on 2026-11-22; the helper kept sending to the unplugged B21).
 * env: PRINTER (a queue name: always that one), PORT (default 7313), VOFF (driver steps, -20…20: the print up or down on the
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

/** The queue to print on (see the header): PRINTER when set, else the plugged-in NIIMBOT. */
async function printer() {
  if (process.env.PRINTER) return process.env.PRINTER;
  const def = (await run("lpstat", ["-d"])).out.match(/destination:\s*(\S+)/)?.[1] ?? "";
  const queues = (await run("lpstat", ["-p"])).out
    .split(/\n(?=printer )/)
    .map((b) => ({ name: b.match(/^printer (\S+)/)?.[1], offline: /offline/i.test(b) }))
    .filter((q) => q.name);
  const up = (n) => queues.some((q) => q.name === n && !q.offline);
  if (/NIIMBOT/i.test(def) && up(def)) return def;
  return queues.find((q) => /NIIMBOT/i.test(q.name) && !q.offline)?.name || def || "NIIMBOT_B2_Pro";
}
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
    const p = await printer();
    const r = await run("lpstat", ["-p", p]);
    return send(res, r.err ? 503 : 200, { ok: !r.err, printer: p, state: r.out || r.errOut });
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
      const p = await printer();
      const r = await run("lp", ["-d", p, "-o", `media=Custom.${mw}x${mh}mm`, "-o", `VerticalOffset=${VOFF}`, "-o", "ppi=300", file]);
      console.log(new Date().toISOString(), p, `${mw}x${mh}mm`, r.err ? `failed: ${r.errOut}` : r.out);
      return r.err ? send(res, 502, { error: r.errOut || String(r.err) }) : send(res, 200, { job: r.out });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  send(res, 404, { error: "not found" });
});

// AN OLDER HELPER STILL ON THE PORT (2026-11-22: the artist restarted it and got EADDRINUSE — the one started hours
// before still sent to the unplugged printer): if what holds the port is this same helper, it is stopped and this one
// takes its place; anything else on the port is left alone and said
server.on("error", async (err) => {
  if (err.code !== "EADDRINUSE" || server.retried) throw err;
  server.retried = true;
  const pid = (await run("lsof", ["-tiTCP:" + PORT, "-sTCP:LISTEN"])).out.split("\n")[0];
  const cmd = pid ? (await run("ps", ["-o", "command=", "-p", pid])).out : "";
  if (!pid || !/card-printer\/server\.mjs/.test(cmd)) {
    console.error(`port ${PORT} is taken by something else (${cmd || "unknown"}): PORT=<another> node tools/card-printer/server.mjs`);
    process.exit(1);
  }
  console.log(`an older card printer helper (pid ${pid}) held port ${PORT}: stopping it`);
  try {
    process.kill(Number(pid));
  } catch {
    /* already gone */
  }
  setTimeout(() => server.listen(PORT, "127.0.0.1"), 800);
});
server.on("listening", async () => console.log(`card printer helper on http://127.0.0.1:${PORT} → ${await printer()} (looked up again for every print)`));
server.listen(PORT, "127.0.0.1");

/**
 * parliament/plate.ts — the SPECIMEN CARD of one life (the end screen, 2026-11-21): the record card set as a card the
 * visitor can take away, one face in the proportion of the printed card (54 × 86 mm, portrait; thermal transfer, so one
 * side, black on white — the screen shows the same picture, on paper or inverted). The artist (2026-11-21): minimal; the
 * same kinds of information as the card before, still told in sentences; the time axis is the one strong graphic and
 * stands on its own — the telling goes apart from it (no infographic leaders). Greys only (a human trace).
 *
 *   head       the specimen's number (개체 0417), its duration (존속 03:00), and one line anchoring it in the real world:
 *              where (the `venue` parameter, if any) and when the life ended — "세지갤러리 · 2026-12-14 15:42 출토"
 *   worldline  the footprint (footprint.ts' cells) on the top face of a small block, the life hanging under it through
 *              time — later is higher, the end on the surface, the birth at the bottom (the wall's own axis). Walking
 *              is a slanted line, staying a vertical post, thicker the stiller; a dotted plumb line ties each long stay
 *              to its place on the ground; a ruler of the life's minutes on the left. On the gallery machine the QR of
 *              the life's recording stands beside it.
 *   record     the card's rows as they were (script.ts ended: 고유 어휘 · 군집 · 어휘 변화 · 발견 · 구조물 · 이동 · 식생 ·
 *              그만 살기 · 사인), the melodies drawn beside the words; the apparatus's two closing lines
 *
 * plateSvg() draws it 1080 × 1720 (20 px a millimetre): the screen, the saved image and the print are one picture. It
 * reads only what the record and the ledger hold — nothing is made up. Pure.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { GLYPH_COLS, GLYPH_ROWS, individualNo, type GlyphDot } from "./glyph";
import { DEFAULT_LEDGER, type Ledger, type LedgerConfig, type LedgerSummary } from "./ledger";
import { SCRIPT, type Lang } from "./script";
import { fmtClock } from "./session";
import { WORLD_CELLS, nearestImage, wrapDelta } from "./world";

/** The face, in pixels: 54 × 86 mm at 20 px a millimetre. */
export const PLATE_W = 1080;
export const PLATE_H = 1720;

export type PlateCellKind = "press" | "tread" | "path" | "slab";

/** A ground cell of the life (footprint.ts' kinds and alphas). */
export interface PlateCell {
  cx: number;
  cz: number;
  kind: PlateCellKind;
  a: number;
}

export interface PlateInput {
  lang: Lang;
  /** The being's id (its number and its own melody). */
  me: string;
  /** Seconds lived (what 존속 reads). */
  lifeSec: number;
  /** The record's totals (witness.ts summary()). */
  group: readonly string[];
  ensembleSec: number;
  newWords: readonly (readonly GlyphDot[])[];
  asked: number;
  found: readonly string[];
  stillSec: number;
  attempts: number;
  /** Life seconds of the failed tries to stop living (a small cross on the line). */
  attemptsAt: readonly number[];
  /** The ledger's end-screen numbers (ledger.ts ledgerSummary; null: no reading). */
  sum: LedgerSummary | null;
  /** Of the others in my concrete, how many were never near for long. */
  unmet: number;
  /** Cause of death, named in `lang`. */
  cause: string;
  /** Where (null: no venue) and when (wall ms) the life ended. */
  venue: string | null;
  endedAt: number;
  /** The trail (world coordinates, life seconds) and the ground cells. */
  trail: readonly { x: number; z: number; t: number }[];
  cells: readonly PlateCell[];
  /** The gallery machine: the QR slot (`modules` = the code, qr.ts qrModules, once there is a recording). null: no slot. */
  qr: { modules?: boolean[][] | null } | null;
}

/** The ledger's ground cells as the footprint map classes them (footprint.ts footprintLayout, the same rules). */
export function plateCells(l: Ledger, cfg: LedgerConfig = DEFAULT_LEDGER): PlateCell[] {
  const out: PlateCell[] = [];
  for (const c of l.cells.values()) {
    if (c.sPeak >= cfg.pressS) out.push({ cx: c.cx, cz: c.cz, kind: "press", a: c.grass > 0 ? Math.min(1, c.pressPeak / c.grass) : 1 });
    if (c.trodT !== null) {
      out.push({ cx: c.cx, cz: c.cz, kind: "tread", a: Math.min(1, c.g / 3) });
      if (c.pathP >= cfg.pathP) out.push({ cx: c.cx, cz: c.cz, kind: "path", a: c.pathP });
    }
    if (c.slab) out.push({ cx: c.cx, cz: c.cz, kind: "slab", a: 1 });
  }
  return out;
}

// ── faces of type ────────────────────────────────────────────────────────────

/** The type faces the card can be set in (Leva); the files are in public/fonts. */
export type PlateFont = "neodgm" | "galmuri11" | "galmuri9" | "galmuriMono11" | "pretendard";

export const PLATE_FONTS: Record<PlateFont, { family: string; file: string; label: string; wide: number; narrow: number }> = {
  neodgm: { family: "NeoDunggeunmo", file: "/fonts/neodgm.woff2", label: "Neo둥근모", wide: 1, narrow: 0.5 },
  galmuri11: { family: "Galmuri11", file: "/fonts/Galmuri11.woff2", label: "갈무리11", wide: 1, narrow: 0.55 },
  galmuri9: { family: "Galmuri9", file: "/fonts/Galmuri9.woff2", label: "갈무리9", wide: 1, narrow: 0.55 },
  galmuriMono11: { family: "GalmuriMono11", file: "/fonts/GalmuriMono11.woff2", label: "갈무리 모노11", wide: 1, narrow: 0.5 },
  pretendard: { family: "Pretendard", file: "/fonts/Pretendard-Regular.woff2", label: "프리텐다드", wide: 0.92, narrow: 0.56 },
};
export const DEFAULT_PLATE_FONT: PlateFont = "galmuri11";

// ── drawing ──────────────────────────────────────────────────────────────────

const M = 72;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

const isWide = (c: number) => c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60));

/** About how wide a line is in a face: Hangul and other wide letters `wide` em, the rest `narrow`. */
export function textWidth(s: string, size: number, font: PlateFont = DEFAULT_PLATE_FONT): number {
  const f = PLATE_FONTS[font];
  let em = 0;
  for (const ch of s) em += isWide(ch.codePointAt(0) ?? 0) ? f.wide : f.narrow;
  return em * size;
}

/** Break a line to fit `maxW`: between its " · " parts where it can, else at spaces; a line never starts with "·". */
export function wrapText(s: string, size: number, maxW: number, font: PlateFont = DEFAULT_PLATE_FONT): string[] {
  const fits = (l: string) => textWidth(l, size, font) <= maxW;
  const lines: string[] = [];
  let cur = "";
  for (const part of s.split(" · ")) {
    const next = cur ? `${cur} · ${part}` : part;
    if (fits(next)) {
      cur = next;
      continue;
    }
    if (cur) lines.push(`${cur} ·`);
    cur = "";
    // a part too long for a line of its own: at spaces
    for (const w of part.split(" ")) {
      const n = cur ? `${cur} ${w}` : w;
      if (cur && !fits(n)) {
        lines.push(cur);
        cur = w;
      } else cur = n;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const text = (x: number, y: number, s: string, size: number, fill: string, anchor: "start" | "end" = "start") =>
  `<text x="${f1(x)}" y="${f1(y)}" font-size="${size}" fill="${fill}"${anchor === "end" ? ` text-anchor="end"` : ""}>${esc(s)}</text>`;

/** A melody as Glyph.tsx draws it: each note a bar as long as it lasts, a high voice high in the box. */
function glyph(dots: readonly GlyphDot[], x: number, y: number, cell: number, fill: string): string {
  const gap = Math.max(1, cell * 0.12);
  return `<g fill="${fill}" shape-rendering="crispEdges">${dots
    .map((d) => `<rect x="${f1(x + d.col * cell)}" y="${f1(y + d.row * cell)}" width="${f1(d.len * cell - gap)}" height="${f1(cell - gap)}"/>`)
    .join("")}</g>`;
}

/** 2026-12-14 15:42 (local time). */
function stamp(ms: number): string {
  const d = new Date(ms);
  const two = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Paper (the printed card: thermal transfer, black on white) or screen (light on the end screen's black). */
export type PlateTheme = "paper" | "screen";

interface Palette {
  bg: string;
  ink: string;
  dim: string;
  faint: string;
  slab: string;
}

const PALETTES: Record<PlateTheme, Palette> = {
  paper: { bg: "#ffffff", ink: "#111111", dim: "#5e5e5a", faint: "#b4b4ae", slab: "#6a6a66" },
  screen: { bg: "#0a0a0a", ink: "#ebebe7", dim: "#9a9b96", faint: "#56574f", slab: "#bbbbbb" },
};

/** One row of the record: a label and its words, a melody after them when it has one. */
interface Row {
  label: string;
  words: string;
  dots?: readonly GlyphDot[];
  big?: boolean;
}

/** Portrait (54 × 86 mm) or landscape (86 × 54 mm): the same card turned, laid out anew. */
export type PlateOrient = "portrait" | "landscape";

/** The card's size in pixels (20 px a millimetre). */
export function plateSize(orient: PlateOrient = "portrait"): { w: number; h: number } {
  return orient === "landscape" ? { w: PLATE_H, h: PLATE_W } : { w: PLATE_W, h: PLATE_H };
}

/** The card (see the header). `glyphOf` names the others' melodies (glyph.ts glyphOf). Portrait: the head across the
 * top, the worldline under it, the record at the foot. Landscape: the worldline standing the card's full height on the
 * left, the head and the record in a column on the right. */
export function plateSvg(
  p: PlateInput,
  glyphOf: (id: string) => GlyphDot[],
  opts: { font?: PlateFont; theme?: PlateTheme; orient?: PlateOrient; fontCss?: string } = {},
): string {
  const font = opts.font ?? DEFAULT_PLATE_FONT;
  const C = PALETTES[opts.theme ?? "paper"];
  const land = opts.orient === "landscape";
  const { w: W, h: H } = plateSize(opts.orient);
  const S = SCRIPT[p.lang].ended;
  const out: string[] = [];
  /** The column the head and the record are set in. */
  const x0 = land ? 868 : M, x1 = W - M;

  // ── head: which being, how long, where and when ──
  const life = fmtClock(p.lifeSec);
  out.push(text(x0, 128, S.who(individualNo(p.me)), 60, C.ink));
  // 존속 and its time as one line the browser sets (no guessing at the face's widths)
  out.push(`<text x="${x1}" y="128" text-anchor="end"><tspan font-size="28" fill="${C.dim}">${esc(S.life)}</tspan><tspan font-size="60" fill="${C.ink}" dx="16">${esc(life)}</tspan></text>`);
  out.push(text(x0, 182, S.unearthed(p.venue, stamp(p.endedAt)), 30, C.dim));

  // ── the record ──
  const sum = p.sum;
  const rows: Row[] = [{ label: S.own, words: "", dots: glyphOf(p.me) }];
  rows.push({ label: S.group, words: S.groupRow(p.group.length, p.ensembleSec) });
  rows.push({ label: S.word, words: S.wordRow(p.newWords.length, p.asked), dots: p.newWords.length ? p.newWords[p.newWords.length - 1] : undefined });
  if (p.found.length) rows.push({ label: S.found, words: S.foundRow(individualNo(p.found[0]), p.found.length - 1), dots: glyphOf(p.found[0]) });
  rows.push({ label: S.built, words: S.builtRow(sum?.slabs ?? 0, sum?.with.length ?? 0, p.unmet) });
  rows.push({ label: S.moved, words: S.movedRow(sum, p.stillSec) });
  rows.push({ label: S.veg, words: S.vegRow(sum) });
  if (p.attempts > 0) rows.push({ label: S.stop, words: S.tried(p.attempts) });
  rows.push({ label: S.cause, words: p.cause, big: true });

  const LS = 26, SIZE = 30, LINE = 41, GAP = land ? 10 : 12, CELL = 7;
  const labelW = Math.min(250, Math.max(...rows.map((r) => textWidth(r.label, LS, font))) + 26);
  const textX = x0 + labelW, maxW = x1 - textX;
  const gw = GLYPH_COLS * CELL, gh = GLYPH_ROWS * CELL;
  const laid = rows.map((r) => {
    const size = r.big ? 44 : SIZE, line = r.big ? 54 : LINE;
    const lines = r.words ? wrapText(r.words, size, maxW, font) : [];
    let h = Math.max(1, lines.length) * line;
    let g: [number, number] | null = null;
    if (r.dots) {
      // the melody after the last line (the row grows to hold it), or on a line of its own when it does not fit
      const last = lines[lines.length - 1] ?? "";
      const end = last ? textWidth(last, size, font) + 18 : 0;
      const row = Math.max(0, lines.length - 1);
      if (end + gw <= maxW) {
        g = [textX + end, row * line + (line - gh) / 2 - 4];
        h = Math.max(h, row * line + gh + 2);
      } else {
        g = [textX, lines.length * line + 4];
        h = lines.length * line + gh + 8;
      }
    }
    return { r, size, line, lines, h, g };
  });
  const recH = laid.reduce((a, l) => a + l.h + GAP, -GAP);
  const foot = [S.kept, S.read].flatMap((s) => wrapText(s, 24, x1 - x0, font));
  const footTop = H - M - (foot.length - 1) * 34 - 24;
  // portrait: the record stands on the foot; landscape: it hangs from the head
  const recTop = land ? 262 : footTop - 44 - recH;
  let y = recTop;
  out.push(`<path d="M${x0} ${f1(recTop - 22)}H${x1}" stroke="${C.faint}" stroke-width="1.5"/>`);
  for (const l of laid) {
    out.push(text(x0, y + (l.r.big ? 36 : 30), l.r.label, LS, C.dim));
    l.lines.forEach((s, i) => out.push(text(textX, y + (l.r.big ? 40 : 31) + i * l.line, s, l.size, C.ink)));
    if (l.r.dots && l.g) out.push(glyph(l.r.dots, l.g[0], y + l.g[1], CELL, C.ink));
    y += l.h + GAP;
  }
  foot.forEach((s, i) => out.push(text(x0, H - M - (foot.length - 1 - i) * 34, s, 24, i === 0 ? C.ink : C.dim)));

  // ── the worldline; on the gallery machine the recording's QR beside it ──
  const gallery = p.qr !== null;
  const QR = land ? 220 : 250;
  const qrX = (land ? 800 : W - M) - QR;
  const fig = land ? { left: 214, top: 104, bottom: H - 104 } : { left: 214, top: 250, bottom: recTop - 66 };
  out.push(worldline(p, { ...fig, right: gallery ? qrX - 24 : land ? 800 : W - M - 30 }, C));
  if (gallery) {
    const x = qrX, qy = fig.bottom - QR;
    out.push(text(x, qy - 50, S.recording, 24, C.dim), text(x, qy - 18, S.recordingNote, 22, C.dim));
    const mods = p.qr?.modules;
    if (mods) {
      // dark on light whatever the paper (a code reads that way), with its quiet zone
      const n = mods.length + 8;
      let d = "";
      mods.forEach((row, my) => row.forEach((on, mx) => on && (d += `M${mx + 4} ${my + 4}h1v1h-1z`)));
      out.push(`<svg x="${x}" y="${qy}" width="${QR}" height="${QR}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#ffffff"/><path d="${d}" fill="#111111"/></svg>`);
    } else {
      const k = 26;
      out.push(`<path d="M${x} ${qy + k}V${qy}H${x + k}M${x + QR - k} ${qy}H${x + QR}V${qy + k}M${x + QR} ${qy + QR - k}V${qy + QR}H${x + QR - k}M${x + k} ${qy + QR}H${x}V${qy + QR - k}" stroke="${C.dim}" stroke-width="2" fill="none"/>`);
    }
  }

  const family = `${PLATE_FONTS[font].family}, NeoDunggeunmo, monospace`;
  const style = opts.fontCss ? `<style>${opts.fontCss}</style>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(family)}">${style}<rect width="${W}" height="${H}" fill="${C.bg}"/>${out.join("")}</svg>`;
}

// ── the worldline ────────────────────────────────────────────────────────────

const C45 = Math.SQRT1_2;
/** How much the ground is squashed in the drawing (1 = seen from straight above, turned 45°). */
const SQUASH = 0.5;
/** Slower than this (world units / s) counts as staying. */
const STAY_SPEED = 0.6;
/** A stay this long gets a plumb line to its place on the ground. */
const STAY_SEC = 4;
const KIND_ORDER: Record<PlateCellKind, number> = { press: 0, tread: 1, path: 2, slab: 3 };

function worldline(p: PlateInput, box: { left: number; right: number; top: number; bottom: number }, C: Palette): string {
  // the trail unwrapped step by step (the world wraps, world.ts): one line, however far it went
  const pts: { u: number; v: number; t: number }[] = [];
  let px = 0, pz = 0;
  for (const q of p.trail) {
    const prev = pts[pts.length - 1];
    pts.push({ u: prev ? prev.u + wrapDelta(q.x - px) / CELL_SIZE : q.x / CELL_SIZE, v: prev ? prev.v + wrapDelta(q.z - pz) / CELL_SIZE : q.z / CELL_SIZE, t: q.t });
    px = q.x;
    pz = q.z;
  }
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  const grow = (u: number, v: number) => {
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  };
  for (const q of pts) grow(q.u, q.v);
  // the cells at every place they show within the trail's reach (where the trail went round the world, twice)
  const cells: (PlateCell & { u: number; v: number })[] = [];
  {
    const pad = 3;
    const reach = pts.length ? [u0 - pad, u1 + pad, v0 - pad, v1 + pad] : null;
    const ref = p.cells[0];
    const images = (x: number, a: number, b: number) => {
      const ks: number[] = [];
      for (let k = Math.ceil((a - x) / WORLD_CELLS); x + k * WORLD_CELLS <= b; k++) ks.push(k);
      return ks;
    };
    for (const c of p.cells) {
      let cu = c.cx + 0.5, cv = c.cz + 0.5;
      if (!reach) {
        cu = nearestImage(cu * CELL_SIZE, (ref.cx + 0.5) * CELL_SIZE) / CELL_SIZE;
        cv = nearestImage(cv * CELL_SIZE, (ref.cz + 0.5) * CELL_SIZE) / CELL_SIZE;
        cells.push({ ...c, u: cu, v: cv });
        continue;
      }
      for (const ku of images(cu, reach[0], reach[1])) for (const kv of images(cv, reach[2], reach[3])) cells.push({ ...c, u: cu + ku * WORLD_CELLS, v: cv + kv * WORLD_CELLS });
    }
    for (const c of cells) {
      grow(c.u - 0.5, c.v - 0.5);
      grow(c.u + 0.5, c.v + 0.5);
    }
    cells.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  }
  if (!Number.isFinite(u0)) (u0 = v0 = -4), (u1 = v1 = 4);
  // square, like the footprint map: every life's block the same shape, the footprint centred on its top face
  const side = Math.max(8, u1 - u0 + 2, v1 - v0 + 2);
  const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
  u0 = mu - side / 2;
  u1 = mu + side / 2;
  v0 = mv - side / 2;
  v1 = mv + side / 2;
  const tEnd = Math.max(p.lifeSec, pts.length ? pts[pts.length - 1].t : 0, 1);

  // the scale: as wide as the box allows; the depth takes the rest of its height
  const span = 2 * side * C45;
  const s = Math.min((box.right - box.left) / span, (0.26 * (box.bottom - box.top)) / (span * SQUASH), 60);
  const faceH = span * s * SQUASH;
  const depth = Math.max(300, Math.min(900, box.bottom - box.top - faceH));
  const k = depth / tEnd;
  const xMid = (box.left + box.right) / 2;
  const X0 = xMid - ((u0 - v1 + (u1 - v0)) / 2) * C45 * s;
  const Y0 = box.top + Math.max(0, (box.bottom - box.top - faceH - depth) / 2) + (u1 + v1) * C45 * s * SQUASH;
  const sx = (u: number, v: number) => X0 + (u - v) * C45 * s;
  const sy = (u: number, v: number, t: number) => Y0 - (u + v) * C45 * s * SQUASH + (tEnd - t) * k;
  const pt = (u: number, v: number, t: number) => `${f1(sx(u, v))} ${f1(sy(u, v, t))}`;

  const out: string[] = [];
  // the block, quiet: the near edges down to the birth, the far ones dashed
  out.push(`<path d="M${pt(u1, v1, tEnd)}L${pt(u1, v1, 0)}M${pt(u0, v1, 0)}L${pt(u1, v1, 0)}L${pt(u1, v0, 0)}" stroke="${C.faint}" stroke-width="1.2" stroke-dasharray="3 9" fill="none"/>`);
  out.push(`<path d="M${pt(u0, v1, tEnd)}L${pt(u0, v1, 0)}L${pt(u0, v0, 0)}L${pt(u1, v0, 0)}L${pt(u1, v0, tEnd)}M${pt(u0, v0, tEnd)}L${pt(u0, v0, 0)}" stroke="${C.faint}" stroke-width="1.5" fill="none"/>`);
  // the strata: every minute (half minute in a short life) the near edges of that moment's layer
  const step = tEnd >= 120 ? 60 : 30;
  for (let t = step; t < tEnd - 1; t += step) out.push(`<path d="M${pt(u0, v1, t)}L${pt(u0, v0, t)}L${pt(u1, v0, t)}" stroke="${C.faint}" stroke-width="1.2" stroke-dasharray="2 10" fill="none"/>`);
  // the ground on the top face: the cells, the trail from above, the face's edge
  const SHADE: Record<PlateCellKind, (a: number) => string> = {
    press: (a) => `fill="${C.ink}" fill-opacity="${(0.08 + 0.2 * a).toFixed(3)}"`,
    tread: () => `fill="${C.ink}" fill-opacity="0.26"`,
    path: (a) => `fill="${C.ink}" fill-opacity="${(0.4 + 0.3 * a).toFixed(3)}"`,
    slab: () => `fill="${C.slab}" stroke="${C.ink}" stroke-width="1"`,
  };
  for (const c of cells) out.push(`<path d="M${pt(c.u - 0.5, c.v - 0.5, tEnd)}L${pt(c.u + 0.5, c.v - 0.5, tEnd)}L${pt(c.u + 0.5, c.v + 0.5, tEnd)}L${pt(c.u - 0.5, c.v + 0.5, tEnd)}Z" ${SHADE[c.kind](c.a)}/>`);
  if (pts.length > 1) out.push(`<path d="M${pts.map((q) => pt(q.u, q.v, tEnd)).join("L")}" stroke="${C.ink}" stroke-width="1.2" fill="none" opacity="0.55" stroke-linejoin="round"/>`);
  out.push(`<path d="M${pt(u0, v1, tEnd)}L${pt(u1, v1, tEnd)}L${pt(u1, v0, tEnd)}L${pt(u0, v0, tEnd)}Z" stroke="${C.ink}" stroke-width="1.5" fill="none" opacity="0.6"/>`);

  // how still I was at each reading (0 walking … 1 staying), over ±2 s
  const still = pts.map((q, i) => {
    let a = i, b = i;
    while (a > 0 && q.t - pts[a - 1].t <= 2) a--;
    while (b < pts.length - 1 && pts[b + 1].t - q.t <= 2) b++;
    const dt = pts[b].t - pts[a].t;
    if (dt <= 0) return 1;
    const sp = (Math.hypot(pts[b].u - pts[a].u, pts[b].v - pts[a].v) * CELL_SIZE) / dt;
    return Math.max(0, Math.min(1, 1 - sp / STAY_SPEED));
  });
  // the long stays: a dotted plumb line from the top of each post up to its place on the ground
  for (let i = 0; i < pts.length; ) {
    if (still[i] < 0.75) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < pts.length && still[j + 1] >= 0.75) j++;
    if (pts[j].t - pts[i].t >= STAY_SEC && tEnd - pts[j].t > 2) out.push(`<path d="M${pt(pts[j].u, pts[j].v, pts[j].t)}L${pt(pts[j].u, pts[j].v, tEnd)}" stroke="${C.ink}" stroke-width="1.2" stroke-dasharray="2 7" opacity="0.4"/>`);
    i = j + 1;
  }
  // the worldline: thicker the stiller, in runs of one weight
  const W = [3, 5, 7.5, 10];
  const wOf = (i: number) => W[Math.min(W.length - 1, Math.floor(still[i] * W.length))];
  for (let i = 0; i < pts.length - 1; ) {
    const w = wOf(i);
    let j = i + 1;
    while (j < pts.length - 1 && wOf(j) === w) j++;
    out.push(`<path d="M${pts.slice(i, j + 1).map((q) => pt(q.u, q.v, q.t)).join("L")}" stroke="${C.ink}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    i = j;
  }
  // the tries to stop living: a small cross on the line
  for (const t of p.attemptsAt) {
    if (!pts.length) break;
    const q = pts.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
    const x = sx(q.u, q.v), y = sy(q.u, q.v, q.t);
    const d = `M${f1(x - 11)} ${f1(y - 11)}L${f1(x + 11)} ${f1(y + 11)}M${f1(x + 11)} ${f1(y - 11)}L${f1(x - 11)} ${f1(y + 11)}`;
    out.push(`<path d="${d}" stroke="${C.bg}" stroke-width="8"/><path d="${d}" stroke="${C.ink}" stroke-width="2.5"/>`);
  }
  // the birth (an open ring at the bottom) and the end (a white square on the surface)
  if (pts.length) {
    const b = pts[0], e = pts[pts.length - 1];
    out.push(`<circle cx="${f1(sx(b.u, b.v))}" cy="${f1(sy(b.u, b.v, b.t))}" r="10" fill="${C.bg}" stroke="${C.ink}" stroke-width="3"/>`);
    out.push(`<rect x="${f1(sx(e.u, e.v) - 10)}" y="${f1(sy(e.u, e.v, tEnd) - 10)}" width="20" height="20" fill="${C.ink}"/>`);
  }
  // the ruler of the life's time, left of the block: 00:00 at the birth, the end level with the top face's left corner
  const lx = sx(u0, v1), ly = sy(u0, v1, tEnd);
  const rx = Math.max(M + 100, lx - 64);
  const rBot = ly + tEnd * k;
  out.push(`<path d="M${f1(rx)} ${f1(ly)}V${f1(rBot)}" stroke="${C.dim}" stroke-width="1.5"/>`);
  for (let t = 0; t <= tEnd + 0.001; t += 10) {
    const y = rBot - t * k;
    const major = t % step === 0;
    out.push(`<path d="M${f1(rx)} ${f1(y)}h${major ? 18 : 9}" stroke="${C.dim}" stroke-width="1.5"/>`);
    if (major && tEnd - t > 8) out.push(text(rx - 16, y + 10, fmtClock(t), 28, C.dim, "end"));
  }
  out.push(`<path d="M${f1(rx - 10)} ${f1(ly)}h22" stroke="${C.ink}" stroke-width="2"/>`);
  out.push(text(rx - 16, ly + 10, fmtClock(tEnd), 28, C.ink, "end"));
  return out.join("");
}

/**
 * parliament/plate.ts — the SPECIMEN CARD of one life (the end screen; laid out on the design canvas and approved by the
 * artist, 2026-11-21). Minimal: the life's worldline on its time axis, the being's name (its melody), its number, and the
 * QR of its recording — nothing else (the record's sentences stay on the end screen's record card). Printed on one side of
 * thermal transfer paper, 54 × 86 mm, or turned, 86 × 54; on white or on black paper. The visitor picks both.
 *
 *   portrait   the worldline across the top; at the foot the melody over the number on the left, the QR on the right
 *   landscape  the worldline the card's full height on the left; a column on the right with the QR at its top, the
 *              melody and the number at its foot
 *
 * Every element meets the margin lines by its visible edge, not by its box (the artist, 2026-11-21): the worldline is
 * cropped to what it draws (the ruler's labels on the left line, the block's corner on the right one); on white the QR is
 * its dark modules (its quiet zone is the paper), on black its light square; the number stands on its digits' own foot and
 * right edge, not on the face's line box.
 *
 *   worldline  the footprint (footprint.ts' cells) on the top face of a small block, the life hanging under it through
 *              time — later is higher, the end on the surface, the birth at the bottom (the wall's own axis). Walking
 *              is a slanted line, staying a vertical post, thicker the stiller; a dotted plumb line ties each long stay
 *              to its place on the ground; a ruler of the life's minutes on the left
 *
 * plateSvg() draws it 1080 × 1720 (20 units a millimetre): the screen, the saved image and the print are one picture.
 * It reads only what the record and the ledger hold — nothing is made up. Pure.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { GLYPH_COLS, individualNo, type GlyphDot } from "./glyph";
import { DEFAULT_LEDGER, type Ledger, type LedgerConfig, type LedgerSummary } from "./ledger";
import type { Lang } from "./script";
import { fmtClock } from "./session";
import { WORLD_CELLS, nearestImage, wrapDelta } from "./world";

/** The face, in card units: 54 × 86 mm at 20 a millimetre. */
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

/** What the card is made from: the record and the ledger at the end. The card draws the trail, the cells, the being and
 * the QR; the rest is the record kept with it (the archive, /api/lives). */
export interface PlateInput {
  lang: Lang;
  /** The being's id (its number and its own melody). */
  me: string;
  /** Seconds lived. */
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
  /** The QR of the life's recording (qr.ts qrModules); null while there is none (its place is kept). */
  qr: boolean[][] | null;
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

/** The card's one face (Galmuri 2.40, Lee Minseo, SIL OFL 1.1; public/fonts, CREDITS.md): the number and the ruler. */
export const PLATE_FACE = { family: "GalmuriMono11", file: "/fonts/GalmuriMono11.woff2" } as const;

/** GalmuriMono11's digits (1200 units an em): every glyph advances half an em; a digit's ink runs from 100 to 1100
 * units over the baseline and from the left edge to 100 units short of its advance. */
const DIGIT = { adv: 600 / 1200, top: 1100 / 1200, foot: 100 / 1200, bearing: 100 / 1200 };

// ── drawing ──────────────────────────────────────────────────────────────────

/** The worldline's ruler keeps this far in from its drawing's edge. */
const M = 72;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

const text = (x: number, y: number, s: string, size: number, fill: string, anchor: "start" | "end" = "start") =>
  `<text x="${f1(x)}" y="${f1(y)}" font-size="${size}" fill="${fill}"${anchor === "end" ? ` text-anchor="end"` : ""}>${esc(s)}</text>`;

/** A melody as Glyph.tsx draws it: each note a bar as long as it lasts, a high voice high in the box. */
function glyph(dots: readonly GlyphDot[], x: number, y: number, cell: number, fill: string): string {
  const gap = Math.max(1, cell * 0.12);
  return `<g fill="${fill}" shape-rendering="crispEdges">${dots
    .map((d) => `<rect x="${f1(x + d.col * cell)}" y="${f1(y + d.row * cell)}" width="${f1(d.len * cell - gap)}" height="${f1(cell - gap)}"/>`)
    .join("")}</g>`;
}

/** Paper (white, the greys of the screen) or screen (light on black: the black card); and for the thermal printer, one
 * ink only: print (black on white) and printBlack (the black card, printed solid) — every line in the one ink, the
 * ground's faint fills left out (they would come out as blots), only the paths and the concrete on the top face. */
export type PlateTheme = "paper" | "screen" | "print" | "printBlack";

/** The one-ink theme for printing a card shown on `theme`. */
export const printTheme = (theme: PlateTheme): PlateTheme => (theme === "screen" || theme === "printBlack" ? "printBlack" : "print");

/** A black card (the screen's or the print's). */
const isBlack = (theme: PlateTheme) => theme === "screen" || theme === "printBlack";

interface Palette {
  bg: string;
  ink: string;
  dim: string;
  faint: string;
  slab: string;
  /** One ink: no faint fills. */
  oneInk?: boolean;
}

const PALETTES: Record<PlateTheme, Palette> = {
  paper: { bg: "#ffffff", ink: "#111111", dim: "#5e5e5a", faint: "#b4b4ae", slab: "#6a6a66" },
  screen: { bg: "#0a0a0a", ink: "#ebebe7", dim: "#9a9b96", faint: "#56574f", slab: "#bbbbbb" },
  print: { bg: "#ffffff", ink: "#000000", dim: "#000000", faint: "#000000", slab: "#ffffff", oneInk: true },
  printBlack: { bg: "#000000", ink: "#ffffff", dim: "#ffffff", faint: "#ffffff", slab: "#000000", oneInk: true },
};

/** Portrait (54 × 86 mm) or landscape (86 × 54 mm): the same card turned, laid out anew. */
export type PlateOrient = "portrait" | "landscape";

/** The card's size in card units (20 a millimetre). */
export function plateSize(orient: PlateOrient = "portrait"): { w: number; h: number } {
  return orient === "landscape" ? { w: PLATE_H, h: PLATE_W } : { w: PLATE_W, h: PLATE_H };
}

// ── the card ─────────────────────────────────────────────────────────────────

/** The card's margin (4 mm), the gap between the worldline and the foot under it (portrait). */
const MARGIN = 80;
const GAP = 80;
/** The melody's box (8 × 8 notes) and the number's size. */
const NAME_BOX = 144;
const NUMBER_SIZE = 96;
/** A QR module, in card units, for a code of 29 modules (a recording's address); a code with more modules gets smaller
 * ones, so the code stays about as large. */
const QR_MODULE = { portrait: 14, landscape: 16 } as const;
const QR_REF = 29;
/** The worldline's shape (width over height) on every card: the white portrait's, where it fills the width. */
const FIG_ASPECT = 460 / 537;

/** The card (see the header). `glyphOf` gives a being's melody (glyph.ts glyphOf). `fontCss`: an @font-face to embed
 * (the saved image loads nothing from outside). */
export function plateSvg(
  p: PlateInput,
  glyphOf: (id: string) => GlyphDot[],
  opts: { theme?: PlateTheme; orient?: PlateOrient; fontCss?: string } = {},
): string {
  const theme = opts.theme ?? "paper";
  const C = PALETTES[theme];
  const black = isBlack(theme);
  const land = opts.orient === "landscape";
  const { w: W, h: H } = plateSize(opts.orient);
  const out: string[] = [];

  // the QR's visible square: its modules on white, its light square (with the quiet zone) on black
  const n = p.qr?.length ?? QR_REF;
  const q = Math.max(1, Math.round((QR_MODULE[land ? "landscape" : "portrait"] * QR_REF) / n));
  const qrSide = (black ? n + 8 : n) * q;
  const qrX = W - MARGIN - qrSide;
  const qrY = land ? MARGIN : H - MARGIN - qrSide;

  // the worldline, its drawn extent on the margins: top left, as wide as the card lets it (portrait), as tall (landscape)
  const figH = land ? H - 2 * MARGIN : Math.min(H - 2 * MARGIN - qrSide - GAP, (W - 2 * MARGIN) / FIG_ASPECT);
  const fig = figure(p, C, FIG_ASPECT);
  const [bx, by, bw, bh] = fig.vb;
  out.push(`<svg x="${MARGIN}" y="${MARGIN}" width="${f1(figH * FIG_ASPECT)}" height="${f1(figH)}" viewBox="${f1(bx)} ${f1(by)} ${f1(bw)} ${f1(bh)}" overflow="visible">${fig.body}</svg>`);

  // the name: the melody's box, its top level with the QR's (portrait) or its foot on the bottom margin (landscape)
  const nameX = land ? qrX : MARGIN;
  const nameY = land ? H - MARGIN - NAME_BOX : qrY;
  out.push(glyph(glyphOf(p.me), nameX, nameY, NAME_BOX / GLYPH_COLS, C.ink));
  // the number: its digits' foot on the bottom margin; left on the margin (portrait), right on it (landscape)
  const base = H - MARGIN + DIGIT.foot * NUMBER_SIZE;
  const num = individualNo(p.me);
  out.push(land ? text(W - MARGIN + DIGIT.bearing * NUMBER_SIZE, base, num, NUMBER_SIZE, C.ink, "end") : text(MARGIN, base, num, NUMBER_SIZE, C.ink));

  // the QR, dark on light whatever the paper (a code reads that way); on white the paper is its quiet zone
  if (p.qr) {
    let d = "";
    const o = black ? 4 : 0;
    p.qr.forEach((row, my) => row.forEach((on, mx) => on && (d += `M${mx + o} ${my + o}h1v1h-1z`)));
    const side = black ? n + 8 : n;
    out.push(
      `<svg x="${qrX}" y="${qrY}" width="${qrSide}" height="${qrSide}" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">${
        black ? `<rect width="${side}" height="${side}" fill="${C.ink}"/><path d="${d}" fill="${C.bg}"/>` : `<path d="${d}" fill="${C.ink}"/>`
      }</svg>`,
    );
  } else if (!C.oneInk) {
    // no recording yet: the code's place, its corners (on the screen only; the print leaves it blank)
    const k = Math.round(qrSide * 0.12), x = qrX, y = qrY, s = qrSide;
    out.push(`<path d="M${x} ${y + k}V${y}H${x + k}M${x + s - k} ${y}H${x + s}V${y + k}M${x + s} ${y + s - k}V${y + s}H${x + s - k}M${x + k} ${y + s}H${x}V${y + s - k}" stroke="${C.dim}" stroke-width="${HAIR}" fill="none"/>`);
  }

  const style = opts.fontCss ? `<style>${opts.fontCss}</style>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${PLATE_FACE.family}, monospace">${style}<rect width="${W}" height="${H}" fill="${C.bg}"/>${out.join("")}</svg>`;
}

/** The worldline is drawn in a box this wide and cropped to what it draws. */
const FIG_DRAW_W = 900;
const figureCache = new WeakMap<PlateInput, Map<number, number>>();

/** The worldline drawn so that its drawn extent has the shape `aspect` (width over height): the box it is drawn in is
 * sought (its height changes the time's depth against the top face), then cropped to the extent. Cached per life. */
function figure(p: PlateInput, C: Palette, aspect: number): { body: string; vb: [number, number, number, number] } {
  const draw = (h: number) => worldline(p, { left: 214, right: FIG_DRAW_W - 16, top: 16, bottom: h - 16 }, C, { face: 0.38 });
  let known = figureCache.get(p);
  if (!known) figureCache.set(p, (known = new Map()));
  let h = known.get(aspect);
  if (h === undefined) {
    // the higher the box, the deeper the time and the narrower the drawing
    let lo = 600, hi = 1600;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const b = drawnBounds(draw(mid));
      if (b[2] / b[3] > aspect) lo = mid;
      else hi = mid;
    }
    h = (lo + hi) / 2;
    known.set(aspect, h);
  }
  const body = draw(h);
  return { body, vb: drawnBounds(body) };
}

/** What a drawing covers — its strokes (with their widths), marks and labels — read back from the SVG it is: x, y, w, h. */
function drawnBounds(svg: string): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number, r = 0) => {
    x0 = Math.min(x0, x - r);
    y0 = Math.min(y0, y - r);
    x1 = Math.max(x1, x + r);
    y1 = Math.max(y1, y + r);
  };
  for (const m of svg.matchAll(/<path d="([^"]*)"([^>]*)\/>/g)) {
    const r = /stroke="(?!none)/.test(m[2]) ? Number(m[2].match(/stroke-width="([\d.]+)"/)?.[1] ?? 1) / 2 : 0;
    let cx = 0, cy = 0;
    for (const c of m[1].matchAll(/([MLHVZhvl])([^MLHVZhvl]*)/g)) {
      const v = (c[2].match(/-?[\d.]+/g) ?? []).map(Number);
      switch (c[1]) {
        case "M":
        case "L":
          for (let i = 0; i + 1 < v.length; i += 2) add((cx = v[i]), (cy = v[i + 1]), r);
          break;
        case "l":
          for (let i = 0; i + 1 < v.length; i += 2) add((cx += v[i]), (cy += v[i + 1]), r);
          break;
        case "H":
          for (const a of v) add((cx = a), cy, r);
          break;
        case "V":
          for (const a of v) add(cx, (cy = a), r);
          break;
        case "h":
          for (const a of v) add((cx += a), cy, r);
          break;
        case "v":
          for (const a of v) add(cx, (cy += a), r);
          break;
      }
    }
  }
  for (const m of svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"[^>]*stroke-width="([\d.]+)"/g)) add(+m[1], +m[2], +m[3] + +m[4] / 2);
  for (const m of svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
    add(+m[1], +m[2]);
    add(+m[1] + +m[3], +m[2] + +m[4]);
  }
  // the labels (the ruler's minutes, in the card's mono face): their digits' ink
  for (const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)"([^>]*)>([^<]*)<\/text>/g)) {
    const x = +m[1], y = +m[2], fs = +m[3], wd = [...m[5]].length * DIGIT.adv * fs, end = /text-anchor="end"/.test(m[4]);
    add(end ? x - wd : x, y - DIGIT.top * fs);
    add((end ? x : x + wd) - DIGIT.bearing * fs, y - DIGIT.foot * fs);
  }
  if (!Number.isFinite(x0)) return [0, 0, 1, 1];
  return [x0, y0, x1 - x0, y1 - y0];
}

// ── the worldline ────────────────────────────────────────────────────────────

const C45 = Math.SQRT1_2;
/** How much the ground is squashed in the drawing (1 = seen from straight above, turned 45°). */
const SQUASH = 0.5;
/** Line weights, in the card's units (20 a millimetre). The thermal printer's dot is 300 dpi, about 1.7 units, and a
 * line under two dots breaks up or vanishes on the label (the first prints, 2026-11-21): no line is thinner than HAIR, and
 * the block's own edges are heavier, to read as a box. */
const HAIR = 3.4;
const EDGE = 4.5;
/** Slower than this (world units / s) counts as staying. */
const STAY_SPEED = 0.6;
/** A stay this long gets a plumb line to its place on the ground. */
const STAY_SEC = 4;
const KIND_ORDER: Record<PlateCellKind, number> = { press: 0, tread: 1, path: 2, slab: 3 };

/** `ruler`: the minutes' ruler on the left (off: the block alone, as wide as the box lets it); `face`: the top face's
 * height at most this share of the figure's (more: a wider block, a shorter time). */
function worldline(p: PlateInput, box: { left: number; right: number; top: number; bottom: number }, C: Palette, look: { ruler?: boolean; face?: number } = {}): string {
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
  const s = Math.min((box.right - box.left) / span, ((look.face ?? 0.26) * (box.bottom - box.top)) / (span * SQUASH), 60);
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
  out.push(`<path d="M${pt(u1, v1, tEnd)}L${pt(u1, v1, 0)}M${pt(u0, v1, 0)}L${pt(u1, v1, 0)}L${pt(u1, v0, 0)}" stroke="${C.faint}" stroke-width="${HAIR}" stroke-dasharray="6 10" fill="none"/>`);
  out.push(`<path d="M${pt(u0, v1, tEnd)}L${pt(u0, v1, 0)}L${pt(u0, v0, 0)}L${pt(u1, v0, 0)}L${pt(u1, v0, tEnd)}M${pt(u0, v0, tEnd)}L${pt(u0, v0, 0)}" stroke="${C.dim}" stroke-width="${EDGE}" fill="none" stroke-linejoin="round"/>`);
  // the strata: every minute (half minute in a short life) the near edges of that moment's layer
  const step = tEnd >= 120 ? 60 : 30;
  for (let t = step; t < tEnd - 1; t += step) out.push(`<path d="M${pt(u0, v1, t)}L${pt(u0, v0, t)}L${pt(u1, v0, t)}" stroke="${C.faint}" stroke-width="${HAIR}" stroke-dasharray="4 12" fill="none"/>`);
  // the ground on the top face: the cells, the trail from above, the face's edge
  const SHADE: Record<PlateCellKind, (a: number) => string> = C.oneInk
    ? { press: () => "", tread: () => "", path: () => `fill="${C.ink}"`, slab: () => `fill="${C.slab}" stroke="${C.ink}" stroke-width="2"` }
    : {
        press: (a) => `fill="${C.ink}" fill-opacity="${(0.08 + 0.2 * a).toFixed(3)}"`,
        tread: () => `fill="${C.ink}" fill-opacity="0.26"`,
        path: (a) => `fill="${C.ink}" fill-opacity="${(0.4 + 0.3 * a).toFixed(3)}"`,
        slab: () => `fill="${C.slab}" stroke="${C.ink}" stroke-width="1"`,
      };
  for (const c of cells) if (SHADE[c.kind](c.a)) out.push(`<path d="M${pt(c.u - 0.5, c.v - 0.5, tEnd)}L${pt(c.u + 0.5, c.v - 0.5, tEnd)}L${pt(c.u + 0.5, c.v + 0.5, tEnd)}L${pt(c.u - 0.5, c.v + 0.5, tEnd)}Z" ${SHADE[c.kind](c.a)}/>`);
  if (pts.length > 1) out.push(`<path d="M${pts.map((q) => pt(q.u, q.v, tEnd)).join("L")}" stroke="${C.ink}" stroke-width="${HAIR}" fill="none" opacity="${C.oneInk ? 1 : 0.55}" stroke-linejoin="round"/>`);
  out.push(`<path d="M${pt(u0, v1, tEnd)}L${pt(u1, v1, tEnd)}L${pt(u1, v0, tEnd)}L${pt(u0, v0, tEnd)}Z" stroke="${C.ink}" stroke-width="${EDGE}" fill="none" opacity="${C.oneInk ? 1 : 0.6}" stroke-linejoin="round"/>`);

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
    if (pts[j].t - pts[i].t >= STAY_SEC && tEnd - pts[j].t > 2) out.push(`<path d="M${pt(pts[j].u, pts[j].v, pts[j].t)}L${pt(pts[j].u, pts[j].v, tEnd)}" stroke="${C.ink}" stroke-width="${HAIR}" stroke-dasharray="4 9" opacity="${C.oneInk ? 1 : 0.4}"/>`);
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
  if (look.ruler !== false) {
    // the ruler of the life's time, left of the block: 00:00 at the birth, the end level with the top face's left corner
    const lx = sx(u0, v1), ly = sy(u0, v1, tEnd);
    const rx = Math.max(M + 100, lx - 64);
    const rBot = ly + tEnd * k;
    out.push(`<path d="M${f1(rx)} ${f1(ly)}V${f1(rBot)}" stroke="${C.dim}" stroke-width="${HAIR}"/>`);
    for (let t = 0; t <= tEnd + 0.001; t += 10) {
      const y = rBot - t * k;
      const major = t % step === 0;
      out.push(`<path d="M${f1(rx)} ${f1(y)}h${major ? 18 : 9}" stroke="${C.dim}" stroke-width="${HAIR}"/>`);
      if (major && tEnd - t > 8) out.push(text(rx - 16, y + 10, fmtClock(t), 28, C.dim, "end"));
    }
    out.push(`<path d="M${f1(rx - 10)} ${f1(ly)}h22" stroke="${C.ink}" stroke-width="${EDGE}"/>`);
    out.push(text(rx - 16, ly + 10, fmtClock(tEnd), 28, C.ink, "end"));
  }
  return out.join("");
}

/** The worldline alone as an SVG of its own, `w` × `h` in card units, uncropped: for laying a card out elsewhere (the
 * design canvas, 2026-11-21). The ruler sits in its first 214. */
export function plateFigureSvg(p: PlateInput, opts: { w: number; h: number; theme?: PlateTheme; ruler?: boolean; face?: number }): string {
  const C = PALETTES[opts.theme ?? "paper"];
  const ruler = opts.ruler !== false;
  const body = worldline(p, { left: ruler ? 214 : 16, right: opts.w - 16, top: 16, bottom: opts.h - 16 }, C, { ruler, face: opts.face });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${opts.w} ${opts.h}" font-family="${PLATE_FACE.family}, monospace">${body}</svg>`;
}

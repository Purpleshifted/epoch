/**
 * parliament/tails.ts — THE TAILS THE BOTS FOLLOW (the artist, 2026-11-12: "움직이는 경로마다 꼬리부터 흐려지다 아예
 * 사라지는 선을 남긴다고 치면…"; taken out and brought back the same day: "밟힌 땅은 뭐야? 꼬리가 더 맞지" — the fold's
 * trodden ground is the ground of the PRESENT only, and a bot lives at its own time of the block).
 *
 * Every walk from one place to another leaves a TAIL on the cells it crosses: whole at the time of the walk, fading
 * over `tailSec` of the time after it, then gone. The LEVEL of a cell at a time is the sum of the tails lying on it
 * then. Nothing is drawn of it (the paths the wall shows are the walkways, walkways.ts): it is what a bot reads when
 * it plans a way (useGlobalBots → flow.ts flowRoute) — ground with tails on it, AT THE BOT'S OWN TIME, is easier, so a
 * second walker takes the first one's cells and the ways join into trunks instead of a web of near misses.
 *
 * A walk shorter than `minLeg` is moving about within a place and leaves no tail (so a tail is laid when the walk has
 * ended). Pure but for the one field the page shares (`tailField`).
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import type { PEvent } from "./types";
import { wrapCell, wrapCoord, wrapDist } from "./world";

export interface TailConfig {
  /** Seconds of one slot of the time axis. */
  slotSec: number;
  /** How long a tail takes to fade away (s). */
  tailSec: number;
  /** Half the width of a tail (world units): under 0.85 it lies on the cells of the walk only. */
  radius: number;
  /** A step shorter than this (world units between two samples) is standing; two samples further apart than
   *  `maxGapSec` are not one walk. */
  minStep: number;
  maxGapSec: number;
  /** A walk shorter than this (from setting off to stopping) leaves no tail; 0 = every step leaves its tail at once. */
  minLeg: number;
}
export const DEFAULT_TAILS: TailConfig = { slotSec: 20, tailSec: 180, radius: 0.7, minStep: 0.6, maxGapSec: 3, minLeg: 12 };

const colKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

export class TailField {
  cfg: TailConfig = DEFAULT_TAILS;
  /** cell → slot → level. */
  private cols = new Map<number, Map<number, number>>();
  private last = new Map<string, { x: number; z: number; s: number }>();
  /** Each walker's walk under way: its steps (ax, az, bx, bz, s), kept until it stops. */
  private open = new Map<string, number[]>();
  steps = 0;

  /** Sets the rules; true when they changed (the field is empty then: feed it again). */
  configure(cfg: TailConfig): boolean {
    if (JSON.stringify(cfg) === JSON.stringify(this.cfg)) return false;
    this.cfg = cfg;
    this.clear();
    return true;
  }

  clear(): void {
    this.cols.clear();
    this.last.clear();
    this.open.clear();
    this.steps = 0;
  }

  /** One presence sample (each walker's in the order of its time). */
  add(e: Pick<PEvent, "o" | "x" | "z" | "s" | "k">): void {
    if (e.k !== undefined && e.k !== "p") return;
    const c = this.cfg;
    const x = wrapCoord(e.x), z = wrapCoord(e.z);
    const prev = this.last.get(e.o);
    this.last.set(e.o, { x, z, s: e.s });
    if (!prev) return;
    const dt = e.s - prev.s, L = Math.hypot(x - prev.x, z - prev.z);
    // (a step over the world's edge is short round the torus but long on the map: the walk ends before it)
    const step = dt > 0 && dt <= c.maxGapSec && L >= c.minStep && L <= wrapDist(prev.x, prev.z, x, z) + 1e-6;
    if (c.minLeg <= 0) {
      if (step) this.lay(prev.x, prev.z, x, z, e.s);
      return;
    }
    if (step) {
      const leg = this.open.get(e.o) ?? [];
      leg.push(prev.x, prev.z, x, z, e.s);
      this.open.set(e.o, leg);
      return;
    }
    // it stopped: a walk from one place to another leaves its tail now; a hop within a place leaves none
    const leg = this.open.get(e.o);
    if (!leg) return;
    this.open.delete(e.o);
    const n = leg.length / 5;
    if (Math.hypot(leg[(n - 1) * 5 + 2] - leg[0], leg[(n - 1) * 5 + 3] - leg[1]) < c.minLeg) return;
    for (let i = 0; i < n; i++) this.lay(leg[i * 5], leg[i * 5 + 1], leg[i * 5 + 2], leg[i * 5 + 3], leg[i * 5 + 4]);
  }

  /** One step from (ax, az) to (bx, bz) at time `s` leaves its tail on the cells it crosses. */
  private lay(ax: number, az: number, bx: number, bz: number, s: number): void {
    const c = this.cfg;
    const L = Math.hypot(bx - ax, bz - az);
    const R = Math.max(0.05, c.radius);
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    const i0 = Math.floor((Math.min(ax, bx) - R) / CELL_SIZE), i1 = Math.floor((Math.max(ax, bx) + R) / CELL_SIZE);
    const j0 = Math.floor((Math.min(az, bz) - R) / CELL_SIZE), j1 = Math.floor((Math.max(az, bz) + R) / CELL_SIZE);
    const k0 = Math.max(0, Math.floor(s / c.slotSec)), k1 = Math.floor((s + Math.max(0, c.tailSec)) / c.slotSec);
    for (let ci = i0; ci <= i1; ci++) {
      for (let cj = j0; cj <= j1; cj++) {
        // the share of a whole crossing of this cell that this step is: the length of the step within R of the cell's
        // middle, over 2R — one walk over a cell's middle adds up to exactly 1, however it is cut into steps
        const px = (ci + 0.5) * CELL_SIZE - ax, pz = (cj + 0.5) * CELL_SIZE - az;
        const along = px * ux + pz * uz, off = Math.abs(px * uz - pz * ux);
        if (off >= R) continue;
        const half = Math.sqrt(R * R - off * off);
        const len = Math.min(L, along + half) - Math.max(0, along - half);
        if (len <= 0) continue;
        const g = len / (2 * R);
        const ck = colKey(wrapCell(ci), wrapCell(cj));
        let col = this.cols.get(ck);
        if (!col) this.cols.set(ck, (col = new Map()));
        for (let k = k0; k <= k1; k++) {
          // whole in the slot of the step, fading with the time after it
          const fade = k === k0 ? 1 : Math.max(0, 1 - ((k + 0.5) * c.slotSec - s) / Math.max(1e-6, c.tailSec));
          if (fade > 0) col.set(k, (col.get(k) ?? 0) + g * fade);
        }
      }
    }
    this.steps++;
  }

  /** Every cell-slot a tail lies on, with its level. */
  each(cb: (cx: number, cz: number, k: number, level: number) => void): void {
    for (const [ck, col] of this.cols) {
      const cx = Math.floor(ck / 65536) - 32768, cz = (ck % 65536) - 32768;
      for (const [k, v] of col) cb(cx, cz, k, v);
    }
  }

  /** The level of a cell at a slot: how many tails lie on it then, each as faded as it is. */
  level(cx: number, cz: number, k: number): number {
    return this.cols.get(colKey(wrapCell(cx), wrapCell(cz)))?.get(k) ?? 0;
  }
}

/** The one field of this page: the bots feed it and plan their ways over it (useGlobalBots). */
export const tailField = new TailField();

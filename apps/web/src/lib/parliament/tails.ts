/**
 * parliament/tails.ts — PATHS FROM FADING TAILS (the artist, 2026-11-12: "움직이는 경로마다 꼬리부터 흐려지다 아예
 * 사라지는 선을 남긴다고 치면, 그게 내 꼬리든 남의 꼬리든 특정 수준 이상 겹치고 유량이 유지되어야 길로 이어지는
 * 거임", "건물이나 무리 사이사이 이동경로가 이어지는 걸 원한 건데 지금은 걍 그물 올 나간 것 같애").
 *
 * Every step leaves a TAIL on the cells it crosses: whole at the time of the step, fading over `tailSec` of the time
 * after it, then gone. Whose tail it is does not matter. The LEVEL of a cell at a time is the sum of the tails lying
 * on it then — how many are overlapping, each as faded as it is. Where the level is at least `pathAt` there is PATH;
 * it stays path for as long as people keep coming (the flow is kept up) and ends when they stop.
 *
 * WHAT MAKES THE WAYS JOIN UP is not drawn afterwards — it is how the walkers walk: a walker plans its way over the
 * ground as it is at its own time, and ground with tails on it is easier (useGlobalBots → flow.ts flowRoute). So a
 * second walker takes the first one's cells where they go the same way, its tail lies exactly on the first tail, and
 * the stretch they share is one line from the beginning — a trunk with branches, not a web of near misses.
 *
 * DRAWN as lines: the path's cells joined to their neighbours, followed from end to end and smoothed into curves, at
 * the height (time) the path began there. A path that lives on is laid again every `resurface` slots, so it is seen
 * all the way up; a branch that leaves an older way climbs from it (no surface rises faster than `rise` slots a cell).
 *
 * Pure but for the one field the page shares (`tailField`): the bots feed it and read it, the wall draws it.
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
  /**
   * NEAR AND FAR (the artist, 2026-11-12: "너무 근교에 있는 건물 덩어리 사이로 오가는 거랑 멀리 있는 곳 사이를
   * 오가는 것도 구분을 해야 할지"): a walk shorter than this (world units, from setting off to stopping) is moving
   * about WITHIN a place — it leaves no tail, so the hops round a group of buildings do not become a scribble of
   * little paths. Only a walk from one place to another leaves one. (So a tail is laid when the walk has ended.)
   * 0 = every step leaves its tail at once.
   */
  minLeg: number;
}
export const DEFAULT_TAILS: TailConfig = { slotSec: 20, tailSec: 180, radius: 0.7, minStep: 0.6, maxGapSec: 3, minLeg: 12 };

export interface TailLines {
  /** Overlapping tails from which a cell is path. */
  pathAt: number;
  /** The most a path's surface rises per cell (slots). */
  rise: number;
  /** Times the curves are smoothed (0 = cell to cell). */
  smooth: number;
  /**
   * LAYERS (the artist, 2026-11-12: "길 모양이 여전히 너무 이상해"): a path's height is not the very slot each cell
   * crossed the threshold in — along one way that differs from cell to cell, and the line wobbled up and down. Time
   * is read in layers of this many slots: what became path in the same layer lies FLAT at that layer's height, and
   * only a branch that came in a later layer climbs to its own (the ramp).
   */
  layer: number;
  /** A path that lives on is laid again after this many layers. */
  resurface: number;
}
export const DEFAULT_TAIL_LINES: TailLines = { pathAt: 3, rise: 0.25, smooth: 4, layer: 3, resurface: 4 };

interface Run {
  cx: number;
  cz: number;
  k0: number;
  k1: number;
  h: number;
}

const colKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

export class TailField {
  cfg: TailConfig = DEFAULT_TAILS;
  /** cell → slot → level. */
  private cols = new Map<number, Map<number, number>>();
  private last = new Map<string, { x: number; z: number; s: number }>();
  /** Each walker's walk under way: its steps (ax, az, bx, bz, s), kept until it stops (minLeg). */
  private open = new Map<string, number[]>();
  private cache: { key: string; out: Float32Array } | null = null;
  /** Bumped by every step: what was drawn is the same while it stands. */
  version = 0;
  steps = 0;

  /** Sets the rules; true when they changed (the field is empty then: feed it again). */
  configure(cfg: TailConfig): boolean {
    if (JSON.stringify(cfg) === JSON.stringify(this.cfg) && this.steps > 0) return false;
    const changed = JSON.stringify(cfg) !== JSON.stringify(this.cfg);
    this.cfg = cfg;
    if (changed) this.clear();
    return changed;
  }

  clear(): void {
    this.cols.clear();
    this.last.clear();
    this.open.clear();
    this.cache = null;
    this.version++;
    this.steps = 0;
  }

  /** One presence sample (each walker's in the order of its time): a step from its last one leaves a tail. */
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
    this.version++;
    this.cache = null;
  }

  /** The level of a cell at a slot: how many tails lie on it then, each as faded as it is. */
  level(cx: number, cz: number, k: number): number {
    return this.cols.get(colKey(wrapCell(cx), wrapCell(cz)))?.get(k) ?? 0;
  }

  /** The level where and when a walker is. */
  levelAt(x: number, z: number, s: number): number {
    return this.level(Math.floor(wrapCoord(x) / CELL_SIZE), Math.floor(wrapCoord(z) / CELL_SIZE), Math.floor(s / this.cfg.slotSec));
  }

  /** The paths as curves: [x, height in slots, z, x, height, z] per short segment. */
  lines(o: TailLines): Float32Array {
    const key = `${this.version}:${JSON.stringify(o)}`;
    if (this.cache && this.cache.key === key) return this.cache.out;
    // RUNS: per cell, the stretches of LAYERS in which it is path — a long one cut every `resurface` layers (laid
    // again). k0 … k1 are layers; the surface's height h is in slots.
    const W = Math.max(1, Math.round(o.layer));
    const S = Math.max(1, Math.round(o.resurface));
    const runs: Run[] = [];
    const at = new Map<number, Run[]>();
    for (const [ck, col] of this.cols) {
      const set = new Set<number>();
      for (const [k, v] of col) if (v >= o.pathAt) set.add(Math.floor(k / W));
      if (!set.size) continue;
      const ks = [...set].sort((p, q) => p - q);
      const cx = Math.floor(ck / 65536) - 32768, cz = (ck % 65536) - 32768;
      const mine: Run[] = [];
      let from = ks[0], prev = ks[0];
      for (let i = 1; i <= ks.length; i++) {
        if (i < ks.length && ks[i] === prev + 1 && ks[i] - from < S) {
          prev = ks[i];
          continue;
        }
        mine.push({ cx, cz, k0: from, k1: prev, h: from * W });
        if (i < ks.length) from = prev = ks[i];
      }
      at.set(ck, mine);
      for (const r of mine) runs.push(r);
    }
    const inWorld = (cx: number, cz: number) => wrapCell(cx) === cx && wrapCell(cz) === cz;
    const touching = (a: Run, cx: number, cz: number): Run | undefined => (inWorld(cx, cz) ? at.get(colKey(cx, cz))?.find((b) => b.k0 <= a.k1 && b.k1 >= a.k0) : undefined);
    // RAMPS: no surface more than `rise` a cell above one it touches (lowest first, until nothing moves)
    const step = Math.max(0, o.rise);
    const queue = [...runs].sort((p, q) => p.h - q.h);
    for (let qi = 0; qi < queue.length && qi < runs.length * 64; qi++) {
      const a = queue[qi];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue;
          const b = touching(a, a.cx + dx, a.cz + dz);
          const cand = a.h + step * (dx && dz ? Math.SQRT2 : 1);
          if (!b || cand >= b.h - 1e-9) continue;
          b.h = cand;
          queue.push(b);
        }
      }
    }
    // LINES: each cell joined to the next (a diagonal only where no step round the corner does it), followed as chains
    const DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1]];
    const adj = new Map<Run, Run[]>();
    const link = (a: Run, b: Run) => {
      const la = adj.get(a) ?? (adj.set(a, []), adj.get(a)!);
      if (!la.includes(b)) la.push(b);
      const lb = adj.get(b) ?? (adj.set(b, []), adj.get(b)!);
      if (!lb.includes(a)) lb.push(a);
    };
    for (const a of runs) {
      for (const [dx, dz] of DIRS) {
        const b = touching(a, a.cx + dx, a.cz + dz);
        if (!b) continue;
        if (dx && dz && (touching(a, a.cx + dx, a.cz) || touching(a, a.cx, a.cz + dz))) continue;
        link(a, b);
      }
    }
    const id = new Map<Run, number>();
    runs.forEach((r, i) => id.set(r, i));
    const edge = (a: Run, b: Run) => (id.get(a)! < id.get(b)! ? `${id.get(a)}:${id.get(b)}` : `${id.get(b)}:${id.get(a)}`);
    const used = new Set<string>();
    const chains: Run[][] = [];
    const trace = (a: Run, b: Run) => {
      const pts = [a, b];
      used.add(edge(a, b));
      let prev = a, cur = b;
      while (cur !== a && adj.get(cur)!.length === 2) {
        const next = adj.get(cur)![0] === prev ? adj.get(cur)![1] : adj.get(cur)![0];
        if (used.has(edge(cur, next))) break;
        used.add(edge(cur, next));
        pts.push(next);
        prev = cur;
        cur = next;
      }
      chains.push(pts);
    };
    // from the ends and the junctions first, then what is left (rings)
    for (const [a, l] of adj) if (l.length !== 2) for (const b of l) if (!used.has(edge(a, b))) trace(a, b);
    for (const [a, l] of adj) for (const b of l) if (!used.has(edge(a, b))) trace(a, b);
    const out: number[] = [];
    const passes = Math.max(0, Math.round(o.smooth));
    for (const ch of chains) {
      let pts = ch.map((r) => [(r.cx + 0.5) * CELL_SIZE, r.h, (r.cz + 0.5) * CELL_SIZE]);
      // the cells' staircase evened out (the ends stay: the next chain begins there) …
      for (let it = 0; it < passes; it++) {
        const q = pts.map((p) => p.slice());
        for (let i = 1; i < pts.length - 1; i++) for (let d = 0; d < 3; d++) q[i][d] = 0.25 * pts[i - 1][d] + 0.5 * pts[i][d] + 0.25 * pts[i + 1][d];
        pts = q;
      }
      // … and its corners cut (Chaikin), twice
      for (let it = 0; it < (passes > 0 ? 2 : 0) && pts.length > 2; it++) {
        const q: number[][] = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[i], p1 = pts[i + 1];
          q.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1], 0.75 * p0[2] + 0.25 * p1[2]]);
          q.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1], 0.25 * p0[2] + 0.75 * p1[2]]);
        }
        q.push(pts[pts.length - 1]);
        pts = q;
      }
      for (let i = 1; i < pts.length; i++) out.push(pts[i - 1][0], pts[i - 1][1], pts[i - 1][2], pts[i][0], pts[i][1], pts[i][2]);
    }
    this.cache = { key, out: Float32Array.from(out) };
    return this.cache.out;
  }
}

/** The one field of this page: the bots feed it and plan their ways over it (useGlobalBots), the wall draws it. */
export const tailField = new TailField();

/**
 * How the walkers use the ground (the wall's knobs; read by useGlobalBots): whether they plan their ways over the
 * tails and how strongly (0 = a tail is no easier than bare ground, 1 = one tail makes a cell 63 % a path, more =
 * sooner), and the buildings as the wall makes them (a copy of the wall's density field, fed with the same samples:
 * the wall's own lives in its worker) — what they go round, or stop at.
 */
export const tailWalk: { follow: boolean; strength: number; built: { levelAt(cx: number, cz: number, k: number): number; add(e: Pick<PEvent, "o" | "x" | "z" | "s" | "k">): void } | null } = { follow: true, strength: 1, built: null };

/**
 * parliament/fossilField.ts
 *
 * THE FOSSIL AS ONE FIELD — what the GPU bakes from, kept on the CPU (2026-11-20, branch gpu-optimized; fuse.ts
 * `field`). The model says what the fossil is made of (spaceModel fieldMaterial: the fossil's units, the plates, the
 * foundations — each a box with when it hardened), only what is other than it was; here it is kept as
 *
 * - THE BOXES (FossilStore): one slot a box, by its key, in the layout the bake's shader reads;
 * - THE BRICKS (BrickGrid): the space cut into bricks of B × B × B samples; only the bricks a box reaches are kept,
 *   each with the list of the boxes that reach it, a place in the atlas (a 3D texture of bricks side by side) and an
 *   entry in the page table (which brick of space is which brick of the atlas). A box that comes, goes or changes
 *   marks the bricks it reaches: only those are baked again, a few a frame (fossilFieldGpu.ts).
 *
 * The page table wraps (a brick's place in it is its coordinates modulo the table's side): the window may rise for as
 * long as it likes, the bricks it leaves behind are let go and their places taken by the new ones. What is alive must
 * be narrower than the table in each direction (64 bricks: 300–500 world) — a brick that would take a place still
 * held is not made (counted in `refused`).
 *
 * Nothing of three.js here: pure and testable.
 */

/** Floats a box in the store (three texels of four: what the bake reads). */
export const PRIM_FLOATS = 12;
/** The page table's side (bricks). */
export const PAGE = 64;

/** A box of the store: [x, y, z, cos | hx, hy, hz, sin | born, own, most, kind] — kind 0 plate · 1 body · 2 foundation · −1 none. */
export class FossilStore {
  data: Float32Array;
  /** One more than the highest slot in use. */
  high = 0;
  private slotOf = new Map<number, number>();
  private free: number[] = [];
  /** Slots written since the last upload (lowest, one past the highest); null = none. */
  dirty: [number, number] | null = null;
  /** The store grew: its texture is to be made again. */
  grown = true;

  constructor(cap = 4096) {
    this.data = new Float32Array(cap * PRIM_FLOATS);
  }
  get size(): number {
    return this.slotOf.size;
  }
  slot(key: number): number | undefined {
    return this.slotOf.get(key);
  }
  private touch(i: number): void {
    if (!this.dirty) this.dirty = [i, i + 1];
    else {
      if (i < this.dirty[0]) this.dirty[0] = i;
      if (i + 1 > this.dirty[1]) this.dirty[1] = i + 1;
    }
  }
  /** A box comes, or is other than it was (`m`: the model's 12 floats — spaceModel FOSSIL_BOX). Returns its slot. */
  set(key: number, m: ArrayLike<number>, o: number): number {
    let i = this.slotOf.get(key);
    if (i === undefined) {
      i = this.free.length ? this.free.pop()! : this.high++;
      if (i * PRIM_FLOATS >= this.data.length) {
        const d = new Float32Array(this.data.length * 2);
        d.set(this.data);
        this.data = d;
        this.grown = true;
      }
      this.slotOf.set(key, i);
    }
    const yaw = m[o + 6], p = i * PRIM_FLOATS, d = this.data;
    d[p] = m[o];
    d[p + 1] = m[o + 1];
    d[p + 2] = m[o + 2];
    d[p + 3] = Math.cos(yaw);
    d[p + 4] = m[o + 3] / 2;
    d[p + 5] = m[o + 4] / 2;
    d[p + 6] = m[o + 5] / 2;
    d[p + 7] = Math.sin(yaw);
    d[p + 8] = m[o + 9];
    d[p + 9] = m[o + 10];
    d[p + 10] = m[o + 11];
    d[p + 11] = m[o + 7];
    this.touch(i);
    return i;
  }
  /** Whether the box of slot `i` has the shape the model's 12 floats at `o` say (only its values may differ). */
  sameShape(i: number, m: ArrayLike<number>, o: number): boolean {
    const d = this.data, p = i * PRIM_FLOATS, yaw = m[o + 6], e = 1e-4;
    return (
      Math.abs(d[p] - m[o]) < e && Math.abs(d[p + 1] - m[o + 1]) < e && Math.abs(d[p + 2] - m[o + 2]) < e &&
      Math.abs(d[p + 4] - m[o + 3] / 2) < e && Math.abs(d[p + 5] - m[o + 4] / 2) < e && Math.abs(d[p + 6] - m[o + 5] / 2) < e &&
      Math.abs(d[p + 3] - Math.cos(yaw)) < e && Math.abs(d[p + 7] - Math.sin(yaw)) < e && d[p + 11] === m[o + 7]
    );
  }
  /** A box is no more. Returns the slot it had (its numbers stand until the slot is taken again), or undefined. */
  drop(key: number): number | undefined {
    const i = this.slotOf.get(key);
    if (i === undefined) return undefined;
    this.slotOf.delete(key);
    this.free.push(i);
    this.data[i * PRIM_FLOATS + 11] = -1;
    this.touch(i);
    return i;
  }
  clear(): void {
    this.slotOf.clear();
    this.free.length = 0;
    this.high = 0;
    this.dirty = null;
    this.grown = true;
  }
  /** A box's bounds in the world (its turn taken into them), wider by `m` and lower by `down`. */
  bounds(i: number, m: number, down: number, out: number[]): number[] {
    const d = this.data, p = i * PRIM_FLOATS;
    const c = Math.abs(d[p + 3]), s = Math.abs(d[p + 7]);
    const hx = c * d[p + 4] + s * d[p + 6], hz = s * d[p + 4] + c * d[p + 6], hy = d[p + 5];
    out[0] = d[p] - hx - m;
    out[1] = d[p + 1] - hy - m - down;
    out[2] = d[p + 2] - hz - m;
    out[3] = d[p] + hx + m;
    out[4] = d[p + 1] + hy + m;
    out[5] = d[p + 2] + hz + m;
    return out;
  }
  /** The earliest and the latest hardening among the boxes (slots); null = no box. */
  bornRange(): [number, number] | null {
    let lo = Infinity, hi = -Infinity;
    for (const i of this.slotOf.values()) {
      const b = this.data[i * PRIM_FLOATS + 8];
      if (b < lo) lo = b;
      if (b > hi) hi = b;
    }
    return lo <= hi ? [lo, hi] : null;
  }
}

const OFF = 2048, SPAN = 4096;
const brickKey = (cx: number, cy: number, cz: number): number => ((cz + OFF) * SPAN + (cy + OFF)) * SPAN + (cx + OFF);
const mod = (a: number, n: number): number => ((a % n) + n) % n;

export interface BrickSpec {
  /** A sample's side (world) and the samples a brick's side. */
  h: number;
  B: number;
  /** How far from a box the field is kept (world), and how much farther below it. */
  reach: number;
  down: number;
  /** The atlas: bricks a side of a slab, and the most slabs it may grow to. */
  A: number;
  slabsMax: number;
}

/** The bricks of one field: lists, places in the atlas, the page table. */
export class BrickGrid {
  readonly bw: number;
  /** brick → the slots of the boxes that reach it. */
  private lists = new Map<number, number[]>();
  private idOf = new Map<number, number>();
  /** atlas place → its brick's coordinates (cx, cy, cz), or undefined. */
  private at: ([number, number, number] | undefined)[] = [];
  private freeIds: number[] = [];
  private highId = 0;
  /** atlas place → the earliest hardening among the boxes that ever reached the brick (slots; never later than the
   *  truth: a brick is only ever taken for older than it is, never younger). */
  private oldest: number[] = [];
  /** atlas place → whether its brick has been baked (only then is it in the page table: stamp). */
  private shown: boolean[] = [];
  /** RGBA a page entry: the brick's place in the atlas (x, y, slab) and, 0 = none, 1 … 255 = held — and how early its
   *  oldest box hardened (stamp): a brick nothing of which is old enough to be out is jumped like an empty one. */
  readonly page = new Uint8Array(PAGE * PAGE * PAGE * 4);
  private pageOwner = new Float64Array(PAGE * PAGE * PAGE).fill(-1);
  pageDirty = true;
  /** Bricks to bake (atlas places). */
  readonly dirty = new Set<number>();
  /** Bricks not made because their place in the page table was held (what is alive is wider than the table). */
  refused = 0;
  /** Bricks not made because the atlas is full at its largest. */
  full = 0;
  /** The bounds of the bricks alive (brick coordinates, both ends within); null = none. */
  private live: number[] | null = null;
  private liveStale = false;
  private tmp = [0, 0, 0, 0, 0, 0];

  constructor(readonly spec: BrickSpec) {
    this.bw = spec.h * spec.B;
  }
  get count(): number {
    return this.idOf.size;
  }
  /** Slabs of the atlas in use (the highest place held, in slabs). */
  get slabs(): number {
    return Math.ceil(this.highId / (this.spec.A * this.spec.A));
  }
  get capacity(): number {
    return this.spec.A * this.spec.A * this.spec.slabsMax;
  }
  clear(): void {
    this.lists.clear();
    this.idOf.clear();
    this.at.length = 0;
    this.freeIds.length = 0;
    this.highId = 0;
    this.page.fill(0);
    this.pageOwner.fill(-1);
    this.pageDirty = true;
    this.dirty.clear();
    this.refused = this.full = 0;
    this.live = null;
    this.liveStale = false;
  }
  private range(b: number[]): number[] {
    const t = this.tmp, w = this.bw;
    t[0] = Math.floor(b[0] / w);
    t[1] = Math.floor(b[1] / w);
    t[2] = Math.floor(b[2] / w);
    t[3] = Math.floor(b[3] / w);
    t[4] = Math.floor(b[4] / w);
    t[5] = Math.floor(b[5] / w);
    return t;
  }
  /** A box (slot `i`) reaches these bounds (FossilStore.bounds with this field's reach): it is put in their bricks' lists. */
  add(i: number, bounds: number[], born = 0): void {
    const r = this.range(bounds);
    const [x0, y0, z0, x1, y1, z1] = r;
    for (let cz = z0; cz <= z1; cz++)
      for (let cy = y0; cy <= y1; cy++)
        for (let cx = x0; cx <= x1; cx++) {
          const k = brickKey(cx, cy, cz);
          let l = this.lists.get(k);
          if (!l) {
            if (!this.make(k, cx, cy, cz)) continue;
            this.lists.set(k, (l = []));
          }
          l.push(i);
          const id = this.idOf.get(k)!;
          if (born < this.oldest[id]) {
            this.oldest[id] = born;
            this.pageDirty = true;
          }
          this.dirty.add(id);
        }
  }
  /** What a box that reaches these bounds says of itself is other than it was (its shape is not): its bricks are baked again. */
  touch(bounds: number[]): void {
    const r = this.range(bounds);
    const [x0, y0, z0, x1, y1, z1] = r;
    for (let cz = z0; cz <= z1; cz++)
      for (let cy = y0; cy <= y1; cy++)
        for (let cx = x0; cx <= x1; cx++) {
          const id = this.idOf.get(brickKey(cx, cy, cz));
          if (id !== undefined) this.dirty.add(id);
        }
  }
  /** The box of slot `i` reached these bounds and no longer does (it went, or is about to be put elsewhere). */
  remove(i: number, bounds: number[]): void {
    const r = this.range(bounds);
    const [x0, y0, z0, x1, y1, z1] = r;
    for (let cz = z0; cz <= z1; cz++)
      for (let cy = y0; cy <= y1; cy++)
        for (let cx = x0; cx <= x1; cx++) {
          const k = brickKey(cx, cy, cz);
          const l = this.lists.get(k);
          if (!l) continue;
          const at = l.indexOf(i);
          if (at < 0) continue;
          l[at] = l[l.length - 1];
          l.pop();
          // (a brick left with nothing is only let go when its turn to be baked comes and it still holds nothing: a box
          // taken out and another put in its place the same moment keep the brick, and what it showed stands until it
          // is baked again — it does not blink)
          this.dirty.add(this.idOf.get(k)!);
        }
  }
  private make(k: number, cx: number, cy: number, cz: number): boolean {
    const p = (mod(cz, PAGE) * PAGE + mod(cy, PAGE)) * PAGE + mod(cx, PAGE);
    if (this.pageOwner[p] >= 0) {
      this.refused++;
      return false;
    }
    let id: number;
    if (this.freeIds.length) id = this.freeIds.pop()!;
    else if (this.highId < this.capacity) id = this.highId++;
    else {
      this.full++;
      return false;
    }
    const A = this.spec.A;
    this.idOf.set(k, id);
    this.at[id] = [cx, cy, cz];
    this.oldest[id] = Infinity;
    this.shown[id] = false;
    this.pageOwner[p] = k;
    this.page[p * 4] = id % A;
    this.page[p * 4 + 1] = Math.floor(id / A) % A;
    this.page[p * 4 + 2] = Math.floor(id / (A * A));
    // (not on the screen until it has been baked: its place in the atlas still holds what was there before — stamp)
    this.page[p * 4 + 3] = 0;
    this.pageDirty = true;
    const v = this.live;
    if (!v) this.live = [cx, cy, cz, cx, cy, cz];
    else {
      if (cx < v[0]) v[0] = cx;
      if (cy < v[1]) v[1] = cy;
      if (cz < v[2]) v[2] = cz;
      if (cx > v[3]) v[3] = cx;
      if (cy > v[4]) v[4] = cy;
      if (cz > v[5]) v[5] = cz;
    }
    return true;
  }
  private letGo(k: number, id: number, cx: number, cy: number, cz: number): void {
    const p = (mod(cz, PAGE) * PAGE + mod(cy, PAGE)) * PAGE + mod(cx, PAGE);
    this.lists.delete(k);
    this.idOf.delete(k);
    this.at[id] = undefined;
    this.freeIds.push(id);
    this.dirty.delete(id);
    this.pageOwner[p] = -1;
    this.page[p * 4 + 3] = 0;
    this.pageDirty = true;
    this.liveStale = true;
  }
  /** The page table's fourth byte, written again: each brick's oldest hardening, from `base` over `range` slots. */
  stamp(base: number, range: number): void {
    for (let id = 0; id < this.at.length; id++) {
      const c = this.at[id];
      if (!c) continue;
      const p = (mod(c[2], PAGE) * PAGE + mod(c[1], PAGE)) * PAGE + mod(c[0], PAGE);
      const o = this.oldest[id];
      this.page[p * 4 + 3] = !this.shown[id] ? 0 : 1 + Math.max(0, Math.min(254, Math.floor((((Number.isFinite(o) ? o : base) - base) / range) * 254)));
    }
  }
  /** The world bounds of the bricks alive [x0, y0, z0, x1, y1, z1]; null = none. */
  bounds(): number[] | null {
    if (this.liveStale) {
      this.liveStale = false;
      let v: number[] | null = null;
      for (const c of this.at) {
        if (!c) continue;
        if (!v) v = [c[0], c[1], c[2], c[0], c[1], c[2]];
        else {
          if (c[0] < v[0]) v[0] = c[0];
          if (c[1] < v[1]) v[1] = c[1];
          if (c[2] < v[2]) v[2] = c[2];
          if (c[0] > v[3]) v[3] = c[0];
          if (c[1] > v[4]) v[4] = c[1];
          if (c[2] > v[5]) v[5] = c[2];
        }
      }
      this.live = v;
    }
    const v = this.live, w = this.bw;
    return v ? [v[0] * w, v[1] * w, v[2] * w, (v[3] + 1) * w, (v[4] + 1) * w, (v[5] + 1) * w] : null;
  }
  /** Every brick alive is to be baked again (the atlas was made anew, or what every brick reads changed). */
  allDirty(): void {
    for (const id of this.idOf.values()) this.dirty.add(id);
  }
  /** Nothing of the atlas stands (it was made anew, empty): no brick is on the screen until it is baked again. */
  allHidden(): void {
    this.shown.fill(false);
    this.pageDirty = true;
    this.allDirty();
  }
  /** These bricks have been baked: they are on the screen from the next stamp. */
  baked(ids: readonly number[]): void {
    for (const id of ids) this.shown[id] = true;
    this.pageDirty = true;
  }
  /**
   * THE NEXT BRICKS TO BAKE: of one slab of the atlas (the bake draws a slab's bricks together, a pass a slice), at
   * most `maxBricks` of them and `maxRefs` list entries. Returns their atlas places, coordinates and lists; they are
   * no longer dirty.
   */
  take(maxBricks: number, maxRefs: number): { slab: number; ids: number[]; coords: [number, number, number][]; lists: number[][] } | null {
    if (!this.dirty.size) return null;
    const perSlab = this.spec.A * this.spec.A;
    let slab = -1;
    const ids: number[] = [], coords: [number, number, number][] = [], lists: number[][] = [];
    let refs = 0;
    for (const id of this.dirty) {
      const s = Math.floor(id / perSlab);
      if (slab < 0) slab = s;
      if (s !== slab) continue;
      const c = this.at[id];
      if (!c) {
        this.dirty.delete(id);
        continue;
      }
      const l = this.lists.get(brickKey(c[0], c[1], c[2])) ?? [];
      if (!l.length) {
        this.letGo(brickKey(c[0], c[1], c[2]), id, c[0], c[1], c[2]);
        continue;
      }
      if (ids.length && refs + l.length > maxRefs) break;
      ids.push(id);
      coords.push(c);
      lists.push(l);
      refs += l.length;
      if (ids.length >= maxBricks) break;
    }
    for (const id of ids) this.dirty.delete(id);
    return ids.length ? { slab, ids, coords, lists } : null;
  }
}

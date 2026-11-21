/// <reference lib="webworker" />
/**
 * A WORKER BESIDE THE MODEL'S (2026-11-16; the artist, on making the wall lighter with her own values kept: "일단 1-3
 * 진행해봐. 3은 중요할 것 같음"). The wall starts two of these, each given one end of a channel to the model's worker
 * (space.worker.ts → SpaceModel.attachPorts) — the model's worker says what is to be worked out, and it is worked out
 * here, so the buildings never wait for it:
 *
 * - THE BUILDINGS' MASS (lib/parliament/fuseUnits.ts): what each building is made of comes in over the channel; its
 *   pieces are made one at a time, the deepest first, and every piece done is sent STRAIGHT TO THE VIEW (this
 *   worker's own postMessage), in chunks of the space — and the model is told which parts have a mass now;
 * - THE WAYS (lib/parliament/walkways.ts): the view gives this worker the log as it gives it to the model's; a round
 *   is asked over the channel and its answer sent back over it.
 *
 * - A HELPER OF THE MASS (2026-11-20, the pool): the worker of the mass keeps what every piece is, which are done,
 *   held, still to do and in what order — and, when the view gives it helpers (other instances of this file, each with
 *   one end of a channel to it), hands them the making of the pieces themselves, one piece each at a time. A piece's
 *   mesh depends only on what it is made from (fuseUnits makePiece), so the mass is the same as one worker's; with no
 *   helpers it makes them itself, as before. If a helper fails, its pieces go back to be made.
 *
 * One file for all: an instance is only ever sent one kind of work.
 */

import { FuseUnits, lookFn, makePiece, type PieceCtx, type PieceDone, type PieceTask, type UnitFused, type UnitRequest } from "@/lib/parliament/fuseUnits";
import type { FuseMesh } from "@/lib/parliament/fuse";
import { walkways, type WalkRequest, type WalkResult } from "@/lib/parliament/walkways";
import type { PEvent } from "@/lib/parliament/types";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let port: MessagePort | null = null;

// ── the mass ──
const units = new FuseUnits();
/** At least this long between two messages to the view (ms): a chunk is merged and sent anew each time. */
const EMIT_MS = 350;
let timer: ReturnType<typeof setTimeout> | null = null;
let due = Infinity;
let lastEmit = 0;

/** The next turn in `ms` — or sooner, if one is already due sooner (a helper back, or a new job, need not wait out a
 *  turn set for a resting piece). */
function schedule(ms = 0): void {
  const at = performance.now() + ms;
  if (timer !== null) {
    if (due <= at) return;
    clearTimeout(timer);
  }
  due = at;
  timer = setTimeout(() => {
    timer = null;
    due = Infinity;
    turn();
  }, ms);
}

/** The helpers (the pool): one end of a channel each; the jobs each has been told (the newest last). */
interface Helper {
  id: number;
  port: MessagePort;
  told: number[];
  busy: boolean;
}
let helpers: Helper[] = [];
/** How many jobs a helper is told of before the oldest is forgotten — fewer than it keeps (HELPER_KEEPS), so a job
 *  this side thinks it knows, it does. */
const TOLD_KEPT = 8;
const HELPER_KEEPS = 16;

function hand(hp: Helper, d: { ctx: PieceCtx; task: PieceTask }): void {
  if (!hp.told.includes(d.ctx.serial)) {
    hp.port.postMessage(d.ctx);
    hp.told.push(d.ctx.serial);
    if (hp.told.length > TOLD_KEPT) hp.told.shift();
  }
  hp.port.postMessage(d.task);
  hp.busy = true;
}

function onHelper(hp: Helper, ev: MessageEvent<PieceDone | { type: "piece-lost"; ticket: number }>): void {
  const m = ev.data;
  hp.busy = false;
  if (m.type === "piece-lost") {
    // (it did not know the job — it is told again)
    hp.told = [];
    units.cancel(hp.id, m.ticket);
  } else units.complete(m);
  schedule();
}

/** Make a piece (no helpers) or hand one to every idle helper. Whether anything was made or handed out. */
function work(): boolean {
  if (!helpers.length) return units.step() !== null;
  let out = false;
  for (const hp of helpers) {
    if (hp.busy) continue;
    const d = units.dispatch(hp.id);
    if (!d) break;
    hand(hp, d);
    out = true;
  }
  return out;
}

/** One piece (or a hand-out), then back to the event loop: what the model says meanwhile (a building's parts are other
 *  than they were, a building is no more) is taken before the next piece is chosen. */
function turn(): void {
  const made = work() ? [] : null;
  // (the parts that came onto the screen — a piece is held until its neighbours are made: fuseUnits commit)
  const keys = units.takeFused();
  if (keys.length) port?.postMessage({ type: "fused", keys } satisfies UnitFused);
  const now = performance.now();
  const [fresh, again] = units.pending();
  const left = fresh + again > 0;
  if (units.hasDirty() && (now - lastEmit >= EMIT_MS || !left)) {
    const { out, transfer } = units.flush();
    scope.postMessage(out, transfer);
    lastEmit = now;
  }
  // (a piece dissolving off the screen is let go when its dissolve is over: fuseUnits sweep)
  const wake = units.sweep();
  // (nothing was made: every piece left is one that stands and rests — looked at again when the first of them may be)
  if (left && made !== null) schedule();
  else if (units.hasDirty()) schedule(EMIT_MS);
  else if (left && units.waitMs < Infinity) schedule(Math.min(units.waitMs + 20, wake + 20, 5000));
  else if (wake < Infinity) schedule(Math.min(wake + 20, 5000));
}

// ── the ways ──
const pres: PEvent[] = [];
const ids = new Set<string>();

function walk(m: WalkRequest): void {
  const t0 = performance.now();
  const walks = walkways(pres, m.seeds, m.cfg, m.opts);
  port?.postMessage({ type: "walks", serial: m.serial, walks, ms: performance.now() - t0 } satisfies WalkResult);
}

function onPort(ev: MessageEvent<UnitRequest | WalkRequest>): void {
  const m = ev.data;
  if (m.type === "walk") {
    walk(m);
    return;
  }
  units.request(m);
  schedule();
}

// ── a helper of the mass ──
const ctxs = new Map<number, { c: PieceCtx; look: ((k: number) => number) | undefined }>();

function onTask(from: MessagePort, ev: MessageEvent<PieceCtx | PieceTask>): void {
  const m = ev.data;
  if (m.type === "ctx") {
    ctxs.set(m.serial, { c: m, look: m.look ? lookFn(m.look) : undefined });
    while (ctxs.size > HELPER_KEEPS) ctxs.delete(ctxs.keys().next().value!);
    return;
  }
  const c = ctxs.get(m.serial);
  if (!c) {
    from.postMessage({ type: "piece-lost", ticket: m.ticket });
    return;
  }
  const stages: Record<string, number> = {};
  const t0 = performance.now();
  const mesh = makePiece(c.c, c.look, m, m.own, stages, m.grows);
  from.postMessage({ type: "piece-done", ticket: m.ticket, mesh, ms: performance.now() - t0, stages } satisfies PieceDone, buffersOf(mesh));
}

function buffersOf(mesh: FuseMesh): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const a of [mesh.position, mesh.normal, mesh.color, mesh.extra, mesh.index, mesh.anchor, mesh.growA, mesh.growB, mesh.late, mesh.side, mesh.blend, mesh.key0, mesh.key1, mesh.key2]) if (a) out.add(a.buffer as ArrayBuffer);
  return [...out];
}

type FromView =
  | { type: "port"; port: MessagePort }
  | { type: "events"; add: PEvent[]; reset?: boolean }
  /** To the worker of the mass: helpers to hand pieces to, and helpers that are no more. */
  | { type: "helpers"; add?: { id: number; port: MessagePort }[]; remove?: number[] }
  /** To a helper: its end of the channel to the worker of the mass. */
  | { type: "helper"; port: MessagePort };

self.onmessage = (ev: MessageEvent<FromView>) => {
  const m = ev.data;
  if (m.type === "port") {
    port = m.port;
    port.onmessage = onPort;
    return;
  }
  if (m.type === "helper") {
    const p = m.port;
    p.onmessage = (e: MessageEvent<PieceCtx | PieceTask>) => onTask(p, e);
    return;
  }
  if (m.type === "helpers") {
    for (const id of m.remove ?? []) {
      const hp = helpers.find((q) => q.id === id);
      if (!hp) continue;
      hp.port.onmessage = null;
      hp.port.close();
      units.cancel(id);
    }
    helpers = helpers.filter((q) => !(m.remove ?? []).includes(q.id));
    for (const { id, port: p } of m.add ?? []) {
      const hp: Helper = { id, port: p, told: [], busy: false };
      p.onmessage = (e: MessageEvent<PieceDone | { type: "piece-lost"; ticket: number }>) => onHelper(hp, e);
      helpers.push(hp);
    }
    schedule();
    return;
  }
  if (m.type === "events") {
    if (m.reset) {
      pres.length = 0;
      ids.clear();
    }
    // (the ways read where the workers were, and nothing else of the log)
    for (const e of m.add) {
      if (ids.has(e.id)) continue;
      ids.add(e.id);
      if (e.r === "worker" && e.k === "p") pres.push(e);
    }
  }
};

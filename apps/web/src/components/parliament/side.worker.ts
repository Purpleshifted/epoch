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

import { FuseUnits, lookFn, makePiece, type PieceCtx, type PieceDone, type PieceTask, type UnitFused, type UnitRequest, type WholePieceBack, type WholePieces } from "@/lib/parliament/fuseUnits";
import type { FuseMesh } from "@/lib/parliament/fuse";
import { MeshoptSimplifier } from "three/examples/jsm/libs/meshopt_simplifier.module.js";
import { walkways, type WalkRequest, type WalkResult } from "@/lib/parliament/walkways";
import type { PEvent } from "@/lib/parliament/types";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let port: MessagePort | null = null;

// ── the mass ──
const units = new FuseUnits();
// (fewer triangles for the settled chunks — fuseUnits simplifyMesh: meshoptimizer's simplifier, index only, the chunk's
// open edges locked, the surface moved by at most half a voxel; nothing until its WASM is ready, nothing at ratio 0)
MeshoptSimplifier.ready.then(() => {
  units.simplifier = (indices, positions, lock, target, errorAbs) => MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, new Float32Array(0), 0, [], lock, target, errorAbs, ["LockBorder", "ErrorAbsolute"])[0];
  schedule();
});
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
/** How many jobs a helper is told of before the oldest is forgotten (a helper keeps the latest per ground; a job this
 *  side thinks it knows and the helper does not is asked for again — piece-lost). */
const TOLD_KEPT = 8;

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
  // (a piece of the model's building: back to the model — or, the helper not knowing its job, handed again)
  const r = relayOut.get(m.ticket);
  if (r) {
    relayOut.delete(m.ticket);
    if (m.type === "piece-lost") {
      hp.told = [];
      if (r.serial === relaySerial) relayQ.unshift({ ctx: r.ctx, task: r.task, key: r.key, serial: r.serial });
    } else if (r.serial === relaySerial) relayBack(r.serial, r.key, m.mesh, m.ms);
    schedule();
    return;
  }
  if (m.type === "piece-lost") {
    // (it did not know the job — it is told again)
    hp.told = [];
    units.cancel(hp.id, m.ticket);
  } else units.complete(m);
  schedule();
}

// ── WHOLE STAGES: A BUILDING'S PIECES, MADE HERE FOR THE MODEL'S WORKER (spaceModel fuseBuildings, 2026-11-28) ──
// The model's worker hands over the pieces of the building it is making (WholePieces); they go before this side's
// own, one to each idle helper (or made here, with none), and each is sent back to the model as it is done. A new
// serial replaces what was handed before; what comes back of an older one is let go.
/** Tickets of these pieces: far above this side's own (FuseUnits counts from 1). */
let relayTicket = 1_000_000_000;
let relaySerial = -1;
const relayQ: { ctx: PieceCtx; task: PieceTask; key: string; serial: number }[] = [];
const relayOut = new Map<number, { ctx: PieceCtx; task: PieceTask; key: string; serial: number; hid?: number }>();
let relayLook: { serial: number; fn: ((k: number) => number) | undefined } | null = null;

function relayBack(serial: number, key: string, mesh: FuseMesh, ms: number): void {
  port?.postMessage({ type: "whole-piece", serial, key, mesh, ms } satisfies WholePieceBack, buffersOf(mesh));
}

function relayTake(m: WholePieces): void {
  relaySerial = m.serial;
  relayQ.length = 0;
  if (!m.ctx) return;
  for (const t of m.tasks) relayQ.push({ ctx: m.ctx, task: { ...t, ticket: relayTicket++ }, key: t.key, serial: m.serial });
}

/** One piece of the model's building: to an idle helper each, or made here (no helpers). Whether any was. */
function relayWork(): boolean {
  if (!relayQ.length) return false;
  if (!helpers.length) {
    const r = relayQ.shift()!;
    if (relayLook?.serial !== r.serial) relayLook = { serial: r.serial, fn: r.ctx.look ? lookFn(r.ctx.look) : undefined };
    const t0 = performance.now();
    const mesh = makePiece(r.ctx, relayLook.fn, r.task, [], {}, false);
    relayBack(r.serial, r.key, mesh, performance.now() - t0);
    return true;
  }
  let out = false;
  for (const hp of helpers) {
    if (hp.busy || !relayQ.length) continue;
    const r = relayQ.shift()!;
    relayOut.set(r.task.ticket, { ...r, hid: hp.id });
    hand(hp, { ctx: r.ctx, task: r.task });
    out = true;
  }
  return out;
}

/** Make a piece (no helpers) or hand one to every idle helper. Whether anything was made or handed out. */
function work(): boolean {
  // (the model's building first: it waits for all of its pieces)
  if (relayQ.length) {
    const did = relayWork();
    if (!helpers.length || !helpers.some((h) => !h.busy)) return did;
    return (helpers.length ? workUnits() : false) || did;
  }
  return workUnits();
}

function workUnits(): boolean {
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
  // (nothing to make: one settled chunk may be given fewer triangles — sent at the next flush)
  if (made === null && units.settleSimplify()) schedule(EMIT_MS);
  // (a piece dissolving off the screen is let go when its dissolve is over: fuseUnits sweep)
  const wake = units.sweep();
  // (nothing was made: every piece left is one that stands and rests — looked at again when the first of them may be)
  if (left && made !== null) schedule();
  else if (units.hasDirty()) schedule(EMIT_MS);
  else if (left && units.waitMs < Infinity) schedule(Math.min(units.waitMs + 20, wake + 20, 5000));
  else if (wake < Infinity) schedule(Math.min(wake + 20, 5000));
  // (the model's building has pieces still to hand out, and there is someone to make them)
  if (relayQ.length && (!helpers.length || helpers.some((h) => !h.busy))) schedule();
}

// ── the ways ──
const pres: PEvent[] = [];
const ids = new Set<string>();

function walk(m: WalkRequest): void {
  const t0 = performance.now();
  const walks = walkways(pres, m.seeds, m.cfg, m.opts);
  port?.postMessage({ type: "walks", serial: m.serial, walks, ms: performance.now() - t0 } satisfies WalkResult);
}

function onPort(ev: MessageEvent<UnitRequest | WalkRequest | WholePieces>): void {
  const m = ev.data;
  if (m.type === "walk") {
    walk(m);
    return;
  }
  if (m.type === "whole-pieces") {
    relayTake(m);
    schedule();
    return;
  }
  units.request(m);
  // (a ground that is no more, or nothing at all: the helpers let go of what they were told of it — no dead state kept)
  if (m.type === "drop" || m.type === "reset") for (const hp of helpers) hp.port.postMessage({ type: "forget", id: m.type === "drop" ? m.id : undefined });
  schedule();
}

// ── a helper of the mass ──
/** The latest job's context per ground (a helper is handed one piece at a time, always of the ground's latest job). */
const ctxs = new Map<string, { c: PieceCtx; look: ((k: number) => number) | undefined }>();

function onTask(from: MessagePort, ev: MessageEvent<PieceCtx | PieceTask | { type: "forget"; id?: string }>): void {
  const m = ev.data;
  if (m.type === "forget") {
    if (m.id === undefined) ctxs.clear();
    else ctxs.delete(m.id);
    return;
  }
  if (m.type === "ctx") {
    ctxs.set(m.id, { c: m, look: m.look ? lookFn(m.look) : undefined });
    return;
  }
  const c = ctxs.get(m.id);
  if (!c || c.c.serial !== m.serial) {
    from.postMessage({ type: "piece-lost", ticket: m.ticket });
    return;
  }
  const stages: Record<string, number> = {};
  const t0 = performance.now();
  const mesh = makePiece(c.c, c.look, m, m.own, stages, m.grows);
  from.postMessage({ type: "piece-done", ticket: m.ticket, mesh, ms: performance.now() - t0, stages, sentAt: performance.timeOrigin + performance.now() } satisfies PieceDone, buffersOf(mesh));
}

function buffersOf(mesh: FuseMesh): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const a of [mesh.position, mesh.normal, mesh.color, mesh.extra, mesh.index, mesh.anchor, mesh.growA, mesh.growB, mesh.late, mesh.side, mesh.blend]) if (a) out.add(a.buffer as ArrayBuffer);
  return [...out];
}

type FromView =
  | { type: "port"; port: MessagePort }
  | { type: "events"; add: PEvent[]; reset?: boolean }
  /** To the worker of the mass: helpers to hand pieces to, and helpers that are no more. */
  | { type: "helpers"; add?: { id: number; port: MessagePort }[]; remove?: number[] }
  /** To a helper: its end of the channel to the worker of the mass. */
  | { type: "helper"; port: MessagePort }
  /** To the worker of the mass: the share of triangles to take off the settled chunks (렌더 › 작업 분담). */
  | { type: "simplify"; ratio: number };

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
  if (m.type === "simplify") {
    units.setSimplify(m.ratio);
    schedule();
    return;
  }
  if (m.type === "helpers") {
    for (const id of m.remove ?? []) {
      const hp = helpers.find((q) => q.id === id);
      if (!hp) continue;
      hp.port.onmessage = null;
      hp.port.close();
      units.cancel(id);
      // (the model's pieces it had: handed again)
      for (const [t, r] of [...relayOut]) if (r.hid === id) {
        relayOut.delete(t);
        if (r.serial === relaySerial) relayQ.unshift({ ctx: r.ctx, task: r.task, key: r.key, serial: r.serial });
      }
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

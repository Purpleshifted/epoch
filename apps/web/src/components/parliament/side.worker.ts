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
 * One file for both: an instance is only ever sent one kind of work.
 */

import { FuseUnits, type UnitFused, type UnitRequest } from "@/lib/parliament/fuseUnits";
import { walkways, type WalkRequest, type WalkResult } from "@/lib/parliament/walkways";
import type { PEvent } from "@/lib/parliament/types";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let port: MessagePort | null = null;

// ── the mass ──
const units = new FuseUnits();
/** At least this long between two messages to the view (ms): a chunk is merged and sent anew each time. */
const EMIT_MS = 350;
let scheduled = false;
let lastEmit = 0;

function schedule(ms = 0): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(turn, ms);
}

/** One piece, then back to the event loop: what the model says meanwhile (a building's parts are other than they were,
 *  a building is no more) is taken before the next piece is chosen. */
function turn(): void {
  scheduled = false;
  const made = units.step();
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

type FromView = { type: "port"; port: MessagePort } | { type: "events"; add: PEvent[]; reset?: boolean };

self.onmessage = (ev: MessageEvent<FromView>) => {
  const m = ev.data;
  if (m.type === "port") {
    port = m.port;
    port.onmessage = onPort;
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

/// <reference lib="webworker" />
/**
 * The 3D timespace's computation, off the main thread: a SpaceModel (lib/parliament/spaceModel.ts) fed with the
 * event log. The view posts new events and compute requests; every result's buffers are transferred, not copied.
 *
 * COMPUTE REQUESTS COALESCE (2026-10-31): the view posts a request every tick once the one in flight is older than
 * 15 s, so a heavy world (a compute of 45 s) piled up ninety stale requests per compute and the model's present fell
 * hours behind the clock — the camera, following the latest event, looked at empty space above the world (the artist:
 * "the stages are on the readout but nothing is there"). Events messages are applied at once (cheap, and they must
 * precede the compute); compute requests received while one waits are merged into one, the newest's clock, with
 * the vegetation / fuse / reclaim parts any dropped one asked for.
 */

import { SpaceModel, handleSpaceRequest, mergeComputeRequests, type SpaceRequest } from "@/lib/parliament/spaceModel";

const model = new SpaceModel();
const scope = self as unknown as DedicatedWorkerGlobalScope;

type Compute = Extract<SpaceRequest, { type: "compute" }>;
let pending: Compute | null = null;
let scheduled = false;

function run() {
  scheduled = false;
  const m = pending;
  pending = null;
  if (!m) return;
  const r = handleSpaceRequest(model, m);
  if (r) scope.postMessage(r.out, r.transfer);
}

self.onmessage = (ev: MessageEvent<SpaceRequest>) => {
  const m = ev.data;
  if (m.type !== "compute") {
    const r = handleSpaceRequest(model, m);
    if (r) scope.postMessage(r.out, r.transfer);
    return;
  }
  pending = mergeComputeRequests(pending, m);
  if (!scheduled) {
    scheduled = true;
    // a macrotask: every compute message already queued behind this one is merged in before the model runs
    setTimeout(run, 0);
  }
};

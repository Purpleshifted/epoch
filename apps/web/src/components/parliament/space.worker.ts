/// <reference lib="webworker" />
/**
 * The 3D timespace's computation, off the main thread: a SpaceModel (lib/parliament/spaceModel.ts) fed with the
 * event log. The view posts new events and compute requests; every result's buffers are transferred, not copied.
 */

import { SpaceModel, handleSpaceRequest, type SpaceRequest } from "@/lib/parliament/spaceModel";

const model = new SpaceModel();

self.onmessage = (ev: MessageEvent<SpaceRequest>) => {
  const r = handleSpaceRequest(model, ev.data);
  if (r) (self as unknown as DedicatedWorkerGlobalScope).postMessage(r.out, r.transfer);
};

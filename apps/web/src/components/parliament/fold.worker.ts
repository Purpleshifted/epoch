/// <reference lib="webworker" />
/**
 * The player's growing fold, off the main thread (lib/parliament/foldClient.ts). Readings are asked for one at a time
 * per kind, so nothing piles up here while a long one runs.
 */

import { FoldHost, type FoldWorkerMessage } from "@/lib/parliament/foldClient";

let host: FoldHost | null = null;

self.onmessage = (ev: MessageEvent<FoldWorkerMessage>) => {
  const m = ev.data;
  if (m.type === "init") {
    host = new FoldHost(m.cfg, m.opts);
    return;
  }
  const reply = host?.handle(m);
  if (reply) (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);
};

"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `onTick` about every `periodMs`, also while the tab is hidden.
 *
 * requestAnimationFrame (useFrame) stops in a hidden tab and setInterval is throttled there (to 1/s, later to
 * 1/min), so the tick comes from a tiny Web Worker, whose timers keep running; setInterval is the fallback.
 * Ticks can still arrive late or in bursts: callers must work from the wall clock (see dueSamples).
 */
export function useTicker(periodMs: number, onTick: () => void): void {
  const cb = useRef(onTick);
  useEffect(() => {
    cb.current = onTick;
  });

  useEffect(() => {
    const fire = () => cb.current();
    let interval: ReturnType<typeof setInterval> | null = null;
    let worker: Worker | null = null;
    let url: string | null = null;
    const fallback = () => {
      worker?.terminate();
      worker = null;
      if (interval === null) interval = setInterval(fire, periodMs);
    };
    try {
      url = URL.createObjectURL(new Blob([`setInterval(function(){postMessage(0)},${Math.max(16, periodMs | 0)});`], { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = fire;
      worker.onerror = fallback;
    } catch {
      fallback();
    }
    return () => {
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      if (interval !== null) clearInterval(interval);
    };
  }, [periodMs]);
}

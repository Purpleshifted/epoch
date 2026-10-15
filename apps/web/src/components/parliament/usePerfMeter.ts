"use client";
/**
 * usePerfMeter — the frame rate on the screen (sound wiring, v4 A1): the artist could not find the numbers in
 * DevTools, so the player page measures itself — fps over the last second, the slowest frame of the last two
 * seconds, frames longer than 50 ms per minute (the lag one feels), and the JS heap where Chrome tells it.
 * One requestAnimationFrame loop; the text updates twice a second.
 */

import { useEffect, useState } from "react";

/** Named spans of main-thread work (ms), kept a minute: which chunk makes the slow frames. */
const spans = new Map<string, { at: number; ms: number }[]>();

/** Record how long a chunk of main-thread work took (RoleField times the fold, the mirror, the sound). */
export function markSpan(name: string, ms: number): void {
  let list = spans.get(name);
  if (!list) {
    list = [];
    spans.set(name, list);
  }
  list.push({ at: performance.now(), ms });
  if (list.length > 600) list.shift();
}

export interface PerfReading {
  fps: number;
  /** The 95th percentile frame interval (ms) over the last two seconds. */
  p95Ms: number;
  /** Frames longer than 50 ms in the last minute. */
  slowPerMin: number;
  /** JS heap (MB), Chrome only; 0 elsewhere. */
  heapMb: number;
  /** The slowest run of each timed chunk in the last minute (ms), slowest first. */
  spans: { name: string; maxMs: number }[];
}

export function usePerfMeter(on: boolean): PerfReading | null {
  const [reading, setReading] = useState<PerfReading | null>(null);
  useEffect(() => {
    if (!on) return;
    const times: number[] = [];
    const slow: number[] = [];
    let last = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const dt = t - last;
      last = t;
      times.push(dt);
      if (dt > 50) slow.push(t);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const id = setInterval(() => {
      const now = performance.now();
      while (slow.length && now - slow[0] > 60000) slow.shift();
      let sum = 0;
      let n = 0;
      const recent: number[] = [];
      for (let i = times.length - 1; i >= 0; i--) {
        sum += times[i];
        n++;
        if (sum <= 2000) recent.push(times[i]);
        if (sum > 2000) break;
      }
      times.splice(0, Math.max(0, times.length - n));
      const lastSec = recent.filter((_, i) => recent.slice(0, i + 1).reduce((a, b) => a + b, 0) <= 1000);
      const fps = lastSec.length ? 1000 / (lastSec.reduce((a, b) => a + b, 0) / lastSec.length) : 0;
      const sorted = recent.slice().sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      const tops: { name: string; maxMs: number }[] = [];
      for (const [name, list] of spans) {
        while (list.length && now - list[0].at > 60000) list.shift();
        if (list.length) tops.push({ name, maxMs: Math.round(Math.max(...list.map((x) => x.ms))) });
      }
      tops.sort((a, b) => b.maxMs - a.maxMs);
      setReading({ fps: Math.round(fps), p95Ms: Math.round(p95), slowPerMin: slow.length, heapMb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : 0, spans: tops });
    }, 500);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, [on]);
  return reading;
}

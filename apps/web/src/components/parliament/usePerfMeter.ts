"use client";
/**
 * usePerfMeter — the frame rate on the screen (sound wiring, v4 A1): the artist could not find the numbers in
 * DevTools, so the player page measures itself — fps over the last second, the slowest frame of the last two
 * seconds, frames longer than 50 ms per minute (the lag one feels), and the JS heap where Chrome tells it.
 * One requestAnimationFrame loop; the text updates twice a second.
 */

import { useEffect, useRef, useState } from "react";

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
  if (ms > 300) perfNote(`in:${name}:${Math.round(ms)}`);
}

const perfNotes: string[] = [];

/** Something worth setting beside the page's stops in `?perf=1`, with its page time. */
export function perfNote(name: string): void {
  if (perfNotes.length < 60) perfNotes.push(`${name}@${(performance.now() / 1000).toFixed(1)}`);
}

/** Last 60 s per span: max, mean, count — readable from DevTools / a hidden tab as `__perfSpans()`. */
export function spanSummary(): Record<string, { maxMs: number; meanMs: number; n: number }> {
  const since = performance.now() - 60_000;
  const out: Record<string, { maxMs: number; meanMs: number; n: number }> = {};
  for (const [name, list] of spans) {
    let max = 0, sum = 0, n = 0;
    for (const e of list) if (e.at >= since) { n++; sum += e.ms; if (e.ms > max) max = e.ms; }
    if (n) out[name] = { maxMs: Math.round(max * 10) / 10, meanMs: Math.round((sum / n) * 10) / 10, n };
  }
  return out;
}
if (typeof window !== "undefined") (window as unknown as { __perfSpans?: typeof spanSummary }).__perfSpans = spanSummary;

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

/** How many readings a run keeps (5 s each). */
const REPORT_READINGS = 72;

/**
 * ?perf=1: this device's own numbers go to the server every 5 s (read back at /api/presets?page=/perf), to measure a
 * real phone from elsewhere: frames, stalls of the main thread (what makes the sound's scheduling late), the spans above.
 */
export function usePerfReport(extra: () => Record<string, unknown>): void {
  const extraRef = useRef(extra);
  useEffect(() => {
    extraRef.current = extra;
  });
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("perf") !== "1") return;
    const run = Date.now().toString(36);
    const nav = navigator as Navigator & { deviceMemory?: number };
    const device = { ua: nav.userAgent.slice(0, 140), url: window.location.search, cores: nav.hardwareConcurrency, memGb: nav.deviceMemory ?? null, size: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio };
    const readings: Record<string, unknown>[] = [];
    let dts: number[] = [];
    let last = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      dts.push(t - last);
      last = t;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // a timer late by this much: the sound books its notes 0.3 s ahead from a timer like this one
    let tickAt = performance.now();
    let stallMax = 0;
    let stalls = 0;
    let stops: [number, number][] = [];
    const tick = setInterval(() => {
      const now = performance.now();
      const gap = now - tickAt - 50;
      if (gap > 300) stops.push([Math.round(tickAt / 100) / 10, Math.round(gap)]);
      tickAt = now;
      if (gap > stallMax) stallMax = gap;
      if (gap > 300) stalls++;
    }, 50);
    // a clock off the page's thread: if it stops with the page, the whole process stood still and not only the page's thread
    let offThreadGap = 0;
    let offThread: Worker | null = null;
    try {
      offThread = new Worker(URL.createObjectURL(new Blob(["let t=performance.now(),m=0;setInterval(()=>{const n=performance.now();m=Math.max(m,n-t-100);t=n},100);onmessage=()=>{postMessage(Math.round(m));m=0}"], { type: "text/javascript" })));
      offThread.onmessage = (e) => (offThreadGap = e.data as number);
    } catch {
      offThread = null;
    }
    // what the phone's audio says of itself: the contexts' states (Safari has "interrupted") and its audio session
    const heard = new WeakSet<object>();
    const listen = (name: string, target: (EventTarget & { state?: string; type?: string; sampleRate?: number }) | null | undefined) => {
      if (!target || heard.has(target)) return;
      heard.add(target);
      perfNote(`${name}:${target.state ?? ""}:${target.sampleRate ?? target.type ?? ""}`);
      target.addEventListener("statechange", () => perfNote(`${name}:${target.state}`));
    };
    const listenAudio = () => {
      const w = window as unknown as { __soundEngine?: { audioContext?: AudioContext | null } | null };
      listen("engine", w.__soundEngine?.audioContext);
      const frame = document.getElementById("noisecraft-iframe") as HTMLIFrameElement | null;
      try {
        listen("patch", (frame?.contentWindow as unknown as { noiseCraftAudioContext?: AudioContext } | null)?.noiseCraftAudioContext);
      } catch {
        /* not ours */
      }
      listen("session", (navigator as unknown as { audioSession?: EventTarget & { state?: string; type?: string } }).audioSession);
    };
    const started = performance.now();
    const report = setInterval(() => {
      listenAudio();
      offThread?.postMessage(0);
      const d = dts.sort((a, b) => a - b);
      const q = (p: number) => Math.round(d[Math.min(d.length - 1, Math.floor(d.length * p))] ?? 0);
      const sum = dts.reduce((a, b) => a + b, 0);
      const reading = { t: Math.round((performance.now() - started) / 1000), fps: sum ? Math.round((d.length * 1000) / sum) : 0, p50: q(0.5), p95: q(0.95), max: Math.round(d[d.length - 1] ?? 0), over50: d.filter((x) => x > 50).length, over100: d.filter((x) => x > 100).length, stallMax: Math.round(stallMax), stalls, stops, offThreadGap, notes: perfNotes.splice(0), spans: spanSummary(), hidden: document.hidden, ...extraRef.current() };
      dts = [];
      stallMax = 0;
      stalls = 0;
      stops = [];
      readings.push(reading);
      if (readings.length > REPORT_READINGS) readings.shift();
      void fetch("/api/presets", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: `parliament.leva:/perf:${run}`, json: { ...device, readings } }) }).catch(() => {});
    }, 5000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(tick);
      clearInterval(report);
      offThread?.terminate();
    };
  }, []);
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

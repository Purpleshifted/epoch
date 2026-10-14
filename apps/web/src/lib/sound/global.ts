/**
 * sound/global.ts — the SPEAKERS of the exhibition room (the global views, docs/sound-logic.md §10).
 *
 * Headphones off, looking at the other monitor: the same motifs that were vivid and interactive in the headset
 * are all here at once — everybody present, every bar, on the same grid — but pushed two octaves down, through one
 * low-pass, into a long hall and a soft saturation, with no space between them. A complex mass that reads as a
 * monotonous landscape of noise: one is a thin line in it. Nothing is interactive here; the only motion is the slow
 * change of who is present and how much weight they have.
 *
 * Same log, same key, same motifs (motif.ts), same grid (sequencer.ts barClock). No HRTF, no bass, no pad, no
 * call and response: those were the headset's.
 */

import { worldKey, type WorldKey } from "./harmony";
import { makeMotif, midiToHz, realize, type Motif } from "./motif";
import { barClock } from "./sequencer";
import type { PEvent } from "@/lib/parliament";

export interface GlobalParams {
  master: number;
  barSec: number;
  /** Octaves the motifs are pushed down. */
  octavesDown: number;
  /** Low-pass over the whole mass (Hz). */
  cutoff: number;
  /** The hall (0..1). */
  hall: number;
  /** Level of one person at full weight (many add up). */
  perVoice: number;
  /** Saturation drive (1 = none). */
  drive: number;
  /** Presence counted over this window (exhibition seconds) before the latest time. */
  windowSec: number;
}

export const DEFAULT_GLOBAL: GlobalParams = {
  master: 0.5,
  barSec: 2,
  octavesDown: 2,
  cutoff: 420,
  hall: 0.7,
  perVoice: 0.1,
  drive: 2.5,
  windowSec: 600,
};

export interface Presence {
  o: string;
  /** 0..1 how much of the window they were there for. */
  weight: number;
}

/** Who is in the log's recent window, by weight (samples / window). Pure. */
export function presences(events: readonly PEvent[], windowSec: number, sampleSec = 1): Presence[] {
  let latest = -Infinity;
  for (const e of events) if (e.s > latest) latest = e.s;
  if (!Number.isFinite(latest)) return [];
  const count = new Map<string, number>();
  for (const e of events) {
    if (e.k !== "p" || e.s < latest - windowSec) continue;
    count.set(e.o, (count.get(e.o) ?? 0) + 1);
  }
  const cap = windowSec / sampleSec;
  return [...count].map(([o, n]) => ({ o, weight: Math.min(1, n / cap) })).sort((a, b) => b.weight - a.weight);
}

function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += ((Math.random() * 2 - 1) - lp) * 0.2;
      d[i] = lp * Math.exp(-i / ctx.sampleRate / decay);
    }
  }
  return buf;
}

function softClip(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

const LOOKAHEAD = 0.3;
const TICK_MS = 80;

export class GlobalEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private lp!: BiquadFilterNode;
  private shaper!: WaveShaperNode;
  private hallSend!: GainNode;
  private bed!: GainNode;
  private motifs = new Map<string, Motif>();
  private present: Presence[] = [];
  private key: WorldKey | null = null;
  private epochMs = 0;
  private params: GlobalParams = DEFAULT_GLOBAL;
  private timer: ReturnType<typeof setInterval> | null = null;
  private planned = -1;

  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  get debug(): { bar: number; voices: number } {
    return { bar: this.planned, voices: this.present.length };
  }

  async start(): Promise<void> {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.shaper = ctx.createWaveShaper();
      this.shaper.curve = softClip(this.params.drive);
      this.shaper.oversample = "2x";
      this.lp = ctx.createBiquadFilter();
      this.lp.type = "lowpass";
      this.lp.frequency.value = this.params.cutoff;
      this.lp.Q.value = 0.7;
      this.lp.connect(this.shaper).connect(this.master).connect(ctx.destination);
      this.hallSend = ctx.createGain();
      this.hallSend.gain.value = this.params.hall;
      const hall = ctx.createConvolver();
      hall.buffer = impulse(ctx, 8, 2.8);
      this.hallSend.connect(hall).connect(this.lp);
      // a bed of low noise that thickens with the crowd
      const n = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let lpv = 0;
      for (let i = 0; i < n; i++) {
        lpv += ((Math.random() * 2 - 1) - lpv) * 0.05;
        d[i] = lpv * 4;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      this.bed = ctx.createGain();
      this.bed.gain.value = 0;
      src.connect(this.bed).connect(this.lp);
      src.start();
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.master.gain.setTargetAtTime(this.params.master, this.ctx.currentTime, 1.5);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
  }

  dispose(): void {
    this.stop();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  /** Every second or so: who is present (presences()), the epoch (grid + key), the knobs. */
  update(present: Presence[], epochMs: number, params: GlobalParams): void {
    this.present = present;
    this.params = params;
    if (this.epochMs !== epochMs) {
      this.epochMs = epochMs;
      this.key = worldKey(String(epochMs));
      this.motifs.clear();
    }
    const ctx = this.ctx;
    if (!ctx || !this.timer) return;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(params.master, t, 1.0);
    this.lp.frequency.setTargetAtTime(params.cutoff, t, 1.0);
    this.hallSend.gain.setTargetAtTime(params.hall, t, 1.0);
    this.bed.gain.setTargetAtTime(Math.min(0.5, present.length * 0.035), t, 2.0);
  }

  private motifOf(id: string): Motif {
    let m = this.motifs.get(id);
    if (!m) {
      m = makeMotif(id);
      this.motifs.set(id, m);
    }
    return m;
  }

  private voiceNote(freq: number, at: number, dur: number, level: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(this.lp);
    g.connect(this.hallSend);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.15);
    g.gain.setTargetAtTime(0, at + dur, 0.6);
    const end = at + dur + 2.5;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = (Math.random() * 2 - 1) * 12;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq * 3;
    o.connect(f).connect(g);
    o.start(at);
    o.stop(end);
    setTimeout(() => g.disconnect(), (end - ctx.currentTime) * 1000 + 100);
  }

  private tick(): void {
    const ctx = this.ctx;
    const key = this.key;
    if (!ctx || !key || ctx.state !== "running" || !this.epochMs) return;
    const p = this.params;
    const now = ctx.currentTime;
    const { bar, start } = barClock(this.epochMs, Date.now(), now, p.barSec);
    if (this.planned < bar) this.planned = bar;
    const next = this.planned + 1;
    const nextStart = start + (next - bar) * p.barSec;
    if (nextStart > now + LOOKAHEAD) return;
    this.planned = next;
    // everybody, every bar, pushed down: the mass
    const down = 12 * p.octavesDown;
    for (const pr of this.present) {
      const m = this.motifOf(pr.o);
      const notes = realize(m, key, null, 0, next, undefined, 0.3);
      const level = p.perVoice * (0.3 + 0.7 * pr.weight);
      for (const n of notes) this.voiceNote(midiToHz(n.pitch - down, m.colour), nextStart + n.at * p.barSec, n.len * p.barSec * 1.6, level);
    }
  }
}

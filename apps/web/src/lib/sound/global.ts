/**
 * sound/global.ts — the SPEAKERS of the exhibition room (the global views, docs/sound-logic.md §10).
 *
 * Headphones off, looking at the other monitor: the same motifs that were vivid and interactive in the headset
 * are all here at once, folded into a landscape of noise with traces of everybody's rhythm in it:
 *
 *   MASS      everybody present in the recent window plays their motif every bar, two octaves down, as a low
 *             sawtooth into one low-pass, a long hall and a soft saturation. Each voice is in ITS OWN key (the
 *             visitor's home key) unless the person is at a building — then in the building's key. So the mass is
 *             polytonal in the open and gathers into one key per building.
 *   TRACES    every person's rhythm cell as a soft tick on the shared grid (a short burst of noise around their
 *             register): the moving come every bar, the still every other bar. The sum of many cells is a shifting
 *             polyrhythm in which the heavier presences stand out — the rhythmic trace of the motifs.
 *   CLUMPS    voices and ticks are panned by WHERE the person is (their x, or the building's x): a building is a
 *             lump in the stereo field, the open ground a scatter.
 *   BREATH    the share of people walking opens the low-pass a little; a still crowd is duller.
 *
 * Nothing is interactive here. Same log, same motifs (motif.ts), same grid (sequencer.ts barClock).
 */

import { buildingKey, homeKey, type Key } from "./harmony";
import { makeMotif, midiToHz, realize, type Motif } from "./motif";
import { barClock } from "./sequencer";
import type { PEvent, Slab } from "@/lib/parliament";

export interface GlobalParams {
  master: number;
  barSec: number;
  /** Octaves the motifs are pushed down. */
  octavesDown: number;
  /** Low-pass over the mass (Hz) when nobody walks; opens with the walking share. */
  cutoff: number;
  /** The hall (0..1). */
  hall: number;
  /** Level of one person's voice at full weight (many add up). */
  perVoice: number;
  /** Level of one person's rhythm tick at full weight. */
  tickLevel: number;
  /** Stereo spread of the clumps (0 = mono, 1 = full). */
  spread: number;
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
  tickLevel: 0.35,
  spread: 0.8,
  drive: 2.5,
  windowSec: 600,
};

export interface Presence {
  o: string;
  /** 0..1 how much of the window they were there for. */
  weight: number;
  /** Where they were last. */
  x: number;
  z: number;
  /** World units / s between their last two samples (0 = still). */
  speed: number;
  /** The building (slab key) they are at, or null. */
  building: string | null;
  /** The building's position when at one (for the clump). */
  bx?: number;
}

/** A slab a person is on or beside (world units from its cell centre). */
const AT_BUILDING = 2.5;

/** Who is in the log's recent window: weight, last position, speed, the building they are at. Pure. */
export function presences(events: readonly PEvent[], windowSec: number, slabs: readonly Slab[] = [], sampleSec = 1): Presence[] {
  let latest = -Infinity;
  for (const e of events) if (e.s > latest) latest = e.s;
  if (!Number.isFinite(latest)) return [];
  const byOwner = new Map<string, { n: number; last: PEvent; prev: PEvent | null }>();
  for (const e of events) {
    if (e.k !== "p" || e.s < latest - windowSec) continue;
    const r = byOwner.get(e.o);
    if (!r) byOwner.set(e.o, { n: 1, last: e, prev: null });
    else {
      r.n++;
      if (e.s > r.last.s) {
        r.prev = r.last;
        r.last = e;
      } else if (!r.prev || e.s > r.prev.s) r.prev = e;
    }
  }
  const cap = windowSec / sampleSec;
  const built = slabs.filter((s) => s.h >= 0.15);
  const out: Presence[] = [];
  for (const [o, r] of byOwner) {
    const { last, prev } = r;
    const dt = prev ? Math.max(0.5, last.s - prev.s) : 1;
    const speed = prev ? Math.hypot(last.x - prev.x, last.z - prev.z) / dt : 0;
    let building: string | null = null;
    let bx: number | undefined;
    let best = AT_BUILDING;
    for (const s of built) {
      const d = Math.hypot(s.x - last.x, s.z - last.z);
      if (d < best) {
        best = d;
        building = s.key;
        bx = s.x;
      }
    }
    out.push({ o, weight: Math.min(1, r.n / cap), x: last.x, z: last.z, speed, building, bx });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** Where a presence sits in the stereo field: by its building's x, else its own; `extent` world units = full pan. */
export function panOf(p: Presence, extent: number, spread: number): number {
  const x = p.building != null && p.bx != null ? p.bx : p.x;
  return Math.max(-1, Math.min(1, x / Math.max(1, extent))) * spread;
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
  private tickBus!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private motifs = new Map<string, Motif>();
  private keys = new Map<string, Key>();
  private present: Presence[] = [];
  private extent = 20;
  private epochMs = 0;
  private params: GlobalParams = DEFAULT_GLOBAL;
  private timer: ReturnType<typeof setInterval> | null = null;
  private planned = -1;

  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  get debug(): { bar: number; voices: number; atBuildings: number; moving: number } {
    return {
      bar: this.planned,
      voices: this.present.length,
      atBuildings: this.present.filter((p) => p.building).length,
      moving: this.present.filter((p) => p.speed > 0.5).length,
    };
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
      // the rhythm traces: their own, gentler low-pass straight into the saturation (they must stay audible)
      this.tickBus = ctx.createBiquadFilter();
      this.tickBus.type = "lowpass";
      this.tickBus.frequency.value = 1600;
      this.tickBus.connect(this.shaper);
      this.tickBus.connect(this.hallSend);
      // noise: a 2 s loop shared by the ticks, and a bed of low noise that thickens with the crowd
      const n = Math.floor(ctx.sampleRate * 2);
      this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const w = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) w[i] = Math.random() * 2 - 1;
      const bedBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = bedBuf.getChannelData(0);
      let lpv = 0;
      for (let i = 0; i < n; i++) {
        lpv += (w[i] - lpv) * 0.05;
        d[i] = lpv * 4;
      }
      const src = ctx.createBufferSource();
      src.buffer = bedBuf;
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

  /** Every second or so: who is present (presences()), the epoch (grid), the knobs. */
  update(present: Presence[], epochMs: number, params: GlobalParams): void {
    this.present = present;
    this.params = params;
    if (this.epochMs !== epochMs) {
      this.epochMs = epochMs;
      this.motifs.clear();
      this.keys.clear();
    }
    let ext = 10;
    for (const p of present) ext = Math.max(ext, Math.abs(p.x), Math.abs(p.bx ?? 0));
    this.extent = ext;
    const ctx = this.ctx;
    if (!ctx || !this.timer) return;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(params.master, t, 1.0);
    const moving = present.length ? present.filter((p) => p.speed > 0.5).length / present.length : 0;
    this.lp.frequency.setTargetAtTime(params.cutoff * (1 + 0.6 * moving), t, 1.5);
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

  private keyOf(p: Presence): Key {
    const id = p.building ? "b:" + p.building : "h:" + p.o;
    let k = this.keys.get(id);
    if (!k) {
      k = p.building ? buildingKey(p.building) : homeKey(p.o);
      this.keys.set(id, k);
    }
    return k;
  }

  private voiceNote(freq: number, at: number, dur: number, level: number, pan: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const pn = ctx.createStereoPanner();
    pn.pan.value = pan;
    g.connect(pn);
    pn.connect(this.lp);
    pn.connect(this.hallSend);
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
    setTimeout(() => {
      g.disconnect();
      pn.disconnect();
    }, (end - ctx.currentTime) * 1000 + 100);
  }

  /** A rhythm trace: a short burst of noise around `freq`, panned. */
  private tickNote(freq: number, at: number, level: number, pan: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const pn = ctx.createStereoPanner();
    pn.pan.value = pan;
    g.connect(pn).connect(this.tickBus);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.004);
    g.gain.setTargetAtTime(0, at + 0.01, 0.045);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 2.5;
    src.connect(bp).connect(g);
    src.start(at);
    src.stop(at + 0.4);
    setTimeout(() => {
      g.disconnect();
      pn.disconnect();
    }, (at + 0.4 - ctx.currentTime) * 1000 + 100);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.epochMs) return;
    const p = this.params;
    const now = ctx.currentTime;
    const { bar, start } = barClock(this.epochMs, Date.now(), now, p.barSec);
    if (this.planned < bar) this.planned = bar;
    const next = this.planned + 1;
    const nextStart = start + (next - bar) * p.barSec;
    if (nextStart > now + LOOKAHEAD) return;
    this.planned = next;
    const down = 12 * p.octavesDown;
    for (const pr of this.present) {
      const m = this.motifOf(pr.o);
      const key = this.keyOf(pr);
      const pan = panOf(pr, this.extent, p.spread);
      const w = 0.3 + 0.7 * pr.weight;
      // the mass: everybody, every bar, pushed down, in their key (or their building's)
      const notes = realize(m, key, null, 0, next, undefined, 0.3);
      for (const n of notes) this.voiceNote(midiToHz(n.pitch - down, m.colour), nextStart + n.at * p.barSec, n.len * p.barSec * 1.6, p.perVoice * w, pan);
      // the traces: their rhythm cell, every bar when walking, every other bar when still
      if (pr.speed > 0.5 || next % 2 === 0) {
        const f = midiToHz(m.base - 12);
        for (const on of m.onsets) this.tickNote(f, nextStart + (on / m.steps) * p.barSec, p.tickLevel * w * 0.5, pan);
      }
    }
  }
}

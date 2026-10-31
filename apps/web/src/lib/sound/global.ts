/**
 * sound/global.ts — the SPEAKERS of the exhibition room: the low noise under the global views (the wall, the
 * timespace). Brought back from the warehouse branch (feature/sound, 2026-10-14) for the November show — the artist:
 * "글로벌 사운드(lf 노이즈) 폴리싱하기 … 지금 저역 노이즈 예전버전" (docs/sound-logic.md §10b).
 *
 * Headphones off, looking at the wall: the same motifs that were vivid in the headset are all here at once, folded
 * into a landscape of low noise with traces of everybody's rhythm in it:
 *
 *   MASS      the heaviest presences play their motif every bar, two octaves down, as a low sawtooth into one
 *             low-pass, a short synthetic room and a soft saturation. Each voice is in ITS OWN home key
 *             (tonality.ts homeKey) unless the person stands in a building's zone — then in the building's key, the
 *             same one the headset hears there (bestKey over its contributors). Polytonal in the open, one key per
 *             building.
 *   BED       a floor of low-passed noise that thickens with the crowd.
 *   TRACES    every person's rhythm cell as a soft tick on the shared grid (a short burst of noise around their
 *             register): the moving every bar, the still every other bar.
 *   (no spatialisation — the artist, 2026-10-31: "글로벌 사운드가 엄청 입체음향 들어가고 무거워질 필요가 전혀 없으니")
 *   BREATH    the share of people walking opens the low-pass a little; a still crowd is duller.
 *
 * Nothing is interactive here. Same log, same motifs (motif.ts), same grid (sequencer.ts barClock).
 */

import type { WorldKey } from "./harmony";
import { makeMotif, midiToHz, realize, type Motif } from "./motif";
import { barClock } from "./sequencer";
import { buildingsOf, type BuildingSignal } from "./signals";
import { bestKey, homeKey } from "./tonality";
import { applyOutput, makeLimiter, onOutputChange } from "./output";
import { wrapDist, type PEvent, type Slab } from "@/lib/parliament";

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
  /** The noise bed: level per person present, and its ceiling. */
  bedPer: number;
  bedMax: number;
  /** The bed's floor when nobody is there (0 = an empty world is silent — the design so far; the artist decides by ear). */
  bedFloor: number;
  /** Saturation drive (1 = none). */
  drive: number;
  /** Presence counted over this window (exhibition seconds) before the latest time. */
  windowSec: number;
  /** The heaviest presences that get a voice each bar (everybody keeps their ticks): the render thread's budget. */
  maxVoices: number;
}

export const DEFAULT_GLOBAL: GlobalParams = {
  master: 0.35, // 0.5 until 10/30: with the headset in the same Chrome the sum clipped (now also a limiter)
  barSec: 2,
  octavesDown: 2,
  cutoff: 420,
  hall: 0.7,
  perVoice: 0.1,
  tickLevel: 0.35,
  bedPer: 0.01,
  bedMax: 0.12,
  bedFloor: 0,
  drive: 2.5,
  windowSec: 600,
  maxVoices: 6, // 14 → 8 → 6 (10/31 — the artist: as light as possible)
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
  /** The building whose zone they stand in (its id), or null. */
  building: string | null;
  /** That building's x (for the clump). */
  bx?: number;
}

/** Who is in the log's recent window: weight, last position, speed, the building zone they stand in. Pure. */
export function presences(events: readonly PEvent[], windowSec: number, buildings: readonly BuildingSignal[] = [], sampleSec = 1): Presence[] {
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
  const out: Presence[] = [];
  for (const [o, r] of byOwner) {
    const { last, prev } = r;
    const dt = prev ? Math.max(0.5, last.s - prev.s) : 1;
    const speed = prev ? wrapDist(last.x, last.z, prev.x, prev.z) / dt : 0;
    let building: string | null = null;
    let bx: number | undefined;
    let best = Infinity;
    for (const b of buildings) {
      const d = wrapDist(b.x, b.z, last.x, last.z);
      if (d <= b.radius && d < best) {
        best = d;
        building = b.id;
        bx = b.x;
      }
    }
    out.push({ o, weight: Math.min(1, r.n / cap), x: last.x, z: last.z, speed, building, bx });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** The buildings of a snapshot's slabs (signals.ts buildingsOf), for presences(). */
export function globalBuildings(slabs: readonly Slab[]): BuildingSignal[] {
  return buildingsOf(slabs);
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

/**
 * How far ahead bars are planned (s). Generous on purpose: the wall's main thread stalls (a big frame, a fold — up to
 * ~2 s measured with 22 bots, 2026-10-30), and a bar not planned when its start passes is lost — the room went "plays,
 * then cuts". Notes already scheduled on the audio clock play through any stall. 0.3 → 1.5 s (10/29) → 3.5 s (10/30).
 * The cost: a change in who is present is heard a few seconds late, which a landscape of noise does not mind.
 */
const LOOKAHEAD = 3.5;
/** People planned per tick: a bar is planned in small slices, never as one long task (34 voices took up to 0.7 s). */
const VOICES_PER_SLICE = 6;
/** A bar still unfinished this close to its start is finished at once, whatever it costs. */
const MUST_FINISH = 0.5;
const TICK_MS = 80;
/** A person's channel is dropped after this many bars without them. */
const CHANNEL_IDLE_BARS = 8;
/**
 * Hard caps on what is alive on the render thread (2026-10-31): on the artist's loaded machine the wall's audio
 * clock fell to 0.28× real time and notes piled up (2673 chains alive) — a loop: more nodes, slower clock, more
 * outstanding notes. Beyond these nothing new is scheduled (counted in stats.shed); the music thins, never stalls.
 */
const MAX_LIVE_VOICES = 200; // 8 voices at a 2 s bar keep ~120 alive (3.5 s of them not yet started): room above that, a wall below the runaway
const MAX_LIVE_TICKS = 40;
/** A note's tail after its length (s): the gain is at ~14 % by then; shorter tails = fewer live chains. */
const VOICE_TAIL = 1.2;

/** One person's colour in the room, reused bar after bar: a low-pass for their voice, a band-pass for their ticks. */
interface Channel {
  /** The voice's colour: one low-pass per person at three times their register (was one per note). */
  filter: BiquadFilterNode;
  /** The tick's colour: one band-pass per person around their register (was one per tick). */
  tickFilter: BiquadFilterNode;
  seenBar: number;
}

/** A bar being planned, a few people per tick. */
interface PendingBar {
  bar: number;
  start: number;
  /** Heaviest first (presences() sorts them). */
  people: Presence[];
  /** How many of them get a voice this bar. */
  voices: number;
  i: number;
}

/** How the planning keeps up (for measuring: window.__globalSound.stats). */
export interface GlobalStats {
  /** Bars fully planned. */
  bars: number;
  /** Bars lost: their start passed before they were planned (a stall longer than the lookahead). */
  lateBars: number;
  /** The smallest lead (s) a bar had left when its planning finished. */
  minLeadSec: number;
  /** The longest / the mean planning slice (ms of main thread per tick). */
  maxSliceMs: number;
  meanSliceMs: number;
  channels: number;
  /** Audio nodes alive now: voice chains (osc + filter + gain) and tick chains (buffer + filter + gain) — the render thread's load. */
  liveVoices: number;
  liveTicks: number;
  /** Notes and ticks scheduled in total. */
  notes: number;
  ticks: number;
  /** Notes and ticks NOT scheduled because the caps were reached. */
  shed: number;
  /** The audio clock's speed against the wall clock over the last seconds (1 = healthy; below ~0.9 the render thread is starved). */
  clockSpeed: number;
}

export class GlobalEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private outputLine = "기본 출력";
  private offOutput: (() => void) | null = null;
  private lp!: BiquadFilterNode;
  private shaper!: WaveShaperNode;
  private hallSend!: GainNode;
  private bed!: GainNode;
  private tickBus!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private motifs = new Map<string, Motif>();
  /** The key of each building (by id), kept between updates so it only moves with a clear margin (bestKey). */
  private buildingKeys = new Map<string, WorldKey>();
  private buildings = new Map<string, BuildingSignal>();
  private present: Presence[] = [];
  private epochMs = 0;
  private params: GlobalParams = DEFAULT_GLOBAL;
  private drive = DEFAULT_GLOBAL.drive;
  private timer: ReturnType<typeof setInterval> | null = null;
  private planned = -1;
  private pending: PendingBar[] = [];
  private channels = new Map<string, Channel>();
  private homeKeys = new Map<string, WorldKey>();
  private slices = { n: 0, sumMs: 0 };
  private _stats: GlobalStats = { bars: 0, lateBars: 0, minLeadSec: Infinity, maxSliceMs: 0, meanSliceMs: 0, channels: 0, liveVoices: 0, liveTicks: 0, notes: 0, ticks: 0, shed: 0, clockSpeed: 1 };
  private clockRef: { ctx: number; wall: number } | null = null;
  /** Runs everything but plays nothing (?sound=mute: measuring in a Claude browser without the artist's speakers). */
  private readonly silent: boolean;

  constructor(opts: { silent?: boolean } = {}) {
    this.silent = !!opts.silent;
  }

  get stats(): GlobalStats {
    return { ...this._stats, meanSliceMs: this.slices.n ? this.slices.sumMs / this.slices.n : 0, channels: this.channels.size };
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running" && this.timer !== null;
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
      const ctx = new AudioContext({ latencyHint: "playback" });
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.shaper = ctx.createWaveShaper();
      this.shaper.curve = softClip(this.params.drive);
      this.drive = this.params.drive;
      this.shaper.oversample = "2x";
      this.lp = ctx.createBiquadFilter();
      this.lp.type = "lowpass";
      this.lp.frequency.value = this.params.cutoff;
      this.lp.Q.value = 0.7;
      this.lp.connect(this.shaper).connect(this.master).connect(makeLimiter(ctx)).connect(ctx.destination);
      // the speakers' own output device, chosen on /v2/sound/output (the default when none)
      void applyOutput(ctx, "speakers").then((s) => (this.outputLine = s));
      this.offOutput = onOutputChange("speakers", () => void applyOutput(ctx, "speakers").then((s) => (this.outputLine = s)));
      this.hallSend = ctx.createGain();
      this.hallSend.gain.value = this.params.hall;
      // the room: no convolver any more (8 s → 5 → 2.5 s → none, 10/31, the artist: as light as possible) — two
      // cross-fed delays with a low-pass in the loop, a diffuse tail of about a second, six nodes in all
      const dA = ctx.createDelay(0.5);
      dA.delayTime.value = 0.071;
      const dB = ctx.createDelay(0.5);
      dB.delayTime.value = 0.113;
      const rlp = ctx.createBiquadFilter();
      rlp.type = "lowpass";
      rlp.frequency.value = 900;
      const fb = ctx.createGain();
      // the two delays are SUMMED into the low-pass and the sum goes back into BOTH: the loop gain is twice this
      // (0.55 howled on 10/31 — loop gain 1.1); 0.28 → 0.56, a tail of about a second
      fb.gain.value = 0.28;
      this.hallSend.connect(dA);
      this.hallSend.connect(dB);
      dA.connect(rlp);
      dB.connect(rlp);
      rlp.connect(fb);
      fb.connect(dA);
      fb.connect(dB);
      rlp.connect(this.lp);
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
    this.master.gain.setTargetAtTime(this.silent ? 0 : this.params.master, this.ctx.currentTime, 1.5);
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
    this.offOutput?.();
    this.offOutput = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  /** Where this engine plays (output.ts). */
  get output(): string {
    return this.outputLine;
  }

  /** Every second or so: who is present (presences()), the buildings, the epoch (grid), the knobs. */
  update(present: Presence[], buildings: readonly BuildingSignal[], epochMs: number, params: GlobalParams): void {
    this.present = present;
    this.params = params;
    this.buildings = new Map(buildings.map((b) => [b.id, b]));
    if (this.epochMs !== epochMs) {
      this.epochMs = epochMs;
      this.motifs.clear();
      this.buildingKeys.clear();
      this.homeKeys.clear();
      this.pending = [];
    }
    // each building's key once a second here (bestKey over its contributors), not per person per bar
    for (const b of buildings) {
      const k = bestKey(b.who, this.buildingKeys.get(b.id) ?? null, 0.15);
      if (k) this.buildingKeys.set(b.id, k);
    }
    // the channels of people gone for a while
    for (const [o, ch] of this.channels) {
      if (ch.seenBar < this.planned - CHANNEL_IDLE_BARS) {
        ch.filter.disconnect();
        ch.tickFilter.disconnect();
        this.channels.delete(o);
      }
    }
    const ctx = this.ctx;
    if (!ctx || !this.timer) return;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.silent ? 0 : params.master, t, 1.0);
    const moving = present.length ? present.filter((p) => p.speed > 0.5).length / present.length : 0;
    this.lp.frequency.setTargetAtTime(params.cutoff * (1 + 0.6 * moving), t, 1.5);
    this.hallSend.gain.setTargetAtTime(params.hall, t, 1.0);
    // the bed of low noise: a faint floor that thickens with the crowd, never a rumble
    this.bed.gain.setTargetAtTime(Math.max(params.bedFloor, Math.min(params.bedMax, present.length * params.bedPer)), t, 2.0);
    if (Math.abs(params.drive - this.drive) > 0.05) {
      this.shaper.curve = softClip(params.drive);
      this.drive = params.drive;
    }
  }

  private motifOf(id: string): Motif {
    let m = this.motifs.get(id);
    if (!m) {
      m = makeMotif(id);
      this.motifs.set(id, m);
    }
    return m;
  }

  /** In a building's zone: the building's key (as the headset hears it there); else the person's home key. */
  private keyOf(p: Presence): WorldKey {
    const k = p.building ? this.buildingKeys.get(p.building) : undefined;
    if (k) return k;
    let h = this.homeKeys.get(p.o);
    if (!h) {
      h = homeKey(p.o);
      this.homeKeys.set(p.o, h);
    }
    return h;
  }

  /** The person's channel (made once, reused): the voice's low-pass into the mass and the hall, the tick's band-pass into the tick bus. */
  private channelOf(o: string, bar: number): Channel {
    let ch = this.channels.get(o);
    if (!ch) {
      const ctx = this.ctx!;
      const m = this.motifOf(o);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = Math.min(2000, 3 * midiToHz(m.base - 12 * this.params.octavesDown));
      filter.connect(this.lp);
      filter.connect(this.hallSend);
      const tickFilter = ctx.createBiquadFilter();
      tickFilter.type = "bandpass";
      tickFilter.frequency.value = midiToHz(m.base - 12);
      tickFilter.Q.value = 2.5;
      tickFilter.connect(this.tickBus);
      ch = { filter, tickFilter, seenBar: bar };
      this.channels.set(o, ch);
    }
    ch.seenBar = bar;
    return ch;
  }

  private voiceNote(freq: number, at: number, dur: number, level: number, out: AudioNode): void {
    if (this._stats.liveVoices >= MAX_LIVE_VOICES) {
      this._stats.shed++;
      return;
    }
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.15);
    g.gain.setTargetAtTime(0, at + dur, 0.6);
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = (Math.random() * 2 - 1) * 12;
    o.connect(g).connect(out); // two nodes a note; the colour (low-pass) is the person's channel
    this._stats.notes++;
    this._stats.liveVoices++;
    o.onended = () => {
      g.disconnect(); // no timer per note: the chain is let go when the oscillator ends
      this._stats.liveVoices--;
    };
    o.start(at);
    o.stop(at + dur + VOICE_TAIL);
  }

  /** A rhythm trace: a short burst of noise, coloured by the person's band-pass (`out`). */
  private tickNote(at: number, level: number, out: AudioNode): void {
    if (this._stats.liveTicks >= MAX_LIVE_TICKS) {
      this._stats.shed++;
      return;
    }
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.004);
    g.gain.setTargetAtTime(0, at + 0.01, 0.045);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.connect(g).connect(out); // two nodes a tick
    this._stats.ticks++;
    this._stats.liveTicks++;
    src.onended = () => {
      g.disconnect();
      this._stats.liveTicks--;
    };
    src.start(at);
    src.stop(at + 0.4);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.epochMs) return;
    const p = this.params;
    const now = ctx.currentTime;
    // the audio clock against the wall clock: a starved render thread shows here before anything is heard
    const wall = performance.now();
    if (!this.clockRef) this.clockRef = { ctx: now, wall };
    else if (wall - this.clockRef.wall >= 2000) {
      const speed = (now - this.clockRef.ctx) / ((wall - this.clockRef.wall) / 1000);
      this._stats.clockSpeed = +(this._stats.clockSpeed * 0.5 + speed * 0.5).toFixed(3);
      this.clockRef = { ctx: now, wall };
    }
    const { bar, start } = barClock(this.epochMs, Date.now(), now, p.barSec);
    // bars that started before they were even queued are lost (a stall longer than the lookahead)
    if (this.planned < 0) this.planned = bar;
    else if (this.planned < bar) {
      this._stats.lateBars += bar - this.planned;
      this.planned = bar;
    }
    // queue every bar that starts within the lookahead, in order, with who is present now
    for (;;) {
      const next = this.planned + 1;
      const nextStart = start + (next - bar) * p.barSec;
      if (nextStart > now + LOOKAHEAD) break;
      this.planned = next;
      // the heaviest presences get a voice (the budget shrinks while the clock is slow); everybody gets their ticks
      const budget = Math.max(2, Math.round(p.maxVoices * Math.max(0.4, Math.min(1, this._stats.clockSpeed))));
      this.pending.push({ bar: next, start: nextStart, people: this.present.slice(), voices: Math.min(budget, this.present.length), i: 0 });
    }
    // plan a few people per tick; a bar close to its start is finished at once
    if (!this.pending.length) return;
    const t0 = performance.now();
    let budget = VOICES_PER_SLICE;
    while (this.pending.length) {
      const pb = this.pending[0];
      const lead = pb.start - ctx.currentTime;
      if (lead <= 0) {
        this._stats.lateBars++;
        this.pending.shift();
        continue;
      }
      const urgent = lead < MUST_FINISH;
      while (pb.i < pb.people.length && (budget > 0 || urgent)) {
        this.planVoice(pb.people[pb.i], pb.bar, pb.start, pb.i < pb.voices);
        pb.i++;
        budget--;
      }
      if (pb.i < pb.people.length) break;
      this.pending.shift();
      this._stats.bars++;
      this._stats.minLeadSec = Math.min(this._stats.minLeadSec, pb.start - ctx.currentTime);
      if (budget <= 0) break;
    }
    const ms = performance.now() - t0;
    this.slices.n++;
    this.slices.sumMs += ms;
    this._stats.maxSliceMs = Math.max(this._stats.maxSliceMs, ms);
  }

  /** One person's notes (if within the voice budget) and ticks for bar `bar`, starting at `barStart` on the audio clock. */
  private planVoice(pr: Presence, bar: number, barStart: number, withVoice: boolean): void {
    const p = this.params;
    const ch = this.channelOf(pr.o, bar);
    const m = this.motifOf(pr.o);
    const w = 0.3 + 0.7 * pr.weight;
    const down = 12 * p.octavesDown;
    // the mass: the heaviest, every bar, pushed down, in their key (or their building's)
    if (withVoice) for (const n of realize(m, this.keyOf(pr), null, 0, bar)) this.voiceNote(midiToHz(n.pitch - down, m.colour), barStart + n.at * p.barSec, n.len * p.barSec * 1.6, p.perVoice * w, ch.filter);
    // the traces: everybody's rhythm cell every other bar (the walking came every bar until 10/31)
    if (bar % 2 === 0) for (const on of m.onsets) this.tickNote(barStart + (on / m.steps) * p.barSec, p.tickLevel * w * 0.5, ch.tickFilter);
  }
}

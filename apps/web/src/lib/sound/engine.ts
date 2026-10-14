/**
 * sound/engine.ts — the PLAYER's ears: Web Audio, no dependencies.
 *
 *   my voice        my motif (motif.ts) as a running arpeggio. Walking speed → tempo; the trodden ground under my
 *                   feet → how regular the notes fall (a formed path = steady steps, open ground = loose timing).
 *   other voices    everyone within earshot plays THEIR motif, panned left/right by where they stand and fading
 *                   with distance. Bots (and later: replayed past visitors) are blurred — a duller, slowly drifting
 *                   tone — so they read as echoes, not as people.
 *   chord           when I STAY among others the notes are held (longer release) and the reverb opens: staying is
 *                   what builds, and here it is the moment that sounds beautiful.
 *   the dull        concrete nearby closes a low-pass over everything (a building is a place where sound goes dull).
 *   grass           vegetation around me is a faint bright noise.
 *
 * Signals come from signals.ts (the same log the ground is folded from); the mapping ranges are Leva knobs
 * (SoundParams). The AudioContext can only start from a user gesture (mobile): call `start()` from one.
 */

import { cycleSeconds, makeMotif, motifNotes, type Motif, type MotifNote } from "./motif";
import type { PersonalSignals } from "./signals";

export interface SoundParams {
  /** Master level 0..1. */
  master: number;
  /** Arpeggio tempo when still / at `speedMax` (BPM, see cycleSeconds). */
  bpmStill: number;
  bpmFast: number;
  /** Walking speed (world/s) that reaches bpmFast. */
  speedMax: number;
  /** Reverb send when staying among others (0..1). */
  reverbMax: number;
  /** Timing jitter (s) of a note on untrodden ground; 0 on a formed path. */
  jitterMax: number;
  /** Low-pass cutoff (Hz) in the open / on concrete. */
  lpOpen: number;
  lpSealed: number;
  /** Level of the vegetation noise at full density (0..1). */
  noiseMax: number;
  /** How far (world) others are heard. */
  hearRadius: number;
  /** Level of another person's voice when right next to me (0..1, mine is 1). */
  othersLevel: number;
  /** How blurred a bot's voice is (0 = like a person, 1 = very dull and drifting). */
  botBlur: number;
  /** Release (s) of a held note when fully staying. */
  holdSec: number;
}

export const DEFAULT_SOUND: SoundParams = {
  master: 0.6,
  bpmStill: 40,
  bpmFast: 140,
  speedMax: 7,
  reverbMax: 0.6,
  jitterMax: 0.08,
  lpOpen: 8000,
  lpSealed: 600,
  noiseMax: 0.25,
  hearRadius: 12,
  othersLevel: 0.7,
  botBlur: 0.6,
  holdSec: 2,
};

interface Voice {
  motif: Motif;
  notes: MotifNote[];
  /** AudioContext time of the next note. */
  nextAt: number;
  idx: number;
  gain: GainNode;
  filt: BiquadFilterNode;
  pan: StereoPannerNode;
  /** 0..1 how blurred (bots). */
  blur: number;
  /** ctx time the voice was last within earshot (for fading out those who left). */
  seen: number;
  /** Level (0..1) and chord hold this voice was last set to. */
  level: number;
}

const LOOKAHEAD = 0.2; // s scheduled ahead
const TICK_MS = 50;
const SMOOTH = 0.08; // s time constant of parameter moves
const OTHER_FADE_SEC = 1.5;

function impulse(ctx: AudioContext, seconds = 2.8, decay = 0.9): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / ctx.sampleRate / decay);
  }
  return buf;
}

function noiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dull!: BiquadFilterNode;
  private dry!: GainNode;
  private send!: GainNode;
  private noiseGain!: GainNode;
  private voices = new Map<string, Voice>();
  private me: Voice | null = null;
  private myId = "";
  private sig: PersonalSignals | null = null;
  private params: SoundParams = DEFAULT_SOUND;
  private yaw = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  /** Builds the graph on first call; resumes the context. Must be called from a user gesture on mobile. */
  async start(): Promise<void> {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.dull = ctx.createBiquadFilter();
      this.dull.type = "lowpass";
      this.dull.frequency.value = this.params.lpOpen;
      this.dull.Q.value = 0.5;
      this.dull.connect(this.master).connect(ctx.destination);
      this.dry = ctx.createGain();
      this.dry.connect(this.dull);
      this.send = ctx.createGain();
      this.send.gain.value = 0.1;
      const verb = ctx.createConvolver();
      verb.buffer = impulse(ctx);
      this.send.connect(verb).connect(this.dull);
      // vegetation: a faint bright noise
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer(ctx);
      noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2400;
      bp.Q.value = 0.9;
      this.noiseGain = ctx.createGain();
      this.noiseGain.gain.value = 0;
      noise.connect(bp).connect(this.noiseGain).connect(this.dry);
      noise.start();
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.master.gain.setTargetAtTime(this.params.master, this.ctx.currentTime, 0.3);
  }

  /** Silence and stop scheduling (the context stays, so a later start() is instant). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  dispose(): void {
    this.stop();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.voices.clear();
    this.me = null;
  }

  private newVoice(id: string, blur: number): Voice {
    const ctx = this.ctx!;
    const motif = makeMotif(id);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 4000;
    const pan = ctx.createStereoPanner();
    filt.connect(gain).connect(pan);
    pan.connect(this.dry);
    pan.connect(this.send);
    return { motif, notes: motifNotes(motif), nextAt: ctx.currentTime + 0.1, idx: 0, gain, filt, pan, blur, seen: ctx.currentTime, level: 0 };
  }

  private dropVoice(id: string, v: Voice): void {
    this.voices.delete(id);
    const ctx = this.ctx!;
    v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    setTimeout(() => {
      v.pan.disconnect();
      v.gain.disconnect();
      v.filt.disconnect();
    }, 2000);
  }

  /** The latest fold of the player's signals (signals.ts); every ~0.5 s. `yaw` = where the camera looks. */
  update(myId: string, sig: PersonalSignals, params: SoundParams, yaw: number): void {
    this.sig = sig;
    this.params = params;
    this.yaw = yaw;
    this.myId = myId;
    const ctx = this.ctx;
    if (!ctx || !this.timer) return;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(params.master, t, 0.3);

    if (!this.me || this.me.motif.id !== myId) {
      if (this.me) this.dropVoice("me", this.me);
      this.me = this.newVoice(myId, 0);
      this.me.gain.gain.setTargetAtTime(1, t, 0.5);
    }
    // the dull: concrete nearby (log-interpolated cutoff)
    const cut = Math.exp(Math.log(params.lpOpen) + (Math.log(params.lpSealed) - Math.log(params.lpOpen)) * sig.sealed);
    this.dull.frequency.setTargetAtTime(cut, t, 0.25);
    // vegetation
    this.noiseGain.gain.setTargetAtTime(params.noiseMax * sig.grass * 0.5, t, 0.5);
    // reverb opens when I stay, more so among others
    const company = Math.min(1, sig.neighbours.length / 3);
    this.send.gain.setTargetAtTime(0.08 + params.reverbMax * sig.stay * (0.35 + 0.65 * company), t, 0.6);

    // who is within earshot
    const alive = new Set<string>();
    for (const n of sig.neighbours) {
      if (n.dist > params.hearRadius) continue;
      alive.add(n.o);
      let v = this.voices.get(n.o);
      if (!v) {
        v = this.newVoice(n.o, n.bot ? params.botBlur : 0);
        this.voices.set(n.o, v);
      }
      v.seen = t;
      const near = 1 - n.dist / params.hearRadius;
      v.level = params.othersLevel * near * near;
      v.gain.gain.setTargetAtTime(v.level, t, 0.4);
      // pan: right = (-cos yaw, sin yaw) → sin(yaw − angle)
      v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, Math.sin(this.yaw - n.angle))), t, SMOOTH);
      v.filt.frequency.setTargetAtTime(v.blur > 0 ? 4000 * Math.pow(0.12, v.blur) : 4000, t, 0.3);
    }
    for (const [id, v] of this.voices) {
      if (alive.has(id)) continue;
      if (t - v.seen > OTHER_FADE_SEC) this.dropVoice(id, v);
      else v.gain.gain.setTargetAtTime(0, t, 0.4);
    }
  }

  private playNote(v: Voice, note: MotifNote, at: number, slot: number, level: number, hold: number): void {
    const ctx = this.ctx!;
    const m = v.motif;
    const dur = slot * note.len;
    const release = 0.12 + hold;
    const g = ctx.createGain();
    g.connect(v.filt);
    const peak = 0.22 * level;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.012);
    g.gain.setTargetAtTime(peak * 0.55, at + 0.012, 0.09);
    g.gain.setTargetAtTime(0, at + dur, release / 3);
    const end = at + dur + release + 0.3;
    // two oscillators: the tone (triangle) and a softer octave above, its weight = the signature's timbre
    const o1 = ctx.createOscillator();
    o1.type = v.blur > 0 ? "sine" : "triangle";
    o1.frequency.value = note.freq;
    if (v.blur > 0) {
      // a blurred voice drifts: a slow random detune
      o1.detune.setValueAtTime((Math.random() * 2 - 1) * 25 * v.blur, at);
      o1.detune.linearRampToValueAtTime((Math.random() * 2 - 1) * 25 * v.blur, end);
    }
    o1.connect(g);
    o1.start(at);
    o1.stop(end);
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = note.freq * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.35 * m.timbre * (1 - v.blur);
    o2.connect(g2).connect(g);
    o2.start(at);
    o2.stop(end);
    setTimeout(() => {
      g.disconnect();
      g2.disconnect();
    }, (end - ctx.currentTime) * 1000 + 100);
  }

  private tick(): void {
    const ctx = this.ctx;
    const sig = this.sig;
    if (!ctx || !sig || ctx.state !== "running") return;
    const p = this.params;
    const now = ctx.currentTime;
    const speed = Math.min(1, sig.speed / Math.max(0.01, p.speedMax));
    const bpm = p.bpmStill + (p.bpmFast - p.bpmStill) * speed;
    const jitter = p.jitterMax * (1 - sig.pathP);
    const hold = p.holdSec * sig.stay * (0.3 + 0.7 * Math.min(1, sig.neighbours.length / 2));
    const schedule = (v: Voice, level: number, tempoBpm: number, jit: number, hld: number) => {
      while (v.nextAt < now + LOOKAHEAD) {
        if (v.nextAt < now - 0.5) v.nextAt = now; // we fell behind (hidden tab): do not burst
        const slot = cycleSeconds(v.motif, tempoBpm) / v.notes.length;
        const note = v.notes[v.idx % v.notes.length];
        this.playNote(v, note, v.nextAt, slot, level, hld);
        v.idx++;
        v.nextAt += slot + (Math.random() * 2 - 1) * jit;
      }
    };
    if (this.me) schedule(this.me, 1, bpm, jitter, hold);
    for (const v of this.voices.values()) {
      if (v.level <= 0.001) continue;
      // others keep their own pace (a still person's motif is slow even while I run), held into a chord when I stay
      schedule(v, 1, 60, p.jitterMax * 0.5, hold);
    }
  }
}

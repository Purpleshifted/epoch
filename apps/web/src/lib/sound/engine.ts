/**
 * sound/engine.ts — the PLAYER's ears: Web Audio, no dependencies (docs/sound-logic.md §8).
 *
 * The engine is a step sequencer on the shared grid (sequencer.ts plans every bar from the signals) and a small
 * subtractive instrument that plays what the plan says:
 *
 *   my voice      straight ahead, in my register.
 *   the others    one voice each, placed around me with the browser's HRTF (PannerNode) at their bearing and
 *                 distance; bots are blurred (darker, drifting) so they read as echoes, not people.
 *   bass          the root of the place on the downbeat while I follow a path.
 *   pad           the chord of the place held while I stay among others (the building being born).
 *   the dull      concrete nearby closes a low-pass over everything.
 *   grass         vegetation around me as a faint bright noise.
 *   rooms         three convolution reverbs, cross-faded by where I am: open ground (short, dark), concrete
 *                 (hard early reflections), the hall that opens while building together.
 *
 * The AudioContext can only start from a user gesture (mobile): call `start()` from one. The optional Magenta
 * models (magenta.ts) are loaded a few seconds after that and only used when they have answered.
 */

import { buildingKey, chordName, homeKey, keyName, magentaChordName, nextDegree, type Key } from "./harmony";
import { Magenta } from "./magenta";
import { hashString, makeMotif, midiToHz, realize, rng, type Motif } from "./motif";
import { barClock, conformity, lockOf, planBar, type BarPlan } from "./sequencer";
import type { PersonalSignals } from "./signals";
import { CYCLES_PER_PHRASE, PHRASE_STEPS, STEPS_PER_CYCLE, cycleToSteps, type Phrase } from "./variation";

export interface SoundParams {
  /** Master level 0..1. */
  master: number;
  /** Seconds per bar: the shared grid. */
  barSec: number;
  /** Walking speed (world/s) counted as running (twice a bar); a tenth of it = still (every other bar). */
  speedMax: number;
  /** Humanize (s) of a note off the grid when free (lock 0); 0 when locked. */
  jitterMax: number;
  /** The hall that opens while building together (0..1). */
  reverbMax: number;
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
  /** Levels of the bass pulse and the held chord (0..1). */
  bassLevel: number;
  padLevel: number;
  /** Use the Magenta models for variation when they can be loaded. */
  magenta: boolean;
  /** World units of PATH walked that move the progression on by one chord. */
  stepEvery: number;
  /** How much conforming pulls single notes onto the chord of the place (0 = the motif is never rewritten). */
  lockPull: number;
  /** Share of noise in a voice at full roughness (crossing vegetation): the tonal/noise ratio. */
  noiseMix: number;
}

export const DEFAULT_SOUND: SoundParams = {
  master: 0.6,
  barSec: 2,
  speedMax: 7,
  jitterMax: 0.03,
  reverbMax: 0.6,
  lpOpen: 8000,
  lpSealed: 600,
  noiseMax: 0.25,
  hearRadius: 12,
  othersLevel: 0.7,
  botBlur: 0.6,
  bassLevel: 0.6,
  padLevel: 0.35,
  magenta: true,
  lockPull: 0.35,
  noiseMix: 0.6,
  stepEvery: 6,
};

interface Voice {
  motif: Motif;
  gain: GainNode;
  filt: BiquadFilterNode;
  panner: PannerNode | null;
  blur: number;
  seen: number;
  level: number;
}

const LOOKAHEAD = 0.3; // s: a bar is scheduled this long before it starts
const TICK_MS = 50;
const OTHER_FADE_SEC = 1.5;
const MAGENTA_AFTER_MS = 4000;

/** A room: exponentially decaying noise, with `taps` early reflections for hard surfaces. */
function impulse(ctx: AudioContext, seconds: number, decay: number, taps = 0, bright = 1): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * bright; // bright 1 = white, lower = darker
      d[i] = lp * Math.exp(-i / ctx.sampleRate / decay);
    }
    for (let t = 1; t <= taps; t++) {
      const at = Math.floor(ctx.sampleRate * (0.011 * t + (c ? 0.003 : 0)));
      if (at < n) d[at] += (0.6 / t) * (t % 2 ? 1 : -1);
    }
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

export interface SoundDebug {
  bar: number;
  /** The key I am in and, at a building, which one. */
  key: string;
  building: string | null;
  /** Degree of the progression (0 = tonic) and the chord. */
  degree: number;
  chord: string;
  /** How far the nearest neighbour has got into my motif (closeness 0..1), and who. */
  nearest: string | null;
  closeness: number;
  /** What the last bar held. */
  bass: number;
  pad: number;
  othersPlaying: number;
  stable: number;
  rough: number;
  lock: number;
  density: number;
  answer: boolean;
  magenta: "off" | "loading" | "ready" | "failed";
  phrase: string | null;
  voices: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dull!: BiquadFilterNode;
  private dry!: GainNode;
  private rooms!: { open: GainNode; concrete: GainNode; hall: GainNode };
  private noiseGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private bassGain!: GainNode;
  private pad!: { oscs: OscillatorNode[]; gains: GainNode[]; level: GainNode };
  private me: Voice | null = null;
  private voices = new Map<string, Voice>();
  private motifs = new Map<string, Motif>();
  private closeness = new Map<string, number>();
  private sig: PersonalSignals | null = null;
  private params: SoundParams = DEFAULT_SOUND;
  private yaw = 0;
  private myId = "";
  private epochMs = 0;
  /** My home key (identity) and the key I am in now (home, or the building's). */
  private home: Key | null = null;
  private placeKey: Key | null = null;
  private atBuilding: string | null = null;
  /** The progression: its degree, and how much path I have walked since it last moved. */
  private degree = 0;
  private walked = 0;
  private lastPos: { x: number; z: number } | null = null;
  private steps = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastUpdate = 0;
  private planned = -1;
  private lastPlan: BarPlan | null = null;
  private lockedBars = 0;
  private phrase: { phrase: Phrase; from: number; kind: string } | null = null;
  private magenta = new Magenta();
  private magentaState: SoundDebug["magenta"] = "off";

  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  get debug(): SoundDebug {
    const p = this.lastPlan;
    return {
      bar: p?.bar ?? -1,
      key: this.placeKey ? keyName(this.placeKey) : "",
      building: this.atBuilding,
      degree: this.degree,
      chord: p ? chordName(p.chord) : "",
      nearest: this.sig?.neighbours[0]?.o ?? null,
      closeness: this.sig?.neighbours[0] ? this.closeness.get(this.sig.neighbours[0].o) ?? 0 : 0,
      bass: p?.bass.length ?? 0,
      pad: p?.pad.level ?? 0,
      othersPlaying: p?.others.length ?? 0,
      stable: p?.stable ?? 0,
      rough: p?.rough ?? 0,
      lock: p?.lock ?? 0,
      density: p?.density ?? 1,
      answer: p?.answer ?? false,
      magenta: this.magentaState,
      phrase: this.phrase ? `${this.phrase.kind} @${this.phrase.from}` : null,
      voices: this.voices.size,
    };
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
      // three rooms
      const room = (seconds: number, decay: number, taps: number, bright: number, level: number) => {
        const g = ctx.createGain();
        g.gain.value = level;
        const v = ctx.createConvolver();
        v.buffer = impulse(ctx, seconds, decay, taps, bright);
        g.connect(v).connect(this.dull);
        return g;
      };
      this.rooms = {
        open: room(1.2, 0.35, 0, 0.25, 0.12),
        concrete: room(2.0, 0.6, 6, 0.9, 0),
        hall: room(4.5, 1.6, 0, 0.5, 0),
      };
      // the listener: at the origin, turned by the camera yaw (update())
      const L = ctx.listener;
      if (L.positionX) {
        L.positionX.value = 0;
        L.positionY.value = 0;
        L.positionZ.value = 0;
        L.upX.value = 0;
        L.upY.value = 1;
        L.upZ.value = 0;
      }
      // vegetation: a faint bright noise
      this.noiseBuf = noiseBuffer(ctx);
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuf;
      noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2400;
      bp.Q.value = 0.9;
      this.noiseGain = ctx.createGain();
      this.noiseGain.gain.value = 0;
      noise.connect(bp).connect(this.noiseGain).connect(this.dry);
      noise.start();
      // bass bus
      this.bassGain = ctx.createGain();
      this.bassGain.gain.value = 1;
      this.bassGain.connect(this.dry);
      // pad: five sustained sines, retuned per bar
      const level = ctx.createGain();
      level.gain.value = 0;
      level.connect(this.dry);
      level.connect(this.rooms.hall);
      const oscs: OscillatorNode[] = [];
      const gains: GainNode[] = [];
      for (let i = 0; i < 5; i++) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? "triangle" : "sine";
        o.frequency.value = 110;
        const g = ctx.createGain();
        g.gain.value = 0;
        o.connect(g).connect(level);
        o.start();
        oscs.push(o);
        gains.push(g);
      }
      this.pad = { oscs, gains, level };
      this.lastUpdate = ctx.currentTime;
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.master.gain.setTargetAtTime(this.params.master, this.ctx.currentTime, 0.3);
    if (this.params.magenta && this.magentaState === "off") {
      this.magentaState = "loading";
      setTimeout(() => this.magenta.load().then((ok) => (this.magentaState = ok ? "ready" : "failed")), MAGENTA_AFTER_MS);
    }
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

  private motifOf(id: string): Motif {
    let m = this.motifs.get(id);
    if (!m) {
      m = makeMotif(id);
      this.motifs.set(id, m);
    }
    return m;
  }

  private newVoice(id: string, blur: number, spatial: boolean): Voice {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 4000;
    let panner: PannerNode | null = null;
    let out: AudioNode = gain;
    if (spatial) {
      panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 1.5;
      panner.rolloffFactor = 1;
      panner.maxDistance = 1000;
      gain.connect(panner);
      out = panner;
    }
    filt.connect(gain);
    out.connect(this.dry);
    out.connect(this.rooms.open);
    out.connect(this.rooms.concrete);
    out.connect(this.rooms.hall);
    return { motif: this.motifOf(id), gain, filt, panner, blur, seen: ctx.currentTime, level: 0 };
  }

  private dropVoice(id: string, v: Voice): void {
    this.voices.delete(id);
    const ctx = this.ctx!;
    v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    setTimeout(() => {
      v.panner?.disconnect();
      v.gain.disconnect();
      v.filt.disconnect();
    }, 2000);
  }

  /**
   * The latest fold of the player's signals (signals.ts), every ~0.5 s. `yaw` = where the camera looks; `epochMs`
   * anchors the shared grid.
   */
  update(myId: string, sig: PersonalSignals, params: SoundParams, yaw: number, epochMs: number): void {
    this.sig = sig;
    this.params = params;
    this.yaw = yaw;
    if (this.myId !== myId || !this.home) {
      this.myId = myId;
      this.home = homeKey(myId);
      this.placeKey = this.home;
      this.atBuilding = null;
    }
    this.epochMs = epochMs;
    // MODULATION: coming to a building puts me in its key (hysteresis so a step at its edge does not flicker); the
    // change itself lands on the next bar, where the plan is made
    if (sig.building && sig.sealed >= 0.3 && this.atBuilding !== sig.building.id) {
      this.atBuilding = sig.building.id;
      this.placeKey = buildingKey(sig.building.id);
      this.degree = 0; // a new key starts on its tonic
      this.walked = 0;
    } else if (this.atBuilding && (!sig.building || sig.sealed <= 0.1)) {
      this.atBuilding = null;
      this.placeKey = this.home;
      this.degree = 0;
      this.walked = 0;
    }
    // THE PATH IS A PROGRESSION: every `stepEvery` world units walked ON a path move the chord on (Markov table of
    // the key); off the path it falls back to the tonic once I stop
    if (this.lastPos) {
      const d = Math.hypot(sig.x - this.lastPos.x, sig.z - this.lastPos.z);
      if (sig.pathP >= 0.25) {
        this.walked += d * sig.pathP;
        if (this.walked >= params.stepEvery && this.placeKey) {
          this.walked = 0;
          this.degree = nextDegree(this.placeKey, this.degree, rng(hashString(`${myId}:${this.steps++}`))());
        }
      } else if (sig.pathP < 0.1 && sig.speed < 0.3 && this.degree !== 0) {
        this.degree = 0;
        this.walked = 0;
      }
    }
    this.lastPos = { x: sig.x, z: sig.z };
    const ctx = this.ctx;
    if (!ctx || !this.timer) return;
    const t = ctx.currentTime;
    const dt = Math.max(0, Math.min(2, t - this.lastUpdate));
    this.lastUpdate = t;
    this.master.gain.setTargetAtTime(params.master, t, 0.3);

    if (!this.me || this.me.motif.id !== myId) {
      if (this.me) this.dropVoice("me", this.me);
      this.me = this.newVoice(myId, 0, false);
      this.me.gain.gain.setTargetAtTime(1, t, 0.5);
    }
    // the listener turns with the camera: forward = (sin yaw, 0, cos yaw) in world terms
    const L = ctx.listener;
    if (L.forwardX) {
      L.forwardX.setTargetAtTime(Math.sin(yaw), t, 0.05);
      L.forwardZ.setTargetAtTime(Math.cos(yaw), t, 0.05);
    }
    // the dull: concrete nearby (log-interpolated cutoff)
    const cut = Math.exp(Math.log(params.lpOpen) + (Math.log(params.lpSealed) - Math.log(params.lpOpen)) * sig.sealed);
    this.dull.frequency.setTargetAtTime(cut, t, 0.25);
    // vegetation
    this.noiseGain.gain.setTargetAtTime(params.noiseMax * sig.grass * 0.5, t, 0.5);
    // rooms: open ground → concrete → the hall of building together
    const company = Math.min(1, sig.neighbours.length / 2);
    const hall = params.reverbMax * sig.stay * company;
    this.rooms.hall.gain.setTargetAtTime(hall, t, 0.8);
    this.rooms.concrete.gain.setTargetAtTime(0.35 * sig.sealed * (1 - hall), t, 0.4);
    this.rooms.open.gain.setTargetAtTime(0.12 * (1 - sig.sealed) * (1 - hall), t, 0.4);

    // who is within earshot: a voice each, placed by HRTF; closeness accumulates while they are near
    const alive = new Set<string>();
    for (const n of sig.neighbours) {
      if (n.dist > params.hearRadius) continue;
      alive.add(n.o);
      let v = this.voices.get(n.o);
      if (!v) {
        v = this.newVoice(n.o, n.bot ? params.botBlur : 0, true);
        this.voices.set(n.o, v);
      }
      v.seen = t;
      v.level = params.othersLevel;
      v.gain.gain.setTargetAtTime(v.level, t, 0.4);
      if (v.panner) {
        v.panner.positionX.setTargetAtTime(Math.sin(n.angle) * n.dist, t, 0.1);
        v.panner.positionZ.setTargetAtTime(Math.cos(n.angle) * n.dist, t, 0.1);
      }
      v.filt.frequency.setTargetAtTime(v.blur > 0 ? 4000 * Math.pow(0.12, v.blur) : 4000, t, 0.3);
      const near = n.dist < params.hearRadius * 0.5;
      this.closeness.set(n.o, Math.max(0, Math.min(1, (this.closeness.get(n.o) ?? 0) + dt * (near ? 0.12 : -0.08))));
    }
    for (const [id, v] of this.voices) {
      if (alive.has(id)) continue;
      if (t - v.seen > OTHER_FADE_SEC) this.dropVoice(id, v);
      else v.gain.gain.setTargetAtTime(0, t, 0.4);
    }
    for (const [id, c] of this.closeness) {
      if (!alive.has(id)) {
        const nc = c - dt * 0.08;
        if (nc <= 0) this.closeness.delete(id);
        else this.closeness.set(id, nc);
      }
    }
  }

  // ── the instrument: tone + (rough) noise ──
  private note(dest: AudioNode, freq: number, at: number, dur: number, vel: number, timbre: number, blur: number, rough = 0): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(dest);
    const peak = 0.22 * vel;
    const release = 0.15 + dur * 0.4;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.012);
    g.gain.setTargetAtTime(peak * 0.55, at + 0.012, 0.09);
    g.gain.setTargetAtTime(0, at + dur, release / 3);
    const end = at + dur + release + 0.3;
    // the tonal / noise ratio: a rough walk (crossing vegetation) turns part of the tone into pitched noise
    const noiseShare = this.params.noiseMix * rough;
    const tone = ctx.createGain();
    tone.gain.value = 1 - noiseShare;
    tone.connect(g);
    const o1 = ctx.createOscillator();
    o1.type = blur > 0 ? "sine" : "triangle";
    o1.frequency.value = freq;
    const drift = 25 * blur + 40 * rough;
    if (drift > 0) {
      o1.detune.setValueAtTime((Math.random() * 2 - 1) * drift, at);
      o1.detune.linearRampToValueAtTime((Math.random() * 2 - 1) * drift, end);
    }
    o1.connect(tone);
    o1.start(at);
    o1.stop(end);
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = freq * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.35 * timbre * (1 - blur);
    o2.connect(g2).connect(tone);
    o2.start(at);
    o2.stop(end);
    let nz: AudioBufferSourceNode | null = null;
    if (noiseShare > 0.02) {
      nz = ctx.createBufferSource();
      nz.buffer = this.noiseBuf;
      nz.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = freq;
      bp.Q.value = 6 - 4 * rough; // the rougher, the wider the band (less pitched)
      const ng = ctx.createGain();
      ng.gain.value = noiseShare * 2.5;
      nz.connect(bp).connect(ng).connect(g);
      nz.start(at);
      nz.stop(end);
    }
    setTimeout(() => {
      g.disconnect();
      g2.disconnect();
      tone.disconnect();
    }, (end - ctx.currentTime) * 1000 + 100);
  }

  private bassNote(pitch: number, at: number, level: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(this.bassGain);
    const peak = 0.5 * level * this.params.bassLevel;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.02);
    g.gain.setTargetAtTime(0, at + 0.12, 0.22);
    const f = midiToHz(pitch);
    // a triangle for the body (audible on small speakers) with a sine an octave below for the weight
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = f * 4;
    lp.connect(g);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(f * 1.5, at);
    o.frequency.exponentialRampToValueAtTime(f, at + 0.06);
    o.connect(lp);
    o.start(at);
    o.stop(at + 1.2);
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = f / 2;
    const sg = ctx.createGain();
    sg.gain.value = 0.7;
    sub.connect(sg).connect(lp);
    sub.start(at);
    sub.stop(at + 1.2);
    setTimeout(() => {
      g.disconnect();
      lp.disconnect();
    }, (at + 1.2 - ctx.currentTime) * 1000 + 100);
  }

  private setPad(pitches: number[], level: number, at: number): void {
    const { oscs, gains, level: lv } = this.pad;
    lv.gain.setTargetAtTime(level * this.params.padLevel * 0.25, at, 0.6);
    for (let i = 0; i < oscs.length; i++) {
      const p = pitches[i];
      if (p == null) {
        gains[i].gain.setTargetAtTime(0, at, 0.4);
        continue;
      }
      oscs[i].frequency.setTargetAtTime(midiToHz(p), at, 0.08);
      gains[i].gain.setTargetAtTime(i === 0 ? 0.8 : 0.5, at, 0.4);
    }
  }

  /** My next 4 bars as a phrase (what Magenta works from). */
  private myPhrase(fromBar: number, lock: number): Phrase {
    const out: Phrase = new Array(PHRASE_STEPS).fill(0);
    if (!this.me || !this.placeKey || !this.sig) return out;
    const key = this.placeKey;
    const chord = this.lastPlan?.chord ?? null;
    for (let c = 0; c < CYCLES_PER_PHRASE; c++) {
      const steps = cycleToSteps(realize(this.me.motif, key, chord, lock, fromBar + c));
      for (let i = 0; i < STEPS_PER_CYCLE; i++) out[c * STEPS_PER_CYCLE + i] = steps[i];
    }
    return out;
  }

  private theirPhrase(id: string, fromBar: number, lock: number): Phrase {
    const out: Phrase = new Array(PHRASE_STEPS).fill(0);
    if (!this.placeKey) return out;
    const m = this.motifOf(id);
    const key = this.atBuilding ? this.placeKey : homeKey(id);
    const chord = this.atBuilding ? this.lastPlan?.chord ?? null : null;
    for (let c = 0; c < CYCLES_PER_PHRASE; c++) {
      const steps = cycleToSteps(realize(m, key, chord, lock, fromBar + c));
      for (let i = 0; i < STEPS_PER_CYCLE; i++) out[c * STEPS_PER_CYCLE + i] = steps[i];
    }
    return out;
  }

  /** Ask Magenta for a phrase when the moment calls for one; it takes my bars once it has answered. */
  private askMagenta(bar: number, sig: PersonalSignals, lock: number, stable: number): void {
    if (!this.params.magenta || !this.magenta.ready || !this.placeKey) return;
    if (this.phrase && bar - this.phrase.from < CYCLES_PER_PHRASE + 2) return; // one phrase, then a breath
    const nearest = sig.neighbours[0];
    const amount = nearest ? this.closeness.get(nearest.o) ?? 0 : 0;
    if (nearest && amount >= 0.5) {
      const res = this.magenta.interpolate(this.myPhrase(bar, lock), this.theirPhrase(nearest.o, bar, lock), amount);
      if (res) this.phrase = { phrase: res, from: bar, kind: `vae×${nearest.o}` };
      return;
    }
    if (stable >= 0.6 && this.lockedBars >= 2 && this.lastPlan) {
      const name = chordName(this.lastPlan.chord);
      const safe = magentaChordName(name);
      const res = this.magenta.improvise(this.myPhrase(bar, lock), [safe, safe]);
      if (res) this.phrase = { phrase: res, from: bar, kind: `rnn ${name}` };
    }
  }

  private tick(): void {
    const ctx = this.ctx;
    const sig = this.sig;
    const key = this.placeKey;
    if (!ctx || !sig || !key || !this.me || ctx.state !== "running" || !this.epochMs) return;
    const p = this.params;
    const now = ctx.currentTime;
    const { bar, start } = barClock(this.epochMs, Date.now(), now, p.barSec);
    if (this.planned < bar) this.planned = bar; // never schedule a bar already under way (or a burst after a hidden tab)
    const next = this.planned + 1;
    const nextStart = start + (next - bar) * p.barSec;
    if (nextStart > now + LOOKAHEAD) return;
    this.planned = next;

    const stable = conformity(sig);
    const lock = lockOf(sig, p.lockPull);
    this.lockedBars = stable >= 0.6 ? this.lockedBars + 1 : 0;
    this.askMagenta(next, sig, lock, stable);
    if (this.phrase && next - this.phrase.from >= CYCLES_PER_PHRASE + 2) this.phrase = null;

    const plan = planBar({
      bar: next,
      sig,
      key,
      building: this.atBuilding,
      degree: this.degree,
      me: this.me.motif,
      others: this.motifs,
      closeness: this.closeness,
      phrase: this.phrase && next - this.phrase.from < CYCLES_PER_PHRASE ? this.phrase : null,
      params: { barSec: p.barSec, speedMax: p.speedMax, bassFrom: 0.25, lockPull: p.lockPull },
    });
    this.lastPlan = plan;
    // a rough walk drifts off the grid and loses notes; a conforming one is steady and complete
    const jitter = p.jitterMax * plan.rough;
    const human = () => (jitter > 0 ? (Math.random() * 2 - 1) * jitter : 0);
    const kept = () => Math.random() >= plan.rough * 0.35;

    for (const n of plan.me) if (kept()) this.note(this.me.filt, n.freq, nextStart + n.at * p.barSec + human(), n.len * p.barSec, 1, this.me.motif.timbre, 0, plan.rough);
    for (const vb of plan.others) {
      const v = this.voices.get(vb.o);
      if (!v || v.level <= 0.001) continue;
      const theirRough = plan.answer ? plan.rough * 0.3 : plan.rough;
      for (const n of vb.notes) if (kept()) this.note(v.filt, n.freq, nextStart + n.at * p.barSec + human() * 0.5, n.len * p.barSec, plan.answer ? 1 : 0.8, v.motif.timbre, v.blur, theirRough);
    }
    for (const b of plan.bass) this.bassNote(b.pitch, nextStart + b.at * p.barSec, b.level);
    this.setPad(plan.pad.pitches, plan.pad.level, nextStart);
  }
}

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

import { chordName, magentaChordName, type WorldKey } from "./harmony";
import { Magenta } from "./magenta";
import { hashString, makeMotif, midiToHz, realize, rng, type Motif } from "./motif";
import { ARRIVAL_IDLE, barClock, lockOf, nextArrival, planBar, type ArrivalState, type BarPlan } from "./sequencer";
import { bestKey, keyName, zoneChord, zoneOf } from "./tonality";
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
  /**
   * The instrument (v4 A2): "webaudio" = everything here; "noisecraft" = the artist's patch plays the harmony (root,
   * colour, fifth, the chorale) on the MUSIC CLOCK this engine decides, and Web Audio keeps the motif, the others,
   * the vegetation and the rooms (the bass and the pad here fall silent).
   */
  instrument: "webaudio" | "noisecraft" | "both";
  /** How much the music clock tightens with the lock (0..0.3 of the bar length) — only with the patch playing. */
  clockPull: number;
  /** My motif comes round every this many bars (the artist: half as often). */
  motifEvery: number;
  /** How much of the motif's micro-tones is heard (0..1). */
  microtone: number;
  /** A bar-synced echo on my motif (0..1 send level). */
  motifEcho: number;
  // ── the motif's timbre (v4 A2f, the artist: fine controls; the preset = "a signal sent into space") ──
  /** The oscillator of the voice. */
  motifWave: "triangle" | "sine" | "sawtooth" | "square";
  /** My register, in semitones (the others keep theirs). */
  motifTranspose: number;
  /** My motif's level (1 = as the others' reference). */
  motifLevel: number;
  /** The envelope: attack and decay (ms), sustain (0..1), release as a share of the note's length. */
  motifAttackMs: number;
  motifDecayMs: number;
  motifSustain: number;
  motifRelease: number;
  /** The voice's low-pass (Hz), its resonance, and how far (octaves) it opens on the attack. */
  motifCutoff: number;
  motifQ: number;
  motifFilterEnv: number;
  /** Partials: an octave above and a fifth above (0..1). */
  motifOctaveLevel: number;
  motifFifthLevel: number;
  /** A second oscillator detuned by this many cents (0 = none). */
  motifDetune: number;
  /** Vibrato depth (cents) and rate (Hz). */
  motifVibrato: number;
  motifVibratoHz: number;
  /** A breath of noise on each note (0..1). */
  motifBreath: number;
  /** Tremolo depth (0..1) at the vibrato rate — the flutter of a transmission. */
  motifTremolo: number;
  /** How the tone is made: "subtractive" (the wave, its partials, the filter) or "fm" (a sine carrier bent by a modulator). */
  motifSynth: "subtractive" | "fm";
  /** FM: the modulator's ratio to the note, its depth (index) and how fast the depth settles (ms). */
  fmRatio: number;
  fmIndex: number;
  fmDecayMs: number;
  /** My motif an octave away now and then: one bar in this many (0 = never), up to this many octaves. */
  motifOctaveEvery: number;
  motifOctaveRange: number;
  /** A building's tonality from its contributors (v4 A4): on/off, the ring outside its zone (world), the hysteresis. */
  zoneTonality: boolean;
  zoneRing: number;
  zoneMargin: number;
  /** Width of the ground's chord bands (cells): how far a walk goes before the chord moves on. */
  bandCells: number;
  /** The arrival cadence (v4 A4b): on/off, and how much the hall opens on it (0..1 of reverbMax). */
  arrival: boolean;
  arrivalHall: number;
  /** The WAVE of an arrival (v4 A4c, the artist: "파도 효과"): a swell of filtered noise rising through the dominant bar and breaking on the tonic (0..1). */
  arrivalWave: number;
  /** The breath before the tonic: everything dips for this long (ms) right before the downbeat (0 = none). */
  arrivalGapMs: number;
  /** The path strength under my feet from which the heartbeat is heard (v4 A4d: 0.25 on the exact cell was too strict). */
  bassFrom: number;
  /** Dying (0..1 over the lifespan's last stretch) and dead (the session ended) — set by the session (muffleSound). */
  dying: number;
  dead: boolean;
  /** How much the dying shakes the voices (0..1): detune drift, dropouts, the echo smearing. */
  dyingWobble: number;
  /** The afterlife (v4 A4d, the artist): the last sound frozen and ringing with astral grains, over this many seconds; the grains' density (0..1). */
  afterlifeSec: number;
  afterlifeGrains: number;
  /** How much of my motif goes into the long open space (0..1): the signal sent out, its tail. */
  motifVerb: number;
  /** How much of the building's dullness the patch gets (0 = none, 1 = as everything else). */
  ncDull: number;
  /** The path's heartbeat: how far it spreads into the rooms (0..1) and the second beat's strength (0..1). */
  bassSpread: number;
  bassDub: number;
  /** How much the voices (my motif, the others) dip on each heartbeat (0..1): the beat stands in front. */
  bassDuck: number;
  /** How much the heartbeat's pitch drops onto the root (0 = a pure thump, 1 = an electronic kick). */
  bassDrop: number;
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
  bassLevel: 0.9, // v4 A2d: the heartbeat in front (0.6 before)
  padLevel: 0.35,
  magenta: false, // the light version has no Magenta (the artist, v4 A1); tfjs shared the GPU with three.js
  instrument: "both",
  clockPull: 0.08,
  motifEvery: 2,
  microtone: 0.3,
  motifEcho: 0.6, // the signal's repeats (0.35 before the radio preset)
  // "a signal sent out into space" (the artist: Interstellar, 전파 보내는 느낌): a pure tone, a clean onset, long
  // tails, two layers beating slowly, a flutter, a little static, a long open space
  motifWave: "sine",
  motifTranspose: 0,
  motifLevel: 1,
  motifAttackMs: 60,
  motifDecayMs: 200,
  motifSustain: 0.8,
  motifRelease: 1.2,
  motifCutoff: 6000,
  motifQ: 0.7,
  motifFilterEnv: 0,
  motifOctaveLevel: 0.1,
  motifFifthLevel: 0,
  motifDetune: 4,
  motifVibrato: 0,
  motifVibratoHz: 5.5,
  motifBreath: 0.15,
  motifTremolo: 0.15,
  motifVerb: 0.5,
  motifSynth: "subtractive",
  fmRatio: 2,
  fmIndex: 2,
  fmDecayMs: 300,
  motifOctaveEvery: 3,
  motifOctaveRange: 1,
  zoneTonality: true,
  zoneRing: 8, // 4 before A4b: at walking speed the ring went by in under a second
  zoneMargin: 0.15,
  bandCells: 12,
  arrival: true,
  arrivalHall: 0.7,
  arrivalWave: 0.6,
  arrivalGapMs: 120,
  bassFrom: 0.15,
  dying: 0,
  dead: false,
  dyingWobble: 0.6,
  afterlifeSec: 8,
  afterlifeGrains: 0.6,
  ncDull: 1,
  bassSpread: 0.7, // v4 A2e: its own long dark room
  bassDub: 0.45,
  bassDuck: 0.35,
  bassDrop: 0.3,
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
/** The others heard at once (nearest first): an HRTF panner per bot was what lagged with a dozen bots (v4 A1). */
const MAX_VOICES = 4;

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
  chord: string;
  lock: number;
  density: number;
  answer: boolean;
  magenta: "off" | "loading" | "ready" | "failed";
  phrase: string | null;
  voices: number;
  /** The NoiseCraft instrument's state (NoiseCraftHost), one phrase; empty without it. */
  nc: string;
  /** The building's tonality where I stand: "D Dorian · in" / "· ring", empty in the open. */
  place: string;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dull!: BiquadFilterNode;
  private dry!: GainNode;
  private rooms!: { open: GainNode; concrete: GainNode; hall: GainNode };
  private noiseGain!: GainNode;
  private bassGain!: GainNode;
  private pad!: { oscs: OscillatorNode[]; gains: GainNode[]; level: GainNode };
  /** My motif's bar-synced echo: send → delay (3/8 bar) → feedback, darkened → dry + hall. */
  private echo!: { send: GainNode; delay: DelayNode; feedback: GainNode };
  /** The long open space my motif is sent into (motifVerb). */
  private space!: GainNode;
  /** The NoiseCraft patch's stream (out=parent) through its own dullness into the master. */
  private nc: { source: MediaStreamAudioSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  /** The path's heartbeat: a soft clip for weight, then dry, and the hall's room darkened by bassSpread. */
  private bassSpread!: GainNode;
  private noise!: AudioBuffer;
  /** The wave: looped noise → a low-pass that rises → a level that swells, into dry and the hall. */
  private wave!: { filter: BiquadFilterNode; gain: GainNode };
  /** The freeze (afterlife): the dry bus into two delays with feedback and a darkening low-pass, ringing on after the end. */
  private freeze!: { input: GainNode; output: GainNode; lp: BiquadFilterNode; fb: GainNode };
  private afterlife: { at: number; until: number } | null = null;
  private wasDead = false;
  /** My motif and the others go through this bus (dry + the rooms); the heartbeat ducks it. */
  private voiceBus!: GainNode;
  private me: Voice | null = null;
  private voices = new Map<string, Voice>();
  private motifs = new Map<string, Motif>();
  private closeness = new Map<string, number>();
  private sig: PersonalSignals | null = null;
  private params: SoundParams = DEFAULT_SOUND;
  private yaw = 0;
  private myId = "";
  private epochMs = 0;
  private key: WorldKey | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastUpdate = 0;
  private planned = -1;
  private lastPlan: BarPlan | null = null;
  private lockedBars = 0;
  private phrase: { phrase: Phrase; from: number; kind: string } | null = null;
  private magenta = new Magenta();
  private magentaState: SoundDebug["magenta"] = "off";
  /** The patch's clock when it carries the grid's phase: wall time of a bar's start (NoiseCraftDriver → setGridAnchor). */
  private anchor: { bar: number; wallMs: number } | null = null;
  /** Plans by bar, so the patch's driver and the scheduler share one plan per bar. */
  private plans = new Map<number, BarPlan>();
  /** What the NoiseCraft host reports (debug line). */
  ncStatus = "";
  /** The key of the building zone I am in (kept across bars for the hysteresis); null in the open. */
  private zoneKey: WorldKey | null = null;
  private placeLine = "";
  /** The arrival cadence (sequencer.ts nextArrival) and the sealed slabs I have already seen near me. */
  private arrivalState: ArrivalState = ARRIVAL_IDLE;
  private seenSlabs: Set<string> | null = null;
  /** 1 right after an arrival's tonic, fading: the hall stays open a moment. */
  private arrivalGlow = 0;
  private arrivalAt = 0;

  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  get debug(): SoundDebug {
    const p = this.lastPlan;
    return {
      bar: p?.bar ?? -1,
      chord: p && this.key ? chordName(this.key, p.chord) : "",
      lock: p?.lock ?? 0,
      density: p?.density ?? 1,
      answer: p?.answer ?? false,
      magenta: this.magentaState,
      phrase: this.phrase ? `${this.phrase.kind} @${this.phrase.from}` : null,
      voices: this.voices.size,
      nc: this.ncStatus + (this.nc ? " → engine" : ""),
      place: this.placeLine + (this.lastPlan?.arrival ? ` · 도착 ${this.lastPlan.arrival}` : ""),
    };
  }

  /** Where I stand in a building's harmony this bar (tonality.ts), or null in the open. */
  private placeFor(sig: PersonalSignals): NonNullable<Parameters<typeof planBar>[0]["place"]> | null {
    const p = this.params;
    const b = sig.building;
    const zone = p.zoneTonality && b ? zoneOf(b.dist, b.radius, p.zoneRing) : null;
    if (!b || !zone) {
      this.zoneKey = null;
      this.placeLine = "";
      return null;
    }
    const key = bestKey(b.who, this.zoneKey, p.zoneMargin);
    if (!key) {
      this.zoneKey = null;
      this.placeLine = "";
      return null;
    }
    this.zoneKey = key;
    this.placeLine = `${keyName(key)} · ${zone}`;
    return { key, chord: zoneChord(key, zone), zone };
  }

  /** The latest signals (null before the first fold). */
  get signals(): PersonalSignals | null {
    return this.sig;
  }

  get currentParams(): SoundParams {
    return this.params;
  }

  /**
   * THE MUSIC CLOCK (v4 A2, the artist): seconds a bar, decided here from the Leva bar length and the interaction —
   * the lock (a path, building together) tightens it by `clockPull`. The patch receives this value. With the Web
   * Audio instrument alone the bar stays the Leva length (the epoch grid must not jump).
   */
  musicBarSec(): number {
    const p = this.params;
    if (p.instrument === "webaudio" || !this.sig) return p.barSec;
    return p.barSec * (1 - p.clockPull * lockOf(this.sig));
  }

  /** The patch's clock carries the grid's phase: bar `bar` starts at `wallMs` (NoiseCraftDriver). */
  setGridAnchor(bar: number, wallMs: number): void {
    this.anchor = { bar, wallMs };
  }

  /**
   * The NoiseCraft patch's output (out=parent: its MediaStream) into this engine: its own low-pass (the building's
   * dullness by ncDull) → the master (level, mute, the lifespan's dulling). null = detach.
   */
  attachNoiseCraft(stream: MediaStream | null): void {
    const ctx = this.ctx;
    if (this.nc) {
      try {
        this.nc.source.disconnect();
        this.nc.filter.disconnect();
        this.nc.gain.disconnect();
      } catch {
        /* ignore */
      }
      this.nc = null;
    }
    if (!stream || !ctx) return;
    const source = ctx.createMediaStreamSource(stream);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = this.params.lpOpen;
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(filter).connect(gain).connect(this.master);
    this.nc = { source, filter, gain };
  }

  get noiseCraftAttached(): boolean {
    return !!this.nc;
  }

  /** The plan of bar `bar` (planned once, shared with the patch's driver); null before anyone is here. */
  planFor(bar: number): BarPlan | null {
    const sig = this.sig;
    const key = this.key;
    if (!sig || !key || !this.me || !this.myId || this.params.dead) return null;
    const cached = this.plans.get(bar);
    if (cached) return cached;
    const p = this.params;
    const lock = lockOf(sig);
    this.lockedBars = lock >= 0.6 ? this.lockedBars + 1 : 0;
    this.askMagenta(bar, sig, lock);
    if (this.phrase && bar - this.phrase.from >= CYCLES_PER_PHRASE + 2) this.phrase = null;
    // the arrival: the moment my own weight counts on a building others built (the artist: not nearness — real
    // contribution); a building born under us while we stand together counts too
    const near = sig.nearSlabs ?? [];
    let born = false;
    if (this.seenSlabs) for (const k of near) if (!this.seenSlabs.has(k)) born = true;
    this.seenSlabs = new Set(near);
    const together = (sig.coBuilders?.length ?? 0) > 0;
    const step = nextArrival(this.arrivalState, bar, together, born && sig.stay > 0.5 && sig.neighbours.length > 0);
    this.arrivalState = step.state;
    const arrival = p.arrival ? step.phase : null;
    if (arrival === "tonic" && this.ctx) {
      this.arrivalGlow = 1;
      this.arrivalAt = this.ctx.currentTime;
    }
    const plan = planBar({
      bar,
      sig,
      key,
      place: this.placeFor(sig),
      arrival,
      me: this.me.motif,
      others: this.motifs,
      closeness: this.closeness,
      phrase: this.phrase && bar - this.phrase.from < CYCLES_PER_PHRASE ? this.phrase : null,
      params: { barSec: this.musicBarSec(), speedMax: p.speedMax, bassFrom: p.bassFrom, motifEvery: p.motifEvery, microtone: p.microtone, motifOctaveEvery: p.motifOctaveEvery, motifOctaveRange: p.motifOctaveRange, bandCells: p.bandCells },
    });
    this.plans.set(bar, plan);
    for (const k of this.plans.keys()) if (k < bar - 4) this.plans.delete(k);
    this.lastPlan = plan;
    return plan;
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
      this.voiceBus = ctx.createGain();
      this.voiceBus.gain.value = 1;
      this.voiceBus.connect(this.dry);
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
        hall: room(3.0, 1.2, 0, 0.5, 0), // 4.5 s before v4 A1: the convolver's cost is its length
      };
      this.voiceBus.connect(this.rooms.open);
      this.voiceBus.connect(this.rooms.concrete);
      this.voiceBus.connect(this.rooms.hall);
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
      // bass bus: the path's heartbeat → a soft clip (weight) → dry, and its own long dark room (bassSpread)
      this.bassGain = ctx.createGain();
      this.bassGain.gain.value = 1;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * 1.3) / Math.tanh(1.3); // a gentle clip (1.6 crackled — the artist, A4c)
      }
      shaper.curve = curve;
      shaper.oversample = "2x";
      this.bassGain.connect(shaper).connect(this.dry);
      // the beat spreads under everything: into the hall's room through a dark low-pass (no convolver of its own —
      // every convolver is audio-thread work, and five of them crackled on the artist's machine)
      this.bassSpread = ctx.createGain();
      this.bassSpread.gain.value = 0;
      const bassDark = ctx.createBiquadFilter();
      bassDark.type = "lowpass";
      bassDark.frequency.value = 500;
      shaper.connect(this.bassSpread).connect(bassDark).connect(this.rooms.hall);
      this.noise = noiseBuffer(ctx, 1);
      // the wave (v4 A4c): looped noise, a low-pass the swell opens, a level that rises and breaks
      const wn = ctx.createBufferSource();
      wn.buffer = noiseBuffer(ctx, 3);
      wn.loop = true;
      const wf = ctx.createBiquadFilter();
      wf.type = "lowpass";
      wf.frequency.value = 300;
      wf.Q.value = 0.8;
      const wg = ctx.createGain();
      wg.gain.value = 0;
      wn.connect(wf).connect(wg);
      wg.connect(this.dry);
      wg.connect(this.rooms.hall);
      wn.start();
      this.wave = { filter: wf, gain: wg };
      // the freeze (v4 A4d): what rang last keeps ringing — two delays in a loop, darkening; silent until the end
      const fin = ctx.createGain();
      fin.gain.value = 0;
      const dA = ctx.createDelay(2);
      dA.delayTime.value = 0.37;
      const dB = ctx.createDelay(2);
      dB.delayTime.value = 0.53;
      const flp = ctx.createBiquadFilter();
      flp.type = "lowpass";
      flp.frequency.value = 2500;
      const ffb = ctx.createGain();
      ffb.gain.value = 0;
      const fout = ctx.createGain();
      fout.gain.value = 0;
      this.dry.connect(fin);
      fin.connect(dA);
      fin.connect(dB);
      dA.connect(flp);
      dB.connect(flp);
      flp.connect(ffb);
      ffb.connect(dA);
      ffb.connect(dB);
      flp.connect(fout);
      fout.connect(this.dull);
      fout.connect(this.rooms.hall);
      this.freeze = { input: fin, output: fout, lp: flp, fb: ffb };
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
      // my motif's echo (v4 A2: a body for the melody beside the patch): a dotted eighth of the bar, darkened
      const send = ctx.createGain();
      send.gain.value = 0;
      const delay = ctx.createDelay(4);
      delay.delayTime.value = this.params.barSec * 0.375;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.3;
      const dark = ctx.createBiquadFilter();
      dark.type = "lowpass";
      dark.frequency.value = 1800;
      send.connect(delay).connect(dark).connect(feedback).connect(delay);
      dark.connect(this.dry);
      dark.connect(this.rooms.hall);
      this.echo = { send, delay, feedback };
      // the long open space the signal goes out into (a 4 s room, half bright), from my voice and its echo
      this.space = room(3.2, 1.6, 0, 0.45, 0); // 4 s before A4c: the convolver's cost is its length
      dark.connect(this.space);
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
      panner.panningModel = "equalpower"; // the nearest voice is switched to HRTF in update()
      panner.distanceModel = "inverse";
      panner.refDistance = 1.5;
      panner.rolloffFactor = 1;
      panner.maxDistance = 1000;
      gain.connect(panner);
      out = panner;
    }
    filt.connect(gain);
    out.connect(this.voiceBus); // dry + the rooms, ducked by the heartbeat
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
   * anchors the shared grid; `key` is the epoch's tonal field.
   */
  update(myId: string, sig: PersonalSignals, params: SoundParams, yaw: number, epochMs: number, key: WorldKey): void {
    this.sig = sig;
    this.params = params;
    this.yaw = yaw;
    this.myId = myId;
    this.epochMs = epochMs;
    this.key = key;
    const ctx = this.ctx;
    if (!ctx || !this.timer) return;
    const t = ctx.currentTime;
    const dt = Math.max(0, Math.min(2, t - this.lastUpdate));
    this.lastUpdate = t;
    // the end of a life: the afterlife plays once and fades itself; a new life brings the master back
    if (params.dead && !this.wasDead) this.startAfterlife(t);
    if (!params.dead && this.wasDead) this.endAfterlife(t);
    this.wasDead = params.dead;
    if (this.afterlife && t > this.afterlife.until) this.afterlife = null;
    if (!this.afterlife && !params.dead) this.master.gain.setTargetAtTime(params.master, t, 0.3);
    // dying: the echo smears, the hall widens (the voices' drift and dropouts are per note / per bar)
    this.echo.feedback.gain.setTargetAtTime(0.3 + 0.45 * params.dying * params.dyingWobble, t, 0.5);

    if (!this.me || this.me.motif.id !== myId) {
      if (this.me) this.dropVoice("me", this.me);
      this.me = this.newVoice(myId, 0, false);
      this.me.gain.gain.setTargetAtTime(1, t, 0.5);
      this.me.gain.connect(this.echo.send);
      this.me.gain.connect(this.space);
    }
    this.space.gain.setTargetAtTime(params.motifVerb * 0.5, t, 0.3);
    // my motif's body: the echo follows the bar, the softness darkens the voice
    this.echo.send.gain.setTargetAtTime(params.motifEcho * 0.6, t, 0.3);
    this.echo.delay.delayTime.setTargetAtTime(this.musicBarSec() * 0.375, t, 0.2);
    this.me.filt.frequency.setTargetAtTime(params.motifCutoff, t, 0.3);
    this.me.filt.Q.setTargetAtTime(params.motifQ, t, 0.3);
    // the listener turns with the camera: forward = (sin yaw, 0, cos yaw) in world terms
    const L = ctx.listener;
    if (L.forwardX) {
      L.forwardX.setTargetAtTime(Math.sin(yaw), t, 0.05);
      L.forwardZ.setTargetAtTime(Math.cos(yaw), t, 0.05);
    }
    // the dull: concrete nearby (log-interpolated cutoff); the patch gets its own share of it (ncDull)
    const cut = Math.exp(Math.log(params.lpOpen) + (Math.log(params.lpSealed) - Math.log(params.lpOpen)) * sig.sealed);
    this.dull.frequency.setTargetAtTime(cut, t, 0.25);
    if (this.nc) {
      const ncCut = Math.exp(Math.log(params.lpOpen) + (Math.log(params.lpSealed) - Math.log(params.lpOpen)) * sig.sealed * params.ncDull);
      this.nc.filter.frequency.setTargetAtTime(ncCut, t, 0.25);
    }
    this.bassSpread.gain.setTargetAtTime(params.bassSpread, t, 0.3);
    // vegetation
    this.noiseGain.gain.setTargetAtTime(params.noiseMax * sig.grass * 0.5, t, 0.5);
    // rooms: open ground → concrete → the hall of building together
    const company = Math.min(1, sig.neighbours.length / 2);
    // the arrival opens the hall at once and lets it close over ~6 s
    const glow = this.arrivalGlow * Math.exp(-(t - this.arrivalAt) / 6);
    const hall = Math.max(params.reverbMax * sig.stay * company, params.reverbMax * params.arrivalHall * glow, params.reverbMax * 0.8 * params.dying);
    this.rooms.hall.gain.setTargetAtTime(hall, t, glow > 0.3 ? 0.15 : 0.8);
    this.rooms.concrete.gain.setTargetAtTime(0.35 * sig.sealed * (1 - hall), t, 0.4);
    this.rooms.open.gain.setTargetAtTime(0.12 * (1 - sig.sealed) * (1 - hall), t, 0.4);

    // who is within earshot: a voice each, the nearest MAX_VOICES only, with a level of detail in the panning
    // (v4 A1): the nearest one is placed by HRTF (a convolution per panner), the others by equal-power panning;
    // closeness accumulates while they are near
    const alive = new Set<string>();
    const heard = sig.neighbours.filter((n) => n.dist <= params.hearRadius).slice(0, MAX_VOICES);
    heard.forEach((n, rank) => {
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
        const model = rank === 0 ? "HRTF" : "equalpower";
        if (v.panner.panningModel !== model) v.panner.panningModel = model;
        v.panner.positionX.setTargetAtTime(Math.sin(n.angle) * n.dist, t, 0.1);
        v.panner.positionZ.setTargetAtTime(Math.cos(n.angle) * n.dist, t, 0.1);
      }
      v.filt.frequency.setTargetAtTime(v.blur > 0 ? 4000 * Math.pow(0.12, v.blur) : 4000, t, 0.3);
      const near = n.dist < params.hearRadius * 0.5;
      this.closeness.set(n.o, Math.max(0, Math.min(1, (this.closeness.get(n.o) ?? 0) + dt * (near ? 0.12 : -0.08))));
    });
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

  // ── the instrument: one note of a voice (mine or another's), shaped by the motif timbre knobs ──
  private note(dest: AudioNode, freq0: number, at: number, dur: number, vel: number, timbre: number, blur: number, mine = false): void {
    const ctx = this.ctx!;
    const p = this.params;
    const freq = mine ? freq0 * Math.pow(2, p.motifTranspose / 12) : freq0;
    const attack = Math.max(0.002, p.motifAttackMs / 1000);
    const decay = Math.max(0.01, p.motifDecayMs / 1000);
    const release = 0.15 + dur * p.motifRelease;
    const peak = 0.22 * vel * (mine ? p.motifLevel : 1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.setTargetAtTime(peak * p.motifSustain, at + attack, decay / 3);
    g.gain.setTargetAtTime(0, at + dur, release / 3);
    const end = at + dur + release + 0.3;
    // the note's own filter, opening on the attack (motifFilterEnv octaves) and settling on the voice's cutoff
    let into: AudioNode = g;
    if (p.motifFilterEnv > 0) {
      const nf = ctx.createBiquadFilter();
      nf.type = "lowpass";
      nf.Q.value = p.motifQ;
      const base = Math.min(16000, p.motifCutoff);
      nf.frequency.setValueAtTime(Math.min(16000, base * Math.pow(2, p.motifFilterEnv)), at);
      nf.frequency.exponentialRampToValueAtTime(base, at + attack + decay);
      nf.connect(g);
      into = nf;
    }
    g.connect(dest);
    const started: OscillatorNode[] = [];
    const osc = (type: OscillatorType, f: number, level: number, detune = 0): OscillatorNode | null => {
      if (level <= 0) return null;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(into);
      o.start(at);
      o.stop(end);
      started.push(o);
      return o;
    };
    const wave: OscillatorType = blur > 0 ? "sine" : p.motifWave;
    const fm = p.motifSynth === "fm" && blur === 0;
    const o1 = osc(fm ? "sine" : wave, freq, 1, p.motifDetune > 0 ? -p.motifDetune / 2 : 0)!;
    if (blur > 0) {
      o1.detune.setValueAtTime((Math.random() * 2 - 1) * 25 * blur, at);
      o1.detune.linearRampToValueAtTime((Math.random() * 2 - 1) * 25 * blur, end);
    }
    if (fm) {
      // a modulator bends the carrier's frequency; its depth (freq × index) settles to a fifth of itself
      const mod = ctx.createOscillator();
      mod.type = "sine";
      mod.frequency.value = freq * p.fmRatio;
      const depth = ctx.createGain();
      const full = freq * p.fmIndex;
      depth.gain.setValueAtTime(full, at);
      depth.gain.setTargetAtTime(full * 0.2, at + attack, Math.max(0.01, p.fmDecayMs / 1000) / 3);
      mod.connect(depth).connect(o1.frequency);
      mod.start(at);
      mod.stop(end);
    } else {
      if (p.motifDetune > 0 && blur === 0) osc(wave, freq, 0.5, p.motifDetune / 2);
      osc("sine", freq * 2, p.motifOctaveLevel * (0.5 + 0.5 * timbre) * (1 - blur));
      osc("sine", freq * 3, p.motifFifthLevel * 0.5 * (1 - blur));
    }
    // dying: the pitch drifts within the note, more as the end comes
    const drift = mine ? p.dying * p.dyingWobble * 40 : 0;
    if (drift > 0) {
      for (const o of started) {
        const d0 = o.detune.value;
        o.detune.setValueAtTime(d0 + (Math.random() * 2 - 1) * drift, at);
        o.detune.linearRampToValueAtTime(d0 + (Math.random() * 2 - 1) * drift, end);
      }
    }
    // tremolo: the flutter of a transmission, on the note's gain
    if (p.motifTremolo > 0 && blur === 0) {
      const tlfo = ctx.createOscillator();
      tlfo.type = "sine";
      tlfo.frequency.value = p.motifVibratoHz;
      const tg = ctx.createGain();
      tg.gain.value = 0.5 * p.motifTremolo * peak;
      tlfo.connect(tg).connect(g.gain);
      tlfo.start(at);
      tlfo.stop(end);
    }
    // vibrato: a slow sine on the detune of the oscillators
    if (p.motifVibrato > 0 && blur === 0) {
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = p.motifVibratoHz;
      const lg = ctx.createGain();
      lg.gain.value = p.motifVibrato;
      lfo.connect(lg);
      for (const o of started) lg.connect(o.detune);
      lfo.start(at);
      lfo.stop(end);
    }
    // a breath: noise through a band around the note, with the note's envelope
    if (p.motifBreath > 0 && blur === 0 && this.noise) {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = Math.min(12000, freq * 2);
      bp.Q.value = 2.5;
      const ng = ctx.createGain();
      ng.gain.value = 0.3 * p.motifBreath;
      n.connect(bp).connect(ng).connect(into);
      n.start(at);
      n.stop(end);
    }
    setTimeout(() => g.disconnect(), (end - ctx.currentTime) * 1000 + 100);
  }

  /**
   * The path's HEARTBEAT (v4 A2c–e, the artist: heavy, not electronic, spreading): a lub and a softer dub 0.17 s
   * later. Each: the root brought down into 40–80 Hz, a soft attack, a small drop (bassDrop), a long body; a sub an
   * octave below with its own slower swell; a dark thump of noise for flesh. The bus clips softly and spreads into
   * a long dark room of its own.
   */
  private bassNote(pitch: number, at: number, level: number): void {
    const ctx = this.ctx!;
    let f = midiToHz(pitch);
    while (f > 80) f /= 2;
    while (f < 40) f *= 2;
    const hit = (when: number, vel: number) => {
      const g = ctx.createGain();
      g.connect(this.bassGain);
      const peak = 0.9 * vel * this.params.bassLevel;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(peak, when + 0.025);
      g.gain.setTargetAtTime(0, when + 0.1, 0.28);
      const o = ctx.createOscillator();
      o.type = "sine";
      const drop = 1 + 1.2 * this.params.bassDrop;
      o.frequency.setValueAtTime(f * drop, when);
      o.frequency.exponentialRampToValueAtTime(f, when + 0.07);
      o.connect(g);
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = f / 2;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0, when);
      sg.gain.linearRampToValueAtTime(0.7, when + 0.04);
      sg.gain.setTargetAtTime(0, when + 0.15, 0.35);
      sub.connect(sg).connect(g);
      // flesh: a dark burst of noise under the beat
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const nf = ctx.createBiquadFilter();
      nf.type = "lowpass";
      nf.frequency.value = 220;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, when);
      ng.gain.linearRampToValueAtTime(0.9 * vel, when + 0.01);
      ng.gain.setTargetAtTime(0, when + 0.04, 0.06);
      n.connect(nf).connect(ng).connect(g);
      n.start(when);
      n.stop(when + 0.5);
      // the beat in front: the voices dip for a moment — from wherever the gain is (a jump to 1 clicked)
      const duck = this.params.bassDuck * vel;
      if (duck > 0) {
        this.voiceBus.gain.setTargetAtTime(1 - duck, when, 0.006);
        this.voiceBus.gain.setTargetAtTime(1, when + 0.08, 0.15);
      }
      o.start(when);
      sub.start(when);
      o.stop(when + 1.2);
      sub.stop(when + 1.2);
      setTimeout(() => {
        g.disconnect();
        sg.disconnect();
      }, (when + 1.2 - ctx.currentTime) * 1000 + 100);
    };
    hit(at, level);
    if (this.params.bassDub > 0) hit(at + 0.17, level * this.params.bassDub);
  }

  get inAfterlife(): boolean {
    return !!this.afterlife;
  }

  /**
   * THE AFTERLIFE (v4 A4d, the artist: not a plain fade — "the last sound + reverb + a little astral granular noise").
   * The living voices stop; what rang last enters the freeze loop for 0.7 s and rings on, darkening; grains of the
   * last chord's classes, high and far, come thick then thin; the master holds a second and then goes.
   */
  private startAfterlife(t: number): void {
    const p = this.params;
    const sec = Math.max(2, p.afterlifeSec);
    this.afterlife = { at: t, until: t + sec };
    this.voiceBus.gain.setTargetAtTime(0, t + 0.5, 0.15);
    this.pad.level.gain.setTargetAtTime(0, t + 0.3, 0.3);
    this.bassGain.gain.setTargetAtTime(0, t, 0.2);
    this.wave.gain.gain.setTargetAtTime(0, t, 0.3);
    this.noiseGain.gain.setTargetAtTime(0, t, 0.5);
    const f = this.freeze;
    f.input.gain.setValueAtTime(1, t);
    f.input.gain.setTargetAtTime(0, t + 0.7, 0.1);
    f.fb.gain.setValueAtTime(0.92, t);
    f.fb.gain.setTargetAtTime(0.5, t + Math.max(0.5, sec - 2), 0.6);
    f.output.gain.setTargetAtTime(0.9, t, 0.1);
    f.lp.frequency.setValueAtTime(2500, t);
    f.lp.frequency.exponentialRampToValueAtTime(400, t + sec);
    if (p.afterlifeGrains > 0) this.grains(t + 0.4, sec - 0.4, p.afterlifeGrains);
    this.master.gain.setTargetAtTime(p.master, t, 0.05);
    this.master.gain.setTargetAtTime(0, t + 1.2, Math.max(0.5, (sec - 1.2) / 3.5));
  }

  /** A new life: the freeze closes, the living buses come back (the master follows the params again). */
  private endAfterlife(t: number): void {
    this.afterlife = null;
    const f = this.freeze;
    f.input.gain.setTargetAtTime(0, t, 0.05);
    f.fb.gain.setTargetAtTime(0, t, 0.05);
    f.output.gain.setTargetAtTime(0, t, 0.2);
    this.voiceBus.gain.setTargetAtTime(1, t, 0.2);
    this.bassGain.gain.setTargetAtTime(1, t, 0.2);
  }

  /** Astral grains: tiny sines (and a few noise grains) on the last chord's classes, 2–3 octaves up, scattered in the stereo field and the far room. */
  private grains(at: number, span: number, density: number): void {
    const ctx = this.ctx!;
    const classes = this.lastPlan?.chord.classes ?? (this.key ? [this.key.root] : [0]);
    const r = rng(hashString(`${this.myId}#afterlife#${Math.floor(at)}`));
    const n = Math.round(90 * density);
    for (let i = 0; i < n; i++) {
      const tau = span * Math.pow(r(), 0.7); // thick early, thinning to the end
      const when = at + tau;
      const life = 1 - tau / span;
      const cls = classes[Math.floor(r() * classes.length)] ?? 0;
      const freq = midiToHz(84 + cls + 12 * Math.floor(r() * 2)) * Math.pow(2, ((r() * 2 - 1) * 25) / 1200);
      const dur = 0.05 + r() * 0.13;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.07 * (0.4 + 0.6 * life), when + dur * 0.4);
      g.gain.linearRampToValueAtTime(0, when + dur);
      const pan = ctx.createStereoPanner();
      pan.pan.value = r() * 2 - 1;
      g.connect(pan);
      pan.connect(this.space);
      pan.connect(this.rooms.hall);
      pan.connect(this.dull);
      let src: AudioScheduledSourceNode;
      if (i % 4 === 3) {
        const ns = ctx.createBufferSource();
        ns.buffer = this.noise;
        ns.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = Math.min(12000, freq);
        bp.Q.value = 8;
        ns.connect(bp).connect(g);
        src = ns;
      } else {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        o.connect(g);
        src = o;
      }
      src.start(when);
      src.stop(when + dur + 0.05);
    }
  }

  /** The wave rising through a bar: the low-pass opens 300 → 2400 Hz, the level swells (sin^1.5-ish by the ramps). */
  private waveSwell(at: number, barSec: number, level: number): void {
    const { filter, gain } = this.wave;
    filter.frequency.cancelScheduledValues(at);
    filter.frequency.setValueAtTime(300, at);
    filter.frequency.exponentialRampToValueAtTime(2400, at + barSec);
    gain.gain.cancelScheduledValues(at);
    gain.gain.setValueAtTime(0.001, at);
    gain.gain.exponentialRampToValueAtTime(0.35 * level, at + barSec * 0.7);
    gain.gain.linearRampToValueAtTime(0.45 * level, at + barSec);
  }

  /** The wave breaking on the downbeat: a last push, then it falls back over ~3 s. */
  private waveBreak(at: number, level: number): void {
    const { filter, gain } = this.wave;
    gain.gain.setTargetAtTime(0.5 * level, at, 0.03);
    gain.gain.setTargetAtTime(0, at + 0.25, 1.0);
    filter.frequency.setTargetAtTime(300, at + 0.25, 1.2);
  }

  /** The breath before the tonic: everything (the patch included, it is on the master) dips, then comes back on the downbeat. */
  private breath(at: number, sec: number): void {
    const m = this.params.master;
    this.master.gain.setTargetAtTime(m * 0.08, at - sec, 0.02);
    this.master.gain.setTargetAtTime(m, at, 0.04);
  }

  private setPad(pitches: number[], level: number, at: number, fast = false): void {
    const { oscs, gains, level: lv } = this.pad;
    lv.gain.setTargetAtTime(level * this.params.padLevel * 0.25, at, fast ? 0.12 : 0.6);
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
    if (!this.me || !this.key || !this.sig) return out;
    const key = this.key;
    const chord = this.lastPlan?.chord ?? null;
    for (let c = 0; c < CYCLES_PER_PHRASE; c++) {
      const steps = cycleToSteps(realize(this.me.motif, key, chord, lock, fromBar + c));
      for (let i = 0; i < STEPS_PER_CYCLE; i++) out[c * STEPS_PER_CYCLE + i] = steps[i];
    }
    return out;
  }

  private theirPhrase(id: string, fromBar: number, lock: number): Phrase {
    const out: Phrase = new Array(PHRASE_STEPS).fill(0);
    if (!this.key) return out;
    const m = this.motifOf(id);
    const chord = this.lastPlan?.chord ?? null;
    for (let c = 0; c < CYCLES_PER_PHRASE; c++) {
      const steps = cycleToSteps(realize(m, this.key, chord, lock, fromBar + c));
      for (let i = 0; i < STEPS_PER_CYCLE; i++) out[c * STEPS_PER_CYCLE + i] = steps[i];
    }
    return out;
  }

  /** Ask Magenta for a phrase when the moment calls for one; it takes my bars once it has answered. */
  private askMagenta(bar: number, sig: PersonalSignals, lock: number): void {
    if (!this.params.magenta || !this.magenta.ready || !this.key) return;
    if (this.phrase && bar - this.phrase.from < CYCLES_PER_PHRASE + 2) return; // one phrase, then a breath
    const nearest = sig.neighbours[0];
    const amount = nearest ? this.closeness.get(nearest.o) ?? 0 : 0;
    if (nearest && amount >= 0.5) {
      const res = this.magenta.interpolate(this.myPhrase(bar, lock), this.theirPhrase(nearest.o, bar, lock), amount);
      if (res) this.phrase = { phrase: res, from: bar, kind: `vae×${nearest.o}` };
      return;
    }
    if (lock >= 0.6 && this.lockedBars >= 2 && this.lastPlan) {
      const name = chordName(this.key, this.lastPlan.chord);
      const safe = magentaChordName(name);
      const res = this.magenta.improvise(this.myPhrase(bar, lock), [safe, safe]);
      if (res) this.phrase = { phrase: res, from: bar, kind: `rnn ${name}` };
    }
  }

  private tick(): void {
    const ctx = this.ctx;
    const sig = this.sig;
    const key = this.key;
    // nobody here yet (a session before LIVE gives an empty id): nothing to plan, nothing to schedule
    if (!ctx || !sig || !key || !this.me || !this.myId || ctx.state !== "running" || !this.epochMs) return;
    if (this.afterlife || this.params.dead) return; // the afterlife rings on its own; nothing new is planned
    const p = this.params;
    const now = ctx.currentTime;
    const barSec = this.musicBarSec();
    // the grid: the patch's clock carries the phase when it plays (anchor), else the epoch on the wall clock
    const nc = p.instrument !== "webaudio";
    const epoch = nc && this.anchor ? this.anchor.wallMs - this.anchor.bar * barSec * 1000 : this.epochMs;
    const { bar, start } = barClock(epoch, Date.now(), now, barSec);
    if (this.planned < bar) this.planned = bar; // never schedule a bar already under way (or a burst after a hidden tab)
    if (this.planned > bar + 1) {
      // the grid moved back (the patch's clock took over from the epoch grid, or the other way round): the bars
      // are numbered anew — plan from here, forget the plans of the old numbering
      this.planned = bar;
      this.plans.clear();
    }
    const next = this.planned + 1;
    const nextStart = start + (next - bar) * barSec;
    if (nextStart > now + LOOKAHEAD) return;
    this.planned = next;

    const plan = this.planFor(next);
    if (!plan) return;
    // dying: the voices drop out for moments, more as the end comes
    const dy = p.dying * p.dyingWobble;
    if (dy > 0.2) {
      for (let i = 0; i < 8; i++) {
        if (Math.random() > dy * 0.45) continue;
        const when = nextStart + (i / 8) * barSec + Math.random() * 0.05;
        this.voiceBus.gain.setTargetAtTime(0.15, when, 0.01);
        this.voiceBus.gain.setTargetAtTime(1, when + 0.06 + 0.12 * dy, 0.03);
      }
    }
    const jitter = p.jitterMax * (1 - plan.lock);
    const human = () => (jitter > 0 ? (Math.random() * 2 - 1) * jitter : 0);

    for (const n of plan.me) this.note(this.me.filt, n.freq, nextStart + n.at * barSec + human(), n.len * barSec, 1, this.me.motif.timbre, 0, true);
    for (const vb of plan.others) {
      const v = this.voices.get(vb.o);
      if (!v || v.level <= 0.001) continue;
      for (const n of vb.notes) this.note(v.filt, n.freq, nextStart + n.at * barSec + human() * 0.5, n.len * barSec, plan.answer ? 1 : 0.8, v.motif.timbre, v.blur);
    }
    // the arrival's wave and breath (v4 A4c): the swell rises through the dominant bar; everything dips for a
    // breath, then the tonic breaks — the contrast the hall alone could not give in a sound already wet
    if (plan.arrival === "dominant" && p.arrivalWave > 0) this.waveSwell(nextStart, barSec, p.arrivalWave);
    if (plan.arrival === "tonic") {
      if (p.arrivalWave > 0) this.waveBreak(nextStart, p.arrivalWave);
      if (p.arrivalGapMs > 0) this.breath(nextStart, p.arrivalGapMs / 1000);
    }
    // with the patch ALONE as the harmony its root and chord are its (a static machine, our gates): silent here;
    // "both" (the artist: 병행) keeps the Web Audio bass and pad beside the patch
    const alone = p.instrument === "noisecraft";
    if (!alone) for (const b of plan.bass) this.bassNote(b.pitch, nextStart + b.at * barSec, b.level);
    this.setPad(plan.pad.pitches, alone ? 0 : plan.pad.level, nextStart, plan.arrival === "tonic");
  }
}

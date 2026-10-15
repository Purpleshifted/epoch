/**
 * sound/engine.ts — the PLAYER's ears: Web Audio, no dependencies (docs/sound-logic.md §8).
 *
 * The engine is a step sequencer on the shared grid (sequencer.ts plans every bar from the signals, on the harmony
 * state of harmonyState.ts) and a small subtractive instrument that plays what the plan says. Three instruments:
 * "webaudio" plays everything here; "noisecraft" leaves everything to the patch; "hybrid" (default) plays the
 * MELODY here — dry, close, mine — and leaves the HARMONY (bass, pad, texture, traces) to the patch, on the
 * patch's clock (setGridAnchor).
 *
 *   my voice      straight ahead, in my register, dry.
 *   the others    one voice each, placed around me with the browser's HRTF (PannerNode) at their bearing and
 *                 distance; bots are blurred (darker, drifting) so they read as echoes, not people.
 *   the line      a Magenta phrase (my motif improvised over the chords, or blended with a neighbour's) as a
 *                 softer second voice — never in place of my motif.
 *   bass          the root of the place on the downbeat while I follow a path.
 *   pad           the chord of the place held while I stay among others (the building being born).
 *
 * ONE BUS, TWO TRACKS (the artist, 2026-10-15 evening: "they still don't blend" — they were two AudioContexts in
 * two rooms). Track A, the melody (the voices above). Track B, the NoiseCraft patch: the embed's output comes in
 * as a MediaStream (attachNoiseCraft) and goes through the SAME treatment the melody gets — a low-pass that
 * closes on concrete, the three rooms, and the vegetation's roughness (an amplitude grain from the noise) — each
 * with its own amounts (SoundParams mel* / nc*), then both into one master with a gentle glue compressor. The
 * melody is delayed by `melDelayMs` to meet the stream's latency.
 *   the dull      concrete nearby closes a low-pass over everything.
 *   grass         vegetation around me as a faint bright noise.
 *   rooms         three convolution reverbs, cross-faded by where I am: open ground (short, dark), concrete
 *                 (hard early reflections), the hall that opens while building together.
 *
 * The AudioContext can only start from a user gesture (mobile): call `start()` from one. The optional Magenta
 * models (magenta.ts) are loaded a few seconds after that and only used when they have answered.
 */

import { KEY_NAMES, bandOf, chordName, homeKey, keyName, magentaChordName, worldKey, type Key, type WorldKey } from "./harmony";
import { HarmonyTracker, harmonyLabel, nextHarmony, type HarmonyState, type PlaceState } from "./harmonyState";
import { Magenta, phraseNotes } from "./magenta";
import { applySink } from "./output";
import { makeMotif, midiToHz, realize, type Motif } from "./motif";
import { barClock, conformity, lockOf, planBar, roughness, type BarPlan } from "./sequencer";
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
  /**
   * HARMONY MODE:
   *   "fusion"   (default) the harmony state H (harmonyState.ts): tonality = whose weights (home / group /
   *              building), people as voices, the path as a progression with cadences, approach = dominant,
   *              staged modulations home, tension; motifs as tonal answers anchored on the chords
   *   "world"    the 2026-10-14 afternoon version (93e85c5): one key per epoch with a progression over the ground,
   *              full pull, no modulation
   */
  harmony: "fusion" | "world";
  /**
   * Who makes the sound: "hybrid" (default) = the melody (me, the near ones, the line) here in Web Audio and the
   * harmony (bass, pad, texture, traces) in the NoiseCraft patch; "webaudio" = everything here; "noisecraft" =
   * everything in the patch (noisecraftDriver.ts feeds it this engine's plans either way).
   */
  instrument: "webaudio" | "noisecraft" | "hybrid";
  /** How much conforming pulls single notes onto the chord of the place (0 = the motif is never rewritten). */
  lockPull: number;
  /** Share of noise in a voice at full roughness (crossing vegetation): the tonal/noise ratio. */
  noiseMix: number;
  /** intersection's inner radius (world): people this close become voices in my sequence; further = texture only. */
  innerRadius: number;
  // ── TRACK A: the melody (Web Audio) ──
  /** Level of the melody track (0..1). */
  melLevel: number;
  /** Its send into the rooms (0..1 × the rooms' own mix). */
  melRoom: number;
  /** Its bar-synced echo send (0..1). */
  melEcho: number;
  /** How much its low-pass follows concrete (0 = never closes, 1 = lpSealed on a building). */
  melFilter: number;
  /** Delay (ms) of the melody so it meets the patch's stream latency. */
  melDelayMs: number;
  /** Scale of the motifs' micro-tonal colour (1 = the signature's cents, 0 = equal temperament). */
  colourScale: number;
  // ── TRACK B: the patch (NoiseCraft through this bus) ──
  ncLevel: number;
  ncRoom: number;
  ncFilter: number;
  /** Max depth of the vegetation grain on the patch (amplitude modulated by noise × roughness). */
  ncRough: number;
  /** Octaves the patch's texture pitch set is shifted (−1 = below the melody's register). */
  ncOctave: number;
  /** The glue compressor on the master. */
  glue: boolean;
  /** HRTF panning of the others (heavier; off = equal-power stereo). New voices only. */
  hrtf: boolean;
  /** The TEXTURE: random short blips on the chord's tones every bar (the patch's bubbling, in Web Audio; 0 = none). */
  textureLevel: number;
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
  magenta: false,
  lockPull: 0.7,
  noiseMix: 0.6,
  innerRadius: 5,
  stepEvery: 6,
  harmony: "fusion",
  instrument: "webaudio",
  melLevel: 1,
  melRoom: 1,
  melEcho: 0.35,
  melFilter: 1,
  melDelayMs: 40,
  colourScale: 0.5,
  ncLevel: 1,
  ncRoom: 0.5,
  ncFilter: 1,
  ncRough: 0.5,
  ncOctave: -1,
  glue: true,
  hrtf: false,
  textureLevel: 0.3,
};

/** Whether the Web Audio instrument plays the melody / the harmony under `instrument`. */
export const playsMelody = (i: SoundParams["instrument"]) => i !== "noisecraft";
export const playsHarmony = (i: SoundParams["instrument"]) => i === "webaudio";

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
const ECHO_STEPS = 3; // the melody's echo: three 16th steps of the bar (a dotted eighth)
const noteName = (midi: number) => KEY_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
const MAX_VOICES = 3; // the others heard at once by the Web Audio instrument (nearest first)
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
  myId: string;
  epochMs: number;
  yaw: number;
  bar: number;
  /** The key I am in and, at a building, which one. */
  key: string;
  building: string | null;
  /** At a building: who built it (heaviest first), whose roots make its chord. */
  builders: string[];
  /** Degree of the progression (0 = tonic) and the chord. */
  degree: number;
  chord: string;
  /** The harmony state in one line (fusion mode). */
  harmony: string;
  tension: number;
  /** My notes this bar (names; * = pulled onto the chord) and the register shift that anchored them. */
  me: string;
  anchor: number;
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
  /** Whether the patch's stream is routed through this bus. */
  ncStream: boolean;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private glue!: DynamicsCompressorNode;
  /** Track A: the melody bus → its delay → its low-pass → dry + a send into the rooms. */
  private mel!: { bus: GainNode; delay: DelayNode; filt: BiquadFilterNode; send: GainNode };
  /** Track B: the patch's stream → level → vegetation grain (AM by noise) → low-pass → dry + a send into the rooms. */
  private nc: { source: MediaStreamAudioSourceNode; level: GainNode; am: GainNode; grain: GainNode; filt: BiquadFilterNode; send: GainNode } | null = null;
  private ncStream: MediaStream | null = null;
  /** Level meters of the two tracks (the workspace shows them). */
  private meterA: AnalyserNode | null = null;
  private meterB: AnalyserNode | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  private dry!: GainNode;
  private rooms!: { open: GainNode; concrete: GainNode; hall: GainNode };
  private noiseGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private bassGain!: GainNode;
  private pad!: { oscs: OscillatorNode[]; gains: GainNode[]; level: GainNode };
  /** The melody's echo: a bar-synced feedback delay, darker on every repeat; its feedback follows the conformity. */
  private echo!: { send: GainNode; delay: DelayNode; fb: GainNode };
  /** The texture's bus: chord-tone blips into the dry mix, the hall and the echo. */
  private texture!: GainNode;
  private me: Voice | null = null;
  /** My motif (pure): planning needs it even with no AudioContext (headless engine on the manager page). */
  private myMotif: Motif | null = null;
  private lastWall = 0;
  private voices = new Map<string, Voice>();
  private motifs = new Map<string, Motif>();
  private closeness = new Map<string, number>();
  private sig: PersonalSignals | null = null;
  private params_: SoundParams = DEFAULT_SOUND;
  private yaw = 0;
  private myId = "";
  private epochMs = 0;
  /** My home key (identity) and the key I am in now (home, the group's, or the building's). */
  private home: Key | null = null;
  private placeKey: Key | null = null;
  /** World mode: the epoch's shared key (cached per epoch). */
  private world: { epochMs: number; key: WorldKey } | null = null;
  /** World mode: the degree of the band I stand on. */
  private degree = 0;
  /** Fusion mode: the harmony tracker (hysteresis, path, cadences) and the state of the last planned bar. */
  private tracker = new HarmonyTracker();
  private place: PlaceState | null = null;
  private harmony: HarmonyState | null = null;
  /** The last pitch of my previous bar (anchoring). */
  private prevLast: number | null = null;
  /** Plans by bar: the Web Audio scheduler and the NoiseCraft driver ask for the same bars. */
  private plans = new Map<number, BarPlan>();
  /** The patch's clock, when it is the master: wall time of a bar's start (NoiseCraftDriver → setGridAnchor). */
  private anchor: { bar: number; wallMs: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastUpdate = 0;
  private planned = -1;
  private lastPlan: BarPlan | null = null;
  private line: Voice | null = null;
  private lockedBars = 0;
  private phrase: { phrase: Phrase; from: number; kind: string } | null = null;
  private magenta = new Magenta();
  private magentaState: SoundDebug["magenta"] = "off";
  private sinkId = "default";

  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running" && this.timer !== null;
  }

  /** The latest signals (for whoever else renders them, e.g. the NoiseCraft knobs). */
  get signals(): PersonalSignals | null {
    return this.sig;
  }

  /** The parameters last given to update(). */
  get params(): SoundParams {
    return this.params_;
  }

  get debug(): SoundDebug {
    const p = this.lastPlan;
    return {
      myId: this.myId,
      epochMs: this.epochMs,
      yaw: this.yaw,
      bar: p?.bar ?? -1,
      key: this.placeKey ? keyName(this.placeKey) + (this.params_.harmony === "world" ? " [world]" : "") : "",
      building: this.harmony && this.harmony.source === "building" ? this.harmony.placeId : null,
      builders: this.harmony?.builders ?? [],
      degree: this.harmony?.degree ?? this.degree,
      chord: p ? chordName(p.chord) : "",
      harmony: this.harmony ? harmonyLabel(this.harmony) : "",
      tension: this.harmony?.tension ?? 0,
      me: p ? p.me.map((n) => noteName(n.pitch) + (n.locked ? "*" : "")).join(" ") : "",
      anchor: p?.anchor ?? 0,
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
      ncStream: !!this.nc,
    };
  }

  /** Builds the graph on first call; resumes the context. Must be called from a user gesture on mobile. */
  async start(): Promise<void> {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      // the glue: a gentle compressor both tracks share (threshold 0 dB = off)
      this.glue = ctx.createDynamicsCompressor();
      this.glue.threshold.value = -18;
      this.glue.knee.value = 12;
      this.glue.ratio.value = 2.5;
      this.glue.attack.value = 0.01;
      this.glue.release.value = 0.25;
      this.master.connect(this.glue).connect(ctx.destination);
      this.dry = ctx.createGain();
      this.dry.connect(this.master);
      // three rooms
      const room = (seconds: number, decay: number, taps: number, bright: number, level: number) => {
        const g = ctx.createGain();
        g.gain.value = level;
        const v = ctx.createConvolver();
        v.buffer = impulse(ctx, seconds, decay, taps, bright);
        g.connect(v).connect(this.master);
        return g;
      };
      this.rooms = {
        open: room(1.2, 0.35, 0, 0.25, 0.12),
        concrete: room(1.5, 0.5, 6, 0.9, 0),
        hall: room(3.0, 1.2, 0, 0.5, 0),
      };
      // track A: the melody bus
      const melBus = ctx.createGain();
      melBus.gain.value = 1;
      const melDelay = ctx.createDelay(1);
      melDelay.delayTime.value = this.params_.melDelayMs / 1000;
      const melFilt = ctx.createBiquadFilter();
      melFilt.type = "lowpass";
      melFilt.frequency.value = this.params_.lpOpen;
      melFilt.Q.value = 0.5;
      const melSend = ctx.createGain();
      melSend.gain.value = this.params_.melRoom;
      melBus.connect(melDelay).connect(melFilt);
      melFilt.connect(this.dry);
      melFilt.connect(melSend);
      for (const r of ["open", "concrete", "hall"] as const) melSend.connect(this.rooms[r]);
      this.mel = { bus: melBus, delay: melDelay, filt: melFilt, send: melSend };
      this.meterA = ctx.createAnalyser();
      this.meterA.fftSize = 512;
      melFilt.connect(this.meterA);
      this.meterB = ctx.createAnalyser();
      this.meterB.fftSize = 512;
      this.meterBuf = new Float32Array(512);
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
      // the melody's echo
      const send = ctx.createGain();
      send.gain.value = 0.35;
      const delay = ctx.createDelay(2);
      delay.delayTime.value = (this.params_.barSec * ECHO_STEPS) / 16;
      const fb = ctx.createGain();
      fb.gain.value = 0.3;
      const dark = ctx.createBiquadFilter();
      dark.type = "lowpass";
      dark.frequency.value = 2200;
      send.connect(delay);
      delay.connect(dark).connect(fb).connect(delay);
      delay.connect(this.mel.bus);
      this.echo = { send, delay, fb };
      // the texture
      this.texture = ctx.createGain();
      this.texture.gain.value = 1;
      this.texture.connect(this.dry);
      this.texture.connect(this.rooms.hall);
      this.texture.connect(send);
      this.lastUpdate = ctx.currentTime;
      if (this.ncStream) this.attachNoiseCraft(this.ncStream);
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
    if (this.sinkId !== "default") await applySink(this.ctx, this.sinkId);
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.master.gain.setTargetAtTime(this.params_.master, this.ctx.currentTime, 0.3);
    if (this.params_.magenta && this.magentaState === "off") {
      this.magentaState = "loading";
      setTimeout(() => this.magenta.load().then((ok) => (this.magentaState = ok ? "ready" : "failed")), MAGENTA_AFTER_MS);
    }
  }

  /** Send this window's sound to an output device (headset / speakers); no-op where the browser cannot. */
  async setSink(id: string): Promise<boolean> {
    this.sinkId = id;
    return this.ctx ? applySink(this.ctx, id) : false;
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
    this.line = null;
  }

  /**
   * TRACK B: the NoiseCraft embed's output (NoiseCraftBridge.onStream) into this bus — level, the vegetation grain
   * (amplitude modulated by filtered noise, depth = ncRough × roughness), a low-pass that closes on concrete
   * (ncFilter), dry + a send into the three rooms. null detaches. Kept until the context exists.
   */
  attachNoiseCraft(stream: MediaStream | null): void {
    this.ncStream = stream;
    if (this.nc) {
      try {
        this.nc.source.disconnect();
        this.nc.level.disconnect();
      } catch {
        /* ignore */
      }
      this.nc = null;
    }
    const ctx = this.ctx;
    if (!ctx || !stream) return;
    try {
      const source = ctx.createMediaStreamSource(stream);
      const level = ctx.createGain();
      level.gain.value = 0;
      const am = ctx.createGain();
      am.gain.value = 1;
      const grainNoise = ctx.createBufferSource();
      grainNoise.buffer = this.noiseBuf;
      grainNoise.loop = true;
      const grainLp = ctx.createBiquadFilter();
      grainLp.type = "lowpass";
      grainLp.frequency.value = 400;
      const grain = ctx.createGain();
      grain.gain.value = 0;
      grainNoise.connect(grainLp).connect(grain).connect(am.gain);
      grainNoise.start();
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = this.params_.lpOpen;
      filt.Q.value = 0.5;
      const send = ctx.createGain();
      send.gain.value = this.params_.ncRoom;
      source.connect(level).connect(am).connect(filt);
      filt.connect(this.dry);
      filt.connect(send);
      if (this.meterB) filt.connect(this.meterB);
      for (const r of ["open", "concrete", "hall"] as const) send.connect(this.rooms[r]);
      this.nc = { source, level, am, grain, filt, send };
    } catch (e) {
      console.warn("[sound] could not route the NoiseCraft stream:", e);
      this.nc = null;
    }
  }

  /** RMS level (0..1) of track A (the melody) and track B (the patch), after their filters. */
  meters(): { a: number; b: number } {
    const rms = (an: AnalyserNode | null) => {
      if (!an || !this.meterBuf) return 0;
      an.getFloatTimeDomainData(this.meterBuf);
      let s = 0;
      for (let i = 0; i < this.meterBuf.length; i++) s += this.meterBuf[i] * this.meterBuf[i];
      return Math.min(1, Math.sqrt(s / this.meterBuf.length) * 3);
    };
    return { a: rms(this.meterA), b: this.nc ? rms(this.meterB) : 0 };
  }

  /**
   * The NoiseCraft patch is the master clock (hybrid / noisecraft): the driver tells when a bar started on the wall
   * clock, and the Web Audio scheduler counts its bars from there instead of the epoch — so the melody here and
   * the harmony there are on one beat.
   */
  setGridAnchor(bar: number, wallMs: number): void {
    this.anchor = { bar, wallMs };
  }

  private motifOf(id: string): Motif {
    let m = this.motifs.get(id);
    if (!m) {
      m = makeMotif(id);
      this.motifs.set(id, m);
    }
    return m;
  }

  private newVoice(id: string, blur: number, spatial: boolean, rooms: ("open" | "concrete" | "hall")[] = ["open", "concrete", "hall"]): Voice {
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
      panner.panningModel = this.params_.hrtf ? "HRTF" : "equalpower";
      panner.distanceModel = "inverse";
      panner.refDistance = 1.5;
      panner.rolloffFactor = 1;
      panner.maxDistance = 1000;
      gain.connect(panner);
      out = panner;
    }
    filt.connect(gain);
    out.connect(this.mel.bus); // every voice is on track A; the rooms are the track's send (rooms[] kept for the signature)
    void rooms;
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
    this.params_ = params;
    this.yaw = yaw;
    if (this.myId !== myId || !this.home) {
      this.myId = myId;
      this.home = homeKey(myId);
      this.placeKey = this.home;
      this.harmony = null;
      this.prevLast = null;
      this.plans.clear();
    }
    this.epochMs = epochMs;
    if (params.harmony === "world") {
      // WORLD: one key for everybody, the chord from the band of the ground I stand on (93e85c5)
      if (!this.world || this.world.epochMs !== epochMs) this.world = { epochMs, key: worldKey(String(epochMs)) };
      this.degree = this.world.key.degrees[bandOf(sig.x, sig.z)];
      this.placeKey = this.world.key;
      this.harmony = null;
    } else {
      // FUSION: the harmony tracker follows the walk; the state itself is made per bar (planFor)
      this.place = this.tracker.update(myId, sig, params.stepEvery);
      if (this.placeKey && (this.placeKey as WorldKey).degrees) this.placeKey = this.home; // back from world mode
    }
    if (!this.myMotif || this.myMotif.id !== myId) this.myMotif = this.motifOf(myId);
    // closeness accumulates on the wall clock (so a headless engine, which only plans, keeps it too)
    const wall = Date.now();
    const wdt = this.lastWall ? Math.max(0, Math.min(2, (wall - this.lastWall) / 1000)) : 0;
    this.lastWall = wall;
    const near = new Set<string>();
    for (const n of sig.neighbours) {
      if (n.dist > params.hearRadius) continue;
      near.add(n.o);
      this.motifOf(n.o); // their leitmotif is known to the planner whichever instrument plays it
      const close = n.dist < params.hearRadius * 0.5;
      this.closeness.set(n.o, Math.max(0, Math.min(1, (this.closeness.get(n.o) ?? 0) + wdt * (close ? 0.12 : -0.08))));
    }
    for (const [id, c] of this.closeness) {
      if (near.has(id)) continue;
      const nc = c - wdt * 0.08;
      if (nc <= 0) this.closeness.delete(id);
      else this.closeness.set(id, nc);
    }
    const ctx = this.ctx;
    if (!ctx || !this.timer) return;
    const t = ctx.currentTime;
    const dt = Math.max(0, Math.min(2, t - this.lastUpdate));
    this.lastUpdate = t;
    this.master.gain.setTargetAtTime(params.master, t, 0.3);
    // the two tracks: the melody here unless the patch plays everything; the patch's stream unless only Web Audio
    this.mel.bus.gain.setTargetAtTime(playsMelody(params.instrument) ? params.melLevel : 0, t, 0.3);
    this.mel.send.gain.setTargetAtTime(params.melRoom, t, 0.3);
    this.mel.delay.delayTime.setTargetAtTime(this.nc ? params.melDelayMs / 1000 : 0, t, 0.1);
    this.echo.send.gain.setTargetAtTime(params.melEcho, t, 0.3);
    this.glue.threshold.setTargetAtTime(params.glue ? -18 : 0, t, 0.1);
    const rough = roughness(sig, params.speedMax);
    const lp = (amount: number) => Math.exp(Math.log(params.lpOpen) + (Math.log(params.lpSealed) - Math.log(params.lpOpen)) * Math.min(1, sig.sealed * amount));
    this.mel.filt.frequency.setTargetAtTime(lp(params.melFilter), t, 0.25);
    if (this.nc) {
      this.nc.level.gain.setTargetAtTime(params.instrument !== "webaudio" ? params.ncLevel : 0, t, 0.3);
      this.nc.send.gain.setTargetAtTime(params.ncRoom, t, 0.3);
      this.nc.filt.frequency.setTargetAtTime(lp(params.ncFilter), t, 0.25);
      const depth = Math.min(0.9, params.ncRough * rough);
      this.nc.am.gain.setTargetAtTime(1 - depth, t, 0.3);
      this.nc.grain.gain.setTargetAtTime(depth * 2, t, 0.3);
    }

    if (!this.me || this.me.motif.id !== myId) {
      if (this.me) this.dropVoice("me", this.me);
      // my voice: close, but in the same rooms as everything (bone dry it floated above the patch) and into the echo
      this.me = this.newVoice(myId, 0, false);
      this.me.gain.gain.setTargetAtTime(1, t, 0.5);
      this.me.filt.connect(this.echo.send);
      if (this.line) this.dropVoice("line", this.line);
      this.line = this.newVoice(myId, 0.3, false, ["open", "hall"]);
      this.line.gain.gain.setTargetAtTime(0.55, t, 0.5);
    }
    // the melody moves with the walk: brighter when moving, darker when still; the echo holds on when I conform
    const moving = Math.min(1, sig.speed / Math.max(0.01, params.speedMax * 0.5));
    this.me.filt.frequency.setTargetAtTime(1800 + 3200 * moving, t, 0.4);
    this.echo.delay.delayTime.setTargetAtTime((params.barSec * ECHO_STEPS) / 16, t, 0.1);
    this.echo.fb.gain.setTargetAtTime(0.2 + 0.4 * conformity(sig), t, 0.5);
    // the listener turns with the camera: forward = (sin yaw, 0, cos yaw) in world terms
    const L = ctx.listener;
    if (L.forwardX) {
      L.forwardX.setTargetAtTime(Math.sin(yaw), t, 0.05);
      L.forwardZ.setTargetAtTime(Math.cos(yaw), t, 0.05);
    }
    // vegetation
    this.noiseGain.gain.setTargetAtTime(params.noiseMax * sig.grass * 0.5, t, 0.5);
    // rooms: open ground → concrete → the hall of building together
    const company = Math.min(1, sig.neighbours.length / 2);
    // the hall opens while building together; it is never fully shut (a floor of a tenth) so the melody has a room
    const hall = params.reverbMax * Math.max(0.1, sig.stay * company);
    this.rooms.hall.gain.setTargetAtTime(hall, t, 0.8);
    this.rooms.concrete.gain.setTargetAtTime(0.35 * sig.sealed * (1 - hall), t, 0.4);
    this.rooms.open.gain.setTargetAtTime(0.12 * (1 - sig.sealed) * (1 - hall), t, 0.4);

    // who is within earshot: a voice each, placed by HRTF — only for the Web Audio instrument (NoiseCraft plays the
    // others itself) and only the nearest MAX_VOICES (an HRTF panner per bot is what lagged with a dozen bots)
    const alive = new Set<string>();
    const heard = playsMelody(params.instrument) ? sig.neighbours.filter((n) => n.dist <= params.hearRadius).slice(0, MAX_VOICES) : [];
    for (const n of heard) {
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
    }
    for (const [id, v] of this.voices) {
      if (alive.has(id)) continue;
      if (t - v.seen > OTHER_FADE_SEC) this.dropVoice(id, v);
      else v.gain.gain.setTargetAtTime(0, t, 0.4);
    }
    void dt;
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
    const noiseShare = this.params_.noiseMix * rough;
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
    const peak = 0.5 * level * this.params_.bassLevel;
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
    lv.gain.setTargetAtTime(level * this.params_.padLevel * 0.25, at, 0.6);
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
    if (!this.myMotif || !this.placeKey || !this.sig) return out;
    const key = this.placeKey;
    const chord = this.lastPlan?.chord ?? null;
    for (let c = 0; c < CYCLES_PER_PHRASE; c++) {
      const steps = cycleToSteps(realize(this.myMotif, key, chord, lock, fromBar + c));
      for (let i = 0; i < STEPS_PER_CYCLE; i++) out[c * STEPS_PER_CYCLE + i] = steps[i];
    }
    return out;
  }

  private theirPhrase(id: string, fromBar: number, lock: number): Phrase {
    const out: Phrase = new Array(PHRASE_STEPS).fill(0);
    if (!this.placeKey) return out;
    const m = this.motifOf(id);
    // among people (a group, a building) we share the place's key and chord; in the open their own home key
    const among = this.harmony?.source === "building" || this.harmony?.source === "group";
    const key = among ? this.placeKey : homeKey(id);
    const chord = among ? this.lastPlan?.chord ?? null : null;
    for (let c = 0; c < CYCLES_PER_PHRASE; c++) {
      const steps = cycleToSteps(realize(m, key, chord, lock, fromBar + c));
      for (let i = 0; i < STEPS_PER_CYCLE; i++) out[c * STEPS_PER_CYCLE + i] = steps[i];
    }
    return out;
  }

  /** Ask Magenta for a phrase when the moment calls for one; it takes my bars once it has answered. */
  private askMagenta(bar: number, sig: PersonalSignals, lock: number, stable: number): void {
    if (!this.params_.magenta || !this.magenta.ready || !this.placeKey) return;
    if (this.phrase && bar - this.phrase.from < CYCLES_PER_PHRASE + 2) return; // one phrase, then a breath
    const nearest = sig.neighbours[0];
    const amount = nearest ? this.closeness.get(nearest.o) ?? 0 : 0;
    // a phrase with fewer than 3 notes would be silence in my voice's place: keep the motif instead
    const take = (res: Phrase | null, kind: string) => {
      if (res && phraseNotes(res) >= 3) this.phrase = { phrase: res, from: bar, kind: `${kind} (${phraseNotes(res)}n)` };
    };
    if (nearest && amount >= 0.5) {
      take(this.magenta.interpolate(this.myPhrase(bar, lock), this.theirPhrase(nearest.o, bar, lock), amount), `vae×${nearest.o}`);
      return;
    }
    // the RNN improvises my motif over the chords of the place: among people (a group, a building) or settled on
    // a path — the line that makes the progression audible as a line (the artist: "Magenta, else what was it for")
    const among = this.harmony && (this.harmony.source === "building" || this.harmony.source === "group");
    if ((among || (stable >= 0.6 && this.lockedBars >= 2)) && this.lastPlan) {
      const name = chordName(this.lastPlan.chord);
      take(this.magenta.improvise(this.myPhrase(bar, lock), [magentaChordName(name), magentaChordName(name)]), `rnn ${name}`);
    }
  }

  /**
   * The plan of bar `bar` from the current signals (sequencer.planBar) on the harmony state of that bar
   * (harmonyState.nextHarmony), with the Magenta requests and the phrase bookkeeping. Memoized per bar: the Web
   * Audio scheduler and the NoiseCraft driver both ask, and must get the same bar.
   */
  planFor(bar: number): BarPlan | null {
    const sig = this.sig;
    if (!sig || !this.myMotif || !this.home) return null;
    const cached = this.plans.get(bar);
    if (cached) return cached;
    const p = this.params_;
    const world = p.harmony === "world";
    const stable = conformity(sig);
    const lock = lockOf(sig, world ? 1 : p.lockPull);
    let h: HarmonyState | null = null;
    if (!world) {
      const place = this.place ?? this.tracker.update(this.myId, sig, p.stepEvery);
      h = nextHarmony(this.harmony && this.harmony.bar < bar ? this.harmony : null, {
        bar,
        myId: this.myId,
        sig,
        place,
        closeness: this.closeness,
        rough: roughness(sig, p.speedMax),
        cadence: this.tracker.takeCadence(),
      });
      this.harmony = h;
      this.placeKey = h.key;
    }
    const key = this.placeKey ?? this.home;
    this.lockedBars = stable >= 0.6 ? this.lockedBars + 1 : 0;
    this.askMagenta(bar, sig, lock, stable);
    if (this.phrase && bar - this.phrase.from >= CYCLES_PER_PHRASE + 2) this.phrase = null;
    const plan = planBar({
      bar,
      sig,
      key,
      building: h && h.source === "building" ? h.placeId : null,
      degree: h ? h.degree : this.degree,
      chord: h ? h.chord : null,
      harmony: h,
      prevLast: this.prevLast,
      register: sig.sealed >= 0.5 ? -12 : 0,
      me: this.myMotif,
      others: this.motifs,
      closeness: this.closeness,
      phrase: this.phrase && bar - this.phrase.from < CYCLES_PER_PHRASE ? this.phrase : null,
      phraseTo: "line",
      params: { barSec: p.barSec, speedMax: p.speedMax, bassFrom: 0.25, lockPull: world ? 1 : p.lockPull, innerRadius: p.innerRadius },
    });
    if (plan.me.length) this.prevLast = plan.me[plan.me.length - 1].pitch;
    this.lastPlan = plan;
    this.plans.set(bar, plan);
    for (const b of this.plans.keys()) if (b < bar - 8) this.plans.delete(b);
    return plan;
  }

  private tick(): void {
    const ctx = this.ctx;
    const sig = this.sig;
    const key = this.placeKey;
    if (!ctx || !sig || !key || !this.me || ctx.state !== "running" || !this.epochMs) return;
    const p = this.params_;
    const now = ctx.currentTime;
    // the grid: the patch's clock when it is the master (anchor), else the epoch on the wall clock
    const epoch = this.anchor && p.instrument !== "webaudio" ? this.anchor.wallMs - this.anchor.bar * p.barSec * 1000 : this.epochMs;
    const { bar, start } = barClock(epoch, Date.now(), now, p.barSec);
    if (this.planned < bar) this.planned = bar; // never schedule a bar already under way (or a burst after a hidden tab)
    const next = this.planned + 1;
    const nextStart = start + (next - bar) * p.barSec;
    if (nextStart > now + LOOKAHEAD) return;
    this.planned = next;

    const plan = this.planFor(next);
    if (!plan) return;
    if (!playsMelody(p.instrument)) return; // NoiseCraft makes the sound from its own bars (planFor on its pulses)
    // a rough walk drifts off the grid and loses notes; a conforming one is steady and complete
    const jitter = p.jitterMax * plan.rough;
    const human = () => (jitter > 0 ? (Math.random() * 2 - 1) * jitter : 0);
    const kept = () => Math.random() >= plan.rough * 0.35;
    // the colour (the signature's cents) scaled: freq = base × (freq / base) ^ colourScale
    const coloured = (n: { pitch: number; freq: number }) => {
      const base = midiToHz(n.pitch);
      return base * Math.pow(n.freq / base, p.colourScale);
    };

    // the timbre breathes slowly from bar to bar (a slow sine per motif) and brightens with the walk
    const breath = 0.5 + 0.5 * Math.sin(next * 0.37 + this.me.motif.timbre * 6.28);
    const timbre = Math.max(0, Math.min(1, this.me.motif.timbre * 0.6 + 0.3 * breath + 0.2 * Math.min(1, sig.speed / p.speedMax)));
    for (const n of plan.me) if (kept()) this.note(this.me.filt, coloured(n), nextStart + n.at * p.barSec + human(), n.len * p.barSec, 1, timbre, 0, plan.rough);
    for (const vb of plan.others) {
      const v = this.voices.get(vb.o);
      if (!v || v.level <= 0.001) continue;
      const theirRough = plan.answer ? plan.rough * 0.3 : plan.rough;
      for (const n of vb.notes) if (kept()) this.note(v.filt, coloured(n), nextStart + n.at * p.barSec + human() * 0.5, n.len * p.barSec, plan.answer ? 1 : 0.8, v.motif.timbre, v.blur, theirRough);
    }
    // the line: a softer second voice of mine (a Magenta phrase), in my register's colour
    if (this.line) for (const n of plan.line) this.note(this.line.filt, coloured(n), nextStart + n.at * p.barSec, n.len * p.barSec, 0.7, this.me.motif.timbre, 0.3, plan.rough * 0.5);
    if (!playsHarmony(p.instrument)) return; // the harmony (bass, pad) is the patch's in the hybrid
    for (const b of plan.bass) this.bassNote(b.pitch, nextStart + b.at * p.barSec, b.level);
    this.setPad(plan.pad.pitches, plan.pad.level, nextStart);
    // the texture: a few short blips on the chord's tones at random steps — more among people, calmer alone; what
    // the patch's random triggers did, in Web Audio
    const company = Math.min(1, sig.neighbours.length / 2);
    const tex = p.textureLevel * (0.35 + 0.65 * company);
    if (tex > 0.01 && plan.chord.classes.length) {
      const count = 1 + Math.floor(Math.random() * (2 + 3 * company));
      for (let i = 0; i < count; i++) {
        const cls = plan.chord.classes[Math.floor(Math.random() * plan.chord.classes.length)];
        const pitch = 60 + cls + 12 * Math.floor(Math.random() * 2);
        const at = nextStart + (Math.floor(Math.random() * 16) / 16) * p.barSec;
        this.note(this.texture, midiToHz(pitch), at, 0.06 + Math.random() * 0.1, tex * 0.5, 0.15, 0.5, plan.rough * 0.5);
      }
    }
  }
}

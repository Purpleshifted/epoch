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

import { chordName, magentaChordName, MODES, type PlaceChord, type WorldKey } from "./harmony";
import { conduct, resolutionChord, TENSE_BARS, type PhraseLock } from "./colour";
import { answerArc, ARC_IDLE, arrivalHold, stepArc, type ArcState, type ArcStep } from "./tensionArc";
import { apartShift, bassUnder, callsOn, endClosed, endOpen, interlock, landWith, octaveToward, placeApart, rotate, shiftNotes } from "./dialogue";
import { wordMotifOf } from "@/lib/parliament/glyph";
import { Magenta } from "./magenta";
import { midiToHz, realize, type Motif, type MotifNote } from "./motif";
import { ARRIVAL_COOLDOWN, ARRIVAL_IDLE, barClock, lockOf, nextArrival, planBar, type ArrivalState, type BarPlan } from "./sequencer";
import { bestKey, keyName, zoneChord, zoneOf } from "./tonality";
import type { KnobSources } from "./noisecraftKnobs";
import { applyOutput, makeLimiter, onOutputChange } from "./output";
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
  /** The wave's and the vegetation's share into the hall's reverb (0..1): dry noise was too dry (10/31, the artist). */
  waveVerb: number;
  grassVerb: number;
  /** The wave's HIT on the downbeat (0..1): after the crest hangs for a moment, a burst with a low thump — the reference's wave crested and struck. */
  waveHit: number;
  /** The breath before the tonic: everything dips for this long (ms) right before the downbeat (0 = none). */
  arrivalGapMs: number;
  /** The path strength under my feet from which the heartbeat is heard (v4 A4d: 0.25 on the exact cell was too strict). */
  bassFrom: number;
  /** The session ended (muffleSound): the AFTERLIFE — nothing but the reverb of the last sound. The dying itself is only the
   * muffling the session applies to these params (master, low-pass, the others, the vegetation) — the artist: simple. */
  dead: boolean;
  /** The afterlife's long room (s): the last sound rings out in it, a fade envelope over its second half. */
  afterlifeTail: number;
  /** After the afterlife: the room's speakers' sound, faintly, in the headset (0 = none) — so the sound met on taking the headset off is already known. */
  afterglow: number;
  /**
   * A word another left, found underfoot (witness `word.found`): the leaver's melody once, on the next bar, in the
   * name's voice — this times the level the name sounds at (1 = as loud as the name, 0 = not heard).
   */
  foundLevel: number;
  /**
   * ASKING AND ANSWERING AS COUNTERPOINT (§13d, the artist 2026-11-27; on the redesigned personal view only — useSound
   * passes false elsewhere): while a question is open the asker calls one bar and leaves the next empty (its phrase ends
   * open, an octave apart from mine), nobody else sings; my answer = my line closing on the tonic with theirs meshed into
   * it a register away, then the new word in octaves in both voices — and from then on my motif IS that word.
   */
  askCounterpoint: boolean;
  /**
   * BUILDING TOGETHER AS AN ENSEMBLE (§13e, the artist 2026-11-27: "합주도 넣어보자"; the redesigned view only): while
   * the record says 합주 (witness ensemble), my motif every bar and up to three of those building with me each a part —
   * entering one bar after another (a canon half a bar late, a bass under all, an inner line), each in its own register,
   * meshed into the others, landing together on an arrival's tonic; the rest keep quiet.
   */
  ensembleCounterpoint: boolean;
  /**
   * The hall and the pad while the ensemble plays (×, 1 = as when merely staying with someone — never less): the artist,
   * 2026-11-27, first "같이 지으면 오히려 홀이랑 패드는 강해져야" (they had been made smaller), then "리버브 엄청 키울 필요
   * 없는듯 … 줄이지만 않으면 돼" — so 1 by default, the knob for more (§13e).
   */
  ensembleSwell: number;
  /**
   * How much the lines of a dialogue or an ensemble keep out of each other's way (0 … 1): 1 = an octave apart and every
   * shared step dodged; 0 = the same register, the same beats, whatever falls (the artist, 2026-11-27: "같은 음역대에 좀
   * 겹치면 어때 꼭 대위적으로 서로 피해갈 이유는 없음"; §13d–e).
   */
  apartness: number;
  /**
   * MORE TURNS IN THE HARMONY (colour.ts, §13f — the artist, 2026-11-27: "화성이 좀 더 ... 진행이 다양했으면 좋겠고 (지금은
   * 오묘한 구간은 없고 살짝 고조되다 금방 풀림)"; the redesigned view only): staying moves through a progression of the
   * place's own that leaves the mode, walking bars are now and then suspended or opened, and an arrival builds longer
   * (a pre-dominant, the dominant, sometimes a deceptive turn, then home).
   */
  harmonyTurns: boolean;
  /** How much of the staying progression moves (0 = the place's chord held, as before; 1 = every step). */
  turnAmount: number;
  /** Which share of the walking bars is suspended or opened (sus4 · sus2 · add9). */
  colourAmount: number;
  /**
   * TENSION WHEN PEOPLE GATHER (colour.ts tenseChord, §13g — the artist, 2026-11-27: "더 텐스한 화성진행도 듣고싶음, 사람이
   * 모였을 떄 특히"; with harmonyTurns, the redesigned view only): 0..1 at its fullest — × how gathered (others within
   * hearing / crowdFull) = the share of eight-bar phrases that go tense, and how dark they may get. 0 = off.
   */
  tension: number;
  /** How many others within hearing make it fully gathered. */
  crowdFull: number;
  /**
   * TENSION THAT BUILDS AND IS RESOLVED (tensionArc.ts, §13h — the artist, 2026-11-27: "쌓여서 한 번에 혹은 서서히 '해결'이
   * 돼야"): bars fully gathered to fill the store; seconds with the same people until familiarity has resolved it;
   * bars of holding without any resolution before it closes by itself (the amen).
   */
  buildBars: number;
  bondSec: number;
  patienceBars: number;
  /** How much of my motif goes into the long open space (0..1): the signal sent out, its tail. */
  motifVerb: number;
  /** How much of the building's dullness the patch gets (0 = none, 1 = as everything else). */
  ncDull: number;
  /** The patch's real-time knobs follow the interaction (noisecraftKnobs.ts, v4 A5a) and how far they depart from the artist's saved values (0..1). */
  ncMap: boolean;
  ncMapDepth: number;
  /**
   * THE PATCH REACTS TO CHANGES (noisecraftKnobs.ts §8e — the artist, 2026-11-27: "noisecraft 패치 노브도 변화에 반응하는
   * 식으로 좀 더 개입 … 껐다 켤 수 있게 해서 한 번 보자"; the redesigned view only): the whole switch, then each part —
   * the tension as timbre, a pluck on each chord change, the dialogue's and the ensemble's gestures.
   */
  ncReact: boolean;
  /**
   * WHILE SOMEONE ASKS ME (§13j — the artist, 2026-11-28: "말 걸 때는 말 거는 애 멜로디 말고 다른 건 좀 죽여도 될 듯, 근데
   * 그 정도를 내가 레바로 조절할 수 있게"; the redesigned view only): how far everything but the asker's voice goes down
   * while the question is open — the pad, the bass, the vegetation's noise, the patch, the others (0 = nothing, 1 = silent).
   */
  askDuck: number;
  /**
   * THE FUTURE PASSING AS A DAYDREAM (§13k — the artist, 2026-11-28: "'미래' 찾아왔을 때 … 소리 효과가 없음. 음색이나 화성을
   * 퓨처리스틱 + 원래 하던 꽃 효과 + 뭔가 전파스러운 … 백일몽이 나를 스쳐가는 느낌", then "훨씬 엠비언트 하게 … 삐악 하는
   * 코드 소리? 는 빼는"; the redesigned view only): on, its level and length (s), and each part's share — the haze (the
   * place's lydian, low and slow), the radio far off (a dark band of static), my own melody as if from the future, the
   * old meadow's glitter (futureSound.ts), the patch's bloom.
   */
  futureSound: boolean;
  futureLevel: number;
  futureDur: number;
  futureHaze: number;
  futureRadio: number;
  futureEcho: number;
  futureGlitter: number;
  futureBloom: number;
  /**
   * …and how wide each reaction swings (0 = off, 1 = as designed, 2 = twice — the artist, 2026-11-27: "이런 요소들 더
   * 찾아서 레바 슬라이더로 그 부분의 폭 조절 가능하게"): the tension as timbre, a chord change's pluck, a question's
   * echo, my answer's pluck, the ensemble's room, a resolution's bloom, clarity on a path, a found word's shimmer.
   */
  reactTension: number;
  reactChange: number;
  reactAsk: number;
  reactAnswer: number;
  reactEnsemble: number;
  reactBloom: number;
  reactPath: number;
  reactFound: number;
  /** The path's heartbeat: how far it spreads into the rooms (0..1) and the second beat's strength (0..1). */
  bassSpread: number;
  bassDub: number;
  /** How much the voices (my motif, the others) dip on each heartbeat (0..1): the beat stands in front. */
  bassDuck: number;
  /** How much the heartbeat's pitch drops onto the root (0 = a pure thump, 1 = an electronic kick). */
  bassDrop: number;
}

/** The artist's mix, as saved on :3003 (2026-11-01: "제일 최근에 열어본 3003 사운드를 디폴트로"). */
export const DEFAULT_SOUND: SoundParams = {
  master: 0.5,
  barSec: 2,
  speedMax: 7,
  jitterMax: 0.04,
  reverbMax: 0.99,
  lpOpen: 5900,
  lpSealed: 750,
  noiseMax: 0.16,
  hearRadius: 17.5,
  othersLevel: 0.19,
  botBlur: 0.79,
  bassLevel: 0.6, // v4 A2d: the heartbeat in front (0.6 before)
  padLevel: 0.62,
  magenta: false, // the light version has no Magenta (the artist, v4 A1); tfjs shared the GPU with three.js
  instrument: "both",
  clockPull: 0.08,
  motifEvery: 1.9,
  microtone: 0.5,
  motifEcho: 0.5, // the signal's repeats (0.35 before the radio preset)
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
  motifOctaveRange: 2,
  zoneTonality: true,
  zoneRing: 8, // 4 before A4b: at walking speed the ring went by in under a second
  zoneMargin: 0.15,
  bandCells: 12,
  arrival: true,
  arrivalHall: 1,
  arrivalWave: 0.6,
  waveVerb: 0.85,
  grassVerb: 0.5,
  waveHit: 0.5,
  arrivalGapMs: 0, // 120 until 10/31 — the artist heard the breath as the sound being eaten at the wave's peak (measured: master 0.5 → 0.04 for 120 ms)
  bassFrom: 0.15,
  dead: false,
  afterlifeTail: 5, // 10 before A5e: the artist found it too long
  afterglow: 0.12,
  foundLevel: 1,
  askCounterpoint: true,
  ensembleCounterpoint: true,
  ensembleSwell: 1,
  apartness: 0.3,
  harmonyTurns: true,
  turnAmount: 0.8,
  colourAmount: 0.3,
  tension: 0.8,
  crowdFull: 2,
  buildBars: 12,
  bondSec: 60,
  patienceBars: 32,
  ncDull: 0.7,
  ncMap: true,
  ncMapDepth: 0.8,
  ncReact: true,
  askDuck: 0.6,
  futureSound: true,
  futureLevel: 0.8,
  futureDur: 10,
  futureHaze: 1,
  futureRadio: 1,
  futureEcho: 1,
  futureGlitter: 0.5,
  futureBloom: 1,
  reactTension: 1,
  reactChange: 1,
  reactAsk: 1,
  reactAnswer: 1,
  reactEnsemble: 1,
  reactBloom: 1,
  reactPath: 1,
  reactFound: 1,
  bassSpread: 0.8, // v4 A2e: its own long dark room
  bassDub: 0.75,
  bassDuck: 0.3,
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
/** A found word not played within this many bars of being found (an arrival's cadence held it, a stalled tab) is let go. */
const FOUND_WAIT_BARS = 4;
const TICK_MS = 50;
const OTHER_FADE_SEC = 1.5;
/** The voice of who has asked me something, against the others' level: the clearest thing around (the artist, 2026-11-10). */
const ASKER_LEVEL = 2.2;
/** My answer to a call: how loud it is said against my ordinary motif (the artist, 2026-11-10: it must leap out, to anyone). */
const ANSWER_VEL = 2.2;
/**
 * The other line of a dialogue (askCounterpoint): as present as mine, wherever they stand — its level undoes the
 * distance's fall-off (inverse, from 1.5) up to 4× and settles a little behind my own voice (§13d; 13 dB behind before).
 */
const PAIR_LEVEL = 0.9;
/** A featured voice's head hop (hopOf): how long one hop lasts from its note (s) — a sixteenth at the 2 s bar. */
const HOP_SEC = 0.24;
/** The ensemble's parts: at most this many besides me, the nearest within this share of the hearing radius. */
const ENSEMBLE_PARTS = 3;
const ENSEMBLE_NEAR = 0.6;
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
  /** The found words' melodies so far (found()): how many have sounded, and the last one — whose, on which bar. */
  found: { played: number; last: string; waiting: string | null };
  /** Asking and answering as counterpoint (§13d): the last bar it shaped — "부름 v_x @12", "빈 마디 v_x @13", "대답 v_x @14 → 새 어휘"; empty when none. */
  dialogue: string;
  /** How tense the harmony may get now (§13g), 0 = not gathered or off. */
  tension: number;
  /** The tension's build-up and its last resolution, for the status line (§13h); "" when off. */
  tensionLine: string;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  /** The limiter's reduction (dB), held and released at 2 dB/s, for the status line. */
  private limHold = 0;
  /** A test hook (window.__soundEngine.forceArrival()): the next bar begins an arrival cadence as if I had just started building with others. */
  private forceTogether = false;
  private outputLine = "기본 출력";
  private offOutput: (() => void) | null = null;
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
  /** The patch's stream as last attached: a context made again (start after dispose) joins it again. */
  private ncStream: MediaStream | null = null;
  /** The path's heartbeat: a soft clip for weight, then dry, and the hall's room darkened by bassSpread. */
  private bassSpread!: GainNode;
  private noise!: AudioBuffer;
  /** The wave: looped noise → a low-pass that rises → a level that swells, into dry and the hall. */
  private wave!: { filter: BiquadFilterNode; gain: GainNode; send: GainNode; dry: GainNode };
  /** The hall's convolver itself (the arrival's room, not dulled): the wave and the vegetation send into it directly. */
  private hallConv!: ConvolverNode;
  private grassSend!: GainNode;
  private afterlife: { at: number; until: number; feedUntil: number } | null = null;
  /** The afterlife's long room (A5d): built with the graph for the tail's length, rebuilt at a death if the knob moved. */
  private afterRoom: { send: GainNode; conv: ConvolverNode; seconds: number } | null = null;
  /** The NoiseCraft patch's own feed into the afterlife room (its fader for the end), joined at a death. */
  private ncFeed: GainNode | null = null;
  private wasDead = false;
  /** My motif and the others go through this bus (dry + the rooms); the heartbeat ducks it. */
  private voiceBus!: GainNode;
  private me: Voice | null = null;
  /** The name's melody on its way to the limiter (announce). */
  private nameOut: GainNode | null = null;
  /** A found word's melody on its way to the master (found): made at the first, let go at a death. */
  private foundOut: GainNode | null = null;
  /** The found word waiting for its bar (found → tick): whose, and when it was found (context seconds). */
  private foundWaiting: { id: string; at: number } | null = null;
  private foundPlayed = 0;
  private foundLast = "";
  /**
   * The recording's tap (recorder.ts): a sink on the limiter's output, made once when a life is first recorded. It
   * carries exactly what goes to the device — the name's melody included — whatever device that is; no processing.
   */
  private tapOut: MediaStreamAudioDestinationNode | null = null;
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
  /** How tense the harmony may get now (§13h: the knob × stored × (1 − bond)). */
  private tensionNow = 0;
  /** The tension's build-up and resolutions (§13h), its last step, and the bar my answer lands home on. */
  private arc: ArcState = ARC_IDLE;
  private arcStep: ArcStep | null = null;
  private answerHomeBar = -1;
  /** The place's own chord on the last planned bar (before any colour): what a resolution lands on. */
  private placeNow: PlaceChord | null = null;
  private tensionLine = "";
  /** THE ONE CONDUCTOR (colour.ts conduct, §13i): the progression under way, the last bar's upper voices, what it did last. */
  private phraseLock: PhraseLock | null = null;
  private lastVoicing: number[] | null = null;
  private conductLine = "";
  /** Per planned bar, for the patch's knobs (§8e): how far its tense phrase has climbed (0..1), a chord change's pluck (0..1), whether it resolved. */
  private barShape = new Map<number, { tension: number; pluck: number; landed: boolean }>();
  /** When (context time) a found word's melody last began (§8e). */
  private foundAt = -1e9;
  /** When the future's daydream last cued the patch's bloom (§13k). */
  private cueBloomAt = -1e9;
  /** The ask's duck (§13j): the gains it moves (pad, vegetation, bass, patch) and where it stands. */
  private ducks: GainNode[] = [];
  private ncDuck: GainNode | null = null;
  private duckNow = 1;
  /** My answer under way (§13d), for the picture's response (answerPhaseOf): whom to, from when (context s), a bar's length. */
  private answerSpan: { id: string; from: number; cycle: number } | null = null;
  /** When (context time) the last question was called and my last answer began (§8e). */
  private askAt = -1e9;
  private answerAt = -1e9;
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
  /** Where I stood in a building's harmony at the last plan (the patch's knobs read it). */
  private zone: "in" | "ring" | null = null;
  /** The arrival cadence (sequencer.ts nextArrival) and the sealed slabs I have already seen near me. */
  private arrivalState: ArrivalState = ARRIVAL_IDLE;
  private seenSlabs: Set<string> | null = null;
  /** 1 right after an arrival's tonic, fading: the hall stays open a moment. */
  private arrivalGlow = 0;
  private arrivalAt = 0;
  // ── asking and answering as counterpoint (§13d) ──
  /** The open question: whose, and the bar its first call is on (bars from there: call, empty, call, …). */
  private question: { id: string; fromBar: number } | null = null;
  /** The answer's two bars (context seconds): my motif and the others keep quiet while it sounds. */
  private answerQuiet: { from: number; to: number } | null = null;
  /** The new word, my motif from the bar after the answer on (this life only). */
  private nextMotif: { motif: Motif; at: number } | null = null;
  /** Whom I answered, still the other line of the dialogue until then (level, no blur, HRTF). */
  private partner: { id: string; until: number } | null = null;
  private dialogueLine = "";
  // ── the ensemble (§13e) ──
  /** Who plays a part while the record says 합주 (update decides, tick plays): in order — canon, bass, inner line. */
  private ensembleIds: string[] = [];
  /** The ensemble's first bar and the bar each part entered on (one after another). */
  private ens: { from: number; entries: Map<string, number> } | null = null;
  /** The featured voices' note onsets (context s): the asker, whom I answer, the parts — the heads hop on them (hopOf). */
  private featured = new Map<string, number[]>();

  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  /**
   * The headset mix as a MediaStream, for the life's recording (useLifeRecording): the limiter's output tapped by a
   * MediaStreamAudioDestinationNode, beside the device — not instead of it. Null before the graph exists (start()
   * has not run on a gesture yet). The same stream is handed out every time.
   */
  tapOutput(): MediaStream | null {
    const ctx = this.ctx;
    if (!ctx || !this.limiter) return null;
    if (!this.tapOut) {
      this.tapOut = ctx.createMediaStreamDestination();
      this.limiter.connect(this.tapOut);
    }
    return this.tapOut.stream;
  }

  get debug(): SoundDebug {
    const p = this.lastPlan;
    return {
      bar: p?.bar ?? -1,
      chord: p && this.key ? chordName(this.key, p.chord) + (this.conductLine ? ` [${this.conductLine}]` : "") : "",
      lock: p?.lock ?? 0,
      density: p?.density ?? 1,
      answer: p?.answer ?? false,
      magenta: this.magentaState,
      phrase: this.phrase ? `${this.phrase.kind} @${this.phrase.from}` : null,
      voices: this.voices.size,
      nc: this.ncStatus + (this.nc ? " → engine" : ""),
      place: this.placeLine + (this.lastPlan?.arrival ? ` · 도착 ${this.lastPlan.arrival}` : ""),
      found: { played: this.foundPlayed, last: this.foundLast, waiting: this.foundWaiting?.id ?? null },
      dialogue: this.dialogueLine,
      tension: this.tensionNow,
      tensionLine: this.tensionLine,
    };
  }

  /** Where I stand in a building's harmony this bar (tonality.ts), or null in the open. */
  private placeFor(sig: PersonalSignals): NonNullable<Parameters<typeof planBar>[0]["place"]> | null {
    const p = this.params;
    const b = sig.building;
    const zone = p.zoneTonality && b ? zoneOf(b.dist, b.radius, p.zoneRing) : null;
    this.zone = zone;
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

  /** Test hook: the next bar starts an arrival cadence (dominant, then the tonic with the wave and the breath). */
  forceArrival(): void {
    this.arrivalState = { ...ARRIVAL_IDLE };
    this.forceTogether = true;
  }

  /** Test hook: what the mix is doing right now (gains as automated, the limiter's reduction in dB). */
  get probe(): { t: number; master: number; voiceBus: number; limiterDb: number; wave: number } | null {
    const ctx = this.ctx;
    if (!ctx || !this.limiter) return null;
    return { t: ctx.currentTime, master: this.master.gain.value, voiceBus: this.voiceBus.gain.value, limiterDb: this.limiter.reduction, wave: this.wave?.gain.gain.value ?? 0 };
  }

  get currentParams(): SoundParams {
    return this.params;
  }

  /**
   * What the patch's real-time knobs follow (noisecraftKnobs.ts, v4 A5a): numbers this engine already has, 0 = idle.
   * null = mapping off or nobody here yet (the knobs glide back to the artist's values).
   */
  knobSources(): KnobSources | null {
    const sig = this.sig;
    const p = this.params;
    if (!sig || !p.ncMap) return null;
    const t = this.ctx?.currentTime ?? 0;
    const glow = this.ctx ? this.arrivalGlow * Math.exp(-(t - this.arrivalAt) / 6) : 0;
    return {
      company: Math.min(1, sig.neighbours.length / 3),
      zone: this.zone === "in" ? 1 : this.zone === "ring" ? 0.5 : 0,
      space: Math.max(-1, Math.min(1, glow - sig.sealed)),
      sealed: sig.sealed,
      speed: Math.min(1, sig.speed / Math.max(0.1, p.speedMax)),
      together: (sig.coBuilders?.length ?? 0) > 0 ? 1 : 0,
      ...this.reactSources(t),
    };
  }

  /**
   * THE PATCH REACTS TO CHANGES (§8e): from the bar being heard now — its tense phrase's climb, a pluck when its chord
   * changed — and from the dialogue (a question just called, my answer just begun) and the ensemble. All 0 when off.
   */
  private reactSources(t: number): Pick<KnobSources, "tension" | "hang" | "pluck" | "ensemble" | "bloom" | "path" | "found"> {
    const p = this.params;
    const off = { tension: 0, hang: 0, pluck: 0, ensemble: 0, bloom: 0, path: 0, found: 0 };
    if (!p.ncReact || !this.running || !this.epochMs) return off;
    // (each reaction's width, 0 … 2)
    const w = (v: number) => Math.max(0, Math.min(2, v));
    const barSec = this.musicBarSec();
    const pos = (Date.now() - this.gridEpochMs(barSec)) / 1000 / barSec;
    const bar = Math.floor(pos);
    const into = (pos - bar) * barSec;
    const shape = this.barShape.get(bar);
    const tension = (shape?.tension ?? 0) * w(p.reactTension);
    const change = (shape?.pluck ?? 0) * Math.exp(-into / 0.6) * w(p.reactChange);
    const ask = t >= this.askAt ? Math.exp(-(t - this.askAt) / 1.5) * w(p.reactAsk) : 0;
    const answer = t >= this.answerAt ? Math.exp(-(t - this.answerAt) / 0.8) * w(p.reactAnswer) : 0;
    // (the bloom: from the start of the bar that resolved, up to two bars back)
    // (…and the future's daydream cues one, §13k)
    let bloom = t >= this.cueBloomAt ? Math.exp(-(t - this.cueBloomAt) / 3) * w(p.futureBloom) : 0;
    for (let j = 0; j <= 2; j++) {
      if (this.barShape.get(bar - j)?.landed) {
        bloom = Math.max(bloom, Math.exp(-(into + j * barSec) / 2.5) * w(p.reactBloom));
        break;
      }
    }
    return {
      tension,
      hang: Math.max(ask, 0.6 * tension),
      pluck: Math.max(change, answer),
      ensemble: this.ensembleIds.length ? w(p.reactEnsemble) : 0,
      bloom,
      path: (this.sig?.pathP ?? 0) * w(p.reactPath),
      found: t >= this.foundAt ? Math.exp(-(t - this.foundAt) / 3) * w(p.reactFound) : 0,
    };
  }


  /**
   * THE MUSIC CLOCK (v4 A2, the artist): seconds a bar, decided here from the Leva bar length and the interaction —
   * the lock (a path, building together) tightens it by `clockPull`. The patch receives this value. With the Web
   * Audio instrument alone the bar stays the Leva length (the epoch grid must not jump).
   */
  /** Where the bars are counted from (wall ms): the patch's clock carries the phase when it plays (anchor), else the epoch. */
  private gridEpochMs(barSec: number): number {
    return this.params.instrument !== "webaudio" && this.anchor ? this.anchor.wallMs - this.anchor.bar * barSec * 1000 : this.epochMs;
  }

  /** Where the music is: the step of its bar (8 to a bar) and how far into it; null before it runs. */
  get musicStep(): { step: number; into: number } | null {
    if (!this.running || !this.epochMs) return null;
    const barSec = this.musicBarSec();
    const inBar = (((Date.now() - this.gridEpochMs(barSec)) / 1000 / barSec) % 1) + 1;
    const pos = (inBar % 1) * 8;
    const step = Math.floor(pos);
    return { step, into: pos - step };
  }

  /**
   * MY ANSWER (the artist, 2026-11-10: "the merged structure must leap out, to anyone"; brought into the redesign
   * 2026-11-22): two bars from `startPerfMs` (performance.now() basis, a bar's edge), `stepMs` a step — first my melody
   * and `other`'s together, then the new `word` they became (glyph.ts newWordMotifOf, what the record writes down), on
   * the place's chord, loud, laid over whatever the bars hold. Nothing in the bar plans changes.
   */
  playAnswer(startPerfMs: number, stepMs: number, other: string, word: Motif): void {
    const ctx = this.ctx;
    if (!ctx || !this.running || !this.me || !this.key || this.params.dead || this.afterlife) return;
    const chord = this.plans.get(this.planned)?.chord ?? null;
    const theirs = this.motifOf(other);
    const cycleSec = (word.steps * stepMs) / 1000;
    const at0 = ctx.currentTime + Math.max(0, startPerfMs - performance.now()) / 1000;
    this.answerAt = at0; // (the patch plucks with my answer, §8e)
    this.answerSpan = { id: other, from: at0, cycle: cycleSec }; // (the picture's response, answerPhaseOf)
    // (a held tension, §13h: my answer resolves my share — the word's bar lands home, half the store let go)
    const resolving = !!this.arcStep?.holding && !!this.placeNow;
    const homeChord = resolving ? resolutionChord(this.placeNow!, "home") : null;
    if (resolving) {
      this.answerHomeBar = this.planned + 1;
      this.arc = answerArc(this.arc, this.answerHomeBar);
      this.plans.delete(this.answerHomeBar);
    }
    const their = this.voices.get(other);
    if (this.params.askCounterpoint) {
      // AS COUNTERPOINT (§13d): bar 1 — my line, closing on the tonic, and theirs an octave or more away, meshed into
      // mine (their notes step aside from mine): plainly two. Bar 2 — the new word in both voices an octave apart, in
      // one rhythm: plainly one. Then the new word is my motif; nothing else sings over these two bars.
      const key = this.zoneKey ?? this.key;
      // my register knob moves only what goes out as mine (note(…, mine)); their line, when they are within earshot,
      // goes out through their own voice as it is — so the octaves are compared as heard
      const T = this.params.motifTranspose;
      const viaMe = !their;
      const mineLine = endClosed(realize(this.me.motif, key, chord, 1, this.planned), key);
      const raw = realize(theirs, key, chord, 1, this.planned);
      // (how far apart they keep: the artist's 서로 피하는 정도 — an octave only when nearly on top of each other at 0.3)
      const ap = this.params.apartness;
      const shift = apartShift(mineLine, raw, viaMe ? 0 : T, 12 * ap);
      const theirLine = interlock(mineLine, shiftNotes(raw, shift), 8, ap, this.planned);
      const theirDest = their?.filt ?? this.me.filt;
      for (const n of mineLine) this.note(this.me.filt, n.freq, at0 + n.at * cycleSec, n.len * cycleSec, ANSWER_VEL, this.me.motif.timbre, 0, true);
      for (const n of theirLine) {
        this.note(theirDest, n.freq, at0 + n.at * cycleSec, n.len * cycleSec, ANSWER_VEL, theirs.timbre, 0, viaMe);
        this.feature(other, at0 + n.at * cycleSec);
      }
      const wordLine = realize(word, key, homeChord ?? chord, 1, this.planned + 1);
      const heard = (ns: readonly { pitch: number }[], k: number) => (ns.length ? ns.reduce((s, n) => s + n.pitch, 0) / ns.length + k : 60 + T);
      const s = octaveToward(shiftNotes(wordLine, T), heard(theirLine, viaMe ? T : 0));
      const octave = shiftNotes(wordLine, viaMe ? s : T + s);
      const at1 = at0 + cycleSec;
      for (const n of wordLine) this.note(this.me.filt, n.freq, at1 + n.at * cycleSec, n.len * cycleSec, ANSWER_VEL, this.me.motif.timbre, 0, true);
      for (const n of octave) {
        this.note(theirDest, n.freq, at1 + n.at * cycleSec, n.len * cycleSec, ANSWER_VEL * 0.8, theirs.timbre, 0, viaMe);
        this.feature(other, at1 + n.at * cycleSec);
      }
      this.answerQuiet = { from: at0, to: at0 + 2 * cycleSec };
      this.nextMotif = { motif: word, at: at0 + 2 * cycleSec };
      this.partner = { id: other, until: at0 + 2 * cycleSec + 0.5 };
      this.question = null;
      this.dialogueLine = `대답 ${other} (${shift ? (shift > 0 ? "+" : "") + shift / 12 + "옥타브" : "제자리"}) → 새 어휘`;
      this.answersPlayed++;
      return;
    }
    for (const n of realize(this.me.motif, this.key, chord, 1, this.planned)) this.note(this.me.filt, n.freq, at0 + n.at * cycleSec, n.len * cycleSec, ANSWER_VEL, this.me.motif.timbre, 0, true);
    for (const n of realize(theirs, this.key, chord, 1, this.planned)) this.note(their?.filt ?? this.me.filt, n.freq, at0 + n.at * cycleSec, n.len * cycleSec, ANSWER_VEL, theirs.timbre, 0, !their);
    for (const n of realize(word, this.key, chord, 1, this.planned + 1)) this.note(this.me.filt, n.freq, at0 + cycleSec + n.at * cycleSec, n.len * cycleSec, ANSWER_VEL, this.me.motif.timbre, 0, true);
    this.answersPlayed++;
  }

  /** How many answers have sounded (debug: engine.answersPlayed). */
  answersPlayed = 0;

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
    this.ncStream = stream;
    if (!stream || !ctx) return;
    const source = ctx.createMediaStreamSource(stream);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = this.params.lpOpen;
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(filter).connect(gain).connect(this.ncDuck ?? this.master);
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
    const together = this.forceTogether || (sig.coBuilders?.length ?? 0) > 0;
    // (longer with more turns: a pre-dominant, the dominant, sometimes a deceptive turn, then home — §13f)
    // (a stored tension holds the dominant longer and the payoff lands — §13h)
    const arcOn = p.harmonyTurns && p.tension > 0;
    const hold = arcOn ? arrivalHold(this.arcStep?.level ?? 0) : 0;
    const step = nextArrival(this.arrivalState, bar, together, born && sig.stay > 0.5 && sig.neighbours.length > 0, ARRIVAL_COOLDOWN, p.harmonyTurns, hold);
    if (this.forceTogether && step.phase === "dominant") this.forceTogether = false;
    this.arrivalState = step.state;
    const arrival = p.arrival ? step.phase : null;
    if (arrival === "tonic" && this.ctx) {
      this.arrivalGlow = 1;
      this.arrivalAt = this.ctx.currentTime;
    }
    // TENSION THAT BUILDS AND IS RESOLVED (§13h): stored while others are within hearing, resolved by building together
    // (the arrival's tonic), my answer (half), familiarity (slowly), patience (the amen) — or scattered
    if (!arcOn) this.arcStep = null;
    else if (bar > this.arc.bar) {
      const heard = sig.neighbours.filter((n) => n.dist <= p.hearRadius).map((n) => n.o);
      this.arcStep = stepArc(this.arc, { bar, barSec: this.musicBarSec(), heard, building: arrival === "tonic" }, { tension: p.tension, crowdFull: p.crowdFull, buildBars: p.buildBars, bondSec: p.bondSec, patienceBars: p.patienceBars });
      this.arc = this.arcStep.state;
    }
    const arc = this.arcStep;
    const release = bar === this.answerHomeBar && arcOn ? "home" : arc?.release ?? null;
    const holding = !release && !!arc?.holding;
    this.tensionNow = arc?.level ?? 0;
    const tension = this.tensionNow;
    let tenseHit = false;
    // (an arrival's or a resolution's bars end the progression under way; the next begins at a phrase's edge)
    if (arrival || release) this.phraseLock = null;
    const prevChord = this.plans.get(bar - 1)?.chord ?? this.lastPlan?.chord ?? null;
    const plan = planBar({
      bar,
      sig,
      key,
      place: this.placeFor(sig),
      // ONE CONDUCTOR (§13i): the place = its building's key or the world's band and its chord (read after placeFor has
      // set the zone's key); a progression — tense when gathered (§13g–h), a turn when staying alone (§13f) — is chosen
      // only at a phrase's edge and kept to its end; walking, the ground's chords, coloured now and then (never on a
      // band's change); whatever is not a progression's own step must connect to the last bar, or its dominant comes first
      colour: p.harmonyTurns
        ? (c: PlaceChord) => {
            const prevPlace = this.placeNow;
            this.placeNow = c;
            // (a resolution's bar: home, the amen's iv, or the scattered deceptive turn — on the place's root)
            if (release) {
              this.conductLine = release === "home" ? "풀림" : release === "plagal" ? "아멘" : "흩어짐";
              return resolutionChord(c, release);
            }
            const keyId = this.zoneKey ? keyName(this.zoneKey) : "w";
            const tag = `${keyId}#${c.band}#${c.rootClass}`;
            const r = conduct(this.phraseLock, {
              bar,
              place: c,
              tag,
              keyId,
              level: tension,
              holding,
              gathered: (arc?.gathered ?? 0) > 0,
              staying: sig.stay > 0.5,
              turnAmount: p.turnAmount,
              colourAmount: p.colourAmount,
              prev: prevChord,
              prevPlace,
            });
            this.phraseLock = r.lock;
            tenseHit = r.kind === "tense";
            const at = r.lock ? ` ${bar - r.lock.from + 1}/${r.lock.len}` : "";
            this.conductLine = `${r.kind === "tense" ? "긴장" : r.kind === "turn" ? "머묾" : r.kind === "walk" ? "걸음" : "제자리"}${at}${r.bridged ? " · 이음(V7)" : ""}`;
            return r.chord;
          }
        : null,
      // (functional, §13i: the arrival leans on the chord it lands on; the pad's voices led from the last bar's)
      functional: p.harmonyTurns,
      voicedFrom: p.harmonyTurns ? this.lastVoicing : null,
      // (the arrival after a stored tension: its pre-dominant and dominants altered for certain)
      tension: (this.arrivalState.hold ?? 0) > 0 ? 1 : tension,
      resolve: release === "home" ? { lock: 0.95, pad: 0.85 } : release === "plagal" ? { lock: 0.85, pad: 0.7 } : release === "deceptive" ? { lock: 0.8, pad: 0.6 } : null,
      arrival,
      me: this.me.motif,
      others: this.motifs,
      closeness: this.closeness,
      phrase: this.phrase && bar - this.phrase.from < CYCLES_PER_PHRASE ? this.phrase : null,
      params: { barSec: this.musicBarSec(), speedMax: p.speedMax, bassFrom: p.bassFrom, motifEvery: p.motifEvery, microtone: p.microtone, motifOctaveEvery: p.motifOctaveEvery, motifOctaveRange: p.motifOctaveRange, bandCells: p.bandCells },
    });
    this.plans.set(bar, plan);
    for (const k of this.plans.keys()) if (k < bar - 4) this.plans.delete(k);
    if (plan.voicing) this.lastVoicing = plan.voicing;
    if (arrival) this.conductLine = arrival === "pre" ? "도착 버금딸림" : arrival === "dominant" ? "도착 딸림" : arrival === "deceptive" ? "도착 거짓 종지" : "도착 으뜸";
    if (!p.harmonyTurns) this.conductLine = "";
    // (for the patch's knobs, §8e: how far a tense phrase has climbed — the arrival's bars lean too — and a pluck when
    // the chord changes, more for a tense one)
    // (holding, §13h: the store's level carries it, the phrase's climb on top; a resolution's bar lets it all go at once)
    const k8 = (((bar % TENSE_BARS) + TENSE_BARS) % TENSE_BARS) / (TENSE_BARS - 1);
    const climb = holding ? Math.min(1, tension / 0.6) * (0.6 + 0.4 * k8) : tenseHit ? k8 : 0;
    const lean = arrival === "pre" ? 0.5 : arrival === "dominant" ? 0.9 : arrival === "deceptive" ? 1 : 0;
    const prev = this.plans.get(bar - 1)?.chord;
    const changed = !!prev && (prev.rootClass !== plan.chord.rootClass || prev.classes.join() !== plan.chord.classes.join());
    const landed = release === "home" || arrival === "tonic";
    this.barShape.set(bar, { tension: landed ? 0 : Math.max(climb, lean), pluck: landed ? 1 : changed ? (plan.chord.quality ? 1 : 0.6) : 0, landed });
    // (the status line)
    const said: Record<string, string> = { build: "함께 지어 풀림", answer: "응답으로 반쯤 풀림", patience: "저절로 풀림(아멘)", scatter: "흩어짐" };
    const last = this.arc.last && bar - this.arc.last.bar < 4 ? ` · ${said[this.arc.last.kind]}` : "";
    this.tensionLine = arc ? `긴장 ${tension.toFixed(2)} (쌓임 ${this.arc.stored.toFixed(2)} · 정 ${arc.bond.toFixed(2)}${holding ? ` · 붙듦 ${this.arc.held}/${p.patienceBars}` : ""})${(this.arrivalState.hold ?? 0) > 0 && arrival ? ` · 도착 딸림 +${this.arrivalState.hold}` : ""}${last}` : "";
    for (const k of this.barShape.keys()) if (k < bar - 8) this.barShape.delete(k);
    this.lastPlan = plan;
    return plan;
  }

  /** Builds the graph on first call; resumes the context. Must be called from a user gesture on mobile. */
  async start(): Promise<void> {
    if (!this.ctx) {
      // "playback": a larger output buffer — the artist heard glitches when the hall opened on an arrival; this piece
      // needs headroom, not low latency (v4 A5)
      const ctx = new AudioContext({ latencyHint: "playback" });
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.dull = ctx.createBiquadFilter();
      this.dull.type = "lowpass";
      this.dull.frequency.value = this.params.lpOpen;
      this.dull.Q.value = 0.5;
      // the limiter before the device (§10c): with the room's speakers in the same Chrome the two summed and clipped
      this.limiter = makeLimiter(ctx);
      this.dull.connect(this.master).connect(this.limiter).connect(ctx.destination);
      // (the ask's duck on the patch, §13j: between the patch's own gain and the master)
      this.ducks = [];
      this.duckNow = 1;
      this.ncDuck = ctx.createGain();
      this.ncDuck.connect(this.master);
      this.ducks.push(this.ncDuck);
      // the headset's own output device, chosen on /v2/sound/output (the default when none)
      void applyOutput(ctx, "headset").then((s) => (this.outputLine = s));
      this.offOutput = onOutputChange("headset", () => void applyOutput(ctx, "headset").then((s) => (this.outputLine = s)));
      this.dry = ctx.createGain();
      this.dry.connect(this.dull);
      this.voiceBus = ctx.createGain();
      this.voiceBus.gain.value = 1;
      this.voiceBus.connect(this.dry);
      // three rooms
      const room = (seconds: number, decay: number, taps: number, bright: number, level: number, bypassDull = false) => {
        const g = ctx.createGain();
        g.gain.value = level;
        const v = ctx.createConvolver();
        v.buffer = impulse(ctx, seconds, decay, taps, bright);
        g.connect(v).connect(bypassDull ? this.master : this.dull);
        if (bypassDull) this.hallConv = v;
        return g;
      };
      this.rooms = {
        open: room(1.2, 0.35, 0, 0.25, 0.12),
        concrete: room(1.6, 0.5, 6, 0.9, 0),
        // the hall is the ARRIVAL's opening: it must not be dulled by the concrete the arrival happens on (10/31)
        hall: room(3.2, 1.3, 0, 0.5, 0, true), // 4.5 s → 3 s (A1) → 2.4 s (A5) → 3.2 s (10/31: too dry); the convolver's cost is its length
      };
      // the hall never sleeps: a whisper of noise keeps its convolver running, so opening it on an arrival does not
      // start a cold convolution (the burst the artist heard as lag)
      const keep = ctx.createBufferSource();
      keep.buffer = noiseBuffer(ctx, 1);
      keep.loop = true;
      const keepGain = ctx.createGain();
      keepGain.gain.value = 0.00002;
      keep.connect(keepGain).connect(this.rooms.hall);
      keep.start();
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
      const noiseDuck = ctx.createGain();
      this.ducks.push(noiseDuck);
      noise.connect(bp).connect(noiseDuck).connect(this.noiseGain).connect(this.dry);
      // the vegetation into the hall's reverb too (10/31, the artist: too dry)
      this.grassSend = ctx.createGain();
      this.grassSend.gain.value = this.params.grassVerb;
      this.noiseGain.connect(this.grassSend).connect(this.hallConv);
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
      this.ducks.push(this.bassGain);
      // the beat spreads under everything: into the hall's room through a dark low-pass (no convolver of its own —
      // every convolver is audio-thread work, and five of them crackled on the artist's machine)
      this.bassSpread = ctx.createGain();
      this.bassSpread.gain.value = 0;
      const bassDark = ctx.createBiquadFilter();
      bassDark.type = "lowpass";
      bassDark.frequency.value = 500;
      // into the hall's CONVOLVER itself, not its gated send (the gate is shut except at an arrival — the heartbeat's
      // spread was dry nearly always; the artist, 10/31: "리버브 부족")
      shaper.connect(this.bassSpread).connect(bassDark).connect(this.hallConv);
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
      // the wave opens 300 → 2400 Hz, but the dry bus is dulled to ~750 Hz on concrete, where arrivals happen — the
      // artist heard the wave "pressed" (10/31): it goes straight to the master, around the building's dullness
      const wd = ctx.createGain();
      wd.gain.value = 1 - 0.55 * this.params.waveVerb;
      wg.connect(wd).connect(this.master);
      // …and into the hall's reverb (the convolver itself, open whatever the arrival's hall gain): dry noise was too dry
      const ws = ctx.createGain();
      ws.gain.value = this.params.waveVerb * 1.4;
      wg.connect(ws).connect(this.hallConv);
      wn.start();
      this.wave = { filter: wf, gain: wg, send: ws, dry: wd };
      this.afterlifeRoom(this.params.afterlifeTail); // the afterlife's long room, ready (no cold start at a death)
      // pad: five sustained sines, retuned per bar
      const level = ctx.createGain();
      level.gain.value = 0;
      // (through the ask's duck, §13j)
      const padDuck = ctx.createGain();
      this.ducks.push(padDuck);
      level.connect(padDuck);
      padDuck.connect(this.dry);
      padDuck.connect(this.rooms.hall);
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
      this.space = room(2.4, 1.3, 0, 0.45, 0); // 4 s → 3.2 (A4c) → 2.4 s (A5)
      dark.connect(this.space);
      this.lastUpdate = ctx.currentTime;
      // the patch's stream, when it was attached to a context since closed (dispose → start), joins this one
      if (this.ncStream && !this.nc) this.attachNoiseCraft(this.ncStream);
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
    this.offOutput?.();
    this.offOutput = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.voices.clear();
    this.me = null;
    // every node kept outside the graph belonged to that context: a later start() makes a new one, and a node of the
    // closed one cannot be connected to it (React's dev double mount disposes once before the first life — the
    // afterlife's room stayed from the first context and the death threw every frame, 2026-11-22)
    if (this.nc) {
      try {
        this.nc.source.disconnect();
        this.nc.filter.disconnect();
        this.nc.gain.disconnect();
      } catch {
        /* ignore */
      }
      this.nc = null; // ncStream kept: start() attaches it again
    }
    this.afterRoom = null;
    this.ncFeed = null;
    this.nameOut = null;
    this.foundOut = null;
    this.foundWaiting = null;
    this.tapOut = null;
    this.afterlife = null;
    this.wasDead = false;
  }

  /** Where this engine plays (output.ts): the chosen device's label, or the default. */
  get output(): string {
    return this.outputLine;
  }

  /** How much the limiter has been pressing lately (dB, ≤ 0). */
  get limiterDb(): number {
    return this.limHold;
  }

  /**
   * The name (before a life): the visitor's melody, alone, straight to the limiter — the master is shut until the life
   * begins, `level` is what it will open to. In the world's key, every note in tune. Nothing when the engine is not
   * running (sound off, muted). The caller repeats it; hushName() ends it when the life begins.
   */
  announce(id: string, key: WorldKey, level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.timer) return;
    const p = this.params;
    if (!this.nameOut) {
      this.nameOut = ctx.createGain();
      this.nameOut.connect(this.limiter);
    }
    this.nameOut.gain.value = Math.max(level, 0.0001);
    const m = this.motifOf(id);
    const at = ctx.currentTime + 0.1;
    const notes = realize(m, key, null, 1, 0);
    for (const n of notes) this.note(this.nameOut, n.freq, at + n.at * p.barSec, n.len * p.barSec, 1, m.timbre, 0, true);
  }

  /** The life begins: what is still sounding of the name fades at once. */
  hushName(): void {
    const ctx = this.ctx;
    const out = this.nameOut;
    if (!ctx || !out) return;
    this.nameOut = null;
    out.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
    setTimeout(() => out.disconnect(), 800);
  }

  /**
   * A word another left is found (the witness's `word.found`, SessionHud): `id` = the one who left it, whose melody the
   * line draws (glyphOf). It sounds ONCE, on the next bar the scheduler plans (tick → playFound), in the name's voice;
   * that bar my own motif keeps quiet. Nothing while the name is up, at the end, or with the engine stopped (muted) —
   * a word found then is not played later.
   */
  found(id: string): void {
    const ctx = this.ctx;
    if (!ctx || !this.timer || this.nameOut || this.afterlife || this.params.dead || this.params.foundLevel <= 0) return;
    this.foundWaiting = { id, at: ctx.currentTime };
  }

  /** The found word's melody from `at` (a bar's start): the leaver's motif in the key I stand in, every note in tune, like the name. */
  private playFound(id: string, at: number, bar: number, key: WorldKey, barSec: number): void {
    const ctx = this.ctx!;
    this.foundAt = at; // (the patch's far bell shimmers with it, §8e)
    if (!this.foundOut) {
      this.foundOut = ctx.createGain();
      // into the master, not the limiter as the name: the master is open at the level the name is announced at, and a
      // death's fade takes the found word down with everything else
      this.foundOut.connect(this.master);
    }
    this.foundOut.gain.value = this.params.foundLevel;
    const m = this.motifOf(id);
    for (const n of realize(m, key, null, 1, 0)) this.note(this.foundOut, n.freq, at + n.at * barSec, n.len * barSec, 1, m.timbre, 0, true);
    this.foundPlayed++;
    this.foundLast = `${id} @${bar}`;
  }

  /** A featured voice's note at `at` (context s): its head hops on it (hopOf). Keeps the last two seconds, in order. */
  private feature(id: string, at: number): void {
    let a = this.featured.get(id);
    if (!a) {
      a = [];
      this.featured.set(id, a);
    }
    let i = a.length;
    while (i > 0 && a[i - 1] > at) i--;
    a.splice(i, 0, at);
    const old = (this.ctx?.currentTime ?? 0) - 2;
    while (a.length && a[0] < old) a.shift();
  }

  /**
   * MY ANSWER AS THE PICTURE SEES IT (§13d → the response, FramePeopleLayer): 0 … 2 through my answer's two bars to `id`
   * (the first: our two lines, the second: the new word in one rhythm), as heard; null when I am not answering `id`.
   */
  answerPhaseOf(id: string): number | null {
    const ctx = this.ctx;
    const a = this.answerSpan;
    if (!ctx || !a || a.id !== id || !this.timer) return null;
    const lat = (ctx as AudioContext & { outputLatency?: number }).outputLatency || ctx.baseLatency || 0;
    const u = (ctx.currentTime - lat - a.from) / Math.max(0.1, a.cycle);
    return u >= 0 && u < 2 ? u : null;
  }

  /** Whose life this engine sounds (the picture's glyph of my word). */
  get selfId(): string {
    return this.myId;
  }

  /**
   * THE FUTURE PASSING AS A DAYDREAM (§13k), AMBIENT (the artist, 2026-11-28: "미래 소리 효과 훨씬 엠비언트 하게 넣고 삐악
   * 하는 코드 소리? 는 빼는 게 나을 듯"): `arrive` — a HAZE rising low (the place's lydian: root, fifth, ninth, #11 as
   * detuned triangle pairs under a filter that opens slowly and closes again; no tremolo), a DARK BAND OF STATIC drifting
   * as if tuned from far off, and MY MELODY once, slowed to half its pace, on a soft radio voice deep in the hall, passing
   * (its pitch falls a little as it goes by) — panned from `panFrom` to `panTo` over futureDur s, more wet than dry; the
   * patch blooms. `leave` — the static sinking and the haze falling a semitone as it fades, off the way the wind blows.
   * (The high quintal chord that shimmered at 4.5–9 Hz — the chirp — and the radio's gliding whistle are gone.)
   * False when nothing was played (sound off, dead, the switch off).
   */
  daydream(kind: "arrive" | "leave", panFrom: number, panTo: number): boolean {
    const ctx = this.ctx;
    const p = this.params;
    if (!ctx || !this.running || ctx.state !== "running" || p.dead || this.afterlife || !p.futureSound || p.futureLevel <= 0) return false;
    const t0 = ctx.currentTime + 0.05;
    const D = kind === "arrive" ? Math.max(3, p.futureDur) : Math.max(2, p.futureDur * 0.5);
    // every part fades out over a long tail after D (and the hall's own tail follows)
    const TAIL = 3;
    const end = t0 + D + TAIL;
    const stop = end + 0.5;
    const c1 = (v: number) => Math.max(-1, Math.min(1, v));
    /** Slowly in over `attack`, held, then out over the last 45 % of the span until `until`. */
    const env = (g: AudioParam, at: number, attack: number, until: number, level: number) => {
      g.setValueAtTime(0, at);
      g.linearRampToValueAtTime(level, at + attack);
      g.setValueAtTime(level, Math.max(at + attack, until - (until - at) * 0.45));
      g.linearRampToValueAtTime(0, until);
    };
    const out = ctx.createGain();
    out.gain.value = p.futureLevel;
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(c1(panFrom), t0);
    pan.pan.linearRampToValueAtTime(c1(panTo), t0 + D);
    const dry = ctx.createGain();
    dry.gain.value = 0.55;
    const send = ctx.createGain();
    send.gain.value = 0.9;
    out.connect(pan);
    pan.connect(dry).connect(this.dull);
    pan.connect(send).connect(this.rooms.hall);
    const tidy: AudioNode[] = [out, pan, dry, send];
    const root = this.placeNow?.rootClass ?? this.key?.root ?? 0;
    // THE HAZE: the place's lydian low (C3 …), each tone a detuned pair, under a lowpass that opens and closes slowly;
    // leaving, it falls a semitone as it fades
    if (p.futureHaze > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 0.7;
      if (kind === "arrive") {
        lp.frequency.setValueAtTime(240, t0);
        lp.frequency.exponentialRampToValueAtTime(1300, t0 + D * 0.55);
        lp.frequency.exponentialRampToValueAtTime(420, end);
      } else {
        lp.frequency.setValueAtTime(900, t0);
        lp.frequency.exponentialRampToValueAtTime(200, end);
      }
      const hg = ctx.createGain();
      env(hg.gain, t0, kind === "arrive" ? D * 0.4 : 0.8, end, 0.03 * p.futureHaze);
      lp.connect(hg).connect(out);
      tidy.push(lp, hg);
      for (const st of [0, 7, 14, 18])
        for (const dc of [-8, 8]) {
          const o = ctx.createOscillator();
          o.type = "triangle";
          o.frequency.value = midiToHz(48 + root + st);
          o.detune.setValueAtTime(dc, t0);
          o.detune.linearRampToValueAtTime(dc + (kind === "leave" ? -100 : 0), end);
          o.connect(lp);
          o.start(t0);
          o.stop(stop);
        }
    }
    // THE RADIO, FAR OFF: static in a wide, dark band drifting as if tuned from a distance (no whistle)
    if (p.futureRadio > 0) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 3.5;
      if (kind === "arrive") {
        bp.frequency.setValueAtTime(300, t0);
        bp.frequency.exponentialRampToValueAtTime(1500, t0 + D * 0.45);
        bp.frequency.exponentialRampToValueAtTime(650, end);
      } else {
        bp.frequency.setValueAtTime(1100, t0);
        bp.frequency.exponentialRampToValueAtTime(180, end);
      }
      const g = ctx.createGain();
      env(g.gain, t0, kind === "arrive" ? D * 0.3 : 0.4, t0 + D + TAIL * 0.5, 0.16 * p.futureRadio);
      src.connect(bp).connect(g).connect(out);
      src.start(t0);
      src.stop(stop);
      tidy.push(bp, g);
    }
    // MY MELODY, FROM THE FUTURE: my motif in the place's lydian, an octave up, ONCE at half its pace, a soft triangle
    // (slow onsets, long tails) through a wide radio band, passing (a doppler's fall)
    if (kind === "arrive" && p.futureEcho > 0 && this.me && this.key) {
      const lydian: WorldKey = { root, mode: MODES[6], degrees: this.key.degrees };
      const notes = realize(this.me.motif, lydian, null, 1, 0);
      const cyc = this.musicBarSec() * 2;
      const start = t0 + D * 0.25;
      const bpf = ctx.createBiquadFilter();
      bpf.type = "bandpass";
      bpf.frequency.value = 900;
      bpf.Q.value = 0.7;
      const vg = ctx.createGain();
      vg.gain.value = 0.08 * p.futureEcho;
      bpf.connect(vg).connect(out);
      tidy.push(bpf, vg);
      for (const n of notes) {
        const at = start + n.at * cyc;
        const len = Math.max(0.25, n.len * cyc);
        if (at > t0 + D - 0.3) continue;
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = n.freq * 2;
        o.detune.setValueAtTime(20, at);
        o.detune.linearRampToValueAtTime(20 - 50 * ((at + len - start) / Math.max(0.1, t0 + D - start)), at + len);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(1, at + 0.08);
        g.gain.setValueAtTime(1, at + Math.max(0.08, len * 0.5));
        g.gain.exponentialRampToValueAtTime(0.001, at + len + 0.9);
        o.connect(g).connect(bpf);
        o.start(at);
        o.stop(at + len + 1);
      }
    }
    // the patch blooms (§8e's bloom, cued — futureBloom its width)
    this.cueBloomAt = t0;
    setTimeout(() => {
      for (const n of tidy)
        try {
          n.disconnect();
        } catch {
          /* gone already */
        }
    }, (stop - ctx.currentTime + 0.5) * 1000);
    return true;
  }

  /**
   * HOW HIGH A FEATURED VOICE'S HEAD IS NOW (the artist, 2026-11-27: "나한테 말 거는 애 머리 통통 튀게 … 블롭 창도 같이
   * 커졌다 작아졌다"): 0 … 1, a bounce from each of its notes AS HEARD (the output's latency taken off) — up fast, down
   * over HOP_SEC; 0 between notes and for every voice not featured (the asker, whom I answer, the ensemble's parts).
   * null when the sound is not running: the picture keeps its own bar then (musicClock.ts voiceHop). Cheap: every frame.
   */
  hopOf(id: string): number | null {
    const ctx = this.ctx;
    if (!ctx || !this.timer || ctx.state !== "running") return null;
    const a = this.featured.get(id);
    if (!a || !a.length) return 0;
    const lat = (ctx as AudioContext & { outputLatency?: number }).outputLatency || ctx.baseLatency || 0;
    const t = ctx.currentTime - lat;
    for (let i = a.length - 1; i >= 0; i--) {
      const age = t - a[i];
      if (age < 0) continue;
      return age < HOP_SEC ? Math.sin(Math.PI * Math.sqrt(age / HOP_SEC)) : 0;
    }
    return 0;
  }

  /**
   * One bar of THE ENSEMBLE (§13e) from `at`: my motif as the lead (every bar), then each part that has entered, by the
   * order they entered in — the first its own melody half a bar late (a canon's entry), the second a bass under all
   * (its first two notes on the 1 and the half bar), the third an inner line — each its own register (by octaves),
   * the melodic parts meshed into my line (their notes step aside from mine); on an arrival's tonic every line's first
   * note lands on the downbeat together. Through their own voices, unblurred; their heads hop on these notes.
   * UNDER A DIALOGUE (`solo`: a question open, an answer sounding — the artist, 2026-11-27: "대화랑 합주 구분이 잘 안 됨"):
   * the band plays on, softer, without the asker / whom I answer and without my line — their duet is the solo on top.
   */
  private playEnsemble(plan: BarPlan, at: number, barSec: number, bar: number, mineToo: boolean, solo: { without: (string | undefined)[] } | null): void {
    const key = this.zoneKey ?? this.key;
    const ens = this.ens;
    if (!this.me || !key || !ens) return;
    const tonic = plan.arrival === "tonic";
    const lock = tonic ? 1 : Math.max(0.85, plan.lock);
    const ap = this.params.apartness;
    const vel = solo ? 0.5 : 0.9;
    const mine = realize(this.me.motif, key, plan.chord, lock, bar);
    if (mineToo && !solo) for (const n of mine) this.note(this.me.filt, n.freq, at + n.at * barSec, n.len * barSec, 1, this.me.motif.timbre, 0, true);
    // (placed by the pitches heard: my register knob moves mine)
    const heardMine = shiftNotes(mine, this.params.motifTranspose);
    const lines: MotifNote[][] = [heardMine];
    const live = this.ensembleIds
      .filter((id) => (ens.entries.get(id) ?? Infinity) <= bar && this.voices.has(id) && !solo?.without.includes(id))
      .sort((a, b) => ens.entries.get(a)! - ens.entries.get(b)! || (a < b ? -1 : 1));
    live.forEach((id, i) => {
      const v = this.voices.get(id)!;
      const m = this.motifOf(id);
      const raw = realize(m, key, plan.chord, lock, bar);
      let line: MotifNote[];
      if (i === 1) line = bassUnder(lines, raw);
      else {
        // (each its own register only as far as the artist's 서로 피하는 정도 asks — they may share one)
        const l = i === 0 && !tonic ? rotate(raw) : raw;
        const moved = shiftNotes(l, placeApart(lines, l, 9 * ap));
        line = tonic ? landWith(heardMine, moved, 8, ap, bar * 7 + i) : interlock(heardMine, moved, 8, ap, bar * 7 + i);
      }
      for (const n of line) {
        this.note(v.filt, n.freq, at + n.at * barSec, n.len * barSec, vel, m.timbre, 0);
        this.feature(id, at + n.at * barSec);
      }
      lines.push(line);
    });
    const what = `합주 ${live.length + (solo ? 0 : 1)}성부${tonic ? " · 같이 착지" : ""}`;
    this.dialogueLine = solo ? `${this.dialogueLine} · 밑에 ${what}` : `${what} @${bar}`;
  }

  /**
   * The asker's CALL (§13d), one bar from `at`: the melody the record writes for this question (`word` — for a question
   * asked again, theirs with mine in it, glyph.ts newWordMotifOf; null = their own) on the place's chord, ending OPEN above
   * the note before it, an octave or more from where mine sits; through their voice, unblurred (update: the pair's level).
   */
  private playCall(id: string, word: Motif | null, plan: BarPlan, at: number, barSec: number, bar: number): void {
    const v = this.voices.get(id);
    const key = this.zoneKey ?? this.key;
    if (!v || !this.me || !key) {
      this.dialogueLine = `부름 ${id} @${bar} (목소리 없음)`;
      return;
    }
    const m = word ?? v.motif;
    this.askAt = at; // (the patch's echo hangs on the question, §8e)
    const call = endOpen(realize(m, key, plan.chord, 1, bar), key);
    const shift = apartShift(realize(this.me.motif, key, plan.chord, 1, bar), call, this.params.motifTranspose, 12 * this.params.apartness);
    for (const n of shiftNotes(call, shift)) {
      this.note(v.filt, n.freq, at + n.at * barSec, n.len * barSec, 1, m.timbre, 0);
      this.feature(id, at + n.at * barSec);
    }
    this.dialogueLine = `부름 ${id} @${bar}${shift ? ` (${shift > 0 ? "+" : ""}${shift / 12}옥타브)` : ""}`;
  }

  /** A being's melody NOW (glyph.ts wordMotifOf): the word its newest answer gave, else its own — §13d "모두 반영". */
  private motifOf(id: string): Motif {
    const m = wordMotifOf(id);
    this.motifs.set(id, m);
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
    this.limHold = Math.min(this.limiter.reduction, this.limHold + 2 * dt);
    // the end of a life: the afterlife plays once and fades itself; a new life brings the master back
    if (params.dead && !this.wasDead) this.startAfterlife(t);
    if (!params.dead && this.wasDead) this.endAfterlife(t);
    this.wasDead = params.dead;
    if (this.afterlife && t > this.afterlife.until) this.afterlife = null;
    if (!this.afterlife && !params.dead) this.master.gain.setTargetAtTime(params.master, t, 0.3);
    this.echo.feedback.gain.setTargetAtTime(0.3, t, 0.5);

    if (!this.me || this.me.motif.id !== myId) {
      if (this.me) this.dropVoice("me", this.me);
      // a new life: its own motif again (a word an answer gave belonged to the last one), no question, no answer
      this.question = null;
      this.answerQuiet = null;
      this.nextMotif = null;
      this.partner = null;
      this.dialogueLine = "";
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
    this.grassSend.gain.setTargetAtTime(params.grassVerb, t, 0.5);
    // wet / dry: the more reverb, the less direct noise (11/01: the wave sounded dry)
    this.wave.send.gain.setTargetAtTime(params.waveVerb * 1.4, t, 0.5);
    this.wave.dry.gain.setTargetAtTime(1 - 0.55 * params.waveVerb, t, 0.5);
    // rooms: open ground → concrete → the hall of building together
    const company = Math.min(1, sig.neighbours.length / 2);
    // the arrival opens the hall at once and lets it close over ~6 s
    const glow = this.arrivalGlow * Math.exp(-(t - this.arrivalAt) / 6);
    // THE ENSEMBLE (§13e): while the record says 합주, the nearest of those around me (who really build with me first)
    // each take a part; the hall and the pad are never made smaller for it (the artist, 2026-11-27: "줄이지만 않으면 돼"),
    // times ensembleSwell (1 = as when staying with someone)
    if (params.ensembleCounterpoint && sig.ensemble) {
      const near = sig.neighbours.filter((n) => n.dist <= params.hearRadius * ENSEMBLE_NEAR);
      const co = sig.coBuilders ?? [];
      const rank = (o: string) => (co.includes(o) ? co.indexOf(o) : co.length + 1);
      this.ensembleIds = near
        .slice()
        .sort((a, b) => rank(a.o) - rank(b.o) || a.dist - b.dist)
        .slice(0, ENSEMBLE_PARTS)
        .map((n) => n.o);
    } else this.ensembleIds = [];
    const staying = params.reverbMax * sig.stay * company;
    const hall = Math.max(this.ensembleIds.length ? staying * Math.max(1, params.ensembleSwell) : staying, params.reverbMax * params.arrivalHall * glow);
    this.rooms.hall.gain.setTargetAtTime(hall, t, glow > 0.3 ? 0.15 : 0.8);
    const dryRooms = 1 - Math.min(1, hall);
    this.rooms.concrete.gain.setTargetAtTime(0.35 * sig.sealed * dryRooms, t, 0.4);
    this.rooms.open.gain.setTargetAtTime(0.12 * (1 - sig.sealed) * dryRooms, t, 0.4);

    // who is within earshot: a voice each, the nearest MAX_VOICES only, with a level of detail in the panning
    // (v4 A1): the nearest one is placed by HRTF (a convolution per panner), the others by equal-power panning;
    // closeness accumulates while they are near
    const alive = new Set<string>();
    const heard = sig.neighbours.filter((n) => n.dist <= params.hearRadius).slice(0, MAX_VOICES);
    // who speaks to me is always heard, however many are nearer
    const asking = sig.asker ? sig.neighbours.find((n) => n.o === sig.asker) : undefined;
    if (asking && !heard.includes(asking)) heard.push(asking);
    // …and whom I am answering, until the answer has sounded (its notes go out through their voice) — §13d
    const pairId = params.askCounterpoint && this.partner && t < this.partner.until ? this.partner.id : null;
    const answering = pairId ? sig.neighbours.find((n) => n.o === pairId) : undefined;
    if (answering && !heard.includes(answering)) heard.push(answering);
    // …and the ensemble's parts (§13e)
    for (const o of this.ensembleIds) {
      const n = sig.neighbours.find((x) => x.o === o);
      if (n && !heard.includes(n)) heard.push(n);
    }
    // WHILE SOMEONE ASKS ME (§13j): everything but the asker's voice down by askDuck (the pad, the vegetation, the bass,
    // the patch here; the others' voices below)
    const duck = sig.asker && !this.afterlife ? 1 - Math.max(0, Math.min(1, params.askDuck)) : 1;
    if (Math.abs(duck - this.duckNow) > 1e-3) {
      for (const g of this.ducks) g.gain.setTargetAtTime(duck, t, duck < this.duckNow ? 0.15 : 0.5);
      this.duckNow = duck;
    }
    heard.forEach((n, rank) => {
      alive.add(n.o);
      let v = this.voices.get(n.o);
      if (!v) {
        v = this.newVoice(n.o, n.bot ? params.botBlur : 0, true);
        this.voices.set(n.o, v);
      }
      v.seen = t;
      // (their newest word once they have answered someone — learnt from the log, glyph.ts)
      v.motif = this.motifOf(n.o);
      // the other line of a dialogue (§13d): as present as mine wherever they stand — the distance's fall-off undone
      // (an ensemble's part: as present, unblurred — but HRTF only by the nearest-first rule: a panner each is costly)
      const part = this.ensembleIds.includes(n.o);
      const pair = (params.askCounterpoint && (n.o === sig.asker || n.o === pairId)) || part;
      const calls = n.o === sig.asker || (pair && !part);
      v.level = pair ? PAIR_LEVEL * Math.min(4, Math.max(1, n.dist / 1.5)) : calls ? params.othersLevel * ASKER_LEVEL : params.othersLevel;
      if (n.o !== sig.asker && n.o !== pairId) v.level *= duck;
      v.gain.gain.setTargetAtTime(v.level, t, calls ? 0.1 : 0.4);
      if (v.panner) {
        // who speaks is placed by HRTF too (the artist, 2026-11-10: out of sight it could not be told where the call
        // came from; equal-power panning says left or right only, never front or behind)
        const model = rank === 0 || calls ? "HRTF" : "equalpower";
        if (v.panner.panningModel !== model) v.panner.panningModel = model;
        v.panner.positionX.setTargetAtTime(Math.sin(n.angle) * n.dist, t, 0.1);
        v.panner.positionZ.setTargetAtTime(Math.cos(n.angle) * n.dist, t, 0.1);
      }
      v.filt.frequency.setTargetAtTime(v.blur > 0 && !calls && !part ? 4000 * Math.pow(0.12, v.blur) : 4000, t, calls ? 0.05 : 0.3);
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
  private bassNote(pitch: number, at: number, level: number, duckScale = 1): void {
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
      const duck = this.params.bassDuck * vel * duckScale;
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

  /** True while the end's last sound is still being taken into the long room (the patch keeps playing that long, then stops). */
  /** The session ended and the afterlife's tail has run out: silence — the afterglow's cue (AfterglowSound). */
  get afterlifeOver(): boolean {
    return this.params.dead && !this.afterlife;
  }

  get inAfterlife(): boolean {
    const a = this.afterlife;
    return !!a && (this.ctx?.currentTime ?? 0) < a.feedUntil;
  }

  /**
   * THE AFTERLIFE (v4 A4d → A5d, the artist: "잔향 말고는 아무것도 안 들리게"): after the end nothing is heard but the
   * reverb. Every living source lets go within half a second (the voices, the pad, the heartbeat, the wave, the
   * vegetation, the patch), and the LAST SOUND — the dry bus and the patch's stream, for a second — goes into a long dark room (`afterlifeTail` seconds) whose tail is all that remains; the
   * master holds and, as the tail dies on its own, a slow safety fade closes it.
   */
  private startAfterlife(t: number): void {
    const p = this.params;
    const tail = Math.max(1, p.afterlifeTail);
    const FEED = 1.0;
    this.afterlife = { at: t, until: t + tail, feedUntil: t + FEED };
    // the living sources let go (short releases, not chops — a chopped note reverberating sounded wrong)
    this.voiceBus.gain.setTargetAtTime(0, t + 0.25, 0.15);
    // a found word still sounding lets go with the voices; one still waiting is not played (tick plans nothing now)
    this.foundWaiting = null;
    const fo = this.foundOut;
    if (fo) {
      this.foundOut = null;
      fo.gain.setTargetAtTime(0, t + 0.25, 0.15);
      setTimeout(() => fo.disconnect(), 2000);
    }
    this.pad.level.gain.setTargetAtTime(0, t + 0.2, 0.25);
    this.bassGain.gain.setTargetAtTime(0, t, 0.1);
    this.wave.gain.gain.setTargetAtTime(0, t, 0.15);
    this.noiseGain.gain.setTargetAtTime(0, t, 0.25);
    // the last sound into the long room. The patch has a FADER of its own for the end (the artist, 2026-10-28:
    // tapped straight into the room it jumped; closed with its dry gain it left no reverb): a feed gain into the
    // room's convolver that comes up as the dry path goes down (a crossfade, the loudness held), stays open for
    // NC_FEED seconds so the room is full of it, then closes slowly — the tail is what remains
    const room = this.afterlifeRoom(tail);
    if (this.nc && this.ctx) {
      const NC_FEED = 1.5;
      const feed = this.ctx.createGain();
      feed.gain.value = 0;
      this.nc.filter.connect(feed).connect(room.conv);
      feed.gain.setTargetAtTime(0.6, t, 0.6); // 1 in 0.4 s until 10/31: the room came in louder than the pressed dry — a jump
      feed.gain.setTargetAtTime(0, t + NC_FEED, 0.5);
      this.nc.gain.gain.setTargetAtTime(0, t + 0.1, 0.4);
      this.ncFeed = feed;
    }
    // the room's send comes up gently and only halfway (1 in 50 ms until 10/31: the reverb of the last second arrived
    // louder than the dry the dying had pressed down — the artist heard the end JUMP instead of sinking away)
    room.send.gain.cancelScheduledValues(t);
    room.send.gain.setTargetAtTime(0.5, t, 0.3);
    room.send.gain.setTargetAtTime(0, t + FEED, 0.15);
    // the master keeps sinking from WHERE IT IS (after the dying: half; after an X hold: whole), never holds, never
    // rises: to a third by mid-tail, to silence at the tail's end (the artist: "점점 눌리다가 아예 사라져야")
    const cur = Math.max(0, Math.min(1, this.master.gain.value));
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(cur, t);
    this.master.gain.linearRampToValueAtTime(cur * 0.3, t + tail * 0.5);
    this.master.gain.linearRampToValueAtTime(0, t + tail);
  }

  /** A new life: the room's send closes, the living buses come back (the master follows the params again). */
  private endAfterlife(t: number): void {
    this.afterlife = null;
    this.afterRoom?.send.gain.setTargetAtTime(0, t, 0.05);
    // the patch's feed into the room goes (its dry path stays and comes back)
    if (this.ncFeed) {
      try {
        this.nc?.filter.disconnect(this.ncFeed);
        this.ncFeed.disconnect();
      } catch {
        /* already gone */
      }
      this.ncFeed = null;
    }
    this.voiceBus.gain.setTargetAtTime(1, t, 0.2);
    this.bassGain.gain.setTargetAtTime(1, t, 0.2);
    this.nc?.gain.gain.setTargetAtTime(1, t, 0.2);
  }

  /**
   * The afterlife's long room: a dark impulse `seconds` long (about −26 dB at its end), fed by the dry bus (and the
   * patch at the end) through a send that stays closed until the end; built with the graph (no cold start at a death), rebuilt
   * when the knob has moved by more than a quarter second.
   */
  private afterlifeRoom(seconds: number): { send: GainNode; conv: ConvolverNode } {
    const ctx = this.ctx!;
    const sec = Math.max(1, Math.min(30, seconds));
    if (this.afterRoom && this.afterRoom.conv.context !== ctx) this.afterRoom = null; // a closed context's room
    if (this.afterRoom && Math.abs(this.afterRoom.seconds - sec) < 0.26) return this.afterRoom;
    if (this.afterRoom) {
      try {
        this.dry.disconnect(this.afterRoom.send);
        this.afterRoom.send.disconnect();
        this.afterRoom.conv.disconnect();
      } catch {
        /* ignore */
      }
    }
    const send = ctx.createGain();
    send.gain.value = 0;
    const conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = impulse(ctx, sec, sec / 3.2, 0, 0.3); // a fuller tail (−26 dB at its end; the fade closes it)
    send.connect(conv).connect(this.master);
    this.dry.connect(send);
    this.afterRoom = { send, conv, seconds: sec };
    return this.afterRoom;
  }

  /** The wave rising through a bar: the low-pass opens 300 → 2400 Hz, the level swells (sin^1.5-ish by the ramps). */
  /**
   * The wave rising through the dominant bar: the low-pass opens 300 → 2400 Hz, the level swells to a crest, and in the
   * bar's last tenth the crest eases back a little before it breaks on the downbeat (the artist, 10/31: the reference's
   * wave crested and struck; 11/01: a deep dip and an instant strike were abrupt — the ease is shallow now).
   */
  private waveSwell(at: number, barSec: number, level: number): void {
    const { filter, gain } = this.wave;
    const hit = this.params.waveHit;
    filter.frequency.cancelScheduledValues(at);
    filter.frequency.setValueAtTime(300, at);
    filter.frequency.exponentialRampToValueAtTime(2400, at + barSec * 0.85);
    gain.gain.cancelScheduledValues(at);
    gain.gain.setValueAtTime(0.001, at);
    gain.gain.exponentialRampToValueAtTime(0.35 * level, at + barSec * 0.7);
    gain.gain.linearRampToValueAtTime(0.45 * level, at + barSec * 0.86);
    gain.gain.linearRampToValueAtTime(0.45 * level * (1 - 0.3 * hit), at + barSec);
  }

  /**
   * The wave breaking on the downbeat: it swells over ~0.1 s (12 ms until 11/01: "갑자기 때리는 게 어색"), the filter
   * opens with it instead of jumping, a soft low thump lies mostly in the reverb, and it falls back over ~3 s.
   */
  private waveBreak(at: number, level: number): void {
    const ctx = this.ctx!;
    const { filter, gain } = this.wave;
    const hit = this.params.waveHit;
    gain.gain.cancelScheduledValues(at);
    gain.gain.setValueAtTime(0.45 * level * (1 - 0.3 * hit), at);
    gain.gain.linearRampToValueAtTime((0.5 + 0.25 * hit) * level, at + 0.1);
    gain.gain.setTargetAtTime(0, at + 0.3, 1.1);
    filter.frequency.cancelScheduledValues(at);
    filter.frequency.setValueAtTime(2400, at);
    filter.frequency.linearRampToValueAtTime(2400 + 800 * hit, at + 0.1);
    filter.frequency.setTargetAtTime(300, at + 0.3, 1.3);
    if (hit > 0) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(62, at);
      o.frequency.exponentialRampToValueAtTime(42, at + 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.3 * level * hit, at + 0.03);
      g.gain.setTargetAtTime(0, at + 0.1, 0.18);
      const dry = ctx.createGain();
      dry.gain.value = 0.4;
      o.connect(g);
      g.connect(dry).connect(this.master);
      g.connect(this.hallConv);
      o.onended = () => {
        g.disconnect();
        dry.disconnect();
      };
      o.start(at);
      o.stop(at + 1);
    }
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
      // (functional, §13i: the voices are led by steps — they change at the bar, no swoop)
      oscs[i].frequency.setTargetAtTime(midiToHz(p), at, this.params.harmonyTurns ? 0.012 : 0.08);
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
    const { bar, start } = barClock(this.gridEpochMs(barSec), Date.now(), now, barSec);
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

    // §13d: the new word an answer gave is my motif from the bar after the answer on (before this bar is planned)
    if (this.nextMotif && nextStart >= this.nextMotif.at - barSec / 4) {
      this.me.motif = this.nextMotif.motif;
      this.nextMotif = null;
    }
    const plan = this.planFor(next);
    if (!plan) return;
    const jitter = p.jitterMax * (1 - plan.lock);
    const human = () => (jitter > 0 ? (Math.random() * 2 - 1) * jitter : 0);

    // ASKING AS COUNTERPOINT (§13d): an open question's bars from its first — the asker calls, then leaves a bar empty
    // (the visitor's turn), and so on; nobody else's melody, mine included, sounds over either. An arrival's cadence keeps
    // its bars. The answer's two bars (playAnswer) are its own: the ordinary melodies keep quiet under them too.
    // (the answer's bars, edge to edge: the page's clock and the context's can differ by a few ms — a quarter bar of slack.
    // While they sound the question is over, even if the record's close has not reached the signals yet.)
    const slack = barSec / 4;
    const quiet = !!this.answerQuiet && nextStart >= this.answerQuiet.from - slack && nextStart < this.answerQuiet.to - slack;
    if (this.answerQuiet && nextStart >= this.answerQuiet.to - slack) this.answerQuiet = null;
    const askId = p.askCounterpoint && !quiet ? sig.asker ?? null : null;
    if (askId !== (this.question?.id ?? null)) this.question = askId ? { id: askId, fromBar: next } : null;
    const q = this.question;
    const k = q && !plan.arrival ? next - q.fromBar : -1;
    const hush = k >= 0 || quiet;
    if (q && k >= 0) {
      if (callsOn(k)) this.playCall(q.id, sig.askerWord ?? null, plan, nextStart, barSec, next);
      else this.dialogueLine = `빈 마디 ${q.id} @${next}`;
    }

    // a found word takes this bar (found()): in my voice, so my motif keeps quiet; an arrival's two bars stay the
    // cadence's (the word waits for the bar after), and a word that has waited longer than a few bars is let go
    const fw = this.foundWaiting;
    let foundBar = false;
    if (fw && now - fw.at > FOUND_WAIT_BARS * barSec) this.foundWaiting = null;
    else if (fw && !plan.arrival) {
      this.foundWaiting = null;
      this.playFound(fw.id, nextStart, next, this.zoneKey ?? key, barSec);
      foundBar = true;
    }

    // THE ENSEMBLE (§13e): while the record says 합주 (really building together) — the parts enter one bar after another
    // (in the order they joined), and the ordinary melodies keep quiet under them. A question or an answer in the middle
    // of it is a SOLO over the band: the band plays on, softer, without the two who talk and without my line
    const ensembleOn = this.ensembleIds.length > 0;
    if (ensembleOn) {
      if (!this.ens) this.ens = { from: next, entries: new Map() };
      for (const id of this.ensembleIds) {
        if (this.ens.entries.has(id)) continue;
        let last = this.ens.from;
        for (const b of this.ens.entries.values()) last = Math.max(last, b);
        this.ens.entries.set(id, Math.max(next, last + 1));
      }
      const partnerNow = this.partner && now < this.partner.until ? this.partner.id : undefined;
      this.playEnsemble(plan, nextStart, barSec, next, !foundBar, hush ? { without: [q?.id, partnerNow] } : null);
    } else this.ens = null;

    if (!foundBar && !hush && !ensembleOn) for (const n of plan.me) this.note(this.me.filt, n.freq, nextStart + n.at * barSec + human(), n.len * barSec, 1, this.me.motif.timbre, 0, true);
    if (!hush && !ensembleOn) for (const vb of plan.others) {
      const v = this.voices.get(vb.o);
      if (!v || v.level <= 0.001) continue;
      // who speaks to me (the artist, 2026-11-10: heard at once, like a call, plainly the pattern): their melody on the
      // grid's own steps, in the motif's own instrument instead of a bot's blur
      const calls = vb.o === sig.asker;
      for (const n of vb.notes) {
        const at = nextStart + n.at * barSec + (calls ? 0 : human() * 0.5);
        this.note(v.filt, n.freq, at, n.len * barSec, plan.answer || calls ? 1 : 0.8, v.motif.timbre, calls ? 0 : v.blur);
        if (calls) this.feature(vb.o, at); // (its head hops on what is heard — hopOf)
      }
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
    // the arrival's tonic bar: the heartbeat must not duck the voices on the downbeat they bloom on (10/31: with the
    // breath it read as the sound being eaten at the wave's peak)
    if (!alone) for (const b of plan.bass) this.bassNote(b.pitch, nextStart + b.at * barSec, b.level, plan.arrival === "tonic" && b.at < 0.05 ? 0 : 1);
    // (the ensemble never makes the pad smaller; ensembleSwell above 1 makes it fuller — §13e)
    const padLevel = ensembleOn ? plan.pad.level * Math.max(1, p.ensembleSwell) : plan.pad.level;
    this.setPad(plan.pad.pitches, alone ? 0 : padLevel, nextStart, plan.arrival === "tonic");
  }
}

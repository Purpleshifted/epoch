/**
 * sound/magenta.ts — OPTIONAL variation models, ported from umwelt (src/audio/MusicEngine.ts evalSequenceMorpher /
 * evalMelodyGen): MusicVAE interpolates two phrases (mine ↔ a neighbour's) in latent space, MusicRNN
 * (chord_pitches_improv) improvises a phrase over the chords of the ground. Both are loaded lazily after the first
 * gesture (TensorFlow.js + checkpoints from Google's bucket: a few MB, network), both are cached per request key,
 * and when anything fails the caller keeps the procedural variation (variation.ts). docs/sound-logic.md §6.
 *
 * Phrases are 32 16th-steps (4 cycles of 8) of MIDI (0 = no new note); Magenta sees them at 120 QPM, 4 steps per
 * quarter, pitches shifted into its melody range (48 … 83).
 */

import type { INoteSequence } from "@magenta/music/es6/protobuf";
import { PHRASE_STEPS, intoRange, type Phrase } from "./variation";

const VAE_CHECKPOINT = "https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/mel_2bar_small";
const RNN_CHECKPOINT = "https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/chord_pitches_improv";
const QPM = 120;
const STEP_SEC = 60 / QPM / 4;

type VAE = { initialize(): Promise<void>; isInitialized(): boolean; interpolate(seqs: INoteSequence[], n: number, temperature?: number): Promise<INoteSequence[]> };
type RNN = { initialize(): Promise<void>; isInitialized(): boolean; continueSequence(seq: INoteSequence, steps: number, temperature?: number, chords?: string[]): Promise<INoteSequence> };
type Sequences = { quantizeNoteSequence(ns: INoteSequence, spq: number): INoteSequence };

export function phraseToSequence(phrase: Phrase): INoteSequence {
  const notes: NonNullable<INoteSequence["notes"]> = [];
  for (let i = 0; i < PHRASE_STEPS; i++) {
    const p = phrase[i] ?? 0;
    if (p <= 0) continue;
    let end = PHRASE_STEPS;
    for (let j = i + 1; j < PHRASE_STEPS; j++) if ((phrase[j] ?? 0) > 0) { end = j; break; }
    notes.push({ pitch: intoRange(p), startTime: i * STEP_SEC, endTime: end * STEP_SEC, velocity: 80 });
  }
  return {
    ticksPerQuarter: 220,
    totalTime: PHRASE_STEPS * STEP_SEC,
    timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
    tempos: [{ time: 0, qpm: QPM }],
    notes,
  };
}

/** A (quantized or not) sequence back to a phrase; `offsetSteps` drops the seed part of an RNN continuation. */
export function sequenceToPhrase(seq: INoteSequence, offsetSteps = 0): Phrase {
  const out: Phrase = new Array(PHRASE_STEPS).fill(0);
  for (const n of seq.notes ?? []) {
    const start = n.quantizedStartStep != null ? n.quantizedStartStep : Math.round((n.startTime ?? 0) / STEP_SEC);
    const s = start - offsetSteps;
    if (s < 0 || s >= PHRASE_STEPS || n.pitch == null) continue;
    out[s] = n.pitch;
  }
  return out;
}

export class Magenta {
  private vae: VAE | null = null;
  private rnn: RNN | null = null;
  private seq: Sequences | null = null;
  private loading: Promise<boolean> | null = null;
  private failed = false;
  private cache = new Map<string, Phrase>();
  private inFlight = new Set<string>();

  get ready(): boolean {
    return !!this.vae && !!this.rnn;
  }

  /** Loads the models once (idempotent); false when the network / WebGL is not there. */
  load(): Promise<boolean> {
    if (this.failed) return Promise.resolve(false);
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const [vaeMod, rnnMod, core] = await Promise.all([
          import("@magenta/music/es6/music_vae"),
          import("@magenta/music/es6/music_rnn"),
          import("@magenta/music/es6/core"),
        ]);
        const vae = new vaeMod.MusicVAE(VAE_CHECKPOINT) as unknown as VAE;
        const rnn = new rnnMod.MusicRNN(RNN_CHECKPOINT) as unknown as RNN;
        await Promise.all([vae.initialize(), rnn.initialize()]);
        this.vae = vae;
        this.rnn = rnn;
        this.seq = core.sequences as unknown as Sequences;
        return true;
      } catch (e) {
        console.warn("[sound] Magenta not available, staying procedural:", e);
        this.failed = true;
        return false;
      }
    })();
    return this.loading;
  }

  /**
   * My phrase pulled `amount` (0..1) of the way towards theirs in MusicVAE's latent space. Returns the cached result
   * at once, or null while it is being made (ask again next bar).
   */
  interpolate(mine: Phrase, theirs: Phrase, amount: number): Phrase | null {
    if (!this.vae || !this.seq) return null;
    const bucket = Math.round(amount * 4) / 4;
    const key = `i:${mine.join(",")}|${theirs.join(",")}|${bucket}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (this.inFlight.has(key)) return null;
    this.inFlight.add(key);
    const q = this.seq;
    this.vae
      .interpolate([q.quantizeNoteSequence(phraseToSequence(mine), 4), q.quantizeNoteSequence(phraseToSequence(theirs), 4)], 5)
      .then((seqs) => {
        // seqs: mine, 1/4, 1/2, 3/4, theirs
        const idx = Math.max(0, Math.min(4, Math.round(bucket * 4)));
        this.cache.set(key, sequenceToPhrase(seqs[idx]));
      })
      .catch((e) => console.warn("[sound] VAE interpolate failed:", e))
      .finally(() => this.inFlight.delete(key));
    return null;
  }

  /** My phrase continued by MusicRNN over `chords` (one per bar, Magenta names like "Dm7"). Cached / null as above. */
  improvise(seed: Phrase, chords: string[], temperature = 1.0): Phrase | null {
    if (!this.rnn || !this.seq) return null;
    const key = `r:${seed.join(",")}|${chords.join(" ")}|${temperature}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (this.inFlight.has(key)) return null;
    this.inFlight.add(key);
    const q = this.seq;
    this.rnn
      .continueSequence(q.quantizeNoteSequence(phraseToSequence(seed), 4), PHRASE_STEPS, temperature, chords)
      .then((seq) => this.cache.set(key, sequenceToPhrase(seq)))
      .catch((e) => console.warn("[sound] RNN improvise failed:", e))
      .finally(() => this.inFlight.delete(key));
    return null;
  }
}

/**
 * sound/motif.ts — the visitor's SIGNATURE (graduation_exhibition_spec §3.1).
 *
 * On arrival every visitor (or bot) is given a frequency CENTROID and 3–5 MICRO-TONES around it (cents off the
 * centroid, not scale degrees), played as a 2-second arpeggio: their leitmotif. Density (how many notes) and
 * tempo (how fast the cycle runs) differ per signature. Everything is a pure function of the visitor id, so the
 * same person sounds the same in every view and on every tab, and the Top/3D views can derive the global
 * PARTIAL of a person (the centroid a few octaves down, see `partialOf`) from the same motif.
 *
 * Pure and deterministic. No Web Audio here (that is engine.ts).
 */

export interface MotifConfig {
  /** Centroid range (Hz); drawn log-uniformly. */
  centroidLo: number;
  centroidHi: number;
  /** Notes in the motif (inclusive). */
  notesMin: number;
  notesMax: number;
  /** How far (cents) the micro-tones may sit from the centroid: each motif draws its own spread in this range. */
  spreadCentsMin: number;
  spreadCentsMax: number;
  /** Length (s) of one cycle of the arpeggio at tempo 1. */
  cycleSec: number;
  /** Per-signature tempo scale range (log-uniform): 1 / tempoRange … tempoRange. */
  tempoRange: number;
}

export const DEFAULT_MOTIF: MotifConfig = {
  centroidLo: 110,
  centroidHi: 440,
  notesMin: 3,
  notesMax: 5,
  spreadCentsMin: 15,
  spreadCentsMax: 90,
  cycleSec: 2,
  tempoRange: 1.33,
};

export interface Motif {
  id: string;
  /** Centre frequency (Hz). */
  centroid: number;
  /** Micro-tones as cents off the centroid, in the order they are arpeggiated. The first is the centroid itself. */
  cents: number[];
  /** This signature's own spread (cents): the widest any of its tones sits from the centroid. */
  spread: number;
  /** Per-signature tempo scale (1 = the configured cycle). */
  tempoScale: number;
  /** 0..1 timbre character (0 = dark / sine-like, 1 = brighter). */
  timbre: number;
  cycleSec: number;
}

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small deterministic PRNG, 0..1. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The signature of one visitor id. Same id, same motif, always. */
export function makeMotif(id: string, cfg: MotifConfig = DEFAULT_MOTIF): Motif {
  const r = rng(hashString(id));
  const centroid = cfg.centroidLo * Math.pow(cfg.centroidHi / cfg.centroidLo, r());
  const n = cfg.notesMin + Math.floor(r() * (cfg.notesMax - cfg.notesMin + 1));
  const spread = cfg.spreadCentsMin + r() * (cfg.spreadCentsMax - cfg.spreadCentsMin);
  const cents = [0];
  for (let i = 1; i < n; i++) {
    // never two tones within 5 cents of each other (they would only beat)
    let c = 0;
    for (let tries = 0; tries < 8; tries++) {
      c = (r() * 2 - 1) * spread;
      if (cents.every((o) => Math.abs(o - c) >= 5)) break;
    }
    cents.push(c);
  }
  const lt = Math.log(cfg.tempoRange);
  const tempoScale = Math.exp((r() * 2 - 1) * lt);
  const timbre = r();
  return { id, centroid, cents, spread, tempoScale, timbre, cycleSec: cfg.cycleSec };
}

/** Frequency (Hz) of tone i of the motif. */
export function toneFreq(m: Motif, i: number): number {
  return m.centroid * Math.pow(2, m.cents[i % m.cents.length] / 1200);
}

export interface MotifNote {
  /** Onset within the cycle, 0..1. */
  at: number;
  /** Length as a share of one tone's slot (0..1). */
  len: number;
  freq: number;
}

/** One cycle of the arpeggio: the tones evenly over the cycle, in their order. */
export function motifNotes(m: Motif): MotifNote[] {
  const n = m.cents.length;
  return m.cents.map((_, i) => ({ at: i / n, len: 0.8, freq: toneFreq(m, i) }));
}

/**
 * Seconds of one cycle when the visitor's state asks for `bpm`: the configured cycle is what 60 BPM means, so a
 * still visitor (40 BPM) hears a 3 s cycle and a running one (140 BPM) a 0.86 s cycle, scaled by the signature.
 */
export function cycleSeconds(m: Motif, bpm: number): number {
  return (m.cycleSec * 60) / Math.max(1, bpm) / m.tempoScale;
}

/**
 * GLOBAL view: a person is one low partial — their centroid `octavesDown` octaves lower. All the partials of all
 * the people together are the ground drone (concept.md §4, acoustic stratigraphy).
 */
export function partialOf(m: Motif, octavesDown = 3): number {
  return m.centroid / Math.pow(2, octavesDown);
}

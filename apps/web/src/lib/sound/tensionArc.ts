/**
 * sound/tensionArc.ts — TENSION THAT BUILDS AND IS RESOLVED (docs/sound-logic.md §13h). Pure.
 *
 * The artist, 2026-11-27: "단순히 사람이 모이면 모일수록 텐션이 커지기만 하면 불안하고 음악진행이 없는 느낌을 주기 쉬운 듯.
 * 이게 쌓여서 한 번에 혹은 서서히 '해결'이 돼야 음악적 효과를 가지는데" → "제안대로 넣어". Until now (§13g) the tension was
 * simply how many were around, and every eight-bar phrase went home by itself. Here:
 *
 *   BUILDS         while others are within hearing the tension is STORED, bar by bar (faster the more there are:
 *                  `buildBars` bars fully gathered to fill it). While it holds, the phrases chain without going home —
 *                  the tonic is kept for a resolution.
 *   RESOLVES AT ONCE
 *     building together   the group's own act resolves the group's tension WHOLLY: the arrival's dominant is held
 *                         longer the more was stored, then the tonic (the engine's arrival; `building` here).
 *     my answer           resolves MY SHARE — half: the answer's second bar (the new word in one rhythm) lands home.
 *   RESOLVES SLOWLY
 *     bond                staying with the same people: the longer together (`bondSec`), the milder — familiarity.
 *     patience            nothing happened for `patienceBars` while it held: a soft plagal close (iv → I, the amen).
 *   SCATTERS             everyone gone while it held: one deceptive bar, then it fades — unresolved, remembered.
 */

export type ArcRelease = "home" | "plagal" | "deceptive";
export type ArcResolved = "build" | "answer" | "patience" | "scatter";

export interface ArcConfig {
  /** The knob: the tension at its fullest (0 = off). */
  tension: number;
  /** How many others within hearing make it fully gathered (it builds that much faster). */
  crowdFull: number;
  /** Bars fully gathered to fill the store. */
  buildBars: number;
  /** Seconds with the same people until they no longer make it tense (0 = no bond). */
  bondSec: number;
  /** Bars of holding without any resolution before it closes by itself (0 = never). */
  patienceBars: number;
}

export const DEFAULT_ARC: ArcConfig = { tension: 0.8, crowdFull: 2, buildBars: 12, bondSec: 60, patienceBars: 32 };

/** The level from which the tension HOLDS (the phrases chain, the tonic is kept). */
export const HOLD_FROM = 0.2;

export interface ArcState {
  bar: number;
  /** 0..1 how much is stored. */
  stored: number;
  /** Bars it has held since the last resolution. */
  held: number;
  /** Whether it held on the last bar. */
  holding: boolean;
  /** Seconds together per other (within hearing), fading while apart. */
  withSec: Record<string, number>;
  /** A resolution of more than one bar under way. */
  closing: { kind: "patience"; from: number } | null;
  /** The last resolution and its bar. */
  last: { kind: ArcResolved; bar: number } | null;
}

export const ARC_IDLE: ArcState = { bar: -1, stored: 0, held: 0, holding: false, withSec: {}, closing: null, last: null };

export interface ArcInputs {
  bar: number;
  barSec: number;
  /** Others within hearing now. */
  heard: readonly string[];
  /** Building together arrived home on this bar (the arrival's tonic). */
  building?: boolean;
}

export interface ArcStep {
  state: ArcState;
  /** 0..1 how tense it may be now: the knob × stored × (1 − bond). */
  level: number;
  /** Whether it holds: every phrase tense, the tonic kept. */
  holding: boolean;
  /** This bar's chord, when it resolves (or scatters). */
  release: ArcRelease | null;
  /** What resolved on this bar. */
  resolved: ArcResolved | null;
  /** 0..1 how familiar the ones around me are. */
  bond: number;
  /** 0..1 how gathered. */
  gathered: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** One bar on. Called once per bar in order; a bar already stepped returns the state as it is. */
export function stepArc(prev: ArcState, inp: ArcInputs, cfg: ArcConfig = DEFAULT_ARC): ArcStep {
  const bars = prev.bar < 0 ? 1 : Math.max(0, Math.min(4, inp.bar - prev.bar));
  const dt = bars * inp.barSec;
  // time together: grows while heard, fades at half the pace while apart
  const withSec: Record<string, number> = {};
  const heard = new Set(inp.heard);
  for (const [id, s] of Object.entries(prev.withSec)) if (!heard.has(id) && s - dt * 0.5 > 0) withSec[id] = s - dt * 0.5;
  for (const id of heard) withSec[id] = (prev.withSec[id] ?? 0) + dt;
  const gathered = clamp01(inp.heard.length / Math.max(1, cfg.crowdFull));
  const bond = cfg.bondSec > 0 && inp.heard.length ? inp.heard.reduce((s, id) => s + clamp01((withSec[id] ?? 0) / cfg.bondSec), 0) / inp.heard.length : 0;

  let stored = prev.stored;
  let held = prev.held;
  let closing = prev.closing;
  let last = prev.last;
  let release: ArcRelease | null = null;
  let resolved: ArcResolved | null = null;
  const levelOf = (s: number) => clamp01(cfg.tension) * s * (1 - bond);

  if (bars > 0) {
    // builds while gathered; drains quickly alone
    stored = gathered > 0 ? clamp01(stored + (gathered * bars) / Math.max(1, cfg.buildBars)) : Math.max(0, stored - 0.25 * bars);
  }

  if (closing) {
    // the amen's second bar: home, all of it let go
    release = "home";
    resolved = "patience";
    stored = 0;
    held = 0;
    closing = null;
  } else if (inp.building && stored > 0) {
    // the group's own act: everything resolves (the engine's arrival plays the cadence)
    resolved = "build";
    stored = 0;
    held = 0;
  } else if (prev.holding && gathered === 0) {
    // everyone gone while it held: a deceptive bar, then it fades
    release = "deceptive";
    resolved = "scatter";
    stored *= 0.3;
    held = 0;
  } else if (levelOf(stored) >= HOLD_FROM) {
    held += Math.max(1, bars);
    if (cfg.patienceBars > 0 && held >= cfg.patienceBars) {
      // nothing happened: the amen (iv, then home next bar)
      release = "plagal";
      closing = { kind: "patience", from: inp.bar };
    }
  } else held = 0;

  if (resolved) last = { kind: resolved, bar: inp.bar };
  const level = levelOf(stored);
  const holding = !release && level >= HOLD_FROM;
  return {
    state: { bar: Math.max(prev.bar, inp.bar), stored, held, holding, withSec, closing, last },
    level,
    holding,
    release,
    resolved,
    bond,
    gathered,
  };
}

/**
 * MY ANSWER resolves my share (§13h): half the store let go, the holding counted from zero; the answer's second bar
 * (`bar`, the new word in one rhythm) lands home — the engine plays that bar's chord as the place's triad.
 */
export function answerArc(prev: ArcState, bar: number): ArcState {
  return { ...prev, stored: prev.stored * 0.5, held: 0, holding: false, last: { kind: "answer", bar } };
}

/** Bars the arrival's dominant is held beyond its one, from how tense it was when building together began. */
export function arrivalHold(level: number): number {
  return level >= 0.5 ? 2 : level >= HOLD_FROM ? 1 : 0;
}

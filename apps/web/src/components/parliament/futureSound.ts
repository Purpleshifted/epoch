/**
 * futureSound — THE FUTURE PASSING, HEARD (the artist, 2026-11-22: "그런 경우 사운드 효과도 줘야할듯, 꽃밭의 경우
 * glittery soundscape 로, 물의 경우 파도와 변별되는 강물 노이즈로... 스쳐지나가도록?").
 *
 * When one of the future's archaeologists crosses where the visitor stands (FutureEncounter.tsx), a few seconds of
 * sound pass by — from the side it comes from to the side it goes to, as the cloud streams away:
 *   - always a breath of air, high and faint (something went past)
 *   - where the future near is a meadow in flower: GLITTER — many short high pings, scattered over the passing
 *   - where the future's water runs near (a border between villages: futurePresence.ts waterDistance): A RIVER — a low
 *     band of noise that gurgles (its centre wanders, its level flutters fast), unlike the wave's slow swelling wash
 *   - where the visitor's life is found: one soft bell under it.
 *
 * It goes into the headset mix BEFORE its dulling filter (the dying's muffling takes it too) and so into the life's
 * recording. The engine keeps its context and buses private (lib/sound/engine.ts belongs to the recording session's
 * work): they are reached here through one narrow, read-only view of them — `busOf` — and nothing of the engine is
 * changed. If the engine is not running (sound off, before the first gesture), nothing is played.
 */

import type { SoundSetup } from "./useSound";

/** The engine's context and the input of its dulling filter (private fields of SoundEngine — read only). */
function busOf(sound: SoundSetup | null): { ctx: AudioContext; into: AudioNode } | null {
  const e = sound?.engine as unknown as { ctx?: AudioContext | null; dull?: AudioNode } | undefined;
  const ctx = e?.ctx, into = e?.dull;
  if (!ctx || !into || ctx.state !== "running" || sound?.muted) return null;
  return { ctx, into };
}

const noises = new WeakMap<AudioContext, AudioBuffer>();
function noise(ctx: AudioContext): AudioBuffer {
  let b = noises.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    // (a little pinker than white: a running average of white)
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = last * 0.6 + (Math.random() * 2 - 1) * 0.4;
      d[i] = last * 1.6;
    }
    noises.set(ctx, b);
  }
  return b;
}

/** The pitches of the glitter (Hz): a high pentatonic, an octave up now and then. */
const GLITTER = [2093, 2349, 2637, 3136, 3520, 4186, 4699, 5274, 6272];

export interface FuturePassing {
  /** 0 … 1: how much of the future near is meadow in flower. */
  glitter: number;
  /** 0 … 1: how near the future's water runs. */
  river: number;
  /** The visitor's life was found there. */
  found: boolean;
  /** Where it comes from and goes to, −1 (left) … 1 (right) of the listener. */
  panFrom: number;
  panTo: number;
  /** How long the passing lasts (s). */
  dur: number;
  /** The whole effect's level (0 … 1; the engine's own master and limiter come after). */
  level: number;
}

export function playFuturePassing(sound: SoundSetup | null, o: FuturePassing): boolean {
  const bus = busOf(sound);
  if (!bus) return false;
  const { ctx, into } = bus;
  const t0 = ctx.currentTime + 0.03, D = Math.max(1, o.dur), end = t0 + D + 1.5;
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(Math.max(-1, Math.min(1, o.panFrom)), t0);
  pan.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, o.panTo)), t0 + D);
  const out = ctx.createGain();
  out.gain.value = Math.max(0, Math.min(1, o.level));
  out.connect(pan).connect(into);
  const stopAll: AudioScheduledSourceNode[] = [];
  const env = (g: GainNode, peak: number, attack: number, hold: number, release: number) => {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.setValueAtTime(peak, t0 + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
  };
  // A BREATH OF AIR: high-passed noise, swelling and gone
  {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(5000, t0);
    hp.frequency.linearRampToValueAtTime(2600, t0 + D * 0.5);
    hp.frequency.linearRampToValueAtTime(6000, t0 + D);
    const g = ctx.createGain();
    env(g, 0.05, D * 0.35, 0.1, D * 0.7);
    src.connect(hp).connect(g).connect(out);
    src.start(t0);
    stopAll.push(src);
  }
  // GLITTER: short high pings scattered over the passing, the more the more the meadow flowers
  const gl = Math.max(0, Math.min(1, o.glitter));
  if (gl > 0.02) {
    const n = Math.round(8 + 56 * gl);
    for (let i = 0; i < n; i++) {
      const at = t0 + Math.random() * D * 0.9;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = GLITTER[Math.floor(Math.random() * GLITTER.length)] * (Math.random() < 0.25 ? 2 : 1);
      osc.detune.value = (Math.random() - 0.5) * 20;
      const g = ctx.createGain();
      const peak = (0.018 + 0.03 * Math.random()) * (0.5 + 0.5 * gl);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06 + Math.random() * 0.16);
      const p = ctx.createStereoPanner();
      p.pan.value = (Math.random() - 0.5) * 1.2;
      osc.connect(g).connect(p).connect(out);
      osc.start(at);
      osc.stop(at + 0.3);
    }
  }
  // A RIVER: a low band of noise whose centre wanders and whose level flutters fast — not the wave's slow swell
  const rv = Math.max(0, Math.min(1, o.river));
  if (rv > 0.02) {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.3;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.9;
    // (its centre wanders: a slow random walk, set ahead)
    let f = 480;
    for (let t = 0; t <= D + 1.5; t += 0.12) {
      f = Math.max(260, Math.min(900, f + (Math.random() - 0.5) * 160));
      bp.frequency.setValueAtTime(f, t0 + t);
    }
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    const flutter = ctx.createGain();
    flutter.gain.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6 + Math.random() * 5;
    const depth = ctx.createGain();
    depth.gain.value = 0.3;
    lfo.connect(depth).connect(flutter.gain);
    const g = ctx.createGain();
    env(g, 0.22 * rv, 0.7, D * 0.4, D * 0.6 + 0.8);
    src.connect(bp).connect(lp).connect(flutter).connect(g).connect(out);
    src.start(t0);
    lfo.start(t0);
    stopAll.push(src, lfo);
  }
  // FOUND: one soft bell under it
  if (o.found) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 880;
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = 880 * 2.76;
    const g = ctx.createGain(), g2 = ctx.createGain();
    g.gain.setValueAtTime(0, t0 + 0.2);
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.21);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
    g2.gain.setValueAtTime(0, t0 + 0.2);
    g2.gain.linearRampToValueAtTime(0.015, t0 + 0.21);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
    osc.connect(g).connect(out);
    osc2.connect(g2).connect(out);
    osc.start(t0 + 0.2);
    osc2.start(t0 + 0.2);
    osc.stop(t0 + 2.8);
    osc2.stop(t0 + 1.4);
  }
  for (const s of stopAll) s.stop(end);
  // (the chain goes when its sources have)
  window.setTimeout(() => {
    try {
      out.disconnect();
      pan.disconnect();
    } catch {
      // gone
    }
  }, (end - ctx.currentTime + 0.5) * 1000);
  return true;
}

/**
 * A WEAK DAYDREAM — THE FUTURE ONLY LOOKING AT ME (FutureResidue's gaze ring, futureCue `glance` — the artist, 2026-11-28:
 * "말로만 알려주고 소리 효과는 '약한 백일몽'만 4초정도 페이드 인앤아웃, 비주얼 효과 없음"): the daydream's low haze alone
 * (the place's lydian — root, fifth, ninth, #11 — as detuned triangle pairs under a lowpass that opens a little and
 * closes), quiet, faded in over the first half of `dur` s and out over the second, panned across, into the hall as the
 * daydream is. No melody, no static, no whistle, no glitter: SoundEngine.daydream stays the arrival's. (The engine's
 * key, place and hall are read through the same narrow view as `busOf`.)
 */
export function playFutureGlance(sound: SoundSetup | null, o: { panFrom: number; panTo: number; level: number; dur?: number }): boolean {
  const bus = busOf(sound);
  if (!bus || o.level <= 0) return false;
  const { ctx, into } = bus;
  const e = sound?.engine as unknown as { placeNow?: { rootClass?: number } | null; key?: { root?: number } | null; rooms?: { hall?: AudioNode } } | undefined;
  const root = e?.placeNow?.rootClass ?? e?.key?.root ?? 0;
  const hall = e?.rooms?.hall;
  const D = Math.max(1, o.dur ?? 4), t0 = ctx.currentTime + 0.05, end = t0 + D;
  const c1 = (v: number) => Math.max(-1, Math.min(1, v));
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(c1(o.panFrom), t0);
  pan.pan.linearRampToValueAtTime(c1(o.panTo), end);
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(0.012 * o.level, t0 + D * 0.5);
  out.gain.linearRampToValueAtTime(0, end);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 0.7;
  lp.frequency.setValueAtTime(240, t0);
  lp.frequency.exponentialRampToValueAtTime(800, t0 + D * 0.5);
  lp.frequency.exponentialRampToValueAtTime(300, end);
  const dry = ctx.createGain();
  dry.gain.value = 0.55;
  lp.connect(out).connect(pan);
  pan.connect(dry).connect(into);
  let send: GainNode | null = null;
  if (hall) {
    send = ctx.createGain();
    send.gain.value = 0.9;
    pan.connect(send).connect(hall);
  }
  const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
  for (const st of [0, 7, 14, 18])
    for (const dc of [-8, 8]) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = midi(48 + root + st);
      osc.detune.value = dc;
      osc.connect(lp);
      osc.start(t0);
      osc.stop(end + 0.1);
    }
  // (the chain goes when its sources have)
  window.setTimeout(() => {
    try {
      lp.disconnect();
      out.disconnect();
      pan.disconnect();
      dry.disconnect();
      send?.disconnect();
    } catch {
      // gone
    }
  }, (end - ctx.currentTime + 0.5) * 1000);
  return true;
}

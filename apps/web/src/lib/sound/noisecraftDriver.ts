/**
 * sound/noisecraftDriver.ts — drives the artist's NoiseCraft patch from the engine (docs/sound-logic.md §8b, v4 A2).
 *
 *   CLOCK     the MUSIC CLOCK is the engine's (interaction and status decide the bar length); the patch RECEIVES it:
 *             whenever the bar length changes the two clock knobs get it (noisecraftMap.clockParams). That is the
 *             only parameter ever sent — the patch is a static machine.
 *   PHASE     a ClockOut node in the patch reports every pulse (6 a step, 96 a bar); the driver counts them, sends
 *             the next bar's sequences on the last pulse of a bar (AI_Seq reads from step 0 and never resets), and
 *             tells the engine when the bar starts on the wall clock (`onBar` → setGridAnchor), so the Web Audio
 *             motif and the patch share one grid. Without a ClockOut: a wall-clock bar, phase unaligned.
 *   PLAY      follows `running()` — the session's phase and the ♪ switch.
 */

import { getNoiseCraftBridge, type NoiseCraftBridge } from "./NoiseCraftBridge";
import { PULSES_PER_BAR, clockParams, modeOfPlan, planToSequences, type PlaceMode } from "./noisecraftMap";
import type { BarPlan } from "./sequencer";

export interface DriverSource {
  /** The plan of bar `bar` (null when the engine cannot plan yet). */
  planFor(bar: number): BarPlan | null;
  /** Whether the patch should play now (LIVE, switched on, not muted). */
  running(): boolean;
  /** Seconds per bar: the music clock the patch receives. */
  barSec(): number;
  /** Bar `bar` starts at `wallMs` on the patch's clock (only when clocked): the engine anchors its grid to it. */
  onBar?(bar: number, wallMs: number): void;
}

export interface DriverStatus {
  patch: string;
  audio: string;
  bar: number;
  mode: PlaceMode | "-";
  clocked: boolean;
  /** Pulses per second of the patch's clock as measured (0 until measured). */
  pulseHz: number;
  /** The bar length last sent to the patch (s). */
  barSecSent: number;
}

const TICK_MS = 250;
const FALLBACK_BAR_MS = 2000;

export class NoiseCraftDriver {
  readonly bridge: NoiseCraftBridge;
  private pulses = -1;
  private bar = -1;
  private clocked = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fallback: ReturnType<typeof setInterval> | null = null;
  private lastPlan: BarPlan | null = null;
  private wantPlay = false;
  private pulseTimes: number[] = [];
  private barSecSent = 0;
  private source: DriverSource;

  constructor(source: DriverSource, bridge = getNoiseCraftBridge()) {
    this.source = source;
    this.bridge = bridge;
    bridge.onClockPulse = (_node, pulseTime) => this.onPulse(pulseTime);
    bridge.onProjectLoaded = () => {
      this.pulses = -1;
      this.bar = -1;
      this.barSecSent = 0;
      this.sendClock();
      if (this.wantPlay) bridge.play();
    };
  }

  /** Mount the embed into `container` (hidden unless `visible`) and start following the source. */
  mount(container: HTMLElement, patch: string, visible: boolean): void {
    this.bridge.createIframe(container, visible, patch);
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    if (!this.fallback) this.fallback = setInterval(() => this.fallbackBar(), FALLBACK_BAR_MS);
  }

  get status(): DriverStatus {
    const pt = this.pulseTimes;
    const pulseHz = pt.length >= 2 ? (pt.length - 1) / Math.max(0.001, pt[pt.length - 1] - pt[0]) : 0;
    return { patch: this.bridge.patch, audio: this.bridge.status, bar: this.bar, mode: this.lastPlan ? modeOfPlan(this.lastPlan) : "-", clocked: this.clocked, pulseHz, barSecSent: this.barSecSent };
  }

  get plan(): BarPlan | null {
    return this.lastPlan;
  }

  /** The music clock to the patch, when it changed (the only parameters ever sent). */
  private sendClock(): void {
    if (!this.bridge.loaded) return;
    const sec = this.source.barSec();
    if (Math.abs(sec - this.barSecSent) < 0.005) return;
    this.barSecSent = sec;
    this.bridge.setParams(clockParams(sec));
  }

  /** `pulseTime` is the patch's AUDIO time (s): the rate is measured on it, not on when the message arrived. */
  private onPulse(pulseTime: number): void {
    this.clocked = true;
    this.pulses++;
    this.pulseTimes.push(pulseTime);
    while (this.pulseTimes.length > PULSES_PER_BAR) this.pulseTimes.shift();
    const period = this.status.pulseHz > 0 ? 1000 / this.status.pulseHz : 0;
    if (this.pulses === 0) {
      this.sendBar(0);
      this.source.onBar?.(0, Date.now());
    }
    // the last pulse before the next bar: send it now so AI_Seq reads it from step 0; the bar starts one pulse on
    if (this.pulses % PULSES_PER_BAR === PULSES_PER_BAR - 1) {
      const bar = Math.floor(this.pulses / PULSES_PER_BAR) + 1;
      this.sendBar(bar);
      this.source.onBar?.(bar, Date.now() + period);
    }
  }

  /** A sequence every bar on the wall clock when the patch has no ClockOut. */
  private fallbackBar(): void {
    if (this.clocked || !this.bridge.isPlaying) return;
    this.sendBar(this.bar + 1);
  }

  private sendBar(bar: number): void {
    if (!this.bridge.loaded) return;
    const plan = this.source.planFor(bar);
    if (!plan) return;
    const seq = planToSequences(plan, this.lastPlan);
    this.bar = bar;
    this.lastPlan = plan;
    for (const id of ["parliament", "harmony", "bass", "texture", "line", "traces"] as const) this.bridge.setSequence(id, seq[id].pitches, seq[id].gates);
  }

  private tick(): void {
    const should = this.source.running();
    if (should !== this.wantPlay) {
      this.wantPlay = should;
      if (this.bridge.loaded) {
        if (should) this.bridge.play();
        else this.bridge.stop();
      }
    }
    if (should) this.sendClock();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.fallback) clearInterval(this.fallback);
    this.timer = null;
    this.fallback = null;
    this.bridge.onClockPulse = undefined;
    this.bridge.onProjectLoaded = undefined;
    this.bridge.stop();
  }
}

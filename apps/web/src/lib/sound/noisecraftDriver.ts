/**
 * sound/noisecraftDriver.ts — the sequencer's brain driving a NoiseCraft patch (docs/sound-logic.md §8b).
 *
 *   BARS      NoiseCraft is the master clock: a ClockOut node in the patch reports every pulse (6 per step);
 *             16 steps = one bar (noisecraftMap.STEPS_PER_BAR). AI_Seq never resets its step index, so the next
 *             bar's sequences are sent on the LAST pulse of the bar and are read from step 0. Without a ClockOut
 *             (a patch the artist has not wired) the driver falls back to umwelt's way: a wall-clock timer,
 *             sequences every bar, phase unaligned.
 *   TEMPO     the patch's sequencer clock is a Pulse whose rate is a knob the mapping drives from barSec
 *             (noisecraftMap.CLOCK_RULE), so the bar is as long here as in the Web Audio instrument.
 *   PLAN      every bar the engine plans it (engine.planFor → sequencer.planBar) from the latest signals; the plan
 *             becomes the receivers' sequences (noisecraftMap.planToSequences): in the HYBRID the harmony only
 *             (parliament = bass + 3 chord voices, harmony, bass, texture, line, traces), with the "noisecraft"
 *             instrument the melody too (parliament = me + 3 neighbours, me, n1–n3).
 *   ANCHOR    when the patch is clocked the driver tells the source when a bar starts on the wall clock
 *             (`onBar`), so the Web Audio melody counts its bars from the patch's beat.
 *   KNOBS     every 250 ms the coded mapping (noisecraftMap.knobParams) sends what moved.
 *   PLAY      follows `running()` (the engine's running state in the player tab, or the manager's own switch).
 */

import { getNoiseCraftBridge, type NoiseCraftBridge } from "./NoiseCraftBridge";
import { PULSES_PER_BAR, knobParams, mapFor, modeOf, planToSequences, type PatchLayer, type PatchMap, type SoundMode } from "./noisecraftMap";
import type { BarPlan } from "./sequencer";
import type { PersonalSignals } from "./signals";

export interface DriverSource {
  /** The latest signals (null before the first fold). */
  signals(): PersonalSignals | null;
  /** The plan of bar `bar` (null when the engine cannot plan yet). */
  planFor(bar: number): BarPlan | null;
  /** Whether the sound should play now (on / not muted / not soloed away). */
  running(): boolean;
  master(): number;
  /** Seconds per bar (the engine's barSec): drives the patch's sequencer clock. */
  barSec(): number;
  /** What the patch plays: the harmony (hybrid) or everything. */
  layer?(): PatchLayer;
  /** Bar `bar` starts at `wallMs` on the patch's clock (only when clocked): the engine anchors its grid to it. */
  onBar?(bar: number, wallMs: number): void;
}

export interface DriverStatus {
  patch: string;
  audio: string;
  bar: number;
  mode: SoundMode | "-";
  clocked: boolean;
  /** Pulses per second of the patch's clock (0 until measured): steps/s = this / PULSES_PER_STEP, bar seconds = PULSES_PER_BAR / this. */
  pulseHz: number;
  lastKnobs: number;
}

const KNOB_EVERY_MS = 500;
const FALLBACK_BAR_MS = 2000;

export class NoiseCraftDriver {
  readonly bridge: NoiseCraftBridge;
  private map: PatchMap;
  private pulses = -1;
  private bar = -1;
  private clocked = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fallback: ReturnType<typeof setInterval> | null = null;
  private lastKnobs = new Map<string, number>();
  private lastPlan: BarPlan | null = null;
  private wantPlay = false;
  private pulseTimes: number[] = [];
  private source: DriverSource;

  constructor(source: DriverSource, patch: string, bridge = getNoiseCraftBridge()) {
    this.source = source;
    this.bridge = bridge;
    this.map = mapFor(patch);
    bridge.onClockPulse = (_node, pulseTime) => this.onPulse(pulseTime);
    bridge.onProjectLoaded = () => {
      this.pulses = -1;
      this.bar = -1;
      this.lastKnobs.clear();
      if (this.wantPlay) bridge.play();
    };
  }

  /** Mount the embed into `container` (hidden unless `visible`) and start following the source. */
  mount(container: HTMLElement, patch: string, visible: boolean): void {
    this.map = mapFor(patch);
    this.bridge.createIframe(container, visible, patch);
    if (!this.timer) this.timer = setInterval(() => this.tick(), KNOB_EVERY_MS);
    if (!this.fallback) this.fallback = setInterval(() => this.fallbackBar(), FALLBACK_BAR_MS);
  }

  setPatch(patch: string): void {
    this.map = mapFor(patch);
    this.bridge.loadPatch(patch);
  }

  get status(): DriverStatus {
    const sig = this.source.signals();
    const pt = this.pulseTimes;
    const pulseHz = pt.length >= 2 ? (pt.length - 1) / Math.max(0.001, pt[pt.length - 1] - pt[0]) : 0;
    return {
      patch: this.bridge.patch,
      audio: this.bridge.status,
      bar: this.bar,
      mode: sig ? modeOf(sig) : "-",
      clocked: this.clocked,
      pulseHz,
      lastKnobs: this.lastKnobs.size,
    };
  }

  get plan(): BarPlan | null {
    return this.lastPlan;
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

  /** umwelt's way when the patch has no ClockOut: a sequence every bar on the wall clock. */
  private fallbackBar(): void {
    if (this.clocked || !this.bridge.isPlaying) return;
    this.sendBar(this.bar + 1);
  }

  private sendBar(bar: number): void {
    if (!this.bridge.loaded) return;
    const plan = this.source.planFor(bar);
    if (!plan) return;
    this.bar = bar;
    this.lastPlan = plan;
    const seq = planToSequences(plan, this.source.layer?.() ?? "harmony");
    const send = (id: keyof typeof seq) => this.bridge.setSequence(id, seq[id].pitches, seq[id].gates);
    for (const id of ["parliament", "harmony", "pad", "bass", "texture", "line", "me", "n1", "n2", "n3", "traces"] as const) send(id);
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
    if (!should || !this.bridge.loaded) return;
    const sig = this.source.signals();
    if (!sig) return;
    const params = knobParams(this.map, { sig, mode: modeOf(sig), plan: this.lastPlan, master: this.source.master(), barSec: this.source.barSec() }, this.lastKnobs);
    this.bridge.setParams(params);
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

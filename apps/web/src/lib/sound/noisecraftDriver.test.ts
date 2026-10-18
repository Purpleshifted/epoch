import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoiseCraftBridge, NoiseCraftParam } from "./NoiseCraftBridge";
import { NoiseCraftDriver } from "./noisecraftDriver";
import { IDLE_SOURCES, KNOB_MAPS } from "./noisecraftKnobs";
import { CLOCK_KNOB, PULSES_PER_BAR } from "./noisecraftMap";
import type { BarPlan } from "./sequencer";

/** A bridge that only records what the driver does. */
function fakeBridge() {
  const b = {
    loaded: true,
    status: "ready",
    isPlaying: false,
    patch: "nc_noise_patch.ncft",
    onClockPulse: undefined as ((node: string, t: number) => void) | undefined,
    onProjectLoaded: undefined as (() => void) | undefined,
    played: 0,
    stopped: 0,
    params: [] as NoiseCraftParam[][],
    seqs: [] as { id: string; pitches: unknown[] }[],
    createIframe() {},
    play() {
      this.played++;
      this.isPlaying = true;
    },
    stop() {
      this.stopped++;
      this.isPlaying = false;
    },
    setParams(p: NoiseCraftParam[]) {
      this.params.push(p);
    },
    setSequence(id: string, pitches: unknown[]) {
      this.seqs.push({ id, pitches });
    },
  };
  return b as typeof b & NoiseCraftBridge;
}

const aPlan = (bar: number): BarPlan =>
  ({ bar, chord: { band: 0, degree: 0, classes: [0, 4, 7], rootClass: 0 }, lock: 0, density: 1, answer: false, me: [], others: [], bass: [], pad: { pitches: [], level: 0 }, arrival: null }) as BarPlan;

describe("the driver: the music clock goes in, the phase comes out", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends the clock once per change, plays and stops with the source, and never any other parameter", () => {
    const b = fakeBridge();
    let barSec = 2;
    let running = false;
    const d = new NoiseCraftDriver({ planFor: aPlan, running: () => running, barSec: () => barSec }, b);
    d.mount({} as HTMLElement, b.patch, false);
    vi.advanceTimersByTime(300);
    expect(b.played).toBe(0);
    expect(b.params).toHaveLength(0); // not running: nothing sent yet
    running = true;
    vi.advanceTimersByTime(300);
    expect(b.played).toBe(1);
    expect(b.params).toHaveLength(1);
    expect(b.params[0].map((p) => p.nodeId)).toEqual([CLOCK_KNOB.nodeId]);
    expect(b.params[0][0].value).toBeCloseTo(48);
    vi.advanceTimersByTime(1000);
    expect(b.params).toHaveLength(1); // unchanged: not sent again
    barSec = 1.84;
    vi.advanceTimersByTime(300);
    expect(b.params).toHaveLength(2);
    expect(b.params[1][0].value).toBeCloseTo(96 / 1.84, 2);
    running = false;
    vi.advanceTimersByTime(300);
    expect(b.stopped).toBe(1);
    d.dispose();
  });

  it("counts the patch's pulses: bar 0 on the first, the next bar's sequences on the last pulse of a bar, the phase to the engine", () => {
    const b = fakeBridge();
    const bars: [number, number][] = [];
    const d = new NoiseCraftDriver({ planFor: aPlan, running: () => true, barSec: () => 2, onBar: (bar, wall) => bars.push([bar, wall]) }, b);
    d.mount({} as HTMLElement, b.patch, false);
    const t0 = Date.now();
    for (let i = 0; i < PULSES_PER_BAR; i++) b.onClockPulse!("", i / 48);
    expect(d.status.clocked).toBe(true);
    expect(d.status.pulseHz).toBeCloseTo(48, 0);
    expect(bars.map(([bar]) => bar)).toEqual([0, 1]);
    expect(bars[1][1] - t0).toBeGreaterThan(15); // one pulse on (≈ 20.8 ms at 48 Hz)
    const sent = b.seqs.map((s) => s.id);
    expect(sent.filter((id) => id === "parliament")).toHaveLength(2); // bar 0 and bar 1
    expect(new Set(sent)).toEqual(new Set(["parliament", "harmony", "bass", "texture", "line", "traces"]));
    expect(d.status.bar).toBe(1);
    d.dispose();
  });

  it("moves the real-time knobs only when the source offers them: gliding toward the targets, within the ranges, back to the rests when stopped", () => {
    const b = fakeBridge();
    let running = true;
    let company = 0;
    const d = new NoiseCraftDriver(
      { planFor: aPlan, running: () => running, barSec: () => 2, knobSources: () => ({ ...IDLE_SOURCES, company }), knobDepth: () => 1 },
      b,
    );
    d.mount({} as HTMLElement, b.patch, false);
    vi.advanceTimersByTime(1100);
    // idle sources: the clock only, the knobs sit at their rests
    expect(b.params.flat().every((p) => p.nodeId === CLOCK_KNOB.nodeId)).toBe(true);
    expect(d.status.knobs).toBe(0);
    company = 1;
    vi.advanceTimersByTime(250 * 30);
    const colour = KNOB_MAPS.find((m) => m.nodeId === "40")!;
    const sent = b.params.flat().filter((p) => p.nodeId === "40").map((p) => p.value as number);
    expect(sent.length).toBeGreaterThan(3); // it glided, not jumped
    for (let i = 1; i < sent.length; i++) expect(sent[i] - sent[i - 1]).toBeLessThanOrEqual((colour.slew ?? 0.04) * (colour.max - colour.min) + 1e-6);
    expect(sent[sent.length - 1]).toBeCloseTo(colour.hi, 3);
    expect(sent.every((v) => v >= colour.min && v <= colour.max)).toBe(true);
    expect(d.status.knobs).toBe(1);
    // stopped: back to the rest, then silence
    running = false;
    vi.advanceTimersByTime(250 * 30);
    expect(d.knobs.current("40")).toBeCloseTo(colour.rest, 3);
    const n = b.params.length;
    vi.advanceTimersByTime(2000);
    expect(b.params.length).toBe(n);
    d.dispose();
  });
});

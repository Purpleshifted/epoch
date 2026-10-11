import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTimeRate, timeRate, worldNow } from "./worldClock";

describe("world clock: a shared time rate, never jumping", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is the wall clock at rate 1, runs faster after, and stays continuous when the rate changes", () => {
    vi.advanceTimersByTime(1000); // past the read cache
    expect(timeRate()).toBe(1);
    expect(worldNow()).toBe(Date.now());
    const t0 = worldNow();
    setTimeRate(10);
    expect(worldNow()).toBe(t0);
    vi.advanceTimersByTime(1000);
    expect(worldNow()).toBe(t0 + 10_000);
    setTimeRate(1);
    vi.advanceTimersByTime(1000);
    expect(worldNow()).toBe(t0 + 11_000); // the 10 s gained stay; real time again
  });
});

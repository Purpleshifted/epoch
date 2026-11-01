import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdThenLate } from "./holdThenLate";

describe("holdThenLate", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());
  const after = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

  it("resolves with the value when the work is in time, and never calls onLate", async () => {
    const onLate = vi.fn();
    const p = holdThenLate(after(1000, ["a"]), 4000, [], onLate);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(onLate).not.toHaveBeenCalled();
  });

  it("resolves with the fallback at the limit, then hands the late value to onLate", async () => {
    const onLate = vi.fn();
    const p = holdThenLate(after(9000, ["a"]), 4000, [], onLate);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(p).resolves.toEqual([]);
    expect(onLate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onLate).toHaveBeenCalledWith(["a"]);
  });

  it("treats a failure in time as the fallback, and a late failure as nothing", async () => {
    const onLate = vi.fn();
    await expect(holdThenLate(Promise.reject(new Error("offline")), 4000, [], onLate)).resolves.toEqual([]);
    const slowFail = new Promise<string[]>((_, rej) => setTimeout(() => rej(new Error("slow")), 9000));
    const p = holdThenLate(slowFail, 4000, [], onLate);
    await vi.advanceTimersByTimeAsync(9000);
    await expect(p).resolves.toEqual([]);
    expect(onLate).not.toHaveBeenCalled();
  });
});

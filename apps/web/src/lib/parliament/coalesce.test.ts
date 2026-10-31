import { describe, expect, it } from "vitest";
import { mergeComputeRequests, type SpaceRequest } from "./spaceModel";

type Compute = Extract<SpaceRequest, { type: "compute" }>;

/**
 * The worker coalesces compute requests that queued up behind a long compute (2026-10-31: a heavy world's 45 s
 * compute piled up a request every tick and the model's present fell hours behind the clock).
 */
describe("compute requests coalesce", () => {
  const nature = { x: 1 } as unknown as Compute["nature"];
  const fuse = { y: 2 } as unknown as Compute["fuse"];
  it("keeps the newest clock and the work a dropped request asked for", () => {
    const a: Compute = { type: "compute", id: 1, now: 100, nature, fuse };
    const b: Compute = { type: "compute", id: 2, now: 160 };
    const m = mergeComputeRequests(a, b);
    expect(m.id).toBe(2);
    expect(m.now).toBe(160);
    expect(m.nature).toBe(nature);
    expect(m.fuse).toBe(fuse);
  });
  it("the newest request's own work wins", () => {
    const a: Compute = { type: "compute", id: 1, now: 100, fuse };
    const fuse2 = { y: 3 } as unknown as Compute["fuse"];
    const b: Compute = { type: "compute", id: 2, now: 160, fuse: fuse2 };
    expect(mergeComputeRequests(a, b).fuse).toBe(fuse2);
    expect(mergeComputeRequests(null, b)).toBe(b);
  });
});

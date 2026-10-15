import { describe, expect, it } from "vitest";
import { DEFAULT_DESK, exportDesk, mergeDesk, parseDeskFile } from "./desk";

describe("the desk: every sound control in one live state", () => {
  it("merges a partial or old desk over the defaults, dropping what does not fit", () => {
    const d = mergeDesk({ headset: { master: 0.3, instrument: "webaudio", bogus: 1, barSec: "2" }, on: false, overrides: { "183": 0.5, "70": "x" }, speakers: { hall: 0.2 } });
    expect(d.headset.master).toBe(0.3);
    expect(d.headset.instrument).toBe("webaudio");
    expect(d.headset.barSec).toBe(DEFAULT_DESK.headset.barSec);
    expect("bogus" in d.headset).toBe(false);
    expect(d.on).toBe(false);
    expect(d.overrides).toEqual({ "183": 0.5 });
    expect(d.speakers.hall).toBe(0.2);
    expect(d.speakers.master).toBe(DEFAULT_DESK.speakers.master);
    expect(mergeDesk(null)).toBe(DEFAULT_DESK);
    expect(mergeDesk("junk")).toBe(DEFAULT_DESK);
  });

  it("a desk file round-trips, and a bare desk object loads too", () => {
    const d = mergeDesk({ headset: { melDelayMs: 55 }, ncPatch: "Feedback_Synth.ncft", overrides: { "70": 0.2 } });
    const back = parseDeskFile(exportDesk(d));
    expect(back?.headset.melDelayMs).toBe(55);
    expect(back?.ncPatch).toBe("Feedback_Synth.ncft");
    expect(back?.overrides).toEqual({ "70": 0.2 });
    expect(parseDeskFile(JSON.stringify({ headset: { master: 0.1 } }))?.headset.master).toBe(0.1);
    expect(parseDeskFile("not json")).toBeNull();
  });
});

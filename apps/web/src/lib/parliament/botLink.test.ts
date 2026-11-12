import { describe, expect, it } from "vitest";
import { blockSlots, parseBotLink } from "./index";

describe("botLink: one link that opens a wall with its herds running", () => {
  it("bots=on&herds=8&block=45&rate=4", () => {
    expect(parseBotLink("?bots=on&herds=8&block=45&rate=4")).toEqual({ values: { botOn: true, hCount: 8, hDepth: 45 }, rate: 4 });
  });
  it("the old names of the ways of living switch the herds on; off switches them off", () => {
    for (const m of ["herd", "session", "resident"]) expect(parseBotLink(`bots=${m}`).values.botOn).toBe(true);
    expect(parseBotLink("bots=off").values).toEqual({ botOn: false });
  });
  it("every knob, clamped to the Leva ranges", () => {
    const { values } = parseBotLink("herds=40&loners=3&size=6-4&life=3~1&follow=2&loose=0.4&spread=1.5&drift=5&gap=30&radius=3&block=90");
    expect(values).toEqual({ hCount: 12, hLoners: 3, hSizeMin: 4, hSizeMax: 6, hLifeMin: 1, hLifeMax: 3, hFollow: 1, hLoose: 0.4, hSpread: 1.5, hDrift: 0.9, hGap: 30, hRadius: 3, hDepth: 60 });
  });
  it("bad or missing values are ignored", () => {
    expect(parseBotLink("bots=maybe&herds=&size=x&rate=abc")).toEqual({ values: {}, rate: undefined });
    expect(parseBotLink("")).toEqual({ values: {}, rate: undefined });
  });
  it("block: the slots the wall stops freezing part shapes for", () => {
    expect(blockSlots("?block=45")).toBe(45);
    expect(blockSlots("?bots=on")).toBe(0);
  });
});

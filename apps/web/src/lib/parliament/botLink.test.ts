import { describe, expect, it } from "vitest";
import { parseBotLink } from "./botLink";

describe("botLink: one link opens a wall with its bots running", () => {
  it("bots=session&max=24&rate=4", () => {
    expect(parseBotLink("?bots=session&max=24&rate=4")).toEqual({ values: { botOn: true, botMode: "session", lcMax: 24 }, rate: 4 });
  });

  it("resident: max is the number of bots (1–30)", () => {
    expect(parseBotLink("bots=resident&max=50").values).toEqual({ botOn: true, botMode: "resident", botCount: 30 });
  });

  it("off switches them off", () => {
    expect(parseBotLink("bots=off").values).toEqual({ botOn: false });
  });

  it("every session knob, clamped to the Leva ranges", () => {
    const { values } = parseBotLink("gap=8&quiet=0.5&wave=20&life=3-1&bands=10-30-60&follow=0.9&revisit=0.1&origin=1&group=0&spread=3&auto=0");
    expect(values).toEqual({
      lcGapSec: 8,
      lcQuiet: 0.5,
      lcWaveMin: 20,
      lcLifeMin: 1,
      lcLifeMax: 3,
      lcShort: 10,
      lcMiddle: 30,
      lcLong: 60,
      lcFollow: 0.9,
      lcRevisit: 0.1,
      lcOrigin: 1,
      lcGroup: 0,
      lcSpread: 2,
      lcAuto: false,
    });
  });

  it("life and bands take - ~ or , between the numbers", () => {
    expect(parseBotLink("life=1~2.5").values).toMatchObject({ lcLifeMin: 1, lcLifeMax: 2.5 });
    expect(parseBotLink("bands=20,40,40").values).toMatchObject({ lcShort: 20, lcMiddle: 40, lcLong: 40 });
  });

  it("bad or missing values are ignored", () => {
    expect(parseBotLink("bots=maybe&max=abc&life=2&bands=1-2&rate=&auto=yes")).toEqual({ values: {}, rate: undefined });
    expect(parseBotLink("")).toEqual({ values: {}, rate: undefined });
  });
});

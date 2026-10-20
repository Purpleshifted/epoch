import { describe, expect, it } from "vitest";
import { MODES, chordName } from "./harmony";
import { bestKey, commonTone, fifthsDistance, homeKey, keyDistance, keyName, zoneChord, zoneOf } from "./tonality";

const key = (root: number, modeName: string) => ({ root, mode: MODES.find((m) => m.name === modeName)!, degrees: [0] });

describe("tonality: the distance between keys", () => {
  it("relative keys are close, the dominant's key a little further, the parallel minor far, the tritone farthest", () => {
    expect(fifthsDistance(0, 7)).toBe(1);
    expect(fifthsDistance(0, 6)).toBe(6);
    expect(keyDistance(key(0, "Ionian"), key(0, "Ionian"))).toBe(0);
    expect(keyDistance(key(0, "Ionian"), key(9, "Aeolian"))).toBeCloseTo(1.0);
    expect(keyDistance(key(0, "Ionian"), key(7, "Ionian"))).toBeCloseTo(1.25);
    expect(keyDistance(key(0, "Ionian"), key(0, "Aeolian"))).toBeCloseTo(3.25);
    expect(keyDistance(key(0, "Ionian"), key(6, "Ionian"))).toBeGreaterThan(5);
  });

  it("a home key is the same for the same id and differs between ids", () => {
    expect(keyName(homeKey("v_abc"))).toBe(keyName(homeKey("v_abc")));
    const names = new Set(["a", "b", "c", "d", "e", "f"].map((id) => keyName(homeKey(id))));
    expect(names.size).toBeGreaterThan(2);
  });
});

describe("tonality: a building's key from its contributors", () => {
  it("one builder: their home key; three of the same home: that key; nobody: null", () => {
    const h = homeKey("bot1");
    expect(keyName(bestKey([{ o: "bot1", amount: 10 }])!)).toBe(keyName(h));
    expect(bestKey([])).toBeNull();
    expect(bestKey([{ o: "x", amount: 0 }])).toBeNull();
  });

  it("the heavier builder pulls the key; the result is never farther from everyone than their own homes", () => {
    const who = [
      { o: "p", amount: 15 },
      { o: "q", amount: 2 },
    ];
    const k = bestKey(who)!;
    const hp = homeKey("p"), hq = homeKey("q");
    const cost = (c: typeof k) => (15 * keyDistance(c, hp) + 2 * keyDistance(c, hq)) / 17;
    expect(cost(k)).toBeLessThanOrEqual(cost(hp) + 1e-9);
    expect(cost(k)).toBeLessThanOrEqual(cost(hq) + 1e-9);
  });

  it("hysteresis: the current key stays unless another is clearly better", () => {
    const who = [{ o: "p", amount: 10 }];
    const home = homeKey("p");
    const near = key(home.root, home.mode.name === "Ionian" ? "Mixolydian" : "Ionian"); // a neighbour (one note apart)
    expect(keyName(bestKey(who, near, 0.15)!)).toBe(keyName(home)); // 0.5+ away: it moves
    const nearer = { ...home };
    expect(bestKey(who, nearer, 0.15)).toBe(nearer); // the same key: kept (same object)
    const far = key((home.root + 6) % 12, home.mode.name);
    expect(keyName(bestKey(who, far, 0.15)!)).toBe(keyName(home));
    expect(bestKey(who, near, 10)).toBe(near); // a huge margin keeps anything
  });

  it("the zone's chords: tonic inside, dominant in the ring", () => {
    const k = key(2, "Ionian"); // D major
    expect(chordName(k, zoneChord(k, "in"))).toBe("Dmaj7");
    expect(chordName(k, zoneChord(k, "ring"))).toBe("A7");
    expect(zoneOf(3, 8, 4)).toBe("in");
    expect(zoneOf(10, 8, 4)).toBe("ring");
    expect(zoneOf(13, 8, 4)).toBeNull();
  });

  it("a common tone between two keys lies in both scales, the tonic of the second if it can", () => {
    expect(commonTone(key(0, "Ionian"), key(7, "Ionian"))).toBe(7);
    expect(commonTone(key(0, "Ionian"), key(9, "Aeolian"))).toBe(9);
    const c = commonTone(key(0, "Ionian"), key(1, "Ionian"));
    expect(c === null || [0, 2, 4, 5, 7, 9, 11].includes(c)).toBe(true);
  });
});

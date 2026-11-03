import { afterEach, describe, expect, it, vi } from "vitest";
import { HEARD_MS, MarkerListener, MarkerSender, RelaySocket, markText, openMarkerListener, openMarkerSender, parseHead, parseMark } from "./markerRelay";

class FakeSocket {
  readyState = 0;
  bufferedAmount = 0;
  sent: string[] = [];
  closed = false;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
  }
  say(text: string) {
    this.onmessage?.({ data: text });
  }
  die() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const setup = () => {
  const made: FakeSocket[] = [];
  const make = () => {
    const s = new FakeSocket();
    made.push(s);
    return s as unknown as WebSocket;
  };
  const clock = { now: 1000 };
  return { made, make, clock, read: () => clock.now };
};

const EPOCH = 5000;
const place = { o: "v_abc12", x: 1, z: 2, s: 3, y: 0.5, e: EPOCH };
const mark = { ...place, t: 900, r: 80 };

describe("what goes over the relay", () => {
  it("a place comes back as it was sent, rounded", () => {
    expect(parseMark(markText({ o: "v_abc12", x: 1.23456, z: -2.5, s: 100.123, y: 3.14159, e: EPOCH, t: 900.4, r: 79.6 }))).toEqual({ o: "v_abc12", x: 1.23, z: -2.5, s: 100.1, y: 3.14, e: EPOCH, t: 900, r: 80 });
  });

  it("only what could be a visitor's place is believed", () => {
    expect(parseMark("not json")).toBeNull();
    expect(parseMark("null")).toBeNull();
    expect(parseMark(JSON.stringify({ ...mark, o: "bot3" }))).toBeNull();
    expect(parseMark(JSON.stringify({ ...mark, x: "1" }))).toBeNull();
    expect(parseMark(JSON.stringify({ o: "v_abc12", x: 1, z: 2 }))).toBeNull();
    expect(parseMark(new ArrayBuffer(8))).toBeNull();
  });

  it("stays inside the relay's limit at its longest", () => {
    const text = markText({ o: "v_abcdefghijkl", x: -79.99, z: -79.99, s: 123456.7, y: -3.14, e: 1_800_000_000_000, t: 1_800_000_000_000, r: 12345 });
    expect(text.length).toBeLessThan(200);
    expect(parseMark(text)).not.toBeNull();
  });
});

describe("the socket", () => {
  it("retries later and later while it fails, and from the start once the relay has answered", () => {
    const { made, make, clock, read } = setup();
    const socket = new RelaySocket("wss://x", () => {}, make, read);
    socket.poke();
    expect(made.length).toBe(1);
    made[0].die();
    socket.poke();
    expect(made.length).toBe(1);
    clock.now += 1000;
    socket.poke();
    expect(made.length).toBe(2);
    made[1].die();
    clock.now += 1000;
    socket.poke();
    expect(made.length).toBe(2);
    clock.now += 1000;
    socket.poke();
    expect(made.length).toBe(3);
    made[2].open();
    socket.poke();
    expect(made[2].sent).toEqual(["ping"]);
    clock.now += 40;
    made[2].say("pong");
    expect(socket.rttMs).toBe(40);
    made[2].die();
    clock.now += 1000;
    socket.poke();
    expect(made.length).toBe(4);
  });

  it("lets go of a socket that no longer answers", () => {
    const { made, make, clock, read } = setup();
    const socket = new RelaySocket("wss://x", () => {}, make, read);
    socket.poke();
    made[0].open();
    clock.now += 16_000;
    socket.poke();
    expect(made[0].closed).toBe(true);
    socket.poke();
    expect(made.length).toBe(2);
  });

  it("stays closed once closed", () => {
    const { made, make, clock, read } = setup();
    const socket = new RelaySocket("wss://x", () => {}, make, read);
    socket.poke();
    socket.close();
    clock.now += 100_000;
    socket.poke();
    expect(made.length).toBe(1);
    expect(made[0].closed).toBe(true);
  });
});

describe("the visitor's side", () => {
  const places = (s: FakeSocket) => s.sent.filter((t) => t !== "ping");

  it("sends a walk as it goes, and standing still once a second", () => {
    const { made, make, clock, read } = setup();
    const sender = new MarkerSender(new RelaySocket("wss://x", () => {}, make, read), read, () => 900);
    sender.tick(place);
    made[0].open();
    made[0].say("pong");
    sender.tick(place);
    expect(places(made[0]).length).toBe(1);
    clock.now += 250;
    sender.tick({ ...place, x: 1.5 });
    expect(places(made[0]).length).toBe(2);
    // the first tick standing still says so at once
    clock.now += 250;
    sender.tick({ ...place, x: 1.5 });
    expect(places(made[0]).length).toBe(3);
    clock.now += 250;
    sender.tick({ ...place, x: 1.5 });
    expect(places(made[0]).length).toBe(3);
    clock.now += 750;
    sender.tick({ ...place, x: 1.5 });
    expect(places(made[0]).length).toBe(4);
  });

  it("a seed head goes at once and reaches the wall once, under its id in the record", () => {
    const { made, make, read } = setup();
    const sender = new MarkerSender(new RelaySocket("wss://x", () => {}, make, read), read, () => 900);
    sender.tick(place);
    made[0].open();
    const e = { id: "v_abc12:t4x:7", o: "v_abc12", r: "tree" as const, k: "s" as const, x: 1.234, z: 5, s: 60.126 };
    sender.head(e, EPOCH);
    const text = made[0].sent[made[0].sent.length - 1];
    expect(parseHead(text)).toEqual({ event: { ...e, x: 1.23, s: 60.13 }, epoch: EPOCH });
    expect(parseMark(text)).toBeNull();

    const wall = setup();
    const listener = new MarkerListener("wss://x", wall.make, wall.read, () => String(EPOCH), () => 1000);
    listener.drain();
    wall.made[0].open();
    wall.made[0].say(text);
    expect(listener.drain()).toEqual([]);
    expect(listener.drainHeads()).toEqual([{ ...e, x: 1.23, s: 60.13 }]);
    expect(listener.drainHeads()).toEqual([]);
  });

  it("a seed head is believed only if it could be a visitor's, in this epoch", () => {
    const line = { h: "v_abc12:t4x:7", o: "v_abc12", x: 1, z: 2, s: 3, e: EPOCH };
    expect(parseHead(JSON.stringify(line))).not.toBeNull();
    expect(parseHead(JSON.stringify({ ...line, h: "bot3:t4x:7", o: "bot3" }))).toBeNull();
    expect(parseHead(JSON.stringify({ ...line, o: "v_other" }))).toBeNull();
    expect(parseHead(JSON.stringify({ ...line, x: "1" }))).toBeNull();
    expect(parseHead(markText(mark))).toBeNull();
    const { made, make, read } = setup();
    const listener = new MarkerListener("wss://x", make, read, () => String(EPOCH + 1), () => 1000);
    listener.drain();
    made[0].open();
    made[0].say(JSON.stringify(line));
    expect(listener.drainHeads()).toEqual([]);
  });

  it("turning on the spot is news too, and the place says when it left and how far the relay is", () => {
    const { made, make, clock, read } = setup();
    const socket = new RelaySocket("wss://x", () => {}, make, read);
    const sender = new MarkerSender(socket, read, () => 900);
    sender.tick(place);
    made[0].open();
    sender.tick(place);
    expect(parseMark(places(made[0])[0])?.r).toBe(-1);
    clock.now += 40;
    made[0].say("pong");
    clock.now += 210;
    sender.tick({ ...place, y: 1 });
    const second = parseMark(places(made[0])[1]);
    expect(second).toMatchObject({ y: 1, t: 900, r: 40 });
  });

  it("drops a place rather than queueing it behind a slow network", () => {
    const { made, make, clock, read } = setup();
    const sender = new MarkerSender(new RelaySocket("wss://x", () => {}, make, read), read, () => 900);
    sender.tick(place);
    made[0].open();
    made[0].bufferedAmount = 5000;
    clock.now += 250;
    sender.tick({ ...place, x: 9 });
    expect(places(made[0]).length).toBe(0);
  });
});

describe("the wall's side", () => {
  it("hands over each place once, and hears someone until they have been silent for a while", () => {
    const { made, make, clock, read } = setup();
    const listener = new MarkerListener("wss://x", make, read, () => String(EPOCH), () => 1000);
    listener.drain();
    made[0].open();
    made[0].say(markText(mark));
    made[0].say("rubbish");
    expect(listener.drain()).toEqual([mark]);
    expect(listener.drain()).toEqual([]);
    expect([...listener.live().keys()]).toEqual([mark.o]);
    clock.now += HEARD_MS + 1;
    expect(listener.live().size).toBe(0);
  });

  it("does not believe another epoch's places: the old world's time would hold the marker up there", () => {
    const { made, make, read } = setup();
    let epoch = String(EPOCH);
    const listener = new MarkerListener("wss://x", make, read, () => epoch, () => 1000);
    listener.drain();
    made[0].open();
    epoch = String(EPOCH + 1);
    made[0].say(markText({ ...mark, s: 9000 }));
    expect(listener.drain()).toEqual([]);
    expect(listener.live().size).toBe(0);
    made[0].say(markText({ ...mark, s: 1, e: EPOCH + 1 }));
    expect(listener.drain()).toEqual([{ ...mark, s: 1, e: EPOCH + 1 }]);
  });

  it("a tab that was not drawing gets only each visitor's newest place", () => {
    const { made, make, read } = setup();
    const listener = new MarkerListener("wss://x", make, read, () => String(EPOCH), () => 1000);
    listener.drain();
    made[0].open();
    for (let i = 0; i < 1000; i++) made[0].say(markText({ ...mark, x: i }));
    made[0].say(markText({ ...mark, o: "v_other", x: 7 }));
    expect(listener.drain().map((m) => [m.o, m.x])).toEqual([
      ["v_abc12", 999],
      ["v_other", 7],
    ]);
  });

  it("reports the way a phone's place took, by the clocks and by the round trips", () => {
    const { made, make, read } = setup();
    const listener = new MarkerListener("wss://x", make, read, () => String(EPOCH), () => 1000);
    listener.drain();
    made[0].open();
    for (let i = 1; i <= 100; i++) made[0].say(markText({ ...mark, s: i, t: 1000 - i, r: i === 100 ? 42 : -1 }));
    expect(listener.status()).toMatchObject({ count: 100, delayP50: 51, delayP95: 96, senderRttMs: 42 });
    listener.clearDelays();
    expect(listener.status().count).toBe(0);
  });
});

describe("switched off", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("no address: no socket, whatever the world", () => {
    vi.stubEnv("NEXT_PUBLIC_MARKER_RELAY", "");
    expect(openMarkerSender()).toBeNull();
    expect(openMarkerListener()).toBeNull();
  });
});

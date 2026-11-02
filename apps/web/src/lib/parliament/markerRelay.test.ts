import { afterEach, describe, expect, it, vi } from "vitest";
import { HEARD_MS, MarkerListener, MarkerSender, RelaySocket, markText, openMarkerListener, openMarkerSender, parseMark } from "./markerRelay";

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

const mark = { o: "v_abc12", x: 1, z: 2, s: 3 };

describe("what goes over the relay", () => {
  it("a place comes back as it was sent, rounded", () => {
    expect(parseMark(markText({ o: "v_abc12", x: 1.23456, z: -2.5, s: 100.123 }))).toEqual({ o: "v_abc12", x: 1.23, z: -2.5, s: 100.1 });
  });

  it("only what could be a visitor's place is believed", () => {
    expect(parseMark("not json")).toBeNull();
    expect(parseMark("null")).toBeNull();
    expect(parseMark(JSON.stringify({ ...mark, o: "bot3" }))).toBeNull();
    expect(parseMark(JSON.stringify({ ...mark, x: "1" }))).toBeNull();
    expect(parseMark(JSON.stringify({ o: "v_abc12", x: 1, z: 2 }))).toBeNull();
    expect(parseMark(new ArrayBuffer(8))).toBeNull();
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
    const sender = new MarkerSender(new RelaySocket("wss://x", () => {}, make, read), read);
    sender.tick(mark);
    made[0].open();
    made[0].say("pong");
    sender.tick(mark);
    expect(places(made[0]).length).toBe(1);
    clock.now += 250;
    sender.tick({ ...mark, x: 1.5 });
    expect(places(made[0]).length).toBe(2);
    clock.now += 250;
    sender.tick({ ...mark, x: 1.5 });
    clock.now += 250;
    sender.tick({ ...mark, x: 1.5 });
    expect(places(made[0]).length).toBe(2);
    clock.now += 500;
    sender.tick({ ...mark, x: 1.5 });
    expect(places(made[0]).length).toBe(3);
  });

  it("drops a place rather than queueing it behind a slow network", () => {
    const { made, make, clock, read } = setup();
    const sender = new MarkerSender(new RelaySocket("wss://x", () => {}, make, read), read);
    sender.tick(mark);
    made[0].open();
    made[0].bufferedAmount = 5000;
    clock.now += 250;
    sender.tick({ ...mark, x: 9 });
    expect(places(made[0]).length).toBe(0);
  });
});

describe("the wall's side", () => {
  it("hands over each place once, and hears someone until they have been silent for a while", () => {
    const { made, make, clock, read } = setup();
    const listener = new MarkerListener("wss://x", make, read);
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
});

describe("switched off", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("no address: no socket, whatever the world", () => {
    vi.stubEnv("NEXT_PUBLIC_MARKER_RELAY", "");
    expect(openMarkerSender()).toBeNull();
    expect(openMarkerListener()).toBeNull();
  });
});

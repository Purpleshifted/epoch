/**
 * sessionLog.ts — a visitor's session as one row on the server, to read the exhibition afterwards (lib/world/analytics.ts).
 * It speaks when the phase changes and never waits for an answer: nothing here touches the session, the frames or the
 * sound, and a line that does not arrive is only a line missing from the record.
 */
import type { SessionLine } from "@/lib/world/analytics";
import type { EndedBy } from "./intake";
import type { SessionPhase } from "./session";
import { serverWorldName, touchDevice } from "./serverWorld";

export interface SessionNow {
  no: number;
  phase: SessionPhase;
  o: string | null;
  lifeSec: number;
  livedSec: number;
  /** The attempts that failed. */
  failed: number;
  endedBy: EndedBy | null;
}

type Page = Pick<SessionLine, "world" | "device" | "lang" | "page">;

const randomId = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join("");

export class SessionLog {
  private id: string | null = null;
  private no = -1;
  private said = "";
  private live: SessionLine | null = null;

  constructor(
    private readonly page: Page,
    private readonly send: (line: SessionLine) => void,
    private readonly newId: () => string = randomId,
  ) {}

  /** Whatever about the session has changed. A row begins with the first gesture; a visitor who wandered off is done with it. */
  update(n: SessionNow): void {
    if (n.no < 1) return; // the machine before it has been switched on
    if (n.phase === "idle") {
      this.id = null;
      this.live = null;
      return;
    }
    if (this.id === null || n.no !== this.no) {
      this.id = this.newId();
      this.no = n.no;
      this.said = "";
    }
    const line: SessionLine = {
      ...this.page,
      id: this.id,
      no: n.no,
      o: n.o,
      phase: n.phase,
      lifeSec: n.lifeSec,
      livedSec: n.livedSec,
      attempts: n.failed + (n.endedBy === "self" ? 1 : 0),
      endedBy: n.endedBy,
    };
    this.live = n.phase === "live" ? line : null;
    const said = `${n.phase}:${n.o}:${line.attempts}:${n.endedBy}`;
    if (said === this.said) return;
    this.said = said;
    this.send(line);
  }

  /** The page is going away during a life: its end will not come. */
  leave(livedSec: number): void {
    if (this.live) this.send({ ...this.live, livedSec, endedBy: "left" });
  }
}

function post(line: SessionLine): void {
  try {
    const body = JSON.stringify(line);
    if (navigator.sendBeacon?.("/api/analytics", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/analytics", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
  } catch {
    // the record is never worth a visitor's session
  }
}

/** Null outside the shared world: then nothing is sent. */
export function openSessionLog(lang: "ko" | "en"): SessionLog | null {
  const world = serverWorldName();
  if (!world) return null;
  return new SessionLog({ world, device: touchDevice() ? "phone" : "desktop", lang, page: new URLSearchParams(window.location.search).get("ui") === "0" }, post);
}

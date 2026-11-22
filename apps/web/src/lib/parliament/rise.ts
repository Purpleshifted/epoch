/**
 * parliament/rise.ts
 *
 * THE COLUMN'S RISE CAN BE STOPPED (the artist, 2026-11-17: "기둥이 천천히 올라가는 속도를 일단... 끄고, 미래 층을
 * 고정시켜"). The window of the block rises with the clock (HerdConfig.shift × the seconds gone by). Setting that
 * speed to 0 is another thing altogether — the fixed block of 11/12, with its own way of eroding and fusing — so the
 * rise is STOPPED instead: the seconds the rise is counted by stand still while it is stopped, and go on from where
 * they stood when it is let go again. The window's top stays where it is; the bots go on being born into the
 * window and building in it; nothing leaves at its foot.
 *
 * WHAT STANDS IN THE WINDOW GOES ON AGEING (the same day: "3020 에서 화석이 걍 안 생기고 있음"). Every age in the
 * rising window was read off the top's way, so at first all of it stood with the rise — nothing built after the stop
 * was ever simplified, eroded, overgrown or fossilised. Now the ages go by the top's way PLUS the way it would have
 * gone while stopped (erode.ts `stood`, from `elapsed − riseSeconds(elapsed)`); only the DEPTH stays read off the top
 * where it really is.
 *
 * One state for the page: the bots' hook keeps it (useGlobalBots: its knob, and this browser's storage), the seating
 * of bots and the window's top read it.
 */

export const risePause: { at: number | null; lost: number; epoch: number } = { at: null, lost: 0, epoch: 0 };

export const LS_RISE = "parliament.riseStop";

/** The seconds the rise is counted by, of `elapsed` seconds gone by. */
export function riseSeconds(elapsed: number): number {
  return Math.max(0, (risePause.at !== null ? Math.min(risePause.at, elapsed) : elapsed) - risePause.lost);
}

/**
 * Where the window's foot is (`bottom`, seconds of the axis) and how fast a life rises against it (`still`: 1 − shift
 * while the window rises, 1 while it is stopped).
 */
export function riseOf(shift: number | undefined, elapsed: number): { bottom: number; still: number } {
  const s = Math.max(0, Math.min(1, shift ?? 0));
  return { bottom: s * riseSeconds(elapsed), still: risePause.at !== null ? 1 : 1 - s };
}

/**
 * Keeps the state in step with the knob (called with the clock, once the world's epoch is known): taken from this
 * browser's storage when the page comes back to the same world, begun anew for another world, and written whenever
 * the rise is stopped or let go. `persist` false (the lab): this page's state only.
 */
export function syncRisePause(stop: boolean, elapsed: number, epoch: number, persist = true): void {
  if (!epoch) return;
  let changed = false;
  if (risePause.epoch !== epoch) {
    let at: number | null = null, lost = 0;
    if (persist) try {
      const raw = JSON.parse((typeof localStorage !== "undefined" && localStorage.getItem(LS_RISE)) || "null") as { at: number | null; lost: number; epoch: number } | null;
      if (raw && raw.epoch === epoch && Number.isFinite(raw.lost)) [at, lost] = [typeof raw.at === "number" ? raw.at : null, raw.lost];
    } catch {
      // (no storage: the rise begins as the knob says)
    }
    Object.assign(risePause, { at, lost, epoch });
  }
  if (stop && risePause.at === null) {
    risePause.at = elapsed;
    changed = true;
  } else if (!stop && risePause.at !== null) {
    risePause.lost += Math.max(0, elapsed - risePause.at);
    risePause.at = null;
    changed = true;
  }
  // (a lab's world is its tab's only: it neither reads nor writes the one entry the wall keeps — it used to replace it,
  // and the wall then came back with its foot moved by all the seconds its rise had stood)
  if (changed && persist) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(LS_RISE, JSON.stringify(risePause));
    } catch {
      // (not kept: the stop holds for this page)
    }
  }
}

/** The block as a view that does not step the bots is told it (the bot server's hello: the herd's window, the rise). */
export interface BlockFrame {
  /** HerdConfig.shift: how fast the window's foot rises with the clock. */
  shift: number;
  /** HerdConfig.depthSec: the window's height (0 = no block: the old time slots). */
  depthSec: number;
  /** The rise's stop as the server keeps it (riseState), null = never stopped. */
  rise: { at: number | null; lost: number } | null;
}

/**
 * WHERE A VISITOR STANDS IN THE BLOCK'S TIME (2026-11-22: the personal view stood at "seconds since the epoch", hours
 * above the block the bots live in, and saw none of them): the offset that seats a life of `lifeSec` seconds the way
 * a loner bot is seated (lifecycle.ts seatLoner) — `rand` of the way up the window, low enough that the life ends
 * under its top. `gone` = the world's seconds since the epoch. Null when there is no block (the old time slots).
 * Pure: the rise's stop is the frame's, not this page's (risePause).
 */
export function blockSeatOffset(f: BlockFrame, gone: number, lifeSec: number, rand: number): number | null {
  const depth = Math.max(0, f.depthSec);
  if (!(depth > 0)) return null;
  const shift = Math.max(0, Math.min(1, f.shift));
  const stopped = f.rise?.at !== null && f.rise?.at !== undefined;
  const counted = Math.max(0, (stopped ? Math.min(f.rise!.at!, gone) : gone) - (f.rise?.lost ?? 0));
  const bottom = shift * counted;
  const still = stopped ? 1 : 1 - shift;
  return rand * Math.max(0, depth - still * Math.max(0, lifeSec)) - (gone - bottom);
}

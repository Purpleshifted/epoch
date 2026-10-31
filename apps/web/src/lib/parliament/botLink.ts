/**
 * parliament/botLink.ts — one link that opens a wall with its bots already running (docs/bot-lifecycle.md §10):
 *
 *   /rehearsal/global?bots=session&max=24&rate=4
 *
 * The query is read once when the wall opens and written into the Leva group "봇 (글로벌에서 돌리기)" (and the time
 * axis for `rate`), as if turned by hand: the panel shows them, nothing is saved until "save" is pressed.
 *
 *   bots     session | resident | off      on, in that way (off: switched off)
 *   max      N                              session: the most at once · resident: the number of bots
 *   gap      seconds                        session: mean gap between arrivals when busy
 *   quiet    0–1                            session: the quiet trough as a share of the busy rate
 *   wave     minutes                        session: one busy ↔ quiet swing
 *   life     a-b (minutes)                  session: shortest and longest life, e.g. 1-3
 *   bands    s-m-l                          session: shares of the short / middle / long lives, e.g. 20-40-40
 *   follow · revisit · origin · group · spread · leave    session: the propensities, as in Leva
 *   auto     0 | 1                          session: lower the most-at-once with the frame rate
 *   rate     number                         the world clock (×); in the lab this tab only, on a shared wall until
 *                                           the tab is closed (then ×1 again — a link must not leave the
 *                                           exhibition running fast)
 *
 * Pure: a query string in, the Leva values out (keys of useGlobalBots' group). Unknown or bad values are ignored.
 */

export interface BotLink {
  /** Leva keys of the group "봇 (글로벌에서 돌리기)" → value. */
  values: Record<string, number | boolean | string>;
  /** The world clock's rate, if asked. */
  rate?: number;
}

const num = (raw: string | null, lo: number, hi: number): number | undefined => {
  if (raw === null || raw.trim() === "") return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined;
};

/** "1-3", "1~3", "1,3" → [1, 3]. */
const pair = (raw: string | null): [number, number] | undefined => {
  if (!raw) return undefined;
  const p = raw.split(/[-~,_ ]+/).map(Number);
  return p.length === 2 && p.every(Number.isFinite) ? [p[0], p[1]] : undefined;
};

export function parseBotLink(search: string): BotLink {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const values: Record<string, number | boolean | string> = {};
  const set = (k: string, v: number | boolean | string | undefined) => {
    if (v !== undefined) values[k] = v;
  };
  const bots = q.get("bots");
  if (bots === "session" || bots === "resident") {
    values.botOn = true;
    values.botMode = bots;
  } else if (bots === "off") values.botOn = false;
  const max = num(q.get("max"), 0, 60);
  if (max !== undefined) {
    if (bots === "resident") set("botCount", Math.max(1, Math.min(30, Math.round(max))));
    else set("lcMax", Math.round(max));
  }
  set("lcGapSec", num(q.get("gap"), 3, 120));
  set("lcQuiet", num(q.get("quiet"), 0, 1));
  set("lcWaveMin", num(q.get("wave"), 1, 120));
  const life = pair(q.get("life"));
  if (life) {
    set("lcLifeMin", Math.max(0.25, Math.min(10, Math.min(life[0], life[1]))));
    set("lcLifeMax", Math.max(0.25, Math.min(10, Math.max(life[0], life[1]))));
  }
  const bands = q.get("bands")?.split(/[-~,_ ]+/).map(Number);
  if (bands && bands.length === 3 && bands.every((b) => Number.isFinite(b) && b >= 0)) {
    set("lcShort", Math.min(100, bands[0]));
    set("lcMiddle", Math.min(100, bands[1]));
    set("lcLong", Math.min(100, bands[2]));
  }
  set("lcFollow", num(q.get("follow"), 0, 1));
  set("lcRevisit", num(q.get("revisit"), 0, 1));
  set("lcOrigin", num(q.get("origin"), 0, 1));
  set("lcGroup", num(q.get("group"), 0, 1));
  set("lcSpread", num(q.get("spread"), 0, 2));
  set("lcLeave", num(q.get("leave"), 0, 1));
  const auto = q.get("auto");
  if (auto === "0" || auto === "1") values.lcAuto = auto === "1";
  return { values, rate: num(q.get("rate"), 0, 40) };
}

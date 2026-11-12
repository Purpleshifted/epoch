/**
 * parliament/botLink.ts — one link that opens a wall with its bots already running (docs/bot-lifecycle.md §10):
 *
 *   /rehearsal/global?bots=on&herds=8&block=45&rate=4
 *
 * The query is read once when the wall opens and written into the Leva group "봇 (글로벌에서 돌리기)" (and the time
 * axis for `rate`), as if turned by hand: the panel shows them, nothing is saved until "save" is pressed.
 *
 *   bots     on | off                        the herds, switched on or off (herd · session · resident also mean on)
 *   herds    N                               living herds at once
 *   loners   N                               bots that go about alone
 *   size     a-b                             members of a herd, e.g. 4-6
 *   life     a-b (minutes)                   shortest and longest life, e.g. 1-3
 *   block    N (slots)                       the depth of the block the herds are seated in (0 = at the present)
 *   gap · radius                             3D distance between herds · 3D radius of a herd (world units)
 *   follow · loose · spread · drift          how they move, as in Leva
 *   rate     number                          the world clock (×); in the lab this tab only, on a shared wall until
 *                                            the tab is closed (then ×1 again — a link must not leave the
 *                                            exhibition running fast)
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

/** `?block=N`: the bots live down to N slots below the present and the wall freezes no part's shape (0 = off). */
export function blockSlots(search: string): number {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return Math.round(num(q.get("block"), 0, 60) ?? 0);
}

export function parseBotLink(search: string): BotLink {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const values: Record<string, number | boolean | string> = {};
  const set = (k: string, v: number | boolean | string | undefined) => {
    if (v !== undefined) values[k] = v;
  };
  const bots = q.get("bots");
  // (herd · session · resident are the old names of the ways of living: all of them switch the herds on)
  if (bots === "on" || bots === "herd" || bots === "session" || bots === "resident") values.botOn = true;
  else if (bots === "off") values.botOn = false;
  const herds = num(q.get("herds"), 0, 12);
  if (herds !== undefined) set("hCount", Math.round(herds));
  const loners = num(q.get("loners"), 0, 12);
  if (loners !== undefined) set("hLoners", Math.round(loners));
  const size = pair(q.get("size"));
  if (size) {
    set("hSizeMin", Math.max(1, Math.min(12, Math.round(Math.min(size[0], size[1])))));
    set("hSizeMax", Math.max(1, Math.min(12, Math.round(Math.max(size[0], size[1])))));
  }
  const life = pair(q.get("life"));
  if (life) {
    set("hLifeMin", Math.max(0.25, Math.min(10, Math.min(life[0], life[1]))));
    set("hLifeMax", Math.max(0.25, Math.min(10, Math.max(life[0], life[1]))));
  }
  set("hFollow", num(q.get("follow"), 0, 1));
  set("hLoose", num(q.get("loose"), 0, 1));
  set("hSpread", num(q.get("spread"), 0, 2));
  set("hDrift", num(q.get("drift"), 0, 0.9));
  set("hGap", num(q.get("gap"), 0, 120));
  set("hRadius", num(q.get("radius"), 0, 20));
  // THE BLOCK: block=45 = the herds are seated down to 45 slots (20 s each) below the present
  if (q.get("block") !== null && q.get("block")!.trim() !== "") set("hDepth", blockSlots(search));
  return { values, rate: num(q.get("rate"), 0, 40) };
}

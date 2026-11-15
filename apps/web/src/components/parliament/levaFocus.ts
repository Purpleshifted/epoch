/**
 * THE PANEL SHOWS ONLY WHAT IS BEING WORKED ON (the artist, 2026-11-15: "지금 레바가 너무 혼잡해서 판단이 좀 어려운데,
 * 이전에 초반 작업하던 것처럼 레바 수정/도입하는 것마다 하나씩 들고오는 식으로 진행하자. 일단 지금 한 것만 레바 남겨줘").
 *
 * ONLY THE GROUPS NAMED BELOW ARE CUT DOWN — every other group of the panel is listed whole, as it was (the artist,
 * a moment later, when the first version hid them all: "아니 다른 레바도 다 숨기면 어떡하냐"). It is the fusion's
 * folder that had grown past judging (some ninety knobs of several generations).
 *
 * Every knob is still declared where it belongs and still applies — its value, its saving, its place in its group are
 * untouched. Only what the panel LISTS of such a group is cut down: Leva asks its store which inputs are visible
 * (`getVisiblePaths`), and here that answer is filtered to LEVA_FOCUS (no schema is changed anywhere). A knob is
 * BROUGHT IN by adding its key to its group's list below, one at a time, when it is introduced or reworked. The
 * group's own `이 폴더의 손잡이 전부 보기` lists all of it again.
 */

import { levaStore } from "leva";

/** The key of the checkbox, in a group that is cut down, that lists all of the group again. */
export const FOCUS_ALL_KEY = "allKnobs";

/**
 * What the panel lists now: group (the top-level folder) → the keys of its knobs under review (a key is the last
 * part of an input's path, whatever folder of the group it sits in). `__save` is a group's save / reload row.
 */
export const LEVA_FOCUS: Record<string, readonly string[]> = {
  // the switch; where the mass grows (on what has been simplified / on every part) and how much the vegetation makes
  // it (2026-11-16: "융합!!!!! 일단 해보자"); what it is made of (the parts' own skins / the crust); what is fused
  // together (a building / a chunk × tile)
  // …and where on the progress the mass begins: the erosion is over by then (2026-11-16)
  // …how the fossil appears (its shape made once, swelling out of its part / made again with the progress), and the
  // progress it begins and is whole at
  "엉김 · 융합 · 레진": ["fuseOn", "fuseGrow", "fuseOnset", "fuseFull", "fuseFrom", "massVeg", "fuseBody", "fuseUnit", FOCUS_ALL_KEY, "__save"],
};

let installed = false;
let active = false;

/**
 * DEV ONLY: the panel's values as they stand in this tab go to a file on this machine (app/api/dev-leva) — once the
 * view is up, and again whenever they have changed — so what the artist has on the screen can be taken as it is and
 * tried elsewhere, saved or not. A tab is told from another by a tag kept for the tab's life.
 */
let posting = false;
function postLive(): void {
  if (posting || typeof window === "undefined" || process.env.NODE_ENV !== "development") return;
  posting = true;
  const w = window as unknown as { __levaTag?: string };
  const tag = (w.__levaTag ??= `tab-${Date.now().toString(36)}`);
  let sent = "";
  const send = () => {
    const data = levaStore.getData() as Record<string, { value?: unknown } | undefined>;
    const values: Record<string, unknown> = {};
    for (const [path, input] of Object.entries(data)) {
      const v = input?.value;
      if (v !== undefined && typeof v !== "function") values[path] = v;
    }
    const body = JSON.stringify({ tag, page: window.location.pathname + window.location.search, ua: navigator.userAgent, values });
    if (body === sent || Object.keys(values).length < 5) return;
    sent = body;
    void fetch("/api/dev-leva", { method: "POST", headers: { "content-type": "application/json" }, body }).catch(() => undefined);
  };
  window.setTimeout(send, 2500);
  window.setInterval(send, 10000);
}

/** Whether a path is listed: every path of a group that is not cut down; of one that is, the knobs under review —
 *  or all of it, with its checkbox on. */
function listed(path: string, data: Record<string, { value?: unknown } | undefined>): boolean {
  for (const group in LEVA_FOCUS) {
    if (!path.startsWith(`${group}.`)) continue;
    if (data[`${group}.${FOCUS_ALL_KEY}`]?.value) return true;
    return LEVA_FOCUS[group].includes(path.slice(path.lastIndexOf(".") + 1));
  }
  return true;
}

/**
 * Turns the focus on or off for this page (the redesign's wall: on). Called while the view renders — before the panel
 * mounts and asks the store for the first time.
 */
export function setLevaFocus(on: boolean): void {
  active = on;
  postLive();
  if (installed || !on) return;
  installed = true;
  const all = levaStore.getVisiblePaths.bind(levaStore);
  levaStore.getVisiblePaths = () => {
    const paths = all();
    if (!active) return paths;
    // (the checkbox is read from the store's data, not `get`: that warns for a path that is not there yet)
    const data = levaStore.getData() as Record<string, { value?: unknown } | undefined>;
    return paths.filter((q) => listed(q, data));
  };
}

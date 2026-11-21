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
import { futureOnly } from "@/lib/parliament/futureOnly";

/** The folders the view of the layer above alone lists: the layer's own and what is left under its ground. */
const FUTURE_GROUPS = ["미래 마을 층"] as const;
/** The layer's knobs that no longer fit what it is (growth at the edge, "not yet" opacity) or are superseded (the
 *  plants' colours: grass, scrub and trees have their own in 미래 마을 층 — 땅 아래). They still hold their values. */
const LAYER_RETIRED = new Set(["edge", "gain", "opacity", "vegColorA", "vegColorB"]);
/** The pit and its light: not drawn in the view of the layer alone. */
const LAYER_NO_PIT = new Set(["pit", "pitAbove", "beamGlow", "beamFall", "beamTaper", "beamSoft", "beamDeep", "pitDepth", "pitWide", "pitShaft", "pitLight", "pitDark", "pitWall", "pitFall", "pitBands"]);

/**
 * WHAT DOES NOTHING IS NOT LISTED (the artist, 2026-11-20: "안 듣는 손잡이 잡아서 숨겨"). With the new fossil — its shape
 * made once, as it will be when all of it has fused (화석이 나타나는 방식 = 새 방식) — every layer's look is the oldest
 * layer's, and the knobs that only say WHEN along a part's progress something happens, or what a YOUNG layer looks
 * like, are read by nothing: how full the mass is at which progress, what an eroded part
 * leaves, when the skeleton is swallowed, from which age a layer is fossil and how its edge wanders, the young
 * layers' steps and thin shell. They keep their values and come back with the old way; `전부 보기` does not list them
 * either — it lists what can be turned.
 */
const FUSION_GROUP = "엉김 · 융합 · 레진";
/**
 * …AND THE SWITCH BETWEEN THE TWO WAYS ITSELF IS NOT LISTED (the artist, 2026-11-20: "'화석이 나타나는 방식' 이건 뭐..
 * 뭘 관리하는 거야???"). It chose how the mass is made — its shape once, let out by its age on the screen (the new
 * way), or made again whenever a part's progress moved (the old) — and everything since 11/16 is built on the first:
 * the age, the life, the units, the pieces. Nothing is to be chosen there any more; the value stays as saved.
 */
const FUSION_UNLISTED = new Set(["fuseGrow"]);
// (…and, until 2026-11-21, the ways' switch: only the pipes' trunks entered the new fossil — spaceModel.ts seededTubes)
// GONE THROUGH AGAIN, KNOB BY KNOB, AGAINST THE CODE (the artist, 2026-11-20: "화석에서 안 헷갈리게 더이상 안 쓰는 방식은
// 레바에서 그때그때 좀 없애줘") — and to be gone through each time the way changes:
//  · scatter: it breaks up thin YOUNG mass — × (1 − the layer's age), and the seeded mass is made at age 1: × 0
//  · steelFossil: the steel that fuses went in as tubes of the old way's field (tubesOf) — the seeded field takes the
//    pipes' trunks only, and no steel part is in a unit
//  · fuseFade: the cross-fade of the ONE mesh the model's worker made; the pieces of the worker beside are replaced
//    each on its own, and come out of their parts instead
// (layerSlots WAS WRONGLY HERE, from earlier the same day: nothing of the fossil reads it any more, but the BUILDINGS' erosion
// does — spaceModel `old`: the progress of a part's place is multiplied by it. Listed again, its label saying so.)
// (2026-11-21, "길도 넣어": the ways' main lines are in the new fossil — its switch is listed again, with which ways and
// how thick a bone. The drawn way's own radius stays out: the bone has its own, wayThick.)
// (2026-11-21, the fossil as a volume — "e 진행해보자": it is moved through its keyframes, not pressed into its unit, thinned
// along its normal or eaten at its edge — growPress, growThin, growSeal, growSealGrain are read by nothing)
const SEED_DEAD = new Set(["growPress", "growThin", "growSeal", "growSealGrain", "fuseFull", "goneMass", "skeletonUntil", "fossilFrom", "fossilTo", "fossilNoise", "blocky", "shellSplit", "shellThickYoung", "fuseUnit", "unitChange", "walkRadius", "scatter", "steelFossil", "fuseFade"]);
/**
 * …AND THE CHOICES THAT LEAD BACK TO THE OLD WAY: what the mass is made of (the parts' own skins / the crust) and where
 * it grows (on what has been simplified / on every part). The new fossil is the first of each — the crust or "every
 * part" makes the mass the old way again (spaceModel computeFuse: seeded = … assetsOnly && !crust). While a choice
 * holds the new way's value it is not listed; should it hold the other, it is — so it can be turned back.
 */
const OLD_WAY_CHOICE: Record<string, string> = { fuseBody: "wrap", fuseFrom: "assets" };

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
  // …and how coarse the fossil's grid may be against the simplification's lattice (2026-11-16: "일단 1-3 진행해봐")
  // (2026-11-16, the artist: "아직도 레바에 부재별 감싸기/구역 옵션이 있는 게 의아해서" — the seeded mass is one field
  // over the whole ground, the exhibition's way: what it is made of and what is fused together are not choices of
  // it any more, and are no longer listed. They stand under `이 폴더의 손잡이 전부 보기` for the old way of making it.)
  // …and the foam's walls and the parts' traces inside it (2026-11-16: "거품벽에도 두께가 좀 있고, 안에 부재 흔적이")
  // (2026-11-20: the fossil's one ruler is its age — the depth's four knobs and the two mixes are gone; the depth's
  // part is one knob, growDeep, and how much each part is sooner or later, layerSpread, is listed with it)
  // …and the frame first, the plates and rooms after (2026-11-17, "A2"): the wait and the rise, and the frame they wait
  // behind — ③'s tubes (꼴, their thickness, their share by size, how much the old layers embed them again)
  // …and the pipes' trunks in the mass (2026-11-20: "배관 본줄기부터"): the switch, which runs are trunks, how thick
  // (fuseBody · fuseFrom: listed only while they hold the old way's value — OLD_WAY_CHOICE)
  "엉김 · 융합 · 레진": ["fusePipes", "trunkShare", "trunkThick", "fuseWalks", "wayShare", "wayThick", "fusePreset", "fuseOn", "fuseGrow", "fuseBody", "fuseFrom", "voxelTie", "pieceTile", "pieceSeg", "massVeg", "iso", "growAgeMin", "growDeep", "layerSpread", "growMelt", "growReach", "growLate", "growRise", "growDie", "growDieAfterMin", "growDieSpanMin", "growDieHoles", "growDieGrain", "growDieRag", "growDiePatch", "massMode", "meltPick", "meltFrame", "meltLump", "meltSteer", "pipeRadius", "pipeSmall", "pipeLarge", "pipeFossil", "skeleton", "skeletonWrap", "shell", "foam", "ribCell", "ribWidth", "ribOpen", "holeVoronoiSmall", "holeVoronoiLarge", "boneMass", "bonePores", "bonePoreSize", "boneFill", "boneWrap", "boneRim", "boneWarm", "boneSee", "boneSeeParts", FOCUS_ALL_KEY, "__save"],
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
  // (what went wrong in the page, as it happened: the last few)
  const errors: string[] = [];
  window.addEventListener("error", (e) => errors.push(`${e.message} @ ${(e.filename ?? "").split("/").pop()}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => errors.push(`rejected: ${String((e as PromiseRejectionEvent).reason).slice(0, 200)}`));
  const send = () => {
    const data = levaStore.getData() as Record<string, { value?: unknown } | undefined>;
    const values: Record<string, unknown> = {};
    for (const [path, input] of Object.entries(data)) {
      const v = input?.value;
      if (v !== undefined && typeof v !== "function") values[path] = v;
    }
    // (the wall's readout as it stands on the screen — the lines from the counts down to the legend)
    const text = document.body.innerText, a = text.indexOf("seeds "), b = text.indexOf("x, z = ground");
    const readout = a < 0 ? "" : text.slice(a, b > a ? b : a + 1500);
    const body = JSON.stringify({ tag, page: window.location.pathname + window.location.search, ua: navigator.userAgent, values, readout, errors: errors.slice(-8) });
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
  // THE LAYER ABOVE ALONE (/rehearsal/future, lib/parliament/futureOnly.ts; the artist, 2026-11-17: "관련없는 레바는
  // 다 빼고"): only that layer's folders are listed — every other knob keeps its value and still applies
  // (knobs of the layer's own folder that no longer fit it — the growth rules, the plants' old colours, now each kind
  // of plant's own — and, in the view of the layer alone, the pit it does not draw: the artist, 2026-11-17: "지금 수정
  // 현황이랑 안 맞는 레버 혹은 미래 뷰에서 쓸 일 없는 레바 뭔지 파악해서 빼고")
  if (path.startsWith("미래 마을 층.")) {
    const leaf = path.slice(path.lastIndexOf(".") + 1);
    if (LAYER_RETIRED.has(leaf) || (futureOnly() && LAYER_NO_PIT.has(leaf))) return false;
  }
  // (…and the world's 지우고 다시 생성하기 — the artist: "미래에도 다시 생성하기는 있어야 할 것 같음"; it tells the bot
  // server to begin a new world, and every view follows)
  // (…and the render options: "프덕에도 미래뷰 렌더옵션이랑 스크린캡처 버튼 넣고", 2026-11-18)
  // (…and the hero shot, HeroShot.tsx: "렌더샷이.. 사라짐...?", 2026-11-18 — it was listed in the whole view only)
  if (futureOnly())
    return (
      FUTURE_GROUPS.some((g) => path.startsWith(g)) ||
      path === "세계" ||
      path === "세계.지우고 다시 생성하기" ||
      path === "렌더" ||
      path.startsWith("렌더.") ||
      path === "히어로샷" ||
      path.startsWith("히어로샷.")
    );
  if (path.startsWith(`${FUSION_GROUP}.`)) {
    const leaf = path.slice(path.lastIndexOf(".") + 1);
    if (FUSION_UNLISTED.has(leaf)) return false;
    if (leaf in OLD_WAY_CHOICE && data[path]?.value === OLD_WAY_CHOICE[leaf]) return false;
    // (the new way: the shape made once, of the parts' own skins — on what has been simplified OR, since 11/20, on every
    // part with its cell-slot's clock: "every part" no longer leads back to the old way, spaceModel computeFuse `seeded`)
    const seedWay = data[`${FUSION_GROUP}.fuseGrow`]?.value === "seed" && data[`${FUSION_GROUP}.fuseBody`]?.value !== "crust";
    if (seedWay && SEED_DEAD.has(leaf)) return false;
  }
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

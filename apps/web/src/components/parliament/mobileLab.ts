/**
 * THE MOBILE VIEW LAB (the artist, 2026-11-23): the personal view's assets, one page each — scan (future), scan
 * (present), bot (present), bot (future) — where their colour, effects and animation are tuned with the references
 * beside them; an action preview that runs the whole personal view on those values like a rehearsal; and the
 * rehearsal's / exhibition's personal view (/v2/mobile) reading the same values with none of these knobs shown.
 *
 * ONE SET OF VALUES, EVERYWHERE: each asset's Leva group is stored under the fixed page `/lab/mobile`
 * (`parliament.leva:/lab/mobile:<group>` — levaSave.ts pinLevaGroup), whatever page shows or reads it, and every
 * personal page pulls that page's saves from the server before Leva mounts (ServerPresetsGate). The server is the
 * redesign production's database; a dev server or a branch preview without one hands those keys on to it
 * (app/api/presets) — the artist: "걍 db 로 바로바로 연동되게 해 어디서든".
 *
 * Which groups a page lists: an asset page its own group and the shared ground (바탕); every other page none of
 * them (their values still apply). `?knobs=all` lists everything, for a look behind the curtain.
 */

import { pinLevaGroup } from "./levaSave";

export const MOBILE_LAB_PAGE = "/lab/mobile";

export type LabAsset = "scan-future" | "scan-present" | "bot-present" | "bot-future";
export type LabPage = LabAsset | "preview";

export const LAB_ASSETS: readonly LabAsset[] = ["scan-future", "scan-present", "bot-present", "bot-future"];

/** The Leva groups — names are storage keys: never rename one without a `legacy` entry in its savable(). */
export const LAB_GROUP: Record<LabAsset | "base", string> = {
  base: "바탕 · 종이와 노출",
  "bot-present": "bot (present) · 현재의 사람",
  "scan-present": "scan (present) · 현재의 장소",
  "scan-future": "scan (future) · 미래의 장소",
  "bot-future": "bot (future) · 미래 발굴자",
};

for (const g of Object.values(LAB_GROUP)) pinLevaGroup(g, MOBILE_LAB_PAGE);

export interface LabAssetInfo {
  /** The button's label (the artist's words) and a line under it. */
  name: string;
  sub: string;
  /** What the page's test scene needs on its address (added when missing). */
  query: Record<string, string>;
  /** The reference stills shown beside it (visual_reference_images/mobile_view_refs/, local only). */
  refs: readonly string[];
}

export const LAB_INFO: Record<LabPage, LabAssetInfo> = {
  "scan-future": {
    name: "scan (future)",
    sub: "미래의 장소 — 겹침, 흰 바탕 위 가느다란 선",
    query: { botserver: "0" },
    refs: ["IMG_1586.JPG", "IMG_1587.JPG", "IMG_1589.JPG", "IMG_1597.JPG", "IMG_1599.JPG"],
  },
  "scan-present": {
    name: "scan (present)",
    sub: "현재의 장소 — 종이 · 노출 · 땅 · 식생 · 건물 · 시야",
    query: { botserver: "0" },
    refs: ["IMG_1580.JPG", "IMG_1564.JPG", "e207eca7-08ad-4098-bcc6-2c25a20085a1.png", "1f5354d5e0c9e3d75709fb5656ad24a84451e20a.jpeg", "3Dpc.jpg"],
  },
  "bot-present": {
    name: "bot (present)",
    sub: "현재의 사람 — 몸 · 걸음 · 장노출 · 말 걸기",
    query: { botserver: "0", crowd: "24" },
    refs: ["IMG_1575.JPG", "IMG_1576.JPG", "IMG_1580.JPG", "IMG_1582.JPG", "IMG_9954.JPG", "images (1).jpeg"],
  },
  "bot-future": {
    name: "bot (future)",
    sub: "미래 발굴자 — 몸 모양의 창 · 남는 창 · 가까우면 화면을 채움",
    query: { botserver: "0", futurefix: "1" },
    refs: ["EDEFE77C-4594-4869-B8C2-AEA9C9F0706D.GIF", "IMG_1575.JPG", "IMG_1401 2.JPG", "IMG_1585.JPG"],
  },
  preview: {
    name: "action preview",
    sub: "위 네 값으로 개인뷰 전체를 리허설처럼",
    query: {},
    refs: [],
  },
};

/** The lab page open in this tab (set by the page before Leva mounts; null = not a lab page). */
let labPage: LabPage | null = null;
export function setMobileLab(page: LabPage | null): void {
  labPage = page;
}
export function mobileLab(): LabPage | null {
  return labPage;
}

function knobsAll(): boolean {
  try {
    return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("knobs") === "all";
  } catch {
    return false;
  }
}

/** Whether this page lists the asset group `asset` ("base" = the shared ground). */
export function labLists(asset: LabAsset | "base"): boolean {
  if (knobsAll()) return true;
  if (!labPage || labPage === "preview") return false;
  return asset === "base" || asset === labPage;
}

/** Whether this page lists the personal view's other detail knobs (the old folders): only behind ?knobs=all. */
export function detailKnobsListed(): boolean {
  return knobsAll();
}

/**
 * AN ASSET PAGE LISTS ITS OWN KNOBS ONLY (the artist, 2026-11-23: each button opens the asset's colour, effects and
 * animation): the panel's paths are cut to the asset's group and the shared ground while a lab asset page is open —
 * every other group keeps its values and still applies. Installed once, on the first lab page (a filter over
 * levaStore.getVisiblePaths, as levaFocus.ts does on the wall).
 */
let filterOn = false;
export function installLabPanelFilter(store: { getVisiblePaths: () => string[] }): void {
  if (filterOn) return;
  filterOn = true;
  const all = store.getVisiblePaths.bind(store);
  store.getVisiblePaths = () => {
    const paths = all();
    if (!labPage || labPage === "preview" || knobsAll()) return paths;
    const mine = [LAB_GROUP.base, LAB_GROUP[labPage]];
    return paths.filter((q) => mine.some((g) => q === g || q.startsWith(`${g}.`)));
  };
}

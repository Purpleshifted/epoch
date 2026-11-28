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
/** "frames": a study of its own (FrameLab.tsx — how a person's frames are laid out, nothing else on the page). */
export type LabPage = LabAsset | "preview" | "frames";

export const LAB_ASSETS: readonly LabAsset[] = ["scan-future", "scan-present", "bot-present", "bot-future"];

/** The Leva groups — names are storage keys: never rename one without a `legacy` entry in its savable(). */
export const LAB_GROUP: Record<LabAsset | "base" | "frames", string> = {
  frames: "frames · 사람 프레임 배치",
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
    sub: "미래의 장소 — 라이다가 읽은 자리에 남는 잔류 (늘 · F 누를 때 · 관찰자가 지나갈 때)",
    // (?futurepass=1: one observer that comes, stands, walks off and is gone, every 32 s — read only in the residue's
    // "관찰자가 지나갈 때만" way, FutureResidue.tsx)
    query: { botserver: "0", futurepass: "1" },
    refs: ["3Dpc.jpg", "interaction_blob.jpeg", "IMG_1589.JPG", "IMG_1597.JPG", "IMG_1601.JPG"],
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
    // (the body-shaped windows retired 2026-11-28: the page of the invisible observers — where they are, how many, how
    // they walk; their crossing shows as the scan residue)
    sub: "보이지 않는 미래 관찰자 — 지금 어디 있는지 · 수 · 도는 반경 · 걸음",
    query: { botserver: "0" },
    refs: ["EDEFE77C-4594-4869-B8C2-AEA9C9F0706D.GIF", "IMG_1575.JPG", "IMG_1401 2.JPG", "IMG_1585.JPG"],
  },
  frames: {
    name: "frames",
    sub: "사람 프레임 배치 — 흰 공간에 사람 프레임만, 옆·뒤·앞에서 보며",
    query: {},
    refs: ["IMG_1575.JPG", "IMG_1580.JPG", "IMG_1573.JPG", "IMG_1401 2.JPG"],
  },
  preview: {
    name: "action preview",
    sub: "위 네 값으로 개인뷰 전체를 리허설처럼",
    // (the lab's test scene, as on the asset pages — the rehearsal's own bot world is empty; 전시 세계 = ?botserver=1&watch=1)
    query: { botserver: "0", crowd: "24", futurefix: "1" },
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

/**
 * THE REDESIGNED PERSONAL VIEW AS AN EXPERIMENT (the artist, 2026-11-27: "일단 지금버전 redesign 에 병합하되, 서버는
 * 공유되고 경험도 같은 세계에서 일어나지만 일단 모드 분리/비교를 위해서 rehearsal 밑에 experiment 추가해서 거기서 개편 개인뷰
 * 보이게"): the lab's look — the street (white paper, long exposure, the eye's camera, the pictograms) and the scan — is
 * drawn only on the lab's pages and on the experiment address (/rehearsal/experiment → /v2/mobile?experiment=1). The
 * exhibition's personal view keeps its black look beside it, in the same world on the same server, for comparing.
 * (Read per call — the address can change without a reload; the last one is kept, so a per-frame call costs nothing.)
 */
let expSearch = "\u0000";
let expOn = false;
function experimentAddress(): boolean {
  if (typeof window === "undefined") return false;
  const s = window.location.search;
  if (s !== expSearch) {
    expSearch = s;
    expOn = new URLSearchParams(s).get("experiment") === "1";
  }
  return expOn;
}
/** Whether this page draws the lab's look at all (any lab page, or the experiment address). */
export function newLook(): boolean {
  return labPage !== null || experimentAddress();
}
/** Whether this page runs every asset together, as saved (the action preview, or the experiment address). */
export function runsEveryAsset(): boolean {
  return labPage === "preview" || (labPage === null && experimentAddress());
}

function knobsAll(): boolean {
  try {
    return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("knobs") === "all";
  } catch {
    return false;
  }
}

/**
 * WHAT THE ACTION PREVIEW LISTS OF THE ASSETS (the artist, 2026-11-27: "액션 프리뷰에서 속도랑 눈높이 조절 후 저장 가능하게"):
 * the walking speed and the eye height of scan (present) › 눈, and that group's save row — saved into the same shared
 * values the asset page saves (one key, the server's), so the preview, the asset page and the personal view agree.
 * Leva paths: group › folder › key; `__save` is the group's save / reload / presets row (levaSave.ts savable).
 */
const PREVIEW_KNOBS: readonly string[] = [
  `${LAB_GROUP["scan-present"]}.눈.walkSpeed`,
  `${LAB_GROUP["scan-present"]}.눈.eyeHeight`,
  `${LAB_GROUP["scan-present"]}.__save`,
  // (and the frame's ceiling, 바탕 › 성능 · 상한 — the artist, 2026-11-27: "액션 프리뷰에서 랙이 심한데 프레임 리소스 상한 같은 거")
  `${LAB_GROUP.base}.성능 · 상한.maxDpr`,
  `${LAB_GROUP.base}.성능 · 상한.maxFps`,
  `${LAB_GROUP.base}.__save`,
];
/** The asset groups the preview lists at all (cut to PREVIEW_KNOBS by the panel filter). */
const PREVIEW_ASSETS: ReadonlySet<LabAsset | "base"> = new Set(["scan-present", "base"]);

/** Whether this page lists the asset group `asset` ("base" = the shared ground). */
export function labLists(asset: LabAsset | "base"): boolean {
  if (knobsAll()) return true;
  if (!labPage) return false;
  if (labPage === "preview") return PREVIEW_ASSETS.has(asset);
  return asset === "base" || asset === labPage;
}

/** Whether this page lists the personal view's other detail knobs (the old folders): only behind ?knobs=all. */
export function detailKnobsListed(): boolean {
  return knobsAll();
}

/**
 * AN ASSET PAGE LISTS ITS OWN KNOBS ONLY (the artist, 2026-11-23: each button opens the asset's colour, effects and
 * animation): the panel's paths are cut to the asset's group and the shared ground while a lab asset page is open —
 * every other group keeps its values and still applies. The action preview lists none of the asset groups but the few
 * knobs in PREVIEW_KNOBS (everything that is not an asset group — sound and the like — stays as it was). Installed
 * once, on the first lab page (a filter over levaStore.getVisiblePaths, as levaFocus.ts does on the wall).
 */
let filterOn = false;
export function installLabPanelFilter(store: { getVisiblePaths: () => string[] }): void {
  if (filterOn) return;
  filterOn = true;
  const all = store.getVisiblePaths.bind(store);
  const inGroup = (q: string, g: string) => q === g || q.startsWith(`${g}.`);
  store.getVisiblePaths = () => {
    const paths = all();
    if (!labPage || knobsAll()) return paths;
    if (labPage === "preview") {
      const groups = Object.values(LAB_GROUP);
      return paths.filter((q) => PREVIEW_KNOBS.includes(q) || !groups.some((g) => inGroup(q, g)));
    }
    const mine = [LAB_GROUP.base, LAB_GROUP[labPage]];
    return paths.filter((q) => mine.some((g) => inGroup(q, g)));
  };
}

/**
 * parliament/futureMeetRule.ts — THE PERSONAL VIEW'S CROSSING RULE, AS THE WALL READS IT (docs/me-future-link.md).
 *
 * The phone decides when the future looks at a visitor and when it finds them (FutureResidue.tsx, scan (future) —
 * 2026-11-28: "현재 위치랑 반경 내에서 겹침 -> 발견 / … 그보다 큰 반경 내에서 겹침 -> 응시"), with the walkers of bot (future)
 * (lib/parliament/excavators.ts). The wall's "나" thread swells at the same moments, so it reads THE SAME SAVED VALUES —
 * the mobile view lab's groups, stored under /lab/mobile (/api/presets; a preview or a dev server reads production's) —
 * rather than copies of the numbers. FALLBACK is used only until they come, or if they never do.
 *
 * No React; one fetch a minute at most.
 */

export interface FutureMeetRule {
  /** The phone's 미래가 보일 때: "observer" is the only one the wall can follow (it cannot see an F, and "always" never arrives). */
  showWhen: string;
  /** 관찰자가 있다고 보는 거리: within it the future FINDS me (the residue, the full daydream). */
  gateR: number;
  /** 응시 거리: within it (and not yet gateR) the future only LOOKS at me — words and a weak daydream, 4 s. */
  gazeR: number;
  /** 다시 찾아오기까지 최소 (s): no arrival within it of the last arrival, no gaze within it of the last gaze or arrival. */
  gap: number;
  /** 남는 시간 (s): what was found stays this long after the observer leaves. */
  life: number;
  /** bot (future)'s walkers: how many, the disc they walk, a leg's seconds. */
  count: number;
  roam: number;
  legSec: number;
}

/** The artist's saved values of 2026-11-28 (resGateR 4, resLife 10, excCount 6 …; gazeR and gap the code's 10 and 40). */
export const FALLBACK_RULE: FutureMeetRule = { showWhen: "observer", gateR: 4, gazeR: 10, gap: 40, life: 10, count: 6, roam: 44, legSec: 24 };

/** (the lab's groups, as mobileLab.ts LAB_GROUP names them — the keys their values are saved under) */
const PLACE_KEY = "parliament.leva:/lab/mobile:scan (future) · 미래의 장소";
const WALKERS_KEY = "parliament.leva:/lab/mobile:bot (future) · 미래 발굴자";

let rule: FutureMeetRule = { ...FALLBACK_RULE };
let askedAt = -Infinity;
let from: "fallback" | "saved" = "fallback";

const num = (o: Record<string, unknown> | null, k: string, d: number): number => {
  const v = o ? Number(o[k]) : NaN;
  return Number.isFinite(v) ? v : d;
};
const valuesOf = (p: unknown): Record<string, unknown> | null => {
  let j = p && typeof p === "object" ? (p as { json?: unknown }).json : null;
  if (typeof j === "string") {
    try {
      j = JSON.parse(j);
    } catch {
      j = null;
    }
  }
  return j && typeof j === "object" ? (j as Record<string, unknown>) : null;
};

async function ask(): Promise<void> {
  try {
    const r = await fetch("/api/presets?page=/lab/mobile", { cache: "no-store" });
    if (!r.ok) return;
    const { presets } = (await r.json()) as { presets?: Record<string, unknown> };
    const place = valuesOf(presets?.[PLACE_KEY]), walkers = valuesOf(presets?.[WALKERS_KEY]);
    if (!place && !walkers) return;
    const d = FALLBACK_RULE;
    rule = {
      showWhen: typeof place?.resShowWhen === "string" ? place.resShowWhen : d.showWhen,
      gateR: num(place, "resGateR", d.gateR),
      gazeR: num(place, "resGazeR", d.gazeR),
      gap: num(place, "resGap", d.gap),
      life: num(place, "resLife", d.life),
      count: num(walkers, "excCount", d.count),
      roam: num(walkers, "excRoam", d.roam),
      legSec: num(walkers, "excLegSec", d.legSec),
    };
    from = "saved";
  } catch {
    /* unreachable: the last values (or the fallback) stand */
  }
}

/** The rule now (asks the saved values again at most once a minute, in the background). */
export function futureMeetRule(): FutureMeetRule {
  if (typeof window !== "undefined") {
    const now = performance.now();
    if (now - askedAt > 60_000) {
      askedAt = now;
      void ask();
    }
  }
  return rule;
}

/** Where the rule came from (for a readout). */
export function futureMeetRuleFrom(): "fallback" | "saved" {
  return from;
}

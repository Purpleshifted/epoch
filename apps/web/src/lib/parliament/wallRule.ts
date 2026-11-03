/**
 * parliament/wallRule.ts — the building rule as the wall has it saved. A visitor in the shared world goes by it, so that
 * what the phone says is built is what the wall builds (the artist, 2026-11-03: until now the phone went by the code's
 * defaults, and on the exhibition's log 62 % of the cells it called a house were not on the wall). Only the reading
 * side is new: the wall and its saved values stay as they are.
 */

import { DEFAULT_FLOW, type FlowConfig } from "./flow";
import type { FoldConfig } from "./types";

/** The wall's own defaults for the worker rule (tuned on screen 2026-10-07), under what it has saved. */
export const SPACE_FOLD = { radius: 2.75, threshold: 40, pourUnit: 111, minVisitors: 4, visitorCap: 20, playerWeight: 3, maxHeight: 18, tauFootprintYears: 2000, emptyGapSec: 20 };
export const WALL_FOLD_GROUP = "생성 규칙 (회사원 시공간 밀집)";
export const WALL_FLOW_GROUP = "길 → 다리.① 땅: 밟힘 → 길 (V2 · 건물과 먼저 온 쪽이 자리)";

const FOLD_KEYS = ["radius", "windowSec", "threshold", "pourUnit", "minVisitors", "visitorCap", "playerWeight", "maxHeight", "tauSlabYears", "tauFootprintYears", "pathVisits", "tauPathYears"] as const;
/** The saved names of the path rules (useFoldControls), and what they are in the rule. */
const FLOW_KEYS: Record<string, keyof FlowConfig> = { stayRadius: "stayRadius", staySec: "staySec", moveShare: "moveShare", tauSec: "tauSec", flowUnit: "unit", blockAt: "blockAt", pull: "pull", gridShare: "gridShare" };

type Saved = Record<string, unknown> | null;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** `own` with everything the wall decides replaced: its defaults, then what it has saved. Nothing saved is the wall's defaults. */
export function followWallRule(own: FoldConfig, fold: Saved, flow: Saved): FoldConfig {
  const out: FoldConfig = { ...own, ...SPACE_FOLD };
  for (const k of FOLD_KEYS) {
    const v = fold?.[k];
    if (num(v)) out[k] = v;
  }
  if (flow?.flowOn === false) {
    out.flow = undefined;
    return out;
  }
  const paths: FlowConfig = { ...(own.flow ?? DEFAULT_FLOW), enabled: true };
  for (const [saved, key] of Object.entries(FLOW_KEYS)) {
    const v = flow?.[saved];
    if (num(v)) (paths[key] as number) = v;
  }
  out.flow = paths;
  return out;
}

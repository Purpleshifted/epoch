import type { AudioState, NoiseSlot } from "@/types/game";

export interface NoiseCraftParam {
  nodeId: string;
  paramName?: string;
  value: number;
}

export interface PersonalAudioMetrics {
  approachIntensity?: number;
  nearestProximity?: number;
  localDensity?: number;
  clusterEnergy?: number;
}

const SLOT_FALLBACKS: Record<number, { nodes: string[]; label: string }> = {
  // 기본 매핑: 1번 슬롯 → 노드 206, 2번 슬롯 → 노드 183
  0: { nodes: ["206"], label: "fact" },
  1: { nodes: ["183"], label: "Vol CHORDS" },
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const format = (value: number, precision = 3) =>
  Number(value.toFixed(precision));

const computeSelfFreq = (approachValue: number) => {
  // Slot 1 (index 0): 0.01 ~ 0.05, 접근 속도에 따라 선형 스케일
  const min = 0.01;
  const max = 0.05;
  const level = clamp(approachValue, 0, 1);
  const value = min + (max - min) * level;
  return format(value);
};

const computeSelfGain = (approachValue: number) => {
  // Slot 2 (index 1): 0.15 ~ 0.8, 접근 속도에 따라 선형 스케일
  const min = 0.15;
  const max = 0.8;
  const level = clamp(approachValue, 0, 1);
  const value = min + (max - min) * level;
  return format(value);
};

const resolveSlotNodes = (
  slots: NoiseSlot[],
  slotIndex: number,
  fallback: string[]
) => {
  const entry = slots.find((slot) => slot.slot === slotIndex);
  if (entry && entry.nodeIds.length) {
    return entry.nodeIds;
  }
  return fallback;
};

const appendSlotParams = (
  params: NoiseCraftParam[],
  slotIndex: number,
  valueList: number[],
  slots: NoiseSlot[],
  fallbackNodes: string[]
) => {
  if (!valueList.length) return;
  const nodeIds = resolveSlotNodes(slots, slotIndex, fallbackNodes);
  nodeIds.forEach((nodeId, index) => {
    const value =
      valueList[index] ?? valueList[valueList.length - 1] ?? valueList[0];
    params.push({
      nodeId,
      paramName: "value",
      value,
    });
  });
};

const toUnit = (value: number | undefined) =>
  clamp(Number.isFinite(value ?? 0) ? (value as number) : 0, 0, 1);

export const buildNoiseCraftParams = (
  audio: AudioState,
  slots: NoiseSlot[] = [],
  mode: "personal" | "global",
  metrics: PersonalAudioMetrics = {}
): NoiseCraftParam[] => {
  const params: NoiseCraftParam[] = [];
  const approach = toUnit(metrics.approachIntensity);
  const nearestProximity = toUnit(metrics.nearestProximity);

  if (mode === "personal") {
    appendSlotParams(
      params,
      0,
      [computeSelfFreq(approach)],
      slots,
      SLOT_FALLBACKS[0].nodes
    );
    appendSlotParams(
      params,
      1,
      [computeSelfGain(approach)],
      slots,
      SLOT_FALLBACKS[1].nodes
    );
  } else {
    appendSlotParams(params, 0, [220], slots, SLOT_FALLBACKS[0].nodes);
    appendSlotParams(params, 1, [0], slots, SLOT_FALLBACKS[1].nodes);
  }

  if (mode === "personal") {
    const clampedApproach = format(toUnit(metrics.approachIntensity));
    ["5", "35", "107"].forEach((nodeId) =>
      params.push({
        nodeId,
        paramName: "value",
        value: clampedApproach,
      })
    );

    // Distance / proximity mapping (0-1, closer = higher)
    const proximityValue = format(nearestProximity);
    params.push({
      nodeId: "17",
      paramName: "value",
      value: proximityValue,
    });
  }

  return params;
};

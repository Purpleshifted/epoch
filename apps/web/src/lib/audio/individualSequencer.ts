import type { AudioClusterState } from "@/types/game";

export interface IndividualPattern {
  bassRow: number | null;
  baritoneRow: number | null;
  tenorRow: number | null;
}

// 간단한 해시로 12톤 인덱스 생성 (0-11)
export const hashToneIndex = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 12;
};

const map12ToneTo4Row = (noteIndex12: number): number => {
  if (noteIndex12 < 0 || noteIndex12 >= 12) return 0;
  return Math.floor(noteIndex12 / 3);
};

export const generateIndividualPattern = (
  selfTone: number | null,
  neighborTones: number[],
  _options?: { cluster?: AudioClusterState | null; isInCluster?: boolean }
): IndividualPattern => {
  const pattern: IndividualPattern = {
    bassRow: null,
    baritoneRow: null,
    tenorRow: null,
  };

  if (selfTone === null) {
    return pattern;
  }

  const baseRow = map12ToneTo4Row(selfTone);
  pattern.bassRow = baseRow;

  const hasFirstNeighbor = neighborTones.length > 0;
  const hasSecondNeighbor = neighborTones.length > 1;

  if (hasFirstNeighbor) {
    // 기본적으로 다른 음으로 만들어서 확실히 화음이 나도록
    pattern.baritoneRow = (baseRow + 1) % 4;
  }

  if (hasSecondNeighbor) {
    // 세 번째 성부도 다른 음으로
    pattern.tenorRow = (baseRow + 3) % 4;
  }

  return pattern;
};

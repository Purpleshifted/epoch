import type { GameState } from "@/types/game";
import type { NoiseCraftParam } from "@/lib/audio/noiseCraftCore";

const MIN_PAN_DISTANCE = 80;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// 거리 → 0.2~1 매핑:
//  - 1000~300: 0.2~0.5 (선형)
//  - 300~100: 0.5~1.0 (선형)
//  - ≥1000: 0.2, ≤100: 1.0
const mapDistanceToValue = (dist: number): number => {
  if (!Number.isFinite(dist)) return 0;
  if (dist >= 1000) return 0.2;
  if (dist >= 300) {
    const t = (1000 - dist) / (1000 - 300); // 0 at 1000, 1 at 300
    return 0.2 + t * (0.5 - 0.2);
  }
  if (dist >= 100) {
    const t = (300 - dist) / (300 - 100); // 0 at 300, 1 at 100
    return 0.5 + t * (1.0 - 0.5);
  }
  return 1.0;
};

// 거리 제곱에 반비례하는 "중력" 스타일 매핑:
//  - dist가 멀어질수록 빠르게 줄어들지만
//  - 완전히 0까지는 가지 않고 0.3을 바닥으로 유지
const mapDistanceToGravity = (dist: number): number => {
  if (!Number.isFinite(dist)) return 0.05;
  if (dist <= 100) return 1;
  const SCALE = 300; // 이 값 기준으로 세기가 절반 근처로 떨어지도록
  const ratio = dist / SCALE;
  const inv = 1 / (1 + ratio * ratio); // 0 < inv ≤ 1
  const MIN = 0.05;
  return MIN + (0.5 - MIN) * inv;
};

/**
 * Generate spatial params for individual_audio_simple / chord_spatial patches:
 * - node 220: nearest distance (0 far ~ 1 close)
 * - node 221: second-nearest distance (0 far ~ 1 close, or 0 if 없음)
 * - node 233: nearest direction (0~1, angle -π~π → 0~1)
 * - node 240: second-nearest direction (0~1, 없으면 0.5)
 * - node 222: nearest pan (0.4~0.6, 좌 0.4, 우 0.6, 너무 가까우면 0.5)
 */
export const generateDistancePanParams = (
  state: GameState
): NoiseCraftParam[] => {
  const selfId = state.selfId;
  if (!selfId) return [];
  const selfPlayer = state.players[selfId];
  if (!selfPlayer) return [];

  const { position: selfPos } = selfPlayer.cell;

  const others = Object.values(state.players).filter(
    (p) => p.id !== selfId
  );
  if (!others.length) {
    return [];
  }

  const withDistances = others
    .map((p) => {
      const dx = p.cell.position.x - selfPos.x;
      const dy = p.cell.position.y - selfPos.y;
      const dist = Math.hypot(dx, dy);
      return { player: p, dx, dy, dist };
    })
    .sort((a, b) => a.dist - b.dist);

  const nearest = withDistances[0];
  const second = withDistances[1];

  // 거리 → "중력" 세기 (거리 제곱에 반비례, 하한 0.3)
  const nearestNorm = mapDistanceToGravity(nearest.dist);
  const secondNorm = second ? mapDistanceToGravity(second.dist) : 0;

  // 방향: -π~π → 0~1
  const nearestAngle = Math.atan2(nearest.dy, nearest.dx); // -π~π
  const nearestDir = (nearestAngle / (2 * Math.PI)) + 0.5; // 0~1
  const nearestDirClamped = clamp01(nearestDir);

  let secondDirClamped = 0.5;
  if (second) {
    const angle2 = Math.atan2(second.dy, second.dx);
    const dir2 = (angle2 / (2 * Math.PI)) + 0.5;
    secondDirClamped = clamp01(dir2);
  }

  // 좌우 팬: 좌 0, 우 1, 중앙 0.5
  let pan = 0.5;
  if (nearest.dist >= MIN_PAN_DISTANCE) {
    const safeDist = nearest.dist || 1;
    const panDir = nearest.dx / safeDist; // -1 ~ 1
    // -1~1 → 0.4~0.6 (좌 0.4, 우 0.6)
    pan = 0.5 + panDir * 0.3;
    pan = Math.max(0.2, Math.min(0.8, pan));
  }

  const params: NoiseCraftParam[] = [
    {
      nodeId: "220",
      paramName: "value",
      value: nearestNorm,
    },
    {
      nodeId: "221",
      paramName: "value",
      value: secondNorm,
    },
    {
      nodeId: "233",
      paramName: "value",
      value: nearestDirClamped,
    },
    {
      nodeId: "240",
      paramName: "value",
      value: secondDirClamped,
    },
    {
      nodeId: "222",
      paramName: "value",
      value: pan,
    },
  ];

  return params;
};

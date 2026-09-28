/**
 * spacetime/types.ts
 *
 * 시공간 블록 공통 타입 정의.
 * 특수상대성이론 개념:
 *   - 3D 시공간 (x, z, t): 공간 2축 + 시간 1축
 *   - 관측자의 동시성 초평면(hyperplane of simultaneity)은 두 값으로 정의:
 *       φ (phi):  XZ 평면에서 운동 방향 (0 ~ 2π)
 *       β (beta): 속도 v/c (0 ~ 0.9) → 기울기 크기
 *   - 별 worldline pillar:
 *       bottom = (x, 0, z)
 *       top    = (x + cos(φ)·β·age, age·scale, z + sin(φ)·β·age)
 */

// ── 별 위상 ──────────────────────────────────────────────
export type StarPhase =
  | "nebula"
  | "protostar"
  | "mainSequence"
  | "redGiant"
  | "supernova"
  | "remnant";

// ── 별 개체 ──────────────────────────────────────────────
export interface StarBody {
  id: string;
  x: number; y: number; z: number;   // 세계 좌표
  vx: number; vz: number;             // 속도
  phaseAge: number;                   // 현재 위상 경과 시간(초)
  mass: number;
  phase: StarPhase;
  age: number;                        // 총 경과 시간(초) → timespace Y축
  radius: number;
  isPermanent: boolean;               // mainSequence+ → true
  // 생성자 동시성 평면 (두 값으로 정의)
  creatorPhi?: number;   // 운동 방향 φ ∈ [0, 2π]
  creatorBeta?: number;  // 속도 β ∈ [0, 0.9]
  /** @deprecated use creatorPhi + creatorBeta */
  creatorAngle?: number;
}

/**
 * 관측 평면 (Observer's Hyperplane of Simultaneity)
 *
 * 3D 시공간 (x, z, t)에서 동시성 평면을 정의하려면 두 값이 필요:
 *   φ (phi):  XZ 평면에서 운동 방향 (0 ~ 2π)
 *             → pillar가 XZ에서 어느 쪽으로 기울어지는지
 *   β (beta): 속도 v/c (0 ~ ~0.9)
 *             → pillar 기울기 크기 (β=0이면 수직, β→1이면 광속 극한)
 *
 * 평면 방정식: t_recorded = t_real + (x·cos(φ) + z·sin(φ))·β·k
 */
export interface SessionPlane {
  phi: number;         // XZ 운동 방향 (0 ~ 2π)
  beta: number;        // 속도 fraction v/c (0 ~ 0.9)
  slotIndex: number;   // 12분할 슬롯 (색상 인덱스)
  color: string;
}

// 12개 관측 평면 색상 (색상환 균등 분할)
export const PLANE_COLORS: string[] = [
  "#ff6677", "#ff9944", "#ffcc22", "#aaff44",
  "#44ffaa", "#22ffee", "#44aaff", "#6677ff",
  "#aa44ff", "#ff44cc", "#ff4488", "#ff6655",
];

export const PLANE_SLOT_COUNT = 12;

export const LS_STARS_KEY = "anthropocene:stars:v1";
export const SS_PLANE_KEY = "session_plane_angle";

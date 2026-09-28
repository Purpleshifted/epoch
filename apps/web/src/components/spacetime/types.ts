/**
 * spacetime/types.ts
 *
 * 시공간 블록 공통 타입 정의.
 * 특수상대성이론 개념:
 *   - 3D+T 시공간 덩어리 (X, Z: 공간, T: 시간)
 *   - 각 관객은 고유한 각도 θ의 동시성 평면(hyperplane of simultaneity)에서 움직임
 *   - creatorAngle: 별을 만든 관객의 평면 각도 → top/side 뷰에서 색상/기울기로 표현
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
  age: number;                        // 총 경과 시간(초) → side view Y축
  radius: number;
  isPermanent: boolean;               // mainSequence+ → true
  creatorAngle?: number;              // 생성자 관측 평면 각도 (rad, 0~2π)
}

// ── 관측 평면 (Observer's Hyperplane of Simultaneity) ───
export interface SessionPlane {
  angle: number;       // 0 ~ 2π
  slotIndex: number;   // 12분할 슬롯 인덱스 (0~11)
  /** 이 평면에 대응하는 색상 — top/side 뷰에서 시각화 */
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

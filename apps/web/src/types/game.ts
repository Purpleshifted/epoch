export type Mode = "personal" | "global";

export interface Vec2 {
  x: number;
  y: number;
}

export interface CellState {
  position: Vec2;
  velocity: Vec2;
  radius: number;
  mass: number;
  color: string;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  cell: CellState;
  target?: Vec2;
  lastUpdate: number;
  isSelf?: boolean;
  depth?: number; // z축(뷰 전환용)
  isPredicted?: boolean;
  lastServerPosition?: Vec2;
  lastServerVelocity?: Vec2;
  predictionOffset?: Vec2;
  // 서버에서 계산한 중력 방향/거리 및 충돌 여부(개인 뷰 연출용)
  gravityDir?: Vec2;
  gravityDist?: number;
  isCollidingSelf?: boolean;
}

export interface SnapshotFrame {
  timestamp: number;
  players: Record<string, PlayerSnapshot>;
  order: string[];
  fast?: boolean;
}

export interface AudioChordNote {
  freq: number;
  gain: number;
}

export interface AudioClusterState {
  clusterId: string;
  chord: AudioChordNote[];
  memberCount: number;
  centroid: Vec2;
  gain: number;
  updatedAt: number;
  source: "cluster" | "global";
}

export interface AudioSelfState {
  noiseLevel: number;
  ambientLevel: number;
  clusterId: string | null;
  updatedAt: number;
}

export interface AudioState {
  self: AudioSelfState | null;
  cluster: AudioClusterState | null;
  global: AudioClusterState | null;
}

export interface NoiseSlot {
  slot: number;
  nodeIds: string[];
  label?: string;
}

export interface CollisionMark {
  id: string;
  position: Vec2;
  radius: number;
  timestamp: number;
  players?: [string, string];
}

export interface CollisionLine {
  id: string;
  players: [string, string];
  startedAt: number;
  lastEvent?: number;
}

export interface CameraState {
  position: Vec2;
  zoom: number;
}

export interface UiState {
  displayName: string;
  statusMessage: string | null;
  connected: boolean;
  reconnecting: boolean;
  population: number;
}

export interface InputState {
  pointer: Vec2;
  pointerActive: boolean;
  lastHeartbeat: number;
  controlVelocity?: Vec2; // 모바일 컨트롤러가 보내는 원하는 속도
}

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

export interface CellTrail {
  points: TrailPoint[];
}

export interface GlobalOverlay {
  focusPlayerId: string | null;
  lastKnownPositions: Record<string, Vec2>;
}

export interface GameState {
  mode: Mode;
  socketId: string | null;
  gameSize: { width: number; height: number };
  players: Record<string, PlayerSnapshot>;
  playerOrder: string[];
  selfId: string | null;
  camera: CameraState;
  ui: UiState;
  input: InputState;
  collisionMarks: CollisionMark[];
  cellTrails: Record<string, CellTrail>;
  globalOverlay: GlobalOverlay;
  target: Vec2;
  playing: boolean;
  collisionLines: CollisionLine[];
  selfHighlightUntil: number;
  snapshotBuffer: SnapshotFrame[];
  audio: AudioState;
  noiseSlots: NoiseSlot[];
}

export type GameAction =
  | { type: "SET_MODE"; mode: Mode }
  | {
      type: "SET_PLAYERS";
      players: Record<string, PlayerSnapshot>;
      order: string[];
      selfId?: string | null;
    }
  | { type: "UPDATE_PLAYER"; player: PlayerSnapshot }
  | { type: "REMOVE_PLAYER"; playerId: string }
  | { type: "SET_SELF"; selfId: string | null }
  | { type: "SET_SOCKET_ID"; socketId: string | null }
  | { type: "SET_UI"; ui: Partial<UiState> }
  | { type: "SET_CAMERA"; camera: Partial<CameraState> }
  | { type: "SET_INPUT"; input: Partial<InputState> }
  | { type: "SET_TARGET"; target: Vec2 }
  | { type: "SET_GAME_SIZE"; gameSize: { width: number; height: number } }
  | { type: "SET_PLAYING"; playing: boolean }
  | { type: "PUSH_COLLISION_MARK"; mark: CollisionMark }
  | { type: "PUSH_COLLISION_EVENTS"; marks: CollisionMark[]; highlight?: boolean }
  | { type: "SET_COLLISION_LINES"; lines: CollisionLine[] }
  | { type: "SET_SELF_HIGHLIGHT"; until: number }
  | { type: "SET_GLOBAL_OVERLAY"; overlay: Partial<GlobalOverlay> }
  | { type: "SET_AUDIO"; audio: Partial<AudioState> }
  | { type: "SET_NOISE_SLOTS"; slots: NoiseSlot[] }
  | { type: "PUSH_SNAPSHOT_FRAME"; frame: SnapshotFrame }
  | { type: "RESET" };

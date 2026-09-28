export interface ServerCell {
  x: number;
  y: number;
  radius?: number;
  mass?: number;
  ox?: number;
  oy?: number;
  color?: string;
  vx?: number;
  vy?: number;
  z?: number;
}

export interface ServerPlayer {
  id?: string;
  name?: string;
  x?: number;
  y?: number;
  z?: number;
  massTotal?: number;
  hue?: number;
  color?: string;
  cells?: ServerCell[];
  target?: { x: number; y: number };
}

export interface ServerCollisionLine {
  id: string;
  players: [string, string];
  startedAt: number;
  lastEvent?: number;
}

export interface ServerCollisionEvent {
  id: string;
  players: [string, string];
  position: { x: number; y: number };
  radius?: number;
  timestamp: number;
}

export interface ServerTellPlayerMovePayload {
  playerData?: ServerPlayer;
  userData?: ServerPlayer[];
}

export interface ServerAudioChord {
  freq: number;
  gain: number;
}

export interface ServerAudioCluster {
  clusterId: string;
  chord: ServerAudioChord[];
  memberCount: number;
  centroid: { x: number; y: number };
  gain: number;
}

export interface ServerAudioSelf {
  noiseLevel: number;
  ambientLevel: number;
  clusterId: string | null;
}

export interface ServerAudioGlobal {
  cluster: ServerAudioCluster | null;
}

import type {
  CellTrail,
  GameAction,
  GameState,
  Mode,
  PlayerSnapshot,
} from "@/types/game";

const createBaseState = (): Omit<GameState, "mode"> => ({
  socketId: null,
  gameSize: { width: 5000, height: 5000 },
  players: {},
  playerOrder: [],
  selfId: null,
  camera: {
    position: { x: 0, y: 0 },
    zoom: 1,
  },
  ui: {
    displayName: "",
    statusMessage: null,
    connected: false,
    reconnecting: false,
    population: 0,
  },
  input: {
    pointer: { x: 0, y: 0 },
    pointerActive: false,
    lastHeartbeat: 0,
    controlVelocity: { x: 0, y: 0 },
  },
  collisionMarks: [],
  cellTrails: {},
  globalOverlay: {
    focusPlayerId: null,
    lastKnownPositions: {},
  },
  target: { x: 0, y: 0 },
  playing: false,
  collisionLines: [],
  selfHighlightUntil: 0,
  snapshotBuffer: [],
  audio: {
    self: null,
    cluster: null,
    global: null,
  },
  noiseSlots: Array.from({ length: 4 }, (_, slot) => ({
    slot,
    nodeIds: [],
  })),
});

export const createInitialState = (mode: Mode = "personal"): GameState => ({
  mode,
  ...createBaseState(),
});

const clampZoom = (zoom: number) => Math.min(4, Math.max(0.2, zoom));

const upsertPlayer = (
  players: Record<string, PlayerSnapshot>,
  player: PlayerSnapshot
) => {
  return {
    ...players,
    [player.id]: player,
  };
};

const updateTrails = (
  state: GameState,
  action: Extract<GameAction, { type: "SET_PLAYERS" }>
) => {
  const nextTrails: Record<string, CellTrail> = { ...state.cellTrails };
  const selfId = action.selfId ?? state.selfId;
  if (selfId) {
    const player = action.players[selfId];
    if (player) {
      const prev = nextTrails[selfId]?.points ?? [];
      const now = Date.now();
      let points = [
        ...prev,
        { x: player.cell.position.x, y: player.cell.position.y, t: now },
      ].filter((p) => now - p.t < 5000);
      const MAX_POINTS = 120;
      if (points.length > MAX_POINTS) {
        points = points.slice(points.length - MAX_POINTS);
      }
      nextTrails[selfId] = { points };
    }
  }
  return nextTrails;
};

export const gameReducer = (
  state: GameState,
  action: GameAction
): GameState => {
  switch (action.type) {
    case "SET_MODE":
      return createInitialState(action.mode);
    case "RESET":
      return createInitialState(state.mode);
    case "SET_SOCKET_ID":
      return { ...state, socketId: action.socketId };
    case "SET_SELF":
      return { ...state, selfId: action.selfId };
    case "SET_UI":
      return { ...state, ui: { ...state.ui, ...action.ui } };
    case "SET_GAME_SIZE":
      return { ...state, gameSize: action.gameSize };
    case "SET_CAMERA":
      return {
        ...state,
        camera: {
          ...state.camera,
          ...action.camera,
          zoom:
            action.camera?.zoom !== undefined
              ? clampZoom(action.camera.zoom)
              : state.camera.zoom,
        },
      };
    case "SET_INPUT":
      return { ...state, input: { ...state.input, ...action.input } };
    case "SET_TARGET":
      return { ...state, target: action.target };
    case "SET_PLAYERS":
      return {
        ...state,
        players: action.players,
        playerOrder: action.order,
        ui: { ...state.ui, population: action.order.length },
        cellTrails: updateTrails(state, action),
      };
    case "UPDATE_PLAYER": {
      const players = upsertPlayer(state.players, action.player);
      const order = state.playerOrder.includes(action.player.id)
        ? state.playerOrder
        : [...state.playerOrder, action.player.id];
      return {
        ...state,
        players,
        playerOrder: order,
        ui: { ...state.ui, population: Object.keys(players).length },
      };
    }
    case "REMOVE_PLAYER": {
      const nextPlayers = { ...state.players };
      delete nextPlayers[action.playerId];
      return {
        ...state,
        players: nextPlayers,
        playerOrder: state.playerOrder.filter((id) => id !== action.playerId),
        ui: { ...state.ui, population: Object.keys(nextPlayers).length },
      };
    }
    case "PUSH_COLLISION_MARK":
      return {
        ...state,
        collisionMarks: [...state.collisionMarks, action.mark].slice(-100),
      };
    case "PUSH_COLLISION_EVENTS": {
      const now = Date.now();
      // 5분(300000ms) 동안 빛의 흔적 유지
      const merged = [...state.collisionMarks, ...action.marks].filter(
        (mark) => now - mark.timestamp < 300000
      );
      const highlight = action.highlight
        ? Math.max(state.selfHighlightUntil, now + 1200)
        : state.selfHighlightUntil;
      return {
        ...state,
        collisionMarks: merged.slice(-200),
        selfHighlightUntil: highlight,
      };
    }
    case "SET_COLLISION_LINES":
      return { ...state, collisionLines: action.lines };
    case "SET_SELF_HIGHLIGHT":
      return { ...state, selfHighlightUntil: action.until };
    case "SET_GLOBAL_OVERLAY":
      return {
        ...state,
        globalOverlay: { ...state.globalOverlay, ...action.overlay },
      };
    case "SET_PLAYING":
      return {
        ...state,
        playing: action.playing,
      };
    case "SET_AUDIO":
      return {
        ...state,
        audio: { ...state.audio, ...action.audio },
      };
    case "SET_NOISE_SLOTS":
      return {
        ...state,
        noiseSlots: action.slots,
      };
    case "PUSH_SNAPSHOT_FRAME": {
      const MAX_BUFFER_MS = 600;
      const MAX_BUFFER_FRAMES = 24;
      const frames = [...state.snapshotBuffer, action.frame];
      const cutoff = action.frame.timestamp - MAX_BUFFER_MS;
      const trimmed = frames
        .filter((frame) => frame.timestamp >= cutoff || frame.fast)
        .slice(-MAX_BUFFER_FRAMES);
      return {
        ...state,
        snapshotBuffer: trimmed,
      };
    }
    default:
      return state;
  }
};

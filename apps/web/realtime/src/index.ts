import http from "node:http";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";
const SOCKET_PATH = process.env.SOCKET_PATH || "/socket";

// 게임 설정 (intersection 서버와 호환되는 기본값)
const GAME_WIDTH = 1920 * 4;
const GAME_HEIGHT = 602 * 4;
const MAX_HEARTBEAT_MS = 5000;
const TICK_HZ = 120; // 이동 계산 더 촘촘히
const UPDATE_HZ = 30; // 기본 브로드캐스트 빈도 (모든 클라이언트)
const SELF_UPDATE_HZ = 30; // 자기 플레이어 전용 보간용 업데이트
const CLUSTER_RADIUS = 420;
const CLUSTER_REFRESH_INTERVAL_MS = 200;
const BASE_CHORD = [261.63, 329.63, 392];

type Vec2 = { x: number; y: number };

interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number; // depth
  desiredVx: number;
  desiredVy: number;
  radius: number;
  massTotal: number;
  color: string;
  screenWidth: number;
  screenHeight: number;
  lastHeartbeat: number;
  vx: number;
  vy: number;
  // 서버가 계산한 중력 방향/거리(가장 가까운 플레이어 기준)
  gravityDirX: number;
  gravityDirY: number;
  gravityDist: number;
  // 소켓 없이 서버에서만 움직이는 봇인지 여부
  isBot?: boolean;
}

interface ClusterInfo {
  id: string;
  memberIds: string[];
  memberCount: number;
  centroid: Vec2;
  gain: number;
  chord: Array<{ freq: number; gain: number }>;
}

const players = new Map<string, Player>();
const spectators = new Set<string>();
// 봇의 간단한 상태 (움직이는 방향, 방향 전환 시점 등)
const botState = new Map<string, { angle: number; nextTurnAt: number }>();
const collisionLines = new Map<
  string,
  {
    id: string;
    players: [string, string];
    startedAt: number;
    lastEvent: number;
  }
>();
const collisionEvents: Array<{
  id: string;
  players: [string, string];
  position: Vec2;
  radius: number;
  timestamp: number;
}> = [];
// 현재 프레임에서 실제로 충돌한 플레이어 id 집합 (isColliding 플래그용)
const collidingNow = new Set<string>();
const COLLISION_DISTANCE = 80;
const MIN_GRAVITY_DISTANCE = 80;
const MAX_SPEED = 320;
const PLAYER_BASE_MASS = 5000;
const INPUT_SMOOTH = 0.02;
// 중력 세기: 실제 이동에는 너무 세지 않도록 절반 정도로 줄임
const GRAVITY_TARGET_SPEED_RATIO = 0.4;
const TARGET_GRAVITY_VELOCITY = MAX_SPEED * GRAVITY_TARGET_SPEED_RATIO;
const MAX_GRAVITY_ACCEL = TARGET_GRAVITY_VELOCITY * INPUT_SMOOTH * TICK_HZ; // accel so steady-state ≈ 0.5 user max
const GRAVITY_G =
  (MAX_GRAVITY_ACCEL * MIN_GRAVITY_DISTANCE * MIN_GRAVITY_DISTANCE) /
  PLAYER_BASE_MASS;
const LOG_GRAVITY = 0;
const LOG_GRAVITY_INTERVAL_MS = Number(
  process.env.LOG_GRAVITY_INTERVAL_MS || 1000
);

// 서버에서 자동으로 움직이는 봇 설정 (기본 0 = 비활성)
const BOT_TARGET_COUNT = Number(process.env.BOT_COUNT || 0);
const BOT_MIN_SPEED = 80;
const BOT_MAX_SPEED = 200;
const BOT_TURN_INTERVAL_MIN_MS = 4000;
const BOT_TURN_INTERVAL_MAX_MS = 12000;

const rand = (min: number, max: number) => Math.random() * (max - min) + min;

const randomDepth = () => {
  const base = rand(800, 2200);
  const skew = Math.max(0.15, Math.pow(Math.random(), 0.35));
  const jitter = rand(0.75, 1.25);
  const sign = Math.random() < 0.5 ? -1 : 1;
  return sign * base * skew * jitter;
};

function spawnPoint(): Vec2 {
  const padding = 100;
  return {
    x: rand(padding, GAME_WIDTH - padding),
    y: rand(padding, GAME_HEIGHT - padding),
  };
}

let botCounter = 0;

function spawnBot() {
  const pos = spawnPoint();
  const id = `bot:${++botCounter}`;
  const angle = rand(0, Math.PI * 2);
  const speed = rand(BOT_MIN_SPEED, BOT_MAX_SPEED);
  const colorHue = rand(0, 360);
  const color = `hsl(${colorHue}, 70%, 70%)`;

  const p: Player = {
    id,
    name: `bot-${botCounter}`,
    x: pos.x,
    y: pos.y,
    z: randomDepth(),
    desiredVx: Math.cos(angle) * speed,
    desiredVy: Math.sin(angle) * speed,
    radius: 20,
    massTotal: PLAYER_BASE_MASS,
    color,
    screenWidth: GAME_WIDTH,
    screenHeight: GAME_HEIGHT,
    lastHeartbeat: Date.now(),
    vx: 0,
    vy: 0,
    gravityDirX: 0,
    gravityDirY: 0,
    gravityDist: Number.POSITIVE_INFINITY,
    isBot: true,
  };

  players.set(id, p);
  const now = Date.now();
  botState.set(id, {
    angle,
    nextTurnAt: now + rand(BOT_TURN_INTERVAL_MIN_MS, BOT_TURN_INTERVAL_MAX_MS),
  });
}

function ensureBots() {
  if (BOT_TARGET_COUNT <= 0) return;
  let botCount = 0;
  for (const p of players.values()) {
    if (p.isBot) botCount += 1;
  }
  while (botCount < BOT_TARGET_COUNT) {
    spawnBot();
    botCount += 1;
  }
}

function updateBotDesiredVelocity(p: Player, now: number) {
  if (!p.isBot) return;
  let state = botState.get(p.id);
  if (!state) {
    state = {
      angle: rand(0, Math.PI * 2),
      nextTurnAt:
        now + rand(BOT_TURN_INTERVAL_MIN_MS, BOT_TURN_INTERVAL_MAX_MS),
    };
    botState.set(p.id, state);
  }

  // 방향 전환 시점이 되면 새로운 방향으로 회전
  if (now >= state.nextTurnAt) {
    state.angle = rand(0, Math.PI * 2);
    state.nextTurnAt =
      now + rand(BOT_TURN_INTERVAL_MIN_MS, BOT_TURN_INTERVAL_MAX_MS);
  }

  // 맵 가장자리 근처면 안쪽으로 살짝 방향 보정
  const edgeMargin = 300;
  let steerX = 0;
  let steerY = 0;
  if (p.x < edgeMargin) steerX += 1;
  if (p.x > GAME_WIDTH - edgeMargin) steerX -= 1;
  if (p.y < edgeMargin) steerY += 1;
  if (p.y > GAME_HEIGHT - edgeMargin) steerY -= 1;
  if (steerX !== 0 || steerY !== 0) {
    const steerAngle = Math.atan2(steerY, steerX);
    // 기존 각도와 보정 각도를 섞어서 부드럽게 회전
    const mix = 0.4;
    const a = state.angle;
    const da = steerAngle - a;
    state.angle = a + da * mix;
  }

  const speed = rand(BOT_MIN_SPEED, BOT_MAX_SPEED);
  p.desiredVx = Math.cos(state.angle) * speed;
  p.desiredVy = Math.sin(state.angle) * speed;
  // 봇은 하트비트가 끊기지 않도록 항상 갱신
  p.lastHeartbeat = now;
}

function moveTowards(p: Player, dt: number) {
  // 가속/감속 기반 부드러운 움직임: 클라이언트가 보낸 원하는 속도에 수렴
  const SMOOTH = INPUT_SMOOTH; // 응답성(0~1)
  const desiredVx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, p.desiredVx));
  const desiredVy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, p.desiredVy));
  p.vx += (desiredVx - p.vx) * SMOOTH;
  p.vy += (desiredVy - p.vy) * SMOOTH;
  p.x = Math.max(0, Math.min(GAME_WIDTH, p.x + p.vx * dt));
  p.y = Math.max(0, Math.min(GAME_HEIGHT, p.y + p.vy * dt));
}

function applyNearestGravity(p: Player, list: Player[], dt: number) {
  if (list.length <= 1 || p.massTotal <= 0) {
    // 다른 플레이어가 없으면 중력 정보 초기화
    p.gravityDirX = 0;
    p.gravityDirY = 0;
    p.gravityDist = Number.POSITIVE_INFINITY;
    return;
  }
  let nearest: Player | null = null;
  let nearestDistSq = Number.POSITIVE_INFINITY;
  for (const other of list) {
    if (other.id === p.id) continue;
    const dx = other.x - p.x;
    const dy = other.y - p.y;
    const distSq = dx * dx + dy * dy;
    if (distSq === 0) continue;
    if (distSq < nearestDistSq) {
      nearest = other;
      nearestDistSq = distSq;
    }
  }
  if (!nearest) {
    p.gravityDirX = 0;
    p.gravityDirY = 0;
    p.gravityDist = Number.POSITIVE_INFINITY;
    return;
  }
  const dist = Math.max(Math.sqrt(nearestDistSq), MIN_GRAVITY_DISTANCE);
  const dirX = (nearest.x - p.x) / dist;
  const dirY = (nearest.y - p.y) / dist;
  const denom = dist * dist;
  if (denom <= 0 || !Number.isFinite(denom)) {
    return;
  }
  const accelMagnitude =
    0.6 *
    Math.min(
      (GRAVITY_G * Math.max(nearest.massTotal, 1)) / denom,
      MAX_GRAVITY_ACCEL
    );
  p.vx += accelMagnitude * dirX * dt;
  p.vy += accelMagnitude * dirY * dt;
  // 시각화/클라이언트용 중력 벡터 저장
  p.gravityDirX = dirX;
  p.gravityDirY = dirY;
  p.gravityDist = dist;
  if (LOG_GRAVITY) {
    const now = Date.now();
    const lastLog = lastGravityLogByPlayer.get(p.id) ?? 0;
    if (now - lastLog >= LOG_GRAVITY_INTERVAL_MS) {
      console.log("[gravity]", {
        playerId: p.id,
        targetId: nearest.id,
        dist: Number(dist.toFixed(2)),
        accel: Number(accelMagnitude.toFixed(2)),
        vx: Number(p.vx.toFixed(2)),
        vy: Number(p.vy.toFixed(2)),
      });
      lastGravityLogByPlayer.set(p.id, now);
    }
  }
}

function toServerPlayer(p: Player) {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    z: p.z,
    massTotal: p.massTotal,
    color: p.color,
    cells: [
      {
        x: p.x,
        y: p.y,
        radius: p.radius,
        vx: p.vx,
        vy: p.vy,
        z: p.z,
      },
    ],
  };
}

function visiblePlayers(forId: string) {
  const viewer = players.get(forId);
  const hideBotsForViewer = viewer && !viewer.isBot;

  const list = Array.from(players.values())
    .filter((u) => {
      if (u.id === forId) return false;
      if (hideBotsForViewer && u.isBot) return false;
      return true;
    })
    .map(toServerPlayer);

  return list;
}

let clusterSnapshot: ClusterInfo[] = [];
let playerClusterMap = new Map<string, string>();
let lastClusterRefresh = 0;
let largestClusterId: string | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const NOISE_SLOT_COUNT = 4;
type NoiseSlotEntry = {
  slot: number;
  nodeIds: string[];
  label: string;
};
const noiseSlotLabels = [
  "Self Frequency",
  "Self Gain",
  "Cluster Chord",
  "Cluster Gain",
];
const createEmptyNoiseSlot = (slot: number): NoiseSlotEntry => ({
  slot,
  nodeIds: [],
  label: noiseSlotLabels[slot] || `Slot ${slot + 1}`,
});
let noiseSlots: NoiseSlotEntry[] = Array.from(
  { length: NOISE_SLOT_COUNT },
  (_, slot) => createEmptyNoiseSlot(slot)
);
const lastGravityLogByPlayer = new Map<string, number>();

const sanitizeNoiseSlotPayload = (payload: unknown) => {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof (payload as { slot?: unknown }).slot !== "number"
  ) {
    return null;
  }
  const slot = (payload as { slot: number }).slot;
  if (slot < 0 || slot >= NOISE_SLOT_COUNT) {
    return null;
  }
  const rawNodeIds = (payload as { nodeIds?: unknown }).nodeIds;
  const nodeIds = Array.isArray(rawNodeIds)
    ? rawNodeIds
        .map((id) => id)
        .filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0
        )
    : [];
  return {
    slot,
    nodeIds,
  };
};

const broadcastNoiseSlots = () => {
  io.emit("noiseSlots:update", noiseSlots);
};

function recomputeClusters() {
  const arr = Array.from(players.values());
  const visited = new Set<string>();
  const assignments = new Map<string, string>();
  const clusters: ClusterInfo[] = [];
  const radiusSq = CLUSTER_RADIUS * CLUSTER_RADIUS;

  for (const player of arr) {
    if (visited.has(player.id)) continue;
    const queue: Player[] = [player];
    visited.add(player.id);
    const members: Player[] = [];

    while (queue.length) {
      const current = queue.pop()!;
      members.push(current);
      for (const candidate of arr) {
        if (visited.has(candidate.id)) continue;
        const dx = current.x - candidate.x;
        const dy = current.y - candidate.y;
        if (dx * dx + dy * dy <= radiusSq) {
          visited.add(candidate.id);
          queue.push(candidate);
        }
      }
    }

    const clusterId = members[0]?.id ?? `cluster-${clusters.length}`;
    members.forEach((member) => assignments.set(member.id, clusterId));
    const centroid = members.reduce(
      (acc, member) => {
        acc.x += member.x;
        acc.y += member.y;
        return acc;
      },
      { x: 0, y: 0 }
    );
    const memberCount = members.length || 1;
    centroid.x /= memberCount;
    centroid.y /= memberCount;
    const gain = clamp(memberCount / 4, 0.1, 1);
    const chord = BASE_CHORD.map((freq, idx) => ({
      freq: Number(
        (freq * (1 + (memberCount - 1) * 0.02 * (idx + 1))).toFixed(2)
      ),
      gain: Number((gain * (1 - idx * 0.15)).toFixed(3)),
    }));
    clusters.push({
      id: clusterId,
      memberIds: members.map((m) => m.id),
      memberCount,
      centroid,
      gain,
      chord,
    });
  }

  clusterSnapshot = clusters;
  playerClusterMap = assignments;
  largestClusterId =
    clusters.reduce<ClusterInfo | null>(
      (prev, current) =>
        !prev || current.memberCount > prev.memberCount ? current : prev,
      null
    )?.id ?? null;
  lastClusterRefresh = Date.now();
}

function ensureClustersFresh(force = false) {
  if (force || Date.now() - lastClusterRefresh > CLUSTER_REFRESH_INTERVAL_MS) {
    recomputeClusters();
  }
}

const serializeCluster = (cluster: ClusterInfo) => ({
  clusterId: cluster.id,
  chord: cluster.chord,
  memberCount: cluster.memberCount,
  centroid: cluster.centroid,
  gain: cluster.gain,
});

const computeNoiseLevel = (p: Player) =>
  clamp(Math.hypot(p.vx, p.vy) / MAX_SPEED, 0, 1);

const computeAmbientLevel = () => clamp(players.size / 12, 0, 1);

const emitAudioForPlayer = (player: Player) => {
  const socket = io.sockets.sockets.get(player.id);
  if (!socket) return;
  const clusterId = playerClusterMap.get(player.id) ?? null;
  const cluster = clusterSnapshot.find((c) => c.id === clusterId);
  socket.emit("audioSelf", {
    noiseLevel: computeNoiseLevel(player),
    ambientLevel: computeAmbientLevel(),
    clusterId,
  });
  if (cluster) {
    socket.emit("audioCluster", serializeCluster(cluster));
  }
};

const emitAudioGlobal = (socketId: string) => {
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) return;
  if (!clusterSnapshot.length) {
    socket.emit("audioGlobal", { cluster: null });
    return;
  }
  const cluster =
    clusterSnapshot.find((c) => c.id === largestClusterId) ??
    clusterSnapshot[0];
  socket.emit("audioGlobal", { cluster: serializeCluster(cluster) });
};

const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

const EVENT_COOLDOWN_MS = 1200;

function detectCollisions() {
  const arr = Array.from(players.values());
  collidingNow.clear();
  for (let i = 0; i < arr.length; i += 1) {
    for (let j = i + 1; j < arr.length; j += 1) {
      const pa = arr[i];
      const pb = arr[j];
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= COLLISION_DISTANCE) {
        // 현재 충돌 중인 플레이어 기록
        collidingNow.add(pa.id);
        collidingNow.add(pb.id);
        const key = pairKey(pa.id, pb.id);
        const now = Date.now();
        const existing = collisionLines.get(key);
        if (!existing) {
          collisionLines.set(key, {
            id: key,
            players: [pa.id, pb.id],
            startedAt: now,
            lastEvent: now,
          });
          collisionEvents.push({
            id: `${key}-${now}`,
            players: [pa.id, pb.id],
            position: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
            radius: 80,
            timestamp: now,
          });
        } else if (now - existing.lastEvent > EVENT_COOLDOWN_MS) {
          existing.lastEvent = now;
          collisionEvents.push({
            id: `${key}-${now}`,
            players: existing.players,
            position: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
            radius: 80,
            timestamp: now,
          });
        }
      }
    }
  }
}

function removePlayerCollisions(id: string) {
  for (const [key, pair] of collisionLines) {
    if (pair.players[0] === id || pair.players[1] === id) {
      collisionLines.delete(key);
    }
  }
}

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:4000",
  "http://127.0.0.1:4000",
  "http://localhost:7773",
  "http://127.0.0.1:7773",
  "https://intersection-web.onrender.com",
  "https://intersection-audio.onrender.com",
  "https://intersection-nextjs.site",
  "https://www.intersection-nextjs.site",
];

const parseOrigins = (raw?: string) =>
  (raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const allowedOrigins = Array.from(
  new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...parseOrigins(process.env.CORS_ORIGINS),
  ])
);

const httpServer = http.createServer((_, res) => {
  res.statusCode = 200;
  res.end("ok");
});

const io = new Server(httpServer, {
  path: SOCKET_PATH,
  transports: ["websocket"],
  allowEIO3: false,
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  pingInterval: 10000,
  pingTimeout: 20000,
});

io.on("connection", (socket) => {
  const type = (socket.handshake.query?.type as string) || "player";
  const isBotConnection = type === "bot";
  socket.emit("noiseSlots:init", noiseSlots);

  if (type === "spectator") {
    spectators.add(socket.id);
    // spectator는 즉시 welcome
    socket.emit("welcome", {}, { width: GAME_WIDTH, height: GAME_HEIGHT });

    socket.on("gotit", () => {
      // no-op: spectator 등록만
    });
  } else {
    // player 핸들러
    socket.on("respawn", () => {
      const pos = spawnPoint();
      const existing = players.get(socket.id);
      const name = existing?.name || "";
      const p: Player = {
        id: socket.id,
        name,
        x: pos.x,
        y: pos.y,
        z: randomDepth(),
        desiredVx: 0,
        desiredVy: 0,
        radius: 20,
        massTotal: PLAYER_BASE_MASS,
        color: "rgba(255,255,255,0.8)",
        screenWidth: existing?.screenWidth || 0,
        screenHeight: existing?.screenHeight || 0,
        lastHeartbeat: Date.now(),
        vx: 0,
        vy: 0,
        gravityDirX: 0,
        gravityDirY: 0,
        gravityDist: Number.POSITIVE_INFINITY,
        isBot: isBotConnection,
      };
      players.set(socket.id, p);
      socket.emit("welcome", toServerPlayer(p), {
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
      });
      ensureClustersFresh(true);
    });

    socket.on(
      "gotit",
      (data: {
        name?: string;
        screenWidth?: number;
        screenHeight?: number;
      }) => {
        const p = players.get(socket.id);
        if (!p) return;
        p.name = (data.name || "").toString().slice(0, 24);
        p.screenWidth = Number(data.screenWidth || 0);
        p.screenHeight = Number(data.screenHeight || 0);
      }
    );

    socket.on(
      "windowResized",
      (data: { screenWidth?: number; screenHeight?: number }) => {
        const p = players.get(socket.id);
        if (!p) return;
        p.screenWidth = Number(data.screenWidth || 0);
        p.screenHeight = Number(data.screenHeight || 0);
      }
    );

    socket.on("0", (payload: { vx?: number; vy?: number }) => {
      const p = players.get(socket.id);
      if (!p) return;
      p.lastHeartbeat = Date.now();
      p.desiredVx = Number(payload?.vx || 0);
      p.desiredVy = Number(payload?.vy || 0);
    });
  }

  socket.on("disconnect", () => {
    spectators.delete(socket.id);
    players.delete(socket.id);
    removePlayerCollisions(socket.id);
    ensureClustersFresh(true);
  });

  // 외부 파라미터 브리지: 클라이언트가 보낸 파라미터 변경을 모두에게 브로드캐스트
  // payload 예: { type: 'setParam', nodeId: '0', paramName: 'value', value: 880 }
  socket.on("param", (payload: unknown) => {
    try {
      io.emit("param", payload);
    } catch {}
  });

  socket.on("noiseSlots:set", (payload: unknown) => {
    const sanitized = sanitizeNoiseSlotPayload(payload);
    if (!sanitized) {
      return;
    }
    noiseSlots = noiseSlots.map((entry) =>
      entry.slot === sanitized.slot
        ? {
            ...entry,
            nodeIds: sanitized.nodeIds.slice(0, 8),
          }
        : entry
    );
    broadcastNoiseSlots();
  });

  socket.on("noiseSlots:clear", (payload: unknown) => {
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof (payload as { slot?: unknown }).slot !== "number"
    ) {
      return;
    }
    const slot = (payload as { slot: number }).slot;
    if (slot < 0 || slot >= NOISE_SLOT_COUNT) return;
    noiseSlots = noiseSlots.map((entry) =>
      entry.slot === slot ? createEmptyNoiseSlot(slot) : entry
    );
    broadcastNoiseSlots();
  });
});

// 게임 루프: 이동 계산
setInterval(() => {
  // 항상 원하는 수만큼 봇이 유지되도록 보정
  ensureBots();

  const now = Date.now();
  const dt = 1 / TICK_HZ;
  const playerList = Array.from(players.values());
  for (const p of playerList) {
    // 봇은 하트비트 없이도 계속 움직이게 허용
    if (!p.isBot && now - p.lastHeartbeat > MAX_HEARTBEAT_MS) {
      // 하트비트 타임아웃: 단순히 타겟 무시
      continue;
    }
    if (p.isBot) {
      updateBotDesiredVelocity(p, now);
    }
    applyNearestGravity(p, playerList, dt);
    moveTowards(p, dt);
  }
}, 1000 / TICK_HZ);

// 업데이트 브로드캐스트
setInterval(() => {
  detectCollisions();
  ensureClustersFresh();
  const collisionSnapshot = Array.from(collisionLines.values());
  const eventsSnapshot = collisionEvents.splice(0);

  // spectator 업데이트
  for (const id of spectators) {
    const s = io.sockets.sockets.get(id);
    if (!s) continue;
    const playerData = {
      x: GAME_WIDTH / 2,
      y: GAME_HEIGHT / 2,
      cells: [],
      massTotal: 0,
      color: "#ccc",
      id,
      name: "",
    };
    s.emit(
      "serverTellPlayerMove",
      playerData,
      Array.from(players.values()).map(toServerPlayer),
      { collisions: collisionSnapshot, collisionEvents: eventsSnapshot }
    );
    s.emit("leaderboard", { players: players.size });
    emitAudioGlobal(id);
  }

  // 각 플레이어별 업데이트
  for (const p of players.values()) {
    const s = io.sockets.sockets.get(p.id);
    if (!s) continue;
    const isColliding = collidingNow.has(p.id);
    const gravity =
      Number.isFinite(p.gravityDist) && p.gravityDist < Number.POSITIVE_INFINITY
        ? {
            x: p.gravityDirX,
            y: p.gravityDirY,
            dist: p.gravityDist,
          }
        : null;
    s.emit("serverTellPlayerMove", toServerPlayer(p), visiblePlayers(p.id), {
      collisions: collisionSnapshot,
      collisionEvents: eventsSnapshot,
      gravity,
      isCollidingSelf: isColliding,
    });
    s.emit("leaderboard", { players: players.size });
    emitAudioForPlayer(p);
  }
}, 1000 / UPDATE_HZ);

// 자기 플레이어 전용 고주파수 업데이트
setInterval(() => {
  for (const p of players.values()) {
    const s = io.sockets.sockets.get(p.id);
    if (!s) continue;
    const isColliding = collidingNow.has(p.id);
    const gravity =
      Number.isFinite(p.gravityDist) && p.gravityDist < Number.POSITIVE_INFINITY
        ? {
            x: p.gravityDirX,
            y: p.gravityDirY,
            dist: p.gravityDist,
          }
        : null;
    // 보간용 빠른 업데이트: 자기 자신 정보 + 최소 메타만 전송
    s.emit("serverTellPlayerMove", toServerPlayer(p), [], {
      fast: true,
      gravity,
      isCollidingSelf: isColliding,
    });
    emitAudioForPlayer(p);
  }
}, 1000 / SELF_UPDATE_HZ);

httpServer.listen(PORT, HOST, () => {
  console.log(`Realtime on http://${HOST}:${PORT}`);
});

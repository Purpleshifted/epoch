import type { PlayerSnapshot, Mode, Vec2 } from "@/types/game";
import type { ServerCell, ServerPlayer } from "@/types/server";

const DEFAULT_COLOR = "rgba(255,255,255,0.6)";

const resolveColor = (player: ServerPlayer): string => {
  if (player.color) return player.color;
  if (typeof player.hue === "number") {
    return `hsl(${Math.round(player.hue)}, 70%, 60%)`;
  }
  return DEFAULT_COLOR;
};

const pickCell = (
  player: ServerPlayer
): {
  position: Vec2;
  radius: number;
  mass: number;
  color: string;
  velocity: Vec2;
  depth?: number;
} => {
  const cells = Array.isArray(player.cells) ? player.cells : [];
  let chosen: ServerCell | null = null;
  if (cells.length > 0) {
    chosen = cells.reduce((prev, cell) => {
      if (!prev) return cell;
      const prevRadius = prev.radius ?? prev.mass ?? 0;
      const nextRadius = cell.radius ?? cell.mass ?? 0;
      return nextRadius > prevRadius ? cell : prev;
    }, cells[0]);
  }

  const fallbackRadius =
    player.massTotal && player.massTotal > 0
      ? Math.max(10, Math.sqrt(player.massTotal))
      : 20;

  const position = {
    x: chosen?.x ?? player.x ?? 0,
    y: chosen?.y ?? player.y ?? 0,
  };

  const radius = chosen?.radius ?? fallbackRadius;
  const mass = chosen?.mass ?? player.massTotal ?? radius * radius;
  const velocity = { x: chosen?.vx ?? 0, y: chosen?.vy ?? 0 };
  const depth = chosen?.z ?? player.z;

  return {
    position,
    radius,
    mass,
    color: resolveColor(player),
    velocity,
    depth,
  };
};

export const toPlayerSnapshot = (
  player: ServerPlayer,
  options: { isSelf?: boolean; fallbackId?: string; fallbackName?: string }
): PlayerSnapshot | null => {
  const id = player.id ?? options.fallbackId;
  if (!id) return null;
  const name = player.name ?? options.fallbackName ?? "";
  const cell = pickCell(player);

  const lastServerPosition: Vec2 = { ...cell.position };
  const lastServerVelocity: Vec2 = { ...cell.velocity };

  return {
    id,
    name,
    cell: {
      position: cell.position,
      velocity: cell.velocity,
      radius: cell.radius,
      mass: cell.mass,
      color: cell.color,
    },
    target: player.target,
    lastUpdate: Date.now(),
    isSelf: options.isSelf,
    depth: cell.depth,
    isPredicted: false,
    lastServerPosition,
    lastServerVelocity,
    predictionOffset: { x: 0, y: 0 },
  };
};

export const mapServerPayloadToSnapshots = (params: {
  playerData?: ServerPlayer;
  userData?: ServerPlayer[];
  mode: Mode;
  selfId?: string | null;
  displayName?: string;
}) => {
  const { playerData, userData = [], mode, selfId, displayName } = params;
  const players: Record<string, PlayerSnapshot> = {};
  const order: string[] = [];

  const pushSnapshot = (
    player: ServerPlayer,
    options: { isSelf?: boolean; fallbackId?: string; fallbackName?: string }
  ) => {
    const snapshot = toPlayerSnapshot(player, options);
    if (!snapshot) return;
    players[snapshot.id] = snapshot;
    if (!order.includes(snapshot.id)) {
      order.push(snapshot.id);
    }
  };

  userData.forEach((player) => {
    pushSnapshot(player, {
      isSelf: Boolean(selfId && player.id === selfId),
    });
  });

  if (playerData) {
    pushSnapshot(playerData, {
      isSelf: mode === "personal",
      fallbackId: selfId ?? playerData.id,
      fallbackName: mode === "personal" ? displayName : playerData.name,
    });
  }

  return { players, order };
};

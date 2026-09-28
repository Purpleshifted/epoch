import type { GameState, PlayerSnapshot } from "@/types/game";
import type { PersonalAudioMetrics } from "@/lib/audio/noiseCraft";

const MAX_CLOSING_SPEED = 320; // 서버 MAX_SPEED 기준, 상대 속도는 이 이상이면 1로 클램프
const PROXIMITY_INNER_RADIUS = 800;
const DENSITY_RADIUS = 800;
const MAX_DENSITY_NEIGHBORS = 8;

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

export const computePersonalAudioMetrics = (
  state: GameState
): PersonalAudioMetrics => {
  const selfId = state.selfId;
  if (!selfId) {
    return {
      approachIntensity: 0,
      nearestProximity: 0,
      localDensity: 0,
      clusterEnergy: 0,
    };
  }
  const selfPlayer = state.players[selfId];
  if (!selfPlayer) {
    return {
      approachIntensity: 0,
      nearestProximity: 0,
      localDensity: 0,
      clusterEnergy: 0,
    };
  }
  const { position: selfPos, velocity: selfVel } = selfPlayer.cell;
  let minDist = Number.POSITIVE_INFINITY;
  let nearestPlayer: PlayerSnapshot | null = null;
  let neighborCount = 0;
  for (const player of Object.values(state.players)) {
    if (player.id === selfId) continue;
    const dx = player.cell.position.x - selfPos.x;
    const dy = player.cell.position.y - selfPos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < DENSITY_RADIUS) {
      neighborCount += 1;
    }
    if (dist < minDist) {
      minDist = dist;
      nearestPlayer = player;
    }
  }
  let approachIntensity = 0;
  let nearestProximity = 0;
  if (nearestPlayer && Number.isFinite(minDist)) {
    const safeDist = Math.max(minDist, 1e-3);
    const dirX = (nearestPlayer.cell.position.x - selfPos.x) / safeDist;
    const dirY = (nearestPlayer.cell.position.y - selfPos.y) / safeDist;
    const relVelX = selfVel.x - nearestPlayer.cell.velocity.x;
    const relVelY = selfVel.y - nearestPlayer.cell.velocity.y;
    const closingSpeed = Math.max(relVelX * dirX + relVelY * dirY, 0);
    approachIntensity = clamp01(closingSpeed / MAX_CLOSING_SPEED);
    nearestProximity = clamp01(1 - minDist / PROXIMITY_INNER_RADIUS);
  }

  const localDensity =
    neighborCount > 0 ? clamp01(neighborCount / MAX_DENSITY_NEIGHBORS) : 0;

  let clusterEnergy = 0;
  if (state.audio.cluster && state.audio.self?.clusterId) {
    if (state.audio.cluster.clusterId === state.audio.self.clusterId) {
      clusterEnergy = clamp01(state.audio.cluster.gain);
    }
  }

  return {
    approachIntensity,
    nearestProximity,
    localDensity,
    clusterEnergy,
  };
};



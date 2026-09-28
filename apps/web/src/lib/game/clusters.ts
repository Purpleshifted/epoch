import type { PlayerSnapshot, Vec2 } from "@/types/game";

const DEFAULT_CLUSTER_RADIUS = 420;

export interface PlayerClusterSummary {
  id: string;
  memberIds: string[];
  memberCount: number;
  centroid: Vec2;
  members: PlayerSnapshot[];
}

export interface AnnotatedCluster extends PlayerClusterSummary {
  label: string;
  rank: number;
  isMulti: boolean;
}

const averagePosition = (members: PlayerSnapshot[]): Vec2 => {
  if (members.length === 0) {
    return { x: 0, y: 0 };
  }
  const total = members.reduce(
    (acc, member) => {
      acc.x += member.cell.position.x;
      acc.y += member.cell.position.y;
      return acc;
    },
    { x: 0, y: 0 }
  );
  return {
    x: total.x / members.length,
    y: total.y / members.length,
  };
};

export const computePlayerClusters = (
  players: PlayerSnapshot[],
  radius = DEFAULT_CLUSTER_RADIUS
): PlayerClusterSummary[] => {
  if (!players.length) {
    return [];
  }
  const visited = new Set<string>();
  const clusters: PlayerClusterSummary[] = [];
  const radiusSq = radius * radius;

  for (const seed of players) {
    if (visited.has(seed.id)) continue;
    const queue: PlayerSnapshot[] = [seed];
    const members: PlayerSnapshot[] = [];
    visited.add(seed.id);

    while (queue.length) {
      const current = queue.pop()!;
      members.push(current);
      for (const candidate of players) {
        if (visited.has(candidate.id)) continue;
        const dx = current.cell.position.x - candidate.cell.position.x;
        const dy = current.cell.position.y - candidate.cell.position.y;
        if (dx * dx + dy * dy <= radiusSq) {
          visited.add(candidate.id);
          queue.push(candidate);
        }
      }
    }

    const id = members[0]?.id ?? `cluster-${clusters.length}`;
    clusters.push({
      id,
      memberIds: members.map((member) => member.id),
      memberCount: members.length,
      centroid: averagePosition(members),
      members,
    });
  }

  return clusters;
};

export const analyzeClusters = (
  players: PlayerSnapshot[],
  radius = DEFAULT_CLUSTER_RADIUS
): {
  clusters: AnnotatedCluster[];
  assignments: Map<string, AnnotatedCluster>;
} => {
  const baseClusters = computePlayerClusters(players, radius);
  const sorted = [...baseClusters].sort(
    (a, b) => b.memberCount - a.memberCount
  );
  const annotated: AnnotatedCluster[] = sorted.map((cluster, index) => {
    const isMulti = cluster.memberCount > 1;
    return {
      ...cluster,
      label: isMulti ? `클러스터 ${index + 1}` : "단독",
      rank: index + 1,
      isMulti,
    };
  });

  const assignments = new Map<string, AnnotatedCluster>();
  annotated.forEach((cluster) => {
    cluster.memberIds.forEach((memberId) => {
      assignments.set(memberId, cluster);
    });
  });

  return {
    clusters: annotated,
    assignments,
  };
};

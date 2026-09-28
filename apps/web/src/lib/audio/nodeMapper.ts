/**
 * Utility to map NoiseCraft nodes from .ncft file to browser view
 * 
 * This helps visualize which nodes correspond to which elements
 * in the browser view at https://noisecraft.app/1469
 */

export interface NodeInfo {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  params?: Record<string, any>;
  connections?: {
    inputs: Array<{ fromNodeId: string; fromOutput: number }>;
    outputs: string[];
  };
}

export interface NoiseCraftProject {
  title?: string;
  nodes: Record<string, any>;
}

/**
 * Parse a NoiseCraft .ncft file and extract node information
 */
export function parseNoiseCraftFile(fileContent: string): NoiseCraftProject {
  const data = JSON.parse(fileContent);
  return {
    title: data.title,
    nodes: data.nodes || {},
  };
}

/**
 * Extract node information with position and connection details
 */
export function extractNodeInfo(
  project: NoiseCraftProject
): Map<string, NodeInfo> {
  const nodesMap = new Map<string, NodeInfo>();
  const { nodes } = project;

  for (const [nodeId, nodeData] of Object.entries(nodes)) {
    const node = nodeData as any;
    const inputs = (node.ins || []).map((input: any) => {
      if (Array.isArray(input) && input.length >= 2) {
        return {
          fromNodeId: String(input[0]),
          fromOutput: input[1] || 0,
        };
      }
      return null;
    }).filter(Boolean);

    nodesMap.set(nodeId, {
      id: nodeId,
      type: node.type || "Unknown",
      name: node.name || node.type || "Unnamed",
      x: node.x || 0,
      y: node.y || 0,
      params: node.params || {},
      connections: {
        inputs,
        outputs: node.outNames || [],
      },
    });
  }

  return nodesMap;
}

/**
 * Find nodes by type
 */
export function findNodesByType(
  nodesMap: Map<string, NodeInfo>,
  nodeType: string
): NodeInfo[] {
  return Array.from(nodesMap.values()).filter(
    (node) => node.type === nodeType
  );
}

/**
 * Find nodes that can be modulated (Knob, Const, etc.)
 */
export function findModulatableNodes(
  nodesMap: Map<string, NodeInfo>
): NodeInfo[] {
  const modulatableTypes = ["Knob", "Const"];
  return Array.from(nodesMap.values()).filter((node) =>
    modulatableTypes.includes(node.type)
  );
}

/**
 * Find nodes in a specific area (for visual debugging)
 */
export function findNodesInArea(
  nodesMap: Map<string, NodeInfo>,
  x: number,
  y: number,
  radius: number = 100
): NodeInfo[] {
  return Array.from(nodesMap.values()).filter((node) => {
    const dx = node.x - x;
    const dy = node.y - y;
    return Math.sqrt(dx * dx + dy * dy) <= radius;
  });
}

/**
 * Generate a visual map of nodes with their browser coordinates
 * This can be used to find a node in the browser view
 */
export function generateNodeMap(project: NoiseCraftProject): {
  byPosition: { x: number; y: number; nodes: NodeInfo[] }[];
  byType: Record<string, NodeInfo[]>;
  modulatable: NodeInfo[];
} {
  const nodesMap = extractNodeInfo(project);
  const nodes = Array.from(nodesMap.values());

  // Group by position (rounded to nearest 50 for clustering)
  const positionMap = new Map<string, NodeInfo[]>();
  for (const node of nodes) {
    const key = `${Math.round(node.x / 50) * 50},${Math.round(node.y / 50) * 50}`;
    if (!positionMap.has(key)) {
      positionMap.set(key, []);
    }
    positionMap.get(key)!.push(node);
  }

  // Group by type
  const byType: Record<string, NodeInfo[]> = {};
  for (const node of nodes) {
    if (!byType[node.type]) {
      byType[node.type] = [];
    }
    byType[node.type].push(node);
  }

  return {
    byPosition: Array.from(positionMap.entries()).map(([key, nodes]) => {
      const [x, y] = key.split(",").map(Number);
      return { x, y, nodes };
    }),
    byType,
    modulatable: findModulatableNodes(nodesMap),
  };
}

/**
 * Find a node by name (fuzzy search)
 */
export function findNodeByName(
  nodesMap: Map<string, NodeInfo>,
  searchName: string
): NodeInfo | null {
  const lowerSearch = searchName.toLowerCase();
  for (const node of nodesMap.values()) {
    if (node.name.toLowerCase().includes(lowerSearch)) {
      return node;
    }
  }
  return null;
}

/**
 * Get all nodes connected to a specific node
 */
export function getConnectedNodes(
  nodesMap: Map<string, NodeInfo>,
  nodeId: string
): {
  inputs: NodeInfo[];
  outputs: NodeInfo[];
} {
  const node = nodesMap.get(nodeId);
  if (!node) {
    return { inputs: [], outputs: [] };
  }

  const inputNodes: NodeInfo[] = [];
  if (node.connections?.inputs) {
    for (const input of node.connections.inputs) {
      const inputNode = nodesMap.get(input.fromNodeId);
      if (inputNode) {
        inputNodes.push(inputNode);
      }
    }
  }

  const outputNodes: NodeInfo[] = [];
  // Find nodes that have this node as input
  for (const otherNode of nodesMap.values()) {
    if (otherNode.connections?.inputs) {
      for (const input of otherNode.connections.inputs) {
        if (input.fromNodeId === nodeId) {
          outputNodes.push(otherNode);
          break;
        }
      }
    }
  }

  return { inputs: inputNodes, outputs: outputNodes };
}




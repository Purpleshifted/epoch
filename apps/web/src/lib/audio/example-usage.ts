/**
 * Example: Complete workflow for using virtual signals with NoiseCraft
 * 
 * This demonstrates:
 * 1. Loading and parsing a NoiseCraft file
 * 2. Finding modulatable nodes
 * 3. Setting up virtual signal generator
 * 4. Connecting to game state
 */

import {
  parseNoiseCraftFile,
  extractNodeInfo,
  findModulatableNodes,
  findNodeByName,
} from "./nodeMapper";
import {
  VirtualSignalGenerator,
  createAttractionModulationConfig,
  createVelocityModulationConfig,
  createDistanceModulationConfig,
  randomChromaticTone,
} from "./virtualSignals";
import { postNoiseCraftParams, resolveNoiseCraftEmbed } from "./noiseCraft";

/**
 * Example: Complete setup for audio modulation with virtual signals
 */
export async function setupAudioModulationWithVirtualSignals() {
  // Step 1: Load and parse the NoiseCraft file
  const filePath = "/noisecraft/examples/falling_in_love_with_waterfalls (2).ncft";
  const fileContent = await fetch(filePath).then((r) => r.text());
  const project = parseNoiseCraftFile(fileContent);

  // Step 2: Extract node information
  const nodesMap = extractNodeInfo(project);
  const modulatableNodes = findModulatableNodes(nodesMap);

  console.log(`Found ${modulatableNodes.length} modulatable nodes`);

  // Step 3: Find specific nodes we want to modulate
  const factNode = findNodeByName(nodesMap, "fact"); // Node 206
  const volNode = findNodeByName(nodesMap, "Vol CHORDS"); // Node 183
  const percentNode = findNodeByName(nodesMap, "%"); // Node 17

  // Step 4: Create virtual signal generator
  const generator = new VirtualSignalGenerator(100); // 100 pixel threshold

  // Step 5: Configure modulation signals
  if (factNode) {
    // Modulate "fact" based on particle attraction
    generator.addSignal(
      createAttractionModulationConfig(
        factNode.id,
        "value",
        0, // min
        0.1 // max (matches node's maxVal)
      )
    );
  }

  if (volNode) {
    // Modulate "Vol CHORDS" based on velocity
    generator.addSignal(
      createVelocityModulationConfig(
        volNode.id,
        "value",
        0.15, // min
        0.8 // max
      )
    );
  }

  if (percentNode) {
    // Modulate "%" based on distance (inverted - closer = higher)
    generator.addSignal(
      createDistanceModulationConfig(
        percentNode.id,
        "value",
        0, // min
        1, // max
        true // inverted
      )
    );
  }

  // Step 6: Create initial particles
  const userParticleId = "user-1";
  generator.createParticle(
    userParticleId,
    { x: 2500, y: 2500 },
    { x: 0, y: 0 },
    {
      mass: 1,
      radius: 20,
      tone: randomChromaticTone(),
    }
  );

  // Step 7: Get NoiseCraft iframe reference
  const { origin } = resolveNoiseCraftEmbed();
  const iframe = document.querySelector<HTMLIFrameElement>(
    'iframe[src*="embedded.html"]'
  );

  return {
    generator,
    userParticleId,
    nodesMap,
    iframe,
    origin,
  };
}

/**
 * Example: Update virtual signals from game state
 */
export function updateVirtualSignalsFromGameState(
  generator: VirtualSignalGenerator,
  userParticleId: string,
  gameState: {
    players: Record<
      string,
      {
        cell: {
          position: { x: number; y: number };
          velocity: { x: number; y: number };
        };
      }
    >;
    selfId: string | null;
  },
  iframe: HTMLIFrameElement | null,
  origin: string | null
) {
  if (!gameState.selfId) return;

  const selfPlayer = gameState.players[gameState.selfId];
  if (!selfPlayer) return;

  // Update user particle from game state
  generator.updateParticle(userParticleId, {
    position: selfPlayer.cell.position,
    velocity: selfPlayer.cell.velocity,
  });

  // Update neighbor particles
  for (const [playerId, player] of Object.entries(gameState.players)) {
    if (playerId === gameState.selfId) continue;

    const neighborId = `neighbor-${playerId}`;
    const existing = generator.getParticles().find((p) => p.id === neighborId);

    if (existing) {
      generator.updateParticle(neighborId, {
        position: player.cell.position,
        velocity: player.cell.velocity,
      });
    } else {
      // Create new neighbor particle
      generator.createParticle(
        neighborId,
        player.cell.position,
        player.cell.velocity,
        {
          mass: 1,
          radius: 20,
          tone: randomChromaticTone(),
        }
      );
    }
  }

  // Remove particles that no longer exist
  const currentNeighborIds = Object.keys(gameState.players)
    .filter((id) => id !== gameState.selfId)
    .map((id) => `neighbor-${id}`);
  const existingNeighbors = generator
    .getParticles()
    .filter((p) => p.id.startsWith("neighbor-"))
    .map((p) => p.id);
  for (const id of existingNeighbors) {
    if (!currentNeighborIds.includes(id)) {
      generator.removeParticle(id);
    }
  }

  // Generate and send parameters
  const params = generator.generateParams(userParticleId);
  if (params.length > 0) {
    postNoiseCraftParams(iframe, origin, params);
  }
}

/**
 * Example: Run continuous simulation
 */
export function startVirtualSignalSimulation(
  generator: VirtualSignalGenerator,
  userParticleId: string,
  gameStateGetter: () => {
    players: Record<
      string,
      {
        cell: {
          position: { x: number; y: number };
          velocity: { x: number; y: number };
        };
      }
    >;
    selfId: string | null;
  },
  iframe: HTMLIFrameElement | null,
  origin: string | null,
  intervalMs: number = 100
) {
  let running = true;
  let lastUpdate = Date.now();

  const update = () => {
    if (!running) return;

    const now = Date.now();
    const dt = (now - lastUpdate) / 1000;
    lastUpdate = now;

    // Get current game state
    const gameState = gameStateGetter();

    // Update virtual signals from game state
    updateVirtualSignalsFromGameState(
      generator,
      userParticleId,
      gameState,
      iframe,
      origin
    );

    // Schedule next update
    setTimeout(update, intervalMs);
  };

  update();

  // Return cleanup function
  return () => {
    running = false;
  };
}

/**
 * Example: Simple standalone test
 */
export async function runStandaloneTest() {
  const setup = await setupAudioModulationWithVirtualSignals();
  const { generator, userParticleId, iframe, origin } = setup;

  // Create some test neighbors
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const distance = 100 + Math.random() * 100;
    generator.createParticle(
      `test-${i}`,
      {
        x: 2500 + Math.cos(angle) * distance,
        y: 2500 + Math.sin(angle) * distance,
      },
      {
        x: (Math.random() - 0.5) * 50,
        y: (Math.random() - 0.5) * 50,
      },
      {
        mass: 1,
        radius: 20,
        tone: randomChromaticTone(),
      }
    );
  }

  // Simulate for a few seconds
  const startTime = Date.now();
  const duration = 5000; // 5 seconds

  const interval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    if (elapsed >= duration) {
      clearInterval(interval);
      return;
    }

    // Simulate movement
    generator.simulate(1 / 60);

    // Generate and send parameters
    const params = generator.generateParams(userParticleId);
    if (params.length > 0) {
      postNoiseCraftParams(iframe, origin, params);
      console.log("Sent parameters:", params);
    }
  }, 100);

  return () => clearInterval(interval);
}




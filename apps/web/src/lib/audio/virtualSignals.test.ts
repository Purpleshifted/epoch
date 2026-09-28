/**
 * Example usage and testing of virtual signal generator
 * 
 * This demonstrates how to use the virtual signal generator
 * for testing audio modulation with particle interactions
 */

import {
  VirtualSignalGenerator,
  createTestScenario,
  createAttractionModulationConfig,
  createVelocityModulationConfig,
  createDistanceModulationConfig,
  createToneModulationConfig,
  randomChromaticTone,
} from "./virtualSignals";
import { postNoiseCraftParams } from "./noiseCraft";

/**
 * Example: Set up virtual signal generator with test particles
 */
export function setupVirtualSignalTest() {
  const generator = new VirtualSignalGenerator(100); // threshold = 100

  // Create test particles
  const particleIds = createTestScenario(generator, 5);

  // Configure signals for modulation
  // Example: Modulate node "206" (fact knob) based on attraction
  generator.addSignal(
    createAttractionModulationConfig("206", "value", 0, 0.1)
  );

  // Example: Modulate node "183" (Vol CHORDS) based on velocity
  generator.addSignal(
    createVelocityModulationConfig("183", "value", 0, 1)
  );

  // Example: Modulate distance-based parameter
  generator.addSignal(
    createDistanceModulationConfig("17", "value", 0, 1, true)
  );

  return { generator, particleIds };
}

/**
 * Example: Run a simulation loop
 */
export function runVirtualSignalSimulation(
  generator: VirtualSignalGenerator,
  targetParticleId: string,
  iframe: HTMLIFrameElement | null,
  origin: string | null,
  intervalMs: number = 100
) {
  let animationFrame: number | null = null;
  let lastTime = Date.now();

  const update = () => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000; // Convert to seconds
    lastTime = now;

    // Simulate particle physics
    generator.simulate(dt);

    // Generate parameters from current state
    const params = generator.generateParams(targetParticleId);

    // Send to NoiseCraft
    if (params.length > 0) {
      postNoiseCraftParams(iframe, origin, params);
    }

    // Schedule next update
    animationFrame = requestAnimationFrame(() => {
      setTimeout(update, intervalMs);
    });
  };

  update();

  // Return cleanup function
  return () => {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
    }
  };
}

/**
 * Example: Create a simple demo with manual particle control
 */
export function createInteractiveDemo() {
  const generator = new VirtualSignalGenerator(100);

  // Create a central particle (the "user")
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

  // Create some nearby particles
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const distance = 150 + Math.random() * 100;
    generator.createParticle(
      `neighbor-${i}`,
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

  // Configure modulation signals
  generator.addSignal(
    createAttractionModulationConfig("206", "value", 0, 0.1)
  );
  generator.addSignal(
    createVelocityModulationConfig("183", "value", 0.1, 0.8)
  );

  return { generator, userParticleId };
}

/**
 * Example: Update particle position from game state
 */
export function syncParticleFromGameState(
  generator: VirtualSignalGenerator,
  particleId: string,
  gameState: {
    position: { x: number; y: number };
    velocity: { x: number; y: number };
  }
) {
  generator.updateParticle(particleId, {
    position: gameState.position,
    velocity: gameState.velocity,
  });
}

/**
 * Example: Get all interaction data for debugging
 */
export function getInteractionDebugInfo(
  generator: VirtualSignalGenerator,
  particleId: string
) {
  const particles = generator.getParticles();
  const target = particles.find((p) => p.id === particleId);
  if (!target) return null;

  const interactions = particles
    .filter((p) => p.id !== particleId)
    .map((other) => {
      const { calculateInteraction } = require("./virtualSignals");
      return {
        otherId: other.id,
        ...calculateInteraction(target, other, 100),
      };
    });

  return {
    particle: target,
    interactions,
    nearest: interactions.reduce((nearest, current) => {
      return current.distance < (nearest?.distance || Infinity)
        ? current
        : nearest;
    }, null as any),
  };
}




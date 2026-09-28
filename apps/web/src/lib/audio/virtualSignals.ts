/**
 * Virtual Signal Generator for Testing Audio Modulation
 * 
 * Generates virtual streams of signals for testing audio modulation
 * based on particle interactions, velocity, distance, etc.
 */

import type { NoiseCraftParam } from "./noiseCraft";

/**
 * Chromatic scale: 12 semitones per octave
 * Maps to MIDI note numbers in a single octave (0-11)
 */
export const CHROMATIC_NOTES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, // C, C#, D, D#, E, F, F#, G, G#, A, A#, B
] as const;

/**
 * Generate a random tone from 12-tone chromatic scale
 */
export function randomChromaticTone(): number {
  return Math.floor(Math.random() * 12);
}

/**
 * Convert chromatic tone (0-11) to frequency ratio
 * 0 = C (1.0), 1 = C# (2^(1/12)), etc.
 */
export function chromaticToneToRatio(tone: number): number {
  return Math.pow(2, tone / 12);
}

/**
 * Virtual particle for testing
 */
export interface VirtualParticle {
  id: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  mass: number;
  radius: number;
  color?: string;
  tone?: number; // 0-11 for chromatic scale
  createdAt: number;
}

/**
 * Particle interaction calculation result
 */
export interface ParticleInteraction {
  distance: number;
  relativeVelocity: number;
  closingSpeed: number;
  attraction: number; // 0-1 normalized attraction
  isNearThreshold: boolean; // within interaction threshold
  isOverThreshold: boolean; // over interaction threshold
}

/**
 * Calculate interaction between two particles
 */
export function calculateInteraction(
  p1: VirtualParticle,
  p2: VirtualParticle,
  threshold: number = 100
): ParticleInteraction {
  const dx = p2.position.x - p1.position.x;
  const dy = p2.position.y - p1.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Relative velocity
  const relVx = p2.velocity.x - p1.velocity.x;
  const relVy = p2.velocity.y - p1.velocity.y;
  const relativeVelocity = Math.sqrt(relVx * relVx + relVy * relVy);

  // Closing speed (projection along line connecting particles)
  const dirX = distance > 0 ? dx / distance : 0;
  const dirY = distance > 0 ? dy / distance : 0;
  const closingSpeed = Math.max(
    0,
    relVx * dirX + relVy * dirY
  );

  // Attraction normalized 0-1 (inverse distance, clamped)
  const maxDist = threshold * 3;
  const normalizedDistance = Math.min(distance, maxDist) / maxDist;
  const attraction = 1 - normalizedDistance;

  const isOverThreshold = distance <= threshold;
  const isNearThreshold =
    distance > threshold && distance <= threshold * 1.5;

  return {
    distance,
    relativeVelocity,
    closingSpeed,
    attraction,
    isNearThreshold,
    isOverThreshold,
  };
}

/**
 * Generate virtual signals from particle interactions
 */
export interface VirtualSignalConfig {
  nodeId: string;
  paramName?: string;
  signalType: "attraction" | "velocity" | "distance" | "closingSpeed" | "tone";
  minValue: number;
  maxValue: number;
  threshold?: number;
  inverted?: boolean; // invert the signal (1 - value)
}

/**
 * Virtual signal stream generator
 */
export class VirtualSignalGenerator {
  private particles: Map<string, VirtualParticle> = new Map();
  private configs: VirtualSignalConfig[] = [];
  private threshold: number;

  constructor(threshold: number = 100) {
    this.threshold = threshold;
  }

  /**
   * Add a signal configuration
   */
  addSignal(config: VirtualSignalConfig): void {
    this.configs.push(config);
  }

  /**
   * Create a new virtual particle
   */
  createParticle(
    id: string,
    position: { x: number; y: number },
    velocity: { x: number; y: number } = { x: 0, y: 0 },
    options: {
      mass?: number;
      radius?: number;
      tone?: number;
    } = {}
  ): VirtualParticle {
    const particle: VirtualParticle = {
      id,
      position,
      velocity,
      mass: options.mass || 1,
      radius: options.radius || 20,
      tone: options.tone ?? randomChromaticTone(),
      createdAt: Date.now(),
    };
    this.particles.set(id, particle);
    return particle;
  }

  /**
   * Update particle position and velocity
   */
  updateParticle(
    id: string,
    updates: {
      position?: { x: number; y: number };
      velocity?: { x: number; y: number };
    }
  ): void {
    const particle = this.particles.get(id);
    if (!particle) return;

    if (updates.position) {
      particle.position = { ...updates.position };
    }
    if (updates.velocity) {
      particle.velocity = { ...updates.velocity };
    }
  }

  /**
   * Remove a particle
   */
  removeParticle(id: string): void {
    this.particles.delete(id);
  }

  /**
   * Generate NoiseCraft parameters from current particle state
   */
  generateParams(targetParticleId: string): NoiseCraftParam[] {
    const target = this.particles.get(targetParticleId);
    if (!target) return [];

    const params: NoiseCraftParam[] = [];
    const particles = Array.from(this.particles.values());

    // Find nearest particle for interaction calculations
    let nearestInteraction: ParticleInteraction | null = null;
    let nearestParticle: VirtualParticle | null = null;
    let minDistance = Infinity;

    for (const other of particles) {
      if (other.id === targetParticleId) continue;
      const interaction = calculateInteraction(target, other, this.threshold);
      if (interaction.distance < minDistance) {
        minDistance = interaction.distance;
        nearestInteraction = interaction;
        nearestParticle = other;
      }
    }

    // Generate signals based on configurations
    for (const config of this.configs) {
      let value: number = 0;

      switch (config.signalType) {
        case "attraction":
          value = nearestInteraction
            ? nearestInteraction.attraction
            : 0;
          break;

        case "velocity":
          value = Math.sqrt(
            target.velocity.x ** 2 + target.velocity.y ** 2
          );
          // Normalize to 0-1 (assuming max velocity of 320)
          value = Math.min(value / 320, 1);
          break;

        case "distance":
          value = nearestInteraction
            ? nearestInteraction.distance
            : this.threshold * 3;
          // Normalize to 0-1 (inverse, closer = higher)
          value = 1 - Math.min(value / (this.threshold * 3), 1);
          break;

        case "closingSpeed":
          value = nearestInteraction
            ? Math.min(nearestInteraction.closingSpeed / 320, 1)
            : 0;
          break;

        case "tone":
          // Convert chromatic tone to normalized value
          value = target.tone !== undefined ? target.tone / 11 : 0;
          break;
      }

      // Map to configured range
      const mappedValue =
        config.minValue +
        (config.maxValue - config.minValue) * value;

      // Apply inversion if needed
      const finalValue = config.inverted
        ? config.maxValue + config.minValue - mappedValue
        : mappedValue;

      params.push({
        nodeId: config.nodeId,
        paramName: config.paramName || "value",
        value: finalValue,
      });
    }

    return params;
  }

  /**
   * Get all particles
   */
  getParticles(): VirtualParticle[] {
    return Array.from(this.particles.values());
  }

  /**
   * Simulate particle movement (simple physics)
   */
  simulate(dt: number = 1 / 60): void {
    const particles = Array.from(this.particles.values());

    for (const particle of particles) {
      // Apply velocity
      particle.position.x += particle.velocity.x * dt;
      particle.position.y += particle.velocity.y * dt;

      // Simple boundary reflection (optional)
      // You can customize this based on your game bounds
    }
  }
}

/**
 * Create a test scenario with multiple particles
 */
export function createTestScenario(
  generator: VirtualSignalGenerator,
  numParticles: number = 5
): string[] {
  const particleIds: string[] = [];
  const centerX = 2500;
  const centerY = 2500;
  const spread = 500;

  for (let i = 0; i < numParticles; i++) {
    const angle = (i / numParticles) * Math.PI * 2;
    const distance = Math.random() * spread;
    const id = `test-${i}`;
    particleIds.push(id);

    generator.createParticle(
      id,
      {
        x: centerX + Math.cos(angle) * distance,
        y: centerY + Math.sin(angle) * distance,
      },
      {
        x: (Math.random() - 0.5) * 100,
        y: (Math.random() - 0.5) * 100,
      },
      {
        mass: 1,
        radius: 20,
        tone: randomChromaticTone(),
      }
    );
  }

  return particleIds;
}

/**
 * Helper to create signal configurations for common modulation patterns
 */
export function createAttractionModulationConfig(
  nodeId: string,
  paramName: string = "value",
  minValue: number = 0,
  maxValue: number = 1
): VirtualSignalConfig {
  return {
    nodeId,
    paramName,
    signalType: "attraction",
    minValue,
    maxValue,
  };
}

export function createVelocityModulationConfig(
  nodeId: string,
  paramName: string = "value",
  minValue: number = 0,
  maxValue: number = 1
): VirtualSignalConfig {
  return {
    nodeId,
    paramName,
    signalType: "velocity",
    minValue,
    maxValue,
  };
}

export function createDistanceModulationConfig(
  nodeId: string,
  paramName: string = "value",
  minValue: number = 0,
  maxValue: number = 1,
  inverted: boolean = true
): VirtualSignalConfig {
  return {
    nodeId,
    paramName,
    signalType: "distance",
    minValue,
    maxValue,
    inverted,
  };
}

export function createToneModulationConfig(
  nodeId: string,
  paramName: string = "value",
  minValue: number = 0,
  maxValue: number = 1
): VirtualSignalConfig {
  return {
    nodeId,
    paramName,
    signalType: "tone",
    minValue,
    maxValue,
  };
}


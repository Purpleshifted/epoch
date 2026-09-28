/**
 * Individual Audio Routing System
 * 
 * Handles audio for individual users/particles, focusing on:
 * - Nearby particle interactions
 * - Panning/localization based on relative positions
 * - Auditory cues for other particles' behavior
 * 
 * Separated from global audio system for modularity
 */

export class IndividualAudioRouter {
  constructor(options = {}) {
    this.maxDistance = options.maxDistance || 300; // Maximum distance for audio interaction
    this.panningRange = options.panningRange || 0.8; // Maximum pan value (-1 to 1)
    this.updateRate = options.updateRate || 60; // Updates per second
    this.userParticleMap = new Map(); // Map userId -> particleId
    this.particleUserMap = new Map(); // Map particleId -> userId
  }

  /**
   * Register a user with a particle
   * @param {string} userId - Unique user identifier
   * @param {number} particleId - Particle ID in the particle system
   */
  registerUser(userId, particleId) {
    this.userParticleMap.set(userId, particleId);
    this.particleUserMap.set(particleId, userId);
  }

  /**
   * Unregister a user (when they leave)
   * @param {string} userId - User identifier to remove
   */
  unregisterUser(userId) {
    const particleId = this.userParticleMap.get(userId);
    if (particleId !== undefined) {
      this.userParticleMap.delete(userId);
      this.particleUserMap.delete(particleId);
    }
  }

  /**
   * Get particle ID for a user
   * @param {string} userId - User identifier
   * @returns {number|null} Particle ID or null if not found
   */
  getParticleId(userId) {
    return this.userParticleMap.get(userId) ?? null;
  }

  /**
   * Get user ID for a particle
   * @param {number} particleId - Particle ID
   * @returns {string|null} User ID or null if not found
   */
  getUserId(particleId) {
    return this.particleUserMap.get(particleId) ?? null;
  }

  /**
   * Calculate panning value based on relative position
   * @param {Object} selfPos - {x, y} position of self particle
   * @param {Object} otherPos - {x, y} position of other particle
   * @returns {number} Pan value from -1 (left) to 1 (right)
   */
  calculatePan(selfPos, otherPos) {
    const dx = otherPos.x - selfPos.x;
    const distance = Math.sqrt(dx * dx + (otherPos.y - selfPos.y) ** 2);
    
    if (distance === 0) return 0;
    
    // Pan based on horizontal offset, scaled by distance
    const normalizedDx = dx / distance;
    return normalizedDx * this.panningRange;
  }

  /**
   * Calculate distance-based gain attenuation
   * @param {number} distance - Distance between particles
   * @returns {number} Gain value from 0 to 1
   */
  calculateDistanceGain(distance) {
    if (distance >= this.maxDistance) return 0;
    
    // Inverse square law with smoothing
    const normalizedDistance = distance / this.maxDistance;
    return Math.max(0, (1 - normalizedDistance) ** 2);
  }

  /**
   * Find nearby particles for a given particle
   * @param {number} particleId - Particle ID
   * @param {Array} allParticles - Array of all particles
   * @returns {Array} Array of nearby particles with distance info
   */
  findNearbyParticles(particleId, allParticles) {
    const selfParticle = allParticles.find(p => p.id === particleId);
    if (!selfParticle) return [];

    const nearby = [];
    
    for (const otherParticle of allParticles) {
      if (otherParticle.id === particleId) continue; // Skip self
      
      const dx = otherParticle.position.x - selfParticle.position.x;
      const dy = otherParticle.position.y - selfParticle.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= this.maxDistance) {
        nearby.push({
          particle: otherParticle,
          distance,
          pan: this.calculatePan(selfParticle.position, otherParticle.position),
          gain: this.calculateDistanceGain(distance),
          relativeVelocity: {
            x: otherParticle.velocity.x - selfParticle.velocity.x,
            y: otherParticle.velocity.y - selfParticle.velocity.y,
          },
        });
      }
    }
    
    // Sort by distance (closest first)
    nearby.sort((a, b) => a.distance - b.distance);
    
    return nearby;
  }

  /**
   * Generate individual audio parameters for a user
   * Focuses on interactions with nearby particles
   * @param {string} userId - User identifier
   * @param {Array} allParticles - Array of all particles from particle system
   * @param {Object} signalGenerator - Signal generator instance
   * @returns {Object} Audio parameters for individual routing
   */
  generateIndividualAudio(userId, allParticles, signalGenerator) {
    const particleId = this.getParticleId(userId);
    if (particleId === null) {
      return {
        enabled: false,
        nearbyParticles: [],
        panning: [],
        gains: [],
        interactions: [],
      };
    }

    const selfParticle = allParticles.find(p => p.id === particleId);
    if (!selfParticle) {
      return {
        enabled: false,
        nearbyParticles: [],
        panning: [],
        gains: [],
        interactions: [],
      };
    }

    // Find nearby particles
    const nearby = this.findNearbyParticles(particleId, allParticles);
    
    // Generate signals for self particle (for context)
    const selfSignals = signalGenerator.generateSignals(particleId);
    
    // Build interaction data for each nearby particle
    const interactions = nearby.map(({ particle, distance, pan, gain, relativeVelocity }) => {
      const otherSignals = signalGenerator.generateSignals(particle.id);
      
      // Calculate interaction strength
      const closingSpeed = Math.hypot(relativeVelocity.x, relativeVelocity.y);
      const isApproaching = 
        (particle.position.x - selfParticle.position.x) * relativeVelocity.x +
        (particle.position.y - selfParticle.position.y) * relativeVelocity.y < 0;
      
      return {
        particleId: particle.id,
        userId: this.getUserId(particle.id),
        distance,
        pan, // -1 (left) to 1 (right)
        gain, // 0 to 1
        closingSpeed,
        isApproaching,
        attraction: otherSignals.attraction || 0,
        velocity: otherSignals.velocity || 0,
        isInner: otherSignals.isInner || false,
        isOuter: otherSignals.isOuter || false,
      };
    });

    return {
      enabled: true,
      selfParticle,
      selfSignals,
      nearbyParticles: nearby.map(n => n.particle),
      interactions,
      // Aggregated values for easy mapping to NoiseCraft nodes
      nearestDistance: interactions[0]?.distance || this.maxDistance,
      nearestPan: interactions[0]?.pan || 0,
      nearestGain: interactions[0]?.gain || 0,
      approachingCount: interactions.filter(i => i.isApproaching).length,
      totalNearbyCount: interactions.length,
    };
  }

  /**
   * Generate NoiseCraft parameters for individual audio routing
   * These can be sent directly to NoiseCraft nodes for individual user audio
   * @param {string} userId - User identifier
   * @param {Array} allParticles - Array of all particles
   * @param {Object} signalGenerator - Signal generator instance
   * @param {Function} mappingFunction - Optional function to map interactions to node params
   * @returns {Array} Array of {nodeId, paramName, value} objects
   */
  generateNoiseCraftParams(userId, allParticles, signalGenerator, mappingFunction = null) {
    const audioData = this.generateIndividualAudio(userId, allParticles, signalGenerator);
    
    if (!audioData.enabled || !mappingFunction) {
      return [];
    }

    // Use custom mapping function if provided
    return mappingFunction(audioData);
  }
}

/**
 * Default mapping function for individual audio
 * Maps interactions to NoiseCraft node parameters
 */
export function createDefaultIndividualMapping(config = {}) {
  const {
    distanceNodeId = "17", // Default: % knob
    panNodeId = null, // No default - depends on patch
    gainNodeId = null, // No default - depends on patch
    velocityNodeId = "183", // Default: Vol CHORDS
  } = config;

  return (audioData) => {
    const params = [];
    
    // Map nearest distance to a node (e.g., probability threshold)
    if (distanceNodeId && audioData.nearestDistance < audioData.maxDistance) {
      const normalizedDistance = audioData.nearestDistance / audioData.maxDistance;
      params.push({
        nodeId: distanceNodeId,
        paramName: "value",
        value: 1 - normalizedDistance, // Closer = higher value
      });
    }
    
    // Map velocity based on nearby particles
    if (velocityNodeId && audioData.interactions.length > 0) {
      const avgVelocity = audioData.interactions.reduce((sum, i) => sum + i.velocity, 0) / audioData.interactions.length;
      params.push({
        nodeId: velocityNodeId,
        paramName: "value",
        value: Math.min(1, avgVelocity),
      });
    }

    return params;
  };
}




/**
 * Background Audio Post-Processing Module
 * 
 * Handles post-processing for background audio from nearby particles.
 * This module is designed to be used in backend/server contexts where
 * only audio processing is needed (no HTML/visual dependencies).
 * 
 * Features:
 * - Selects up to 2 nearest particles for background audio
 * - Separates In Inner and In Outer particles
 * - Applies distance-based volume and reverb control
 * - Calculates panning information for spatial audio
 * 
 * Usage:
 *   import { processBackgroundAudio } from './background-audio-post-processing.js';
 *   const params = processBackgroundAudio(selfParticle, allParticles, config);
 */

/**
 * Calculate localization parameters for particles
 * @param {Object} selfParticle - The controlled particle
 * @param {Array} otherParticles - Array of all other particles
 * @param {Object} config - Configuration { innerRadius, outerRadius }
 * @returns {Object} Localization results keyed by particle ID
 */
export function calculateLocalization(selfParticle, otherParticles, config) {
  const { innerRadius, outerRadius } = config;
  const results = {};
  
  otherParticles.forEach(other => {
    if (other.id === selfParticle.id) return;
    
    const dx = other.position.x - selfParticle.position.x;
    const dy = other.position.y - selfParticle.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    const isInDistinct = distance <= innerRadius;
    const isInOuter = distance <= outerRadius && !isInDistinct;
    
    if (isInDistinct || isInOuter) {
      // Panning: -1 (left) to +1 (right) based on relative X position
      const normalizedX = dx / outerRadius;
      const pan = Math.max(-1, Math.min(1, normalizedX * 1.5));
      
      // Gain: Distance-based attenuation
      const normalizedDistance = distance / outerRadius;
      const gain = Math.max(0.1, 1 - normalizedDistance * normalizedDistance);
      
      // Calculate closing speed (velocity component towards self)
      const relVx = other.velocity.x - selfParticle.velocity.x;
      const relVy = other.velocity.y - selfParticle.velocity.y;
      const dirX = distance > 0 ? dx / distance : 0;
      const dirY = distance > 0 ? dy / distance : 0;
      const closingSpeed = Math.max(0, relVx * dirX + relVy * dirY);
      
      results[other.id] = {
        pan,
        gain: isInDistinct ? gain : gain * 0.5, // Lower gain in outer range
        distance,
        closingSpeed: Math.min(closingSpeed / 320, 1), // Normalized
        isInDistinct: isInDistinct ? 1 : 0, // 1 or 0
        isInOuter: isInOuter ? 1 : 0, // 1 or 0
      };
    }
  });
  
  return results;
}

/**
 * Process background audio post-processing
 * 
 * @param {Object} selfParticle - The controlled particle (id: 0 typically)
 * @param {Array} allParticles - Array of all particles
 * @param {Object} config - Configuration object
 * @param {number} config.innerRadius - Inner radius for distinct audio range
 * @param {number} config.outerRadius - Outer radius for background audio range
 * @param {number} config.baseVolume - Base volume when particles are close (default: 0.0015)
 * 
 * @returns {Object} Post-processing parameters and state
 *   - params: Array of {nodeId, paramName, value} for NoiseCraft nodes
 *   - state: Localization state for debugging/future use
 */
export function processBackgroundAudio(selfParticle, allParticles, config = {}) {
  const {
    innerRadius = 80,
    outerRadius = 150,
    baseVolume = 0.0015,
  } = config;
  
  if (!selfParticle) {
    return {
      params: [],
      state: {
        candidates: [],
        avgPan: 0,
        innerCount: 0,
        outerCount: 0,
      }
    };
  }
  
  // 1. Calculate localization for all nearby particles
  const localizationResults = calculateLocalization(
    selfParticle,
    allParticles,
    { innerRadius, outerRadius }
  );
  
  // 2. Select up to 2 particles for background audio (closest ones)
  const candidateParticles = Object.entries(localizationResults)
    .map(([particleId, loc]) => ({
      id: parseInt(particleId),
      ...loc,
      particle: allParticles.find(p => p.id === parseInt(particleId))
    }))
    .filter(item => item.particle) // Ensure particle exists
    .sort((a, b) => a.distance - b.distance) // Sort by distance (closest first)
    .slice(0, 2); // Maximum 2 particles
  
  // 3. Separate In Inner and In Outer particles
  const innerParticlesForAudio = candidateParticles.filter(p => p.isInDistinct === 1);
  const outerParticlesForAudio = candidateParticles.filter(p => p.isInOuter === 1 && p.isInDistinct === 0);
  
  // 4. Calculate aggregate parameters for background audio
  let hasNearbyParticles = candidateParticles.length > 0;
  let maxDistanceFactor = 0;
  let avgPan = 0;
  let maxOuterWetness = 0; // Maximum reverb for outer particles
  
  if (hasNearbyParticles) {
    // Calculate max distance factor (for volume fade)
    candidateParticles.forEach(candidate => {
      const distanceFactor = candidate.distance <= innerRadius 
        ? 1.0 
        : Math.max(0, 1 - ((candidate.distance - innerRadius) / (outerRadius - innerRadius)));
      maxDistanceFactor = Math.max(maxDistanceFactor, distanceFactor);
    });
    
    // Calculate average pan (for stereo imaging)
    if (candidateParticles.length > 0) {
      const totalPan = candidateParticles.reduce((sum, p) => sum + (p.pan || 0), 0);
      avgPan = totalPan / candidateParticles.length;
    }
    
    // Calculate max outer wetness (only for outer particles, not inner)
    outerParticlesForAudio.forEach(outer => {
      const distanceFactor = Math.max(0, 1 - ((outer.distance - innerRadius) / (outerRadius - innerRadius)));
      // Outer particles should be more wet (reverb) and quieter
      const outerWetness = 1.0 + (1 - distanceFactor) * 0.8; // 1.0 to 1.8
      maxOuterWetness = Math.max(maxOuterWetness, outerWetness);
    });
  }
  
  // 5. Generate NoiseCraft node parameters
  const params = [];
  
  // Node 183 = "Vol CHORDS" - volume of other oscillators (bass, baritone, tenor)
  // Fade out completely when no particles nearby (beyond outerRadius)
  // In Outer particles should be quieter than In Inner
  let targetVolume = 0.0;
  
  if (hasNearbyParticles) {
    if (innerParticlesForAudio.length > 0) {
      // In Inner particles: normal volume (they're part of the chord)
      const innerAvgFactor = innerParticlesForAudio.reduce((sum, p) => {
        const df = p.distance <= innerRadius ? 1.0 : 
          Math.max(0, 1 - ((p.distance - innerRadius) / (outerRadius - innerRadius)));
        return sum + df;
      }, 0) / innerParticlesForAudio.length;
      targetVolume = baseVolume * innerAvgFactor;
    }
    
    if (outerParticlesForAudio.length > 0) {
      // In Outer particles: quieter, more spatial (lower volume)
      const outerAvgFactor = outerParticlesForAudio.reduce((sum, p) => {
        const df = p.distance <= innerRadius ? 1.0 : 
          Math.max(0, 1 - ((p.distance - innerRadius) / (outerRadius - innerRadius)));
        return sum + df * 0.3; // 30% of base volume for outer particles
      }, 0) / outerParticlesForAudio.length;
      targetVolume = Math.max(targetVolume, baseVolume * outerAvgFactor);
    }
  }
  
  params.push({
    nodeId: "183",
    paramName: "value",
    value: Math.max(0, targetVolume)
  });
  
  // Node 163 = "REVERB WET" - reverb for background particles
  // In Outer particles: More wet (spatial reverb)
  // In Inner particles: Less wet (they're closer, part of chord)
  let targetReverb = 0.0;
  
  if (hasNearbyParticles) {
    if (outerParticlesForAudio.length > 0) {
      // In Outer: High reverb (wet, spatial, immersive)
      targetReverb = Math.min(1.4, maxOuterWetness);
    } else if (innerParticlesForAudio.length > 0) {
      // In Inner: Lower reverb (closer, less spatial)
      const innerAvgFactor = innerParticlesForAudio.reduce((sum, p) => {
        const df = p.distance <= innerRadius ? 1.0 : 
          Math.max(0, 1 - ((p.distance - innerRadius) / (outerRadius - innerRadius)));
        return sum + df;
      }, 0) / innerParticlesForAudio.length;
      targetReverb = 0.4 * innerAvgFactor; // 40% of max for inner particles
    }
  }
  
  params.push({
    nodeId: "163",
    paramName: "value",
    value: Math.max(0, Math.min(1.4, targetReverb))
  });
  
  // 6. Store localization state for potential future use
  const state = {
    localization: {
      candidates: candidateParticles.map(p => ({
        id: p.id,
        pan: p.pan,
        gain: p.gain,
        distance: p.distance,
        isInDistinct: p.isInDistinct,
        isInOuter: p.isInOuter
      })),
      avgPan,
      innerCount: innerParticlesForAudio.length,
      outerCount: outerParticlesForAudio.length
    }
  };
  
  return {
    params,
    state
  };
}

/**
 * Smooth parameter values to prevent audio clicks/pops
 * Exponential smoothing with time-based rate limiting
 * 
 * @param {number} currentValue - Current parameter value
 * @param {number} targetValue - Target parameter value
 * @param {number} smoothingFactor - Smoothing factor (0-1, lower = smoother)
 * @param {Object} smoothingState - Previous smoothing state
 * @returns {number} Smoothed value
 */
export function smoothParameter(currentValue, targetValue, smoothingFactor, smoothingState = {}) {
  const MAX_CHANGE_PER_FRAME = 0.01; // Maximum change per frame for volume
  const diff = targetValue - currentValue;
  const change = Math.sign(diff) * Math.min(Math.abs(diff), MAX_CHANGE_PER_FRAME);
  
  return currentValue + change * smoothingFactor;
}


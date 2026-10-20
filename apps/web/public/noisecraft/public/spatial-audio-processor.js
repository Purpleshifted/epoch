/**
 * Spatial Audio Processor Module
 * 
 * Web Audio API를 사용한 정교한 spatialization/post-processing
 * 
 * Features:
 * - HRTF-based 3D spatialization (PannerNode)
 * - Distance-based attenuation
 * - Dynamic position updates
 * - Optimized for real-time performance
 * 
 * Usage:
 *   import { SpatialAudioProcessor } from './spatial-audio-processor.js';
 *   const processor = new SpatialAudioProcessor(audioContext);
 */

/**
 * Spatial Audio Processor Class
 * Manages Web Audio API PannerNodes for spatial audio processing
 */
export class SpatialAudioProcessor {
  constructor(audioContext, options = {}) {
    this.audioContext = audioContext;
    this.pannerNodes = new Map(); // particleId -> PannerNode
    this.sourceNodes = new Map(); // particleId -> source AudioNode
    this.options = {
      innerRadius: options.innerRadius || 80,
      outerRadius: options.outerRadius || 150,
      panningModel: options.panningModel || 'HRTF', // 'HRTF' or 'equalpower'
      distanceModel: options.distanceModel || 'inverse',
      rolloffFactor: options.rolloffFactor || 2,
      refDistance: options.refDistance || 80, // innerRadius
      maxDistance: options.maxDistance || 300, // beyond outerRadius, completely silent
      updateThrottle: options.updateThrottle || 33, // ms (30fps)
      ...options
    };
    
    this.lastUpdateTime = new Map(); // particleId -> last update timestamp
    this.destination = null; // Will be set when connecting
  }
  
  /**
   * Create a PannerNode for a particle
   * @param {number} particleId - Particle ID
   * @param {Object} position - Initial position {x, y, z}
   * @returns {PannerNode} Created panner node
   */
  createPannerNode(particleId, position = { x: 0, y: 0, z: 0 }) {
    const panner = this.audioContext.createPanner();
    
    // Configure panner settings
    panner.panningModel = this.options.panningModel;
    panner.distanceModel = this.options.distanceModel;
    panner.refDistance = this.options.refDistance;
    panner.maxDistance = this.options.maxDistance;
    panner.rolloffFactor = this.options.rolloffFactor;
    
    // Cone settings (omnidirectional)
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 0;
    panner.coneOuterGain = 0;
    
    // Set initial position
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z || 0;
    
    this.pannerNodes.set(particleId, panner);
    return panner;
  }
  
  /**
   * Update panner position for a particle
   * Throttled for performance (updateThrottle ms)
   * @param {number} particleId - Particle ID
   * @param {Object} position - New position {x, y, z}
   * @param {Object} selfPosition - Self particle position (for relative positioning)
   */
  updatePannerPosition(particleId, position, selfPosition) {
    const now = Date.now();
    const lastUpdate = this.lastUpdateTime.get(particleId) || 0;
    
    // Throttle updates for performance
    if (now - lastUpdate < this.options.updateThrottle) {
      return;
    }
    
    const panner = this.pannerNodes.get(particleId);
    if (!panner) return;
    
    // Calculate relative position (2D space, z = 0)
    const x = position.x - (selfPosition.x || 0);
    const y = position.y - (selfPosition.y || 0);
    const z = position.z || 0;
    
    // Update position (linear interpolation for smooth movement)
    const smoothness = 0.1; // Lower = smoother, but more lag
    const currentX = panner.positionX.value;
    const currentY = panner.positionY.value;
    const currentZ = panner.positionZ.value;
    
    panner.positionX.setValueAtTime(
      currentX + (x - currentX) * smoothness,
      this.audioContext.currentTime
    );
    panner.positionY.setValueAtTime(
      currentY + (y - currentY) * smoothness,
      this.audioContext.currentTime
    );
    panner.positionZ.setValueAtTime(
      currentZ + (z - currentZ) * smoothness,
      this.audioContext.currentTime
    );
    
    this.lastUpdateTime.set(particleId, now);
  }
  
  /**
   * Connect audio source to panner and output
   * @param {AudioNode} sourceNode - Source audio node (from NoiseCraft or other source)
   * @param {number} particleId - Particle ID
   * @param {Object} position - Initial position {x, y, z}
   * @param {AudioNode} destination - Destination node (usually audioContext.destination)
   * @returns {PannerNode} Connected panner node
   */
  connectAudio(sourceNode, particleId, position, destination) {
    // Get or create panner node
    let panner = this.pannerNodes.get(particleId);
    if (!panner) {
      panner = this.createPannerNode(particleId, position);
    }
    
    // Store source node reference
    this.sourceNodes.set(particleId, sourceNode);
    
    // Store destination if not already set
    if (!this.destination) {
      this.destination = destination;
    }
    
    // Disconnect existing connections (if any)
    try {
      sourceNode.disconnect();
      panner.disconnect();
    } catch (e) {
      // Ignore disconnection errors
    }
    
    // Connect: source -> panner -> destination
    sourceNode.connect(panner);
    panner.connect(destination);
    
    return panner;
  }
  
  /**
   * Disconnect and remove panner node
   * @param {number} particleId - Particle ID
   */
  disconnectPanner(particleId) {
    const panner = this.pannerNodes.get(particleId);
    const source = this.sourceNodes.get(particleId);
    
    if (panner) {
      try {
        panner.disconnect();
      } catch (e) {
        // Ignore disconnection errors
      }
      this.pannerNodes.delete(particleId);
    }
    
    if (source) {
      try {
        source.disconnect();
      } catch (e) {
        // Ignore disconnection errors
      }
      this.sourceNodes.delete(particleId);
    }
    
    this.lastUpdateTime.delete(particleId);
  }
  
  /**
   * Update listener position (self particle position)
   * This affects how all spatialized sounds are perceived
   * @param {Object} position - Listener position {x, y, z}
   */
  updateListenerPosition(position) {
    const listener = this.audioContext.listener;
    
    if (listener.positionX) {
      // Modern API (Chrome, Firefox)
      listener.positionX.value = position.x || 0;
      listener.positionY.value = position.y || 0;
      listener.positionZ.value = position.z || 0;
    } else {
      // Legacy API (Safari)
      listener.setPosition(position.x || 0, position.y || 0, position.z || 0);
    }
  }
  
  /**
   * Batch update multiple particle positions
   * More efficient than individual updates
   * @param {Array} updates - Array of {particleId, position, selfPosition}
   */
  batchUpdatePositions(updates) {
    const now = Date.now();
    
    updates.forEach(({ particleId, position, selfPosition }) => {
      const lastUpdate = this.lastUpdateTime.get(particleId) || 0;
      
      if (now - lastUpdate >= this.options.updateThrottle) {
        this.updatePannerPosition(particleId, position, selfPosition);
      }
    });
  }
  
  /**
   * Clean up all panner nodes
   */
  dispose() {
    const particleIds = Array.from(this.pannerNodes.keys());
    particleIds.forEach(id => this.disconnectPanner(id));
  }
  
  /**
   * Get active panner node count
   * @returns {number} Number of active panner nodes
   */
  getActivePannerCount() {
    return this.pannerNodes.size;
  }
}

/**
 * Helper function to create and configure a SpatialAudioProcessor
 * @param {AudioContext} audioContext - Web Audio API context
 * @param {Object} config - Configuration from particle system
 * @returns {SpatialAudioProcessor} Configured processor
 */
export function createSpatialProcessor(audioContext, config = {}) {
  const processor = new SpatialAudioProcessor(audioContext, {
    innerRadius: config.innerRadius || 80,
    outerRadius: config.outerRadius || 150,
    refDistance: config.innerRadius || 80,
    maxDistance: (config.outerRadius || 150) * 2, // Fade out beyond outerRadius
    panningModel: 'HRTF', // Use HRTF for best spatialization
    distanceModel: 'inverse',
    rolloffFactor: 2,
    updateThrottle: 33 // 30fps updates
  });
  
  return processor;
}


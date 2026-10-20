/**
 * Virtual Particle System Module
 * A standalone module for simulating particles with gravitational interactions
 * and generating signal streams for parameter mapping.
 */

export class VirtualParticle {
  constructor(id, x, y, tone, mass = 1) {
    this.id = id;
    this.position = { x, y };
    this.velocity = { x: 0, y: 0 };
    this.tone = tone;
    this.mass = mass;
    this.name = `Particle ${id}`;
    
    // Sequencer pattern: random note profile [1,0,...,0] to [0,0,...,1]
    // This represents which note (column) in the sequencer this particle uses
    this.sequencerPattern = this.generateRandomNoteProfile(12); // Default 12-tone chromatic
  }
  
  /**
   * Generate a random note profile with exactly one note active
   * Can use music theory for harmonious patterns
   * Returns array like [1,0,0,...,0] or [0,0,1,...,0] etc.
   */
  generateRandomNoteProfile(numNotes = 12, useMusicTheory = true, scaleName = null) {
    // Use music theory if available and enabled
    if (useMusicTheory && typeof window !== 'undefined' && window.generateHarmoniousPattern) {
      try {
        return window.generateHarmoniousPattern(scaleName || 'C Pentatonic Major', null, numNotes);
      } catch (e) {
        console.warn('Music theory pattern generation failed, using random:', e);
      }
    }
    
    // Fallback to pure random
    const pattern = new Array(numNotes).fill(0);
    const activeNoteIndex = Math.floor(Math.random() * numNotes);
    pattern[activeNoteIndex] = 1;
    return pattern;
  }
  
  /**
   * Get the active note index (0-based)
   * If pattern is empty [0,0,...,0], use tone property as fallback
   */
  getActiveNoteIndex() {
    const patternIndex = this.sequencerPattern.findIndex(val => val === 1);
    if (patternIndex >= 0) {
      return patternIndex;
    }
    // Fallback to tone property if pattern is empty
    return this.tone % 12;
  }

  update(dt) {
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    // No friction - particles move freely in space
  }
}

/**
 * Signal Generator with Gravitational Force
 * Calculates interactions between particles and generates stream data
 */
export class SignalGenerator {
  constructor(innerRadius = 80, outerRadius = 150) {
    this.innerRadius = innerRadius;
    this.outerRadius = outerRadius;
    this.particles = [];
    this.G = 10000; // Gravitational constant - increased for stronger attraction
    this.minDistance = 3; // Lower minimum distance for stronger close-range gravity
  }

  setParticles(particles) {
    this.particles = particles;
  }

  setGravitationalConstant(G) {
    this.G = G;
  }

  setMinDistance(minDistance) {
    this.minDistance = minDistance;
  }

  setRadii(innerRadius, outerRadius) {
    this.innerRadius = innerRadius;
    this.outerRadius = outerRadius;
  }

  // Calculate gravitational force: F = G * m1 * m2 / r^2
  // IMPORTANT: Gravity works at ALL distances - no distance cutoff or radius limit
  // The innerRadius/outerRadius are ONLY used for signal generation (isInner/isOuter flags),
  // they do NOT affect gravitational interaction between particles
  calculateGravitationalForce(p1, p2) {
    const dx = p2.position.x - p1.position.x;
    const dy = p2.position.y - p1.position.y;
    const distanceSquared = dx * dx + dy * dy;
    const distance = Math.sqrt(distanceSquared);
    // Use minimum distance only to prevent division by zero, not to limit gravity
    const effectiveDistance = Math.max(distance, this.minDistance);

    // F = G * m1 * m2 / r^2
    // This force is calculated for ALL distances, no matter how far apart particles are
    const force = (this.G * p1.mass * p2.mass) / (effectiveDistance * effectiveDistance);
    
    // Normalize force (0 to 1 range for attraction signal)
    // This normalization is only for signal generation, not for physics
    const maxExpectedForce = (this.G * p1.mass * p2.mass) / (this.minDistance * this.minDistance);
    const normalizedForce = Math.min(force / maxExpectedForce, 1);

    return {
      force,
      normalizedForce,
      distance,
      direction: { x: dx / effectiveDistance, y: dy / effectiveDistance },
    };
  }

  calculateInteraction(p1, p2) {
    const gravitational = this.calculateGravitationalForce(p1, p2);
    const distance = gravitational.distance;

    const relVx = p2.velocity.x - p1.velocity.x;
    const relVy = p2.velocity.y - p1.velocity.y;
    const relativeVelocity = Math.sqrt(relVx * relVx + relVy * relVy);

    const dirX = distance > 0 ? (p2.position.x - p1.position.x) / distance : 0;
    const dirY = distance > 0 ? (p2.position.y - p1.position.y) / distance : 0;
    const closingSpeed = Math.max(0, relVx * dirX + relVy * dirY);

    const isInner = distance <= this.innerRadius;
    const isOuter = distance > this.innerRadius && distance <= this.outerRadius;

    return {
      distance,
      relativeVelocity,
      closingSpeed,
      attraction: gravitational.normalizedForce, // Use gravitational force as attraction
      isInner,
      isOuter,
      gravitationalForce: gravitational.force,
    };
  }

  /**
   * Check if two particles are "collected" (Is Inner to each other)
   */
  areCollected(p1, p2) {
    const interaction = this.calculateInteraction(p1, p2);
    return interaction.isInner;
  }

  /**
   * Find the most affecting particle based on mass and distance
   * If particles are collected (Is Inner to each other), sum their masses
   */
  findMostAffectingParticle(target) {
    let maxAffect = -Infinity;
    let mostAffecting = null;
    let mostAffectingDistance = Infinity;
    
    // Track which particles we've already considered as part of clusters
    const processedParticles = new Set();

    // First pass: identify collected groups (clusters of particles that are inner to each other)
    const clusterMap = new Map(); // particle ID -> cluster array
    
    for (const other of this.particles) {
      if (other.id === target.id || processedParticles.has(other.id)) continue;
      
      const interaction = this.calculateInteraction(target, other);
      if (interaction.isInner) {
        // Found a particle in inner radius - check if it forms a cluster with others
        const cluster = [other];
        processedParticles.add(other.id);
        
        // Find all other particles that are inner to target AND inner to this particle
        for (const candidate of this.particles) {
          if (candidate.id === target.id || candidate.id === other.id || processedParticles.has(candidate.id)) continue;
          
          const candidateInteraction = this.calculateInteraction(target, candidate);
          if (candidateInteraction.isInner && this.areCollected(other, candidate)) {
            cluster.push(candidate);
            processedParticles.add(candidate.id);
          }
        }
        
        // Store cluster
        cluster.forEach(p => clusterMap.set(p.id, cluster));
      }
    }

    // Second pass: calculate affect for each particle/cluster
    processedParticles.clear();
    
    for (const other of this.particles) {
      if (other.id === target.id || processedParticles.has(other.id)) continue;
      
      const interaction = this.calculateInteraction(target, other);
      const distance = interaction.distance;
      
      // Check if this particle is part of a collected cluster
      let effectiveMass = other.mass;
      let clusterDistance = distance;
      
      // If collected (inner), sum masses of all particles in the cluster
      if (interaction.isInner && clusterMap.has(other.id)) {
        const cluster = clusterMap.get(other.id);
        effectiveMass = cluster.reduce((sum, p) => sum + p.mass, 0);
        // Use the closest distance to any particle in the cluster
        cluster.forEach(clusterParticle => {
          const clusterInteraction = this.calculateInteraction(target, clusterParticle);
          clusterDistance = Math.min(clusterDistance, clusterInteraction.distance);
        });
        
        // Mark all cluster particles as processed
        cluster.forEach(p => processedParticles.add(p.id));
      } else {
        processedParticles.add(other.id);
      }
      
      // Calculate "affect" as mass / distance^2 (inverse square law)
      // Higher mass and closer distance = higher affect
      const affect = effectiveMass / (clusterDistance * clusterDistance);
      
      if (affect > maxAffect) {
        maxAffect = affect;
        mostAffecting = other;
        mostAffectingDistance = clusterDistance;
      }
    }

    return {
      particle: mostAffecting,
      distance: mostAffectingDistance,
      affect: maxAffect
    };
  }

  generateSignals(targetId) {
    const target = this.particles.find((p) => p.id === targetId);
    if (!target) return null;

    // Find all inner particles (for closing speed calculation)
    const innerParticles = [];
    const outerParticles = [];
    
    for (const other of this.particles) {
      if (other.id === targetId) continue;
      const interaction = this.calculateInteraction(target, other);
      
      if (interaction.isInner) {
        innerParticles.push({ particle: other, interaction });
      } else if (interaction.isOuter) {
        outerParticles.push({ particle: other, interaction });
      }
    }

    // Calculate closing speed: average value of all particles in inner or outer radius that are approaching
    // If Is Inner: average of inner particles approaching
    // If Is Outer (but not Inner): average of outer particles approaching
    let closingSpeed = 0;
    let approachingSpeeds = [];
    
    // Collect approaching speeds from inner particles first
    if (innerParticles.length > 0) {
      for (const { particle: other, interaction } of innerParticles) {
        // Only count if approaching (positive closing speed)
        if (interaction.closingSpeed > 0) {
          approachingSpeeds.push(interaction.closingSpeed);
        }
      }
    }
    
    // If no inner particles, collect from outer particles
    if (approachingSpeeds.length === 0 && outerParticles.length > 0) {
      for (const { particle: other, interaction } of outerParticles) {
        // Only count if approaching (positive closing speed)
        if (interaction.closingSpeed > 0) {
          approachingSpeeds.push(interaction.closingSpeed);
        }
      }
    }
    
    // Calculate average if we have approaching particles
    if (approachingSpeeds.length > 0) {
      closingSpeed = approachingSpeeds.reduce((sum, speed) => sum + speed, 0) / approachingSpeeds.length;
    } else {
      // Fallback: use the nearest particle's closing speed if no inner/outer particles are approaching
      const nearest = this.findMostAffectingParticle(target);
      if (nearest.particle) {
        const interaction = this.calculateInteraction(target, nearest.particle);
        closingSpeed = Math.max(0, interaction.closingSpeed);
      }
    }
    
    // Normalize closing speed
    closingSpeed = Math.min(closingSpeed / 320, 1);

    // Distance: from the most affecting particle
    const mostAffecting = this.findMostAffectingParticle(target);
    const distance = mostAffecting.particle ? mostAffecting.distance : Infinity;

    // Is Inner: 1 when true, 0 when false
    const isInner = innerParticles.length > 0 ? 1 : 0;
    
    // Is Outer: 1 when true, 0 when false
    const isOuter = outerParticles.length > 0 ? 1 : 0;

    // Attraction: use most affecting particle's attraction
    let attraction = 0;
    if (mostAffecting.particle) {
      const interaction = this.calculateInteraction(target, mostAffecting.particle);
      attraction = interaction.attraction;
    }

    const velocity = Math.sqrt(
      target.velocity.x ** 2 + target.velocity.y ** 2
    );
    const normalizedVelocity = Math.min(velocity / 320, 1);

    return {
      attraction,
      velocity: normalizedVelocity,
      distance,
      closingSpeed,
      isInner, // Now returns 1 or 0
      isOuter, // Now returns 1 or 0
      // Additional data for sequencer logic
      innerParticles: innerParticles.map(p => ({
        id: p.particle.id,
        distance: p.interaction.distance,
        closingSpeed: p.interaction.closingSpeed,
        pattern: p.particle.sequencerPattern,
        position: { x: p.particle.position.x, y: p.particle.position.y }
      })),
      outerParticles: outerParticles.map(p => ({
        id: p.particle.id,
        distance: p.interaction.distance,
        pattern: p.particle.sequencerPattern,
        position: { x: p.particle.position.x, y: p.particle.position.y }
      })),
      mostAffectingParticleId: mostAffecting.particle ? mostAffecting.particle.id : null
    };
  }

  // Get all particles
  getParticles() {
    return this.particles;
  }

  // Add a particle
  addParticle(particle) {
    if (!particle) {
      console.error("[SignalGenerator] Cannot add null/undefined particle");
      return;
    }
    this.particles.push(particle);
    console.log(`[SignalGenerator] Particle ${particle.id} added to array, total: ${this.particles.length}`);
  }

  // Remove a particle by ID
  removeParticle(id) {
    this.particles = this.particles.filter((p) => p.id !== id);
  }
}

/**
 * Particle System Manager
 * Main interface for managing particles and signal generation
 */
export class ParticleSystem {
  constructor(options = {}) {
    const {
      innerRadius = 80,
      outerRadius = 150,
      G = 500,            // Realistic gravitational constant (reduced for better visibility)
      minDistance = 3,    // Lower minimum distance for stronger close-range gravity
      particles = [],
    } = options;

    this.signalGenerator = new SignalGenerator(innerRadius, outerRadius);
    this.signalGenerator.setGravitationalConstant(G);
    this.signalGenerator.setMinDistance(minDistance);

    // Initialize particles if provided
    if (particles.length > 0) {
      this.signalGenerator.setParticles(particles);
    }
  }

  // Add a particle
  // Default mass is 100 for stronger gravitational interaction
  addParticle(id, x, y, tone = 0, mass = 100) {
    try {
      const particle = new VirtualParticle(id, x, y, tone, mass);
      this.signalGenerator.addParticle(particle);
      console.log(`[ParticleSystem] Added particle ${id} at (${x}, ${y}), total particles: ${this.signalGenerator.particles.length}`);
      return particle;
    } catch (e) {
      console.error(`[ParticleSystem] Failed to add particle ${id}:`, e);
      throw e;
    }
  }

  // Remove a particle
  removeParticle(id) {
    this.signalGenerator.removeParticle(id);
  }

  // Get all particles
  getParticles() {
    return this.signalGenerator.getParticles();
  }

  // Update particle positions with attraction-based velocity (no gravity)
  // Uses attraction signal to update velocity, then applies velocity to position
  // Gravity is removed - only attraction and velocity are used
  update(dt) {
    const particles = this.signalGenerator.getParticles();
    
    // Limit time step to prevent numerical instability
    const maxDt = 0.01; // Maximum 10ms per step
    const safeDt = Math.min(dt, maxDt);
    
    // Calculate attraction-based velocity changes for each particle
    particles.forEach((p1, i) => {
      let velocityChangeX = 0;
      let velocityChangeY = 0;

      // Apply attraction from other particles (within outer radius for efficiency)
      particles.forEach((p2, j) => {
        if (i === j) return;
        
        const interaction = this.signalGenerator.calculateInteraction(p1, p2);
        
        // Only apply attraction if within outer radius (for performance)
        if (interaction.distance <= this.signalGenerator.outerRadius * 2) {
          // Use attraction signal (0-1) to calculate velocity change
          // Stronger attraction = stronger pull towards other particle
          const attractionStrength = interaction.attraction * 50; // Scale factor for attraction
          
          // Direction towards other particle
          const dx = p2.position.x - p1.position.x;
          const dy = p2.position.y - p1.position.y;
          const distance = interaction.distance;
          
          if (distance > 0) {
            const dirX = dx / distance;
            const dirY = dy / distance;
            
            // Velocity change proportional to attraction
            velocityChangeX += dirX * attractionStrength * safeDt;
            velocityChangeY += dirY * attractionStrength * safeDt;
          }
        }
      });

      // Apply velocity damping to prevent infinite acceleration
      const damping = 0.95; // Slight damping to prevent runaway velocities
      p1.velocity.x = (p1.velocity.x + velocityChangeX) * damping;
      p1.velocity.y = (p1.velocity.y + velocityChangeY) * damping;
      
      // Limit maximum velocity
      const maxVelocity = 200;
      const currentSpeed = Math.sqrt(p1.velocity.x ** 2 + p1.velocity.y ** 2);
      if (currentSpeed > maxVelocity) {
        const scale = maxVelocity / currentSpeed;
        p1.velocity.x *= scale;
        p1.velocity.y *= scale;
      }
      
      // Update position using velocity
      p1.position.x += p1.velocity.x * safeDt;
      p1.position.y += p1.velocity.y * safeDt;
    });
  }

  // Calculate escape velocity for a particle at distance r from total mass M
  // v_escape = sqrt(2 * G * M / r)
  calculateEscapeVelocity(particle, totalMass, distance) {
    const G = this.signalGenerator.G;
    if (distance <= 0 || totalMass <= 0) return Infinity;
    return Math.sqrt(2 * G * totalMass / distance);
  }

  // Calculate orbital velocity for a particle at distance r from mass M
  // v_orbital = sqrt(G * M / r) for circular orbit
  calculateOrbitalVelocity(particle, totalMass, distance) {
    const G = this.signalGenerator.G;
    if (distance <= 0 || totalMass <= 0) return 0;
    return Math.sqrt(G * totalMass / distance);
  }

  // Generate signals for a specific particle
  generateSignals(particleId) {
    return this.signalGenerator.generateSignals(particleId);
  }

  // Generate signals for all particles
  generateAllSignals() {
    const particles = this.signalGenerator.getParticles();
    const signals = {};
    particles.forEach((particle) => {
      signals[particle.id] = this.generateSignals(particle.id);
    });
    return signals;
  }

  // Update configuration
  setGravitationalConstant(G) {
    this.signalGenerator.setGravitationalConstant(G);
  }

  setMinDistance(minDistance) {
    this.signalGenerator.setMinDistance(minDistance);
  }

  setRadii(innerRadius, outerRadius) {
    this.signalGenerator.setRadii(innerRadius, outerRadius);
  }

  // Get configuration
  getConfig() {
    return {
      innerRadius: this.signalGenerator.innerRadius,
      outerRadius: this.signalGenerator.outerRadius,
      G: this.signalGenerator.G,
      minDistance: this.signalGenerator.minDistance,
    };
  }
}


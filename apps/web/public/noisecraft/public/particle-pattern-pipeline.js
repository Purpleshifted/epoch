/**
 * Particle Pattern Assignment Pipeline
 * Centralized system for assigning and managing sequencer patterns per particle
 * Integrates with individual and global sequencer logic
 */

export class ParticlePatternPipeline {
  constructor(options = {}) {
    this.mode = options.mode || 'individual'; // 'individual' or 'global'
    this.patternManager = options.patternManager || null; // PatternAssignmentManager instance
    this.harmonicPlacer = options.harmonicPlacer || null; // GlobalHarmonicPlacer instance (for global mode)
    
    // Track pattern assignments per particle
    this.particlePatterns = new Map(); // particleId -> { pattern: Array, assignedAt: timestamp }
    
    // For global mode: track sequencer position assignments
    this.globalAssignments = {}; // particleId -> { voice: 'bass'|'baritone'|'tenor', column: 0-11 }
  }

  /**
   * Assign pattern to a particle (individual mode)
   * @param {Object} particle - VirtualParticle instance
   * @param {Array} existingPatterns - Array of existing patterns for harmonization
   * @param {String} scaleName - Optional scale name
   */
  assignPatternToParticle(particle, existingPatterns = [], scaleName = null) {
    if (!particle || !particle.id) {
      console.warn('[ParticlePatternPipeline] Invalid particle for pattern assignment');
      return null;
    }

    let pattern = null;

    // Use pattern manager if available
    if (this.patternManager && typeof this.patternManager.generateUniquePattern === 'function') {
      pattern = this.patternManager.generateUniquePattern(
        particle.id,
        existingPatterns,
        scaleName
      );
    } else {
      // Fallback: use particle's existing sequencerPattern or generate new one
      if (particle.sequencerPattern && Array.isArray(particle.sequencerPattern)) {
        pattern = [...particle.sequencerPattern]; // Copy existing pattern
      } else {
        // Generate new pattern
        if (typeof particle.generateRandomNoteProfile === 'function') {
          pattern = particle.generateRandomNoteProfile(12, true, scaleName);
        } else {
          // Ultimate fallback: random pattern
          pattern = new Array(12).fill(0);
          pattern[Math.floor(Math.random() * 12)] = 1;
        }
      }
    }

    // Store pattern assignment
    this.particlePatterns.set(particle.id, {
      pattern,
      assignedAt: Date.now()
    });

    // Update particle's sequencerPattern property
    particle.sequencerPattern = pattern;

    // Also register with pattern manager if available
    if (this.patternManager && typeof this.patternManager.assignPattern === 'function') {
      this.patternManager.assignPattern(particle.id, pattern);
    }

    return pattern;
  }

  /**
   * Assign global sequencer position to a particle (global mode)
   * Uses harmonic progression algorithm
   * @param {Object} particle - VirtualParticle instance
   * @param {Number} totalParticles - Total number of particles
   * @returns {Object} Assignment { voice: 'bass'|'baritone'|'tenor', column: 0-11 }
   */
  assignGlobalPositionToParticle(particle, totalParticles) {
    if (!particle || !particle.id) {
      console.warn('[ParticlePatternPipeline] Invalid particle for global position assignment');
      return null;
    }

    // Check if already assigned
    if (this.globalAssignments[particle.id]) {
      return this.globalAssignments[particle.id];
    }

    // Get particle's note index
    // Use tone property as fallback if pattern is empty
    let noteIndex = particle.getActiveNoteIndex();
    if (noteIndex < 0 || noteIndex >= 12) {
      // Fallback to tone property
      if (particle.tone !== undefined) {
        noteIndex = particle.tone % 12;
      }
      if (noteIndex < 0 || noteIndex >= 12) {
        console.warn(`[ParticlePatternPipeline] Invalid note index ${noteIndex} for particle ${particle.id} (tone: ${particle.tone})`);
        return null;
      }
    }

    let assignment = null;

    // Use harmonic placer if available
    if (this.harmonicPlacer && typeof this.harmonicPlacer.assignNewUser === 'function') {
      try {
        const position = this.harmonicPlacer.assignNewUser(noteIndex, totalParticles);
        if (position >= 0 && position < 36) {
          const voiceIndex = Math.floor(position / 12);
          const column = position % 12;
          const voices = ['bass', 'baritone', 'tenor'];
          const voice = voices[voiceIndex];

          assignment = { voice, column };
          this.globalAssignments[particle.id] = assignment;

          // Register with harmonic placer
          if (typeof this.harmonicPlacer.addAssignment === 'function') {
            this.harmonicPlacer.addAssignment(noteIndex, position);
          }
        }
      } catch (e) {
        console.warn('[ParticlePatternPipeline] Harmonic placement failed:', e);
      }
    }

    // Fallback to random if harmonic placement failed
    if (!assignment) {
      assignment = this._getRandomGlobalPosition();
      if (assignment) {
        this.globalAssignments[particle.id] = assignment;
      }
    }

    return assignment;
  }

  /**
   * Get pattern information from inner particles (for individual mode)
   * Simulates receiving pattern data from inner particles
   * @param {Array} innerParticles - Array of inner particle objects
   * @returns {Array} Array of note indices (0-11) from inner particles
   */
  receivePatternsFromInnerParticles(innerParticles) {
    if (!Array.isArray(innerParticles) || innerParticles.length === 0) {
      return [];
    }

    const receivedNotes = [];

    innerParticles.forEach((innerParticle, index) => {
      if (!innerParticle) return;
      if (index >= 2) return; // Only use first 2 inner particles (max 3 notes total)

      // Get note from inner particle (as if receiving pattern info from that particle)
      if (typeof innerParticle.getActiveNoteIndex === 'function') {
        const noteIndex = innerParticle.getActiveNoteIndex();
        if (noteIndex >= 0 && noteIndex < 12) {
          receivedNotes.push(noteIndex);
        }
      }

      // TODO: In future, also receive noise pattern from inner particle
      // For now, just pass (noise implementation later)
    });

    return receivedNotes;
  }

  /**
   * Remove particle assignment (when particle is removed)
   * @param {Number} particleId - Particle ID
   */
  removeParticleAssignment(particleId) {
    this.particlePatterns.delete(particleId);
    delete this.globalAssignments[particleId];

    // Also remove from pattern manager if available
    if (this.patternManager) {
      // Pattern manager doesn't have remove method, but we can clear it
      // by not using it for this particle anymore
    }

    // Remove from harmonic placer if available
    if (this.harmonicPlacer && this.globalAssignments[particleId]) {
      const assignment = this.globalAssignments[particleId];
      // Harmonic placer tracks by note and position, not particle ID
      // So we need to find and remove the matching assignment
      // This is handled by updateAssignmentsFromMap when regenerating
    }
  }

  /**
   * Get pattern for a particle
   * @param {Number} particleId - Particle ID
   * @returns {Array|null} Pattern array or null if not assigned
   */
  getParticlePattern(particleId) {
    const assignment = this.particlePatterns.get(particleId);
    return assignment ? assignment.pattern : null;
  }

  /**
   * Get global assignment for a particle
   * @param {Number} particleId - Particle ID
   * @returns {Object|null} Assignment { voice, column } or null
   */
  getGlobalAssignment(particleId) {
    return this.globalAssignments[particleId] || null;
  }

  /**
   * Get all global assignments (for compatibility with existing code)
   * @returns {Object} Map of { particleId: { voice, column } }
   */
  getAllGlobalAssignments() {
    return { ...this.globalAssignments };
  }

  /**
   * Update global assignments from external map (for synchronization)
   * @param {Object} assignments - Map of { particleId: { voice, column } }
   */
  updateGlobalAssignments(assignments) {
    this.globalAssignments = { ...assignments };
  }

  /**
   * Helper: Get random global position (fallback)
   * @private
   */
  _getRandomGlobalPosition() {
    const voices = ['bass', 'baritone', 'tenor'];
    const usedPositions = {
      bass: new Set(Object.values(this.globalAssignments).filter(a => a.voice === 'bass').map(a => a.column)),
      baritone: new Set(Object.values(this.globalAssignments).filter(a => a.voice === 'baritone').map(a => a.column)),
      tenor: new Set(Object.values(this.globalAssignments).filter(a => a.voice === 'tenor').map(a => a.column))
    };

    const availableVoices = voices.filter(voice => usedPositions[voice].size < 12);
    if (availableVoices.length === 0) {
      return null; // All positions filled
    }

    const randomVoice = availableVoices[Math.floor(Math.random() * availableVoices.length)];
    const availableColumns = Array.from({ length: 12 }, (_, i) => i)
      .filter(col => !usedPositions[randomVoice].has(col));

    if (availableColumns.length === 0) {
      return null;
    }

    const randomColumn = availableColumns[Math.floor(Math.random() * availableColumns.length)];
    return { voice: randomVoice, column: randomColumn };
  }

  /**
   * Clear all assignments
   */
  clear() {
    this.particlePatterns.clear();
    this.globalAssignments = {};
  }
}

/**
 * Factory function
 */
export function createParticlePatternPipeline(options = {}) {
  return new ParticlePatternPipeline(options);
}


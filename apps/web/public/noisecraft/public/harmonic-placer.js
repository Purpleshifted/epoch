/**
 * Global Harmonic Placer
 * Implements harmonic progression algorithm for placing particles in 36 sequencer positions
 * Based on instability mapping and entropy-based complexity control
 */

/**
 * Instability Map based on sensory dissonance data
 * Score range: 0 (most stable/consonant) ~ 10 (most unstable/dissonant)
 */
export const INSTABILITY_MAP = {
  0: 0,    // C (Tonic/Unison) - 가장 안정
  1: 9,    // C#/Db (Minor 2nd) - 매우 높은 dissonance
  2: 3,    // D (Major 2nd) - 중간 dissonance
  3: 2,    // D#/Eb (Minor 3rd) - 낮은 dissonance (consonant)
  4: 1.5,  // E (Major 3rd) - 낮은 dissonance (consonant)
  5: 2.5,  // F (Perfect 4th) - 낮은 dissonance (consonant)
  6: 8,    // F#/Gb (Tritone) - 매우 높은 dissonance
  7: 0.5,  // G (Perfect 5th) - 가장 낮은 dissonance (most consonant)
  8: 4,    // G#/Ab (Minor 6th) - 중간 dissonance
  9: 2,    // A (Major 6th) - 낮은 dissonance (consonant)
  10: 4.5, // A#/Bb (Minor 7th) - 중간-높은 dissonance
  11: 7,   // B (Major 7th/Leading tone) - 높은 dissonance
};

/**
 * Calculate average instability of assigned notes
 */
function calculateAverageInstability(assignedNotes) {
  if (!assignedNotes || assignedNotes.length === 0) return 0;
  
  const totalInstability = assignedNotes.reduce((sum, note) => {
    return sum + (INSTABILITY_MAP[note] || 0);
  }, 0);
  
  return totalInstability / assignedNotes.length;
}

/**
 * Global Harmonic Placer Class
 * Implements hybrid approach: constraint filtering + harmonic distance optimization + voice leading
 */
export class GlobalHarmonicPlacer {
  constructor(key = 'C', mode = 'major') {
    this.key = key;
    this.mode = mode;
    this.assignedPositions = []; // [{ note: 0-11, position: 0-35, voice: 0-2, step: 0-11 }]
  }

  /**
   * Main function: assign a new user to a position
   * @param {Number} userNote - 12-tone note index (0-11)
   * @param {Number} totalUsers - Total number of users (for entropy-based complexity)
   * @returns {Number} Position index (0-35)
   */
  assignNewUser(userNote, totalUsers, verbose = false) {
    const availablePositions = this.getAvailablePositions();
    
    if (availablePositions.length === 0) {
      console.warn('[HarmonicPlacer] No available positions');
      return -1;
    }

    // Phase 1: Constraint filtering
    const validPositions = availablePositions.filter(pos => {
      return this.satisfiesConstraints(userNote, pos, totalUsers);
    });

    if (validPositions.length === 0) {
      // If constraints too strict, use random fallback
      if (verbose) {
        console.warn(`[HarmonicPlacer] No valid positions after constraint filtering (note: ${userNote}, available: ${availablePositions.length}), using random`);
      }
      const selected = availablePositions[Math.floor(Math.random() * availablePositions.length)];
      if (verbose) {
        const voice = Math.floor(selected / 12);
        const step = selected % 12;
        const voiceName = voice === 0 ? 'bass' : voice === 1 ? 'baritone' : 'tenor';
        console.log(`[HarmonicPlacer] Selected random position: ${selected} (${voiceName} step ${step})`);
      }
      return selected;
    }

    // Phase 2: Harmonic distance optimization
    const targetDistance = this.calculateTargetDistance(totalUsers);
    const scored = validPositions.map(pos => {
      const score = this.evaluateHarmonicScore(userNote, pos, targetDistance, totalUsers);
      return { position: pos, score };
    });

    // Filter out zero-score positions
    const validScored = scored.filter(c => c.score > 0);
    if (validScored.length === 0) {
      // Fallback to random if all scores are 0
      if (verbose) {
        console.warn(`[HarmonicPlacer] All scores are 0 (note: ${userNote}), using random from ${validPositions.length} valid positions`);
      }
      const selected = validPositions[Math.floor(Math.random() * validPositions.length)];
      if (verbose) {
        const voice = Math.floor(selected / 12);
        const step = selected % 12;
        const voiceName = voice === 0 ? 'bass' : voice === 1 ? 'baritone' : 'tenor';
        console.log(`[HarmonicPlacer] Selected random position: ${selected} (${voiceName} step ${step})`);
      }
      return selected;
    }

    // Phase 3: Weighted random selection (maintains randomness while preferring better positions)
    const selected = this.weightedRandomSelect(validScored);
    if (verbose) {
      const voice = Math.floor(selected / 12);
      const step = selected % 12;
      const voiceName = voice === 0 ? 'bass' : voice === 1 ? 'baritone' : 'tenor';
      const selectedScore = validScored.find(c => c.position === selected)?.score || 0;
      console.log(`[HarmonicPlacer] ✓ Assigned note ${userNote} to ${voiceName} step ${step} (position: ${selected}, score: ${selectedScore.toFixed(3)}, targetDistance: ${targetDistance.toFixed(2)})`);
    }
    return selected;
  }

  /**
   * Check if position satisfies constraints
   * @param {Number} noteIndex - 12-tone note index (0-11)
   * @param {Number} position - Position index (0-35)
   * @param {Number} totalUsers - Total number of users
   * @returns {Boolean} True if constraints are satisfied
   */
  satisfiesConstraints(noteIndex, position, totalUsers) {
    const instability = INSTABILITY_MAP[noteIndex] || 0;
    const step = position % 12; // Step in 12-step cycle (0-11)
    const distanceToCycleEnd = 12 - step;

    // Constraint 1: Unstable notes (instability > 5) must be resolvable before cycle ends
    if (instability > 5 && distanceToCycleEnd < 3) {
      // Check if resolution note (C = 0) is available in next 3 steps
      const hasResolution = this.checkResolutionAvailable(step, 0);
      if (!hasResolution) {
        return false; // Cannot resolve unstable note
      }
    }

    // Constraint 2: User count-based max instability
    // More users = allow higher instability
    const maxAllowedInstability = Math.log(totalUsers + 1) * 1.5;
    if (instability > maxAllowedInstability && totalUsers < 3) {
      // For very few users, be more strict about instability
      return false;
    }

    return true;
  }

  /**
   * Check if resolution note is available in next few steps
   * @param {Number} currentStep - Current step in cycle (0-11)
   * @param {Number} resolutionNote - Note that resolves (usually 0 for C)
   * @returns {Boolean} True if resolution is possible
   */
  checkResolutionAvailable(currentStep, resolutionNote) {
    // Check if resolution note exists in assigned positions within next 3 steps
    for (let i = 1; i <= 3; i++) {
      const checkStep = (currentStep + i) % 12;
      const hasResolution = this.assignedPositions.some(p => 
        p.step === checkStep && p.note === resolutionNote
      );
      if (hasResolution) return true;
    }

    // If no resolution in assigned positions, check if there's room for one
    // (Future optimization: predict if resolution can be placed)
    // For now, allow it if there are unassigned positions in next 3 steps
    const availableInNext3 = [];
    for (let i = 1; i <= 3; i++) {
      const checkStep = (currentStep + i) % 12;
      // Check if any position with this step is available
      const usedSteps = new Set(this.assignedPositions.map(p => p.step));
      if (!usedSteps.has(checkStep)) {
        return true; // Space available for resolution
      }
    }

    // Strict mode: require existing resolution
    return false;
  }

  /**
   * Calculate target harmonic distance based on user count
   * More users = higher distance = more complex progression
   * @param {Number} userCount - Total number of users
   * @returns {Number} Target distance (0-8)
   */
  calculateTargetDistance(userCount) {
    // User 1: distance 0 (tonic)
    // More users: higher distance (progression goes further from tonic)
    const maxDistance = 8;
    return Math.min(maxDistance, Math.log(userCount + 1) * 2);
  }

  /**
   * Evaluate harmonic score for a position
   * @param {Number} userNote - Note to place (0-11)
   * @param {Number} position - Position index (0-35)
   * @param {Number} targetDistance - Target harmonic distance
   * @param {Number} totalUsers - Total number of users
   * @returns {Number} Score (0-1, higher is better)
   */
  evaluateHarmonicScore(userNote, position, targetDistance, totalUsers) {
    // Create temporary assignment to evaluate
    const tempPositions = [...this.assignedPositions, {
      note: userNote,
      position,
      voice: Math.floor(position / 12), // 0=bass, 1=baritone, 2=tenor
      step: position % 12
    }];

    // Calculate progression distance
    const newDistance = this.calculateProgressionDistance(tempPositions);
    
    // Distance score: how close to target distance?
    const distanceDiff = Math.abs(newDistance - targetDistance);
    const distanceScore = 1 / (1 + distanceDiff); // Closer to target = higher score

    // Position score: prefer middle positions in cycle (step 4-8)
    const step = position % 12;
    const positionScore = 1 - Math.abs(step - 6) / 6; // 0 at step 0 or 12, 1 at step 6

    // Instability balance: don't accumulate too much instability
    const allNotes = tempPositions.map(p => p.note);
    const avgInstability = calculateAverageInstability(allNotes);
    const maxInstability = Math.log(totalUsers + 1) * 2;
    const instabilityScore = Math.max(0, 1 - (avgInstability / maxInstability));

    // Voice distribution: prefer balanced distribution across voices
    const voiceCounts = [0, 0, 0];
    tempPositions.forEach(p => {
      voiceCounts[p.voice]++;
    });
    const voiceVariance = this.calculateVariance(voiceCounts);
    const voiceScore = 1 / (1 + voiceVariance); // Lower variance = better balance

    // Combined score (weighted)
    return distanceScore * 0.4 + 
           positionScore * 0.2 + 
           instabilityScore * 0.2 + 
           voiceScore * 0.2;
  }

  /**
   * Calculate progression distance (simplified version)
   * For now, uses average instability as a proxy for harmonic distance
   * Future: integrate Tonal.js for more sophisticated calculation
   * @param {Array} positions - Array of position objects
   * @returns {Number} Distance (0-10)
   */
  calculateProgressionDistance(positions) {
    if (!positions || positions.length === 0) return 0;
    
    const notes = positions.map(p => p.note);
    const avgInstability = calculateAverageInstability(notes);
    
    // Convert average instability to distance-like metric
    // Higher instability = further from tonic
    return avgInstability;
  }

  /**
   * Calculate variance of array
   */
  calculateVariance(values) {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return variance;
  }

  /**
   * Weighted random selection
   * @param {Array} candidates - Array of { position, score }
   * @returns {Number} Selected position
   */
  weightedRandomSelect(candidates) {
    const totalScore = candidates.reduce((sum, c) => sum + c.score, 0);
    if (totalScore === 0) {
      // Fallback to uniform random
      return candidates[Math.floor(Math.random() * candidates.length)].position;
    }

    let random = Math.random() * totalScore;
    
    for (const candidate of candidates) {
      random -= candidate.score;
      if (random <= 0) {
        return candidate.position;
      }
    }

    // Fallback
    return candidates[0].position;
  }

  /**
   * Get available positions (0-35)
   * @returns {Array} Array of available position indices
   */
  getAvailablePositions() {
    const used = new Set(this.assignedPositions.map(p => p.position));
    return Array.from({ length: 36 }, (_, i) => i)
      .filter(p => !used.has(p));
  }

  /**
   * Add assigned position (after placement)
   * @param {Number} note - Note index (0-11)
   * @param {Number} position - Position index (0-35)
   */
  addAssignment(note, position) {
    this.assignedPositions.push({
      note,
      position,
      voice: Math.floor(position / 12),
      step: position % 12
    });
  }

  /**
   * Remove assignment (when particle is removed)
   * @param {Number} note - Note index
   * @param {Number} position - Position index
   */
  removeAssignment(note, position) {
    this.assignedPositions = this.assignedPositions.filter(p => 
      !(p.note === note && p.position === position)
    );
  }

  /**
   * Update assignments from existing assignments map
   * @param {Object} assignments - Map of { particleId: { voice, column } }
   * @param {Boolean} clearFirst - If true, clear existing assignments first (default: false)
   */
  updateAssignmentsFromMap(assignments, particles, clearFirst = false) {
    if (clearFirst) {
      this.assignedPositions = [];
    }
    
    // Remove assignments for particles that are no longer in the assignments map
    const currentParticleIds = new Set(Object.keys(assignments).map(id => parseInt(id)));
    this.assignedPositions = this.assignedPositions.filter(assignment => {
      // Keep assignments that match current particles
      const particle = particles.find(p => {
        const note = p.getActiveNoteIndex();
        const voiceIndex = Math.floor(assignment.position / 12);
        const step = assignment.position % 12;
        const voice = voiceIndex === 0 ? 'bass' : voiceIndex === 1 ? 'baritone' : 'tenor';
        return note === assignment.note && 
               assignments[p.id]?.voice === voice &&
               assignments[p.id]?.column === step;
      });
      return particle && currentParticleIds.has(particle.id);
    });
    
    // Add or update assignments from map
    Object.entries(assignments).forEach(([particleIdStr, assignment]) => {
      const particleId = parseInt(particleIdStr);
      const particle = particles.find(p => p.id === particleId);
      if (!particle) return;

      const note = particle.getActiveNoteIndex();
      if (note < 0 || note >= 12) return;

      const voiceIndex = assignment.voice === 'bass' ? 0 :
                        assignment.voice === 'baritone' ? 1 : 2;
      const position = voiceIndex * 12 + assignment.column;

      // Check if assignment already exists
      const existingIndex = this.assignedPositions.findIndex(a => 
        a.note === note && a.position === position
      );
      
      if (existingIndex === -1) {
        // Add new assignment
        this.addAssignment(note, position);
      }
    });
  }

  /**
   * Get current assignments as map (for compatibility with existing code)
   * @returns {Object} Map of { particleId: { voice, column } }
   */
  getAssignmentsMap(particles) {
    const map = {};
    this.assignedPositions.forEach(assignment => {
      // Find particle with matching note at this position
      const particle = particles.find(p => {
        const note = p.getActiveNoteIndex();
        return note === assignment.note && 
               this.isParticleAtPosition(p.id, assignment.position, particles);
      });
      
      if (particle) {
        const voice = assignment.voice === 0 ? 'bass' :
                     assignment.voice === 1 ? 'baritone' : 'tenor';
        map[particle.id] = {
          voice,
          column: assignment.step
        };
      }
    });
    return map;
  }

  /**
   * Helper: check if particle is at position (for mapping)
   */
  isParticleAtPosition(particleId, position, particles) {
    // This is a simplified check - in practice, we'd track particle ID
    // For now, we'll rely on note matching
    return true;
  }

  /**
   * Clear all assignments
   */
  clear() {
    this.assignedPositions = [];
  }
}


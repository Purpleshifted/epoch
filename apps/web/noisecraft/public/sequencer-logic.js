/**
 * Sequencer Logic Module
 * Handles individual and global audio routing with sequencer patterns
 */

export class SequencerLogic {
  constructor() {
    // Individual sequencers: one column per voice (bass, baritone, tenor)
    this.individualSequencers = {
      bass: null,      // MonoSeq node ID
      baritone: null,  // MonoSeq node ID
      tenor: null      // MonoSeq node ID
    };
    
    // Global sequencers: multiple columns for chord progression
    this.globalSequencers = {
      bass: null,      // MonoSeq node ID
      baritone: null,  // MonoSeq node ID
      tenor: null      // MonoSeq node ID
    };
  }

  /**
   * Set sequencer node IDs
   * @param {Object} sequencers - { individual: {bass, baritone, tenor}, global: {bass, baritone, tenor} }
   */
  setSequencerNodes(sequencers) {
    if (sequencers.individual) {
      this.individualSequencers = sequencers.individual;
    }
    if (sequencers.global) {
      this.globalSequencers = sequencers.global;
    }
  }

  /**
   * Generate individual sequencer pattern for a particle
   * Individual: each voice has 1 column, so max chord is 3 notes
   * Returns pattern in format: { bass: [12 notes], baritone: [12 notes], tenor: [12 notes] }
   * Each array has exactly one 1 and the rest are 0
   * 
   * @param {Object} selfParticle - The controlled particle
   * @param {Array} innerParticles - Array of particle objects in inner radius (with getActiveNoteIndex method)
   * @returns {Object} Pattern updates for individual sequencers
   */
  /**
   * Map 12-tone chromatic note index (0-11) to 4-row sequencer (0-3)
   * Uses a simple mapping: divide by 3 and round
   * 0-2 -> 0, 3-5 -> 1, 6-8 -> 2, 9-11 -> 3
   */
  map12ToneTo4Row(noteIndex12) {
    if (noteIndex12 < 0 || noteIndex12 >= 12) return 0;
    return Math.floor(noteIndex12 / 3);
  }

  generateIndividualPattern(selfParticle, innerParticles) {
    // Always initialize with zeros (ensures clean state)
    // Now using 4 rows instead of 12
    const pattern = {
      bass: new Array(4).fill(0),
      baritone: new Array(4).fill(0),
      tenor: new Array(4).fill(0)
    };

    // Self particle's note ALWAYS goes to bass (even when alone)
    // Map from 12-tone to 4-row sequencer
    if (selfParticle && typeof selfParticle.getActiveNoteIndex === 'function') {
      const selfNoteIndex12 = selfParticle.getActiveNoteIndex();
      if (selfNoteIndex12 >= 0 && selfNoteIndex12 < 12) {
        const rowIndex = this.map12ToneTo4Row(selfNoteIndex12);
        pattern.bass[rowIndex] = 1;
      }
    }

    // Inner particles' notes are distributed to baritone and tenor
    // IMPORTANT: Only set baritone/tenor if inner particles exist
    // This ensures when alone, only bass plays (single tone)
    if (Array.isArray(innerParticles) && innerParticles.length > 0) {
      innerParticles.forEach((innerParticle, index) => {
        if (!innerParticle || typeof innerParticle.getActiveNoteIndex !== 'function') return;
        
        const noteIndex12 = innerParticle.getActiveNoteIndex();
        if (noteIndex12 >= 0 && noteIndex12 < 12) {
          const rowIndex = this.map12ToneTo4Row(noteIndex12);
          if (index === 0) {
            // First inner particle -> baritone (2-note chord)
            pattern.baritone[rowIndex] = 1;
          } else if (index === 1) {
            // Second inner particle -> tenor (3-note chord)
            pattern.tenor[rowIndex] = 1;
          }
          // Only use first 2 inner particles (max 3-note chord)
        }
      });
    }
    // If innerParticles is empty or length === 0, baritone and tenor remain all zeros
    // This means: when alone = only bass plays = single tone ✅

    return pattern;
  }

  /**
   * Generate global sequencer pattern for all particles
   * Global: multiple columns so audience can hear chord progression
   * Pattern: bass 1st column -> baritone 1st column -> tenor 1st column -> 
   *          bass 2nd column -> baritone 2nd column -> ...
   * 
   * @param {Array} allParticles - All particles in the system
   * @returns {Object} Pattern updates for global sequencers
   */
  generateGlobalPattern(allParticles) {
    // Sort particles by ID for consistent ordering
    const sortedParticles = [...allParticles].sort((a, b) => a.id - b.id);
    
    const pattern = {
      bass: new Array(12).fill(0),
      baritone: new Array(12).fill(0),
      tenor: new Array(12).fill(0)
    };

    // Assign notes in order: bass -> baritone -> tenor -> bass -> ...
    sortedParticles.forEach((particle, index) => {
      const noteIndex = particle.getActiveNoteIndex();
      if (noteIndex >= 0) {
        const voiceIndex = index % 3; // 0 = bass, 1 = baritone, 2 = tenor
        const columnIndex = Math.floor(index / 3); // Which column in the voice
        
        // For now, we use 12 columns (one per note), but this can be adjusted
        // Each voice gets its own pattern with notes at different step positions
        const stepPosition = (columnIndex * 4) % 16; // Spread across 16 steps
        
        if (voiceIndex === 0) {
          pattern.bass[noteIndex] = 1; // Bass voice
        } else if (voiceIndex === 1) {
          pattern.baritone[noteIndex] = 1; // Baritone voice
        } else {
          pattern.tenor[noteIndex] = 1; // Tenor voice
        }
      }
    });

    return pattern;
  }

  /**
   * Calculate spatialization parameters for outer particles
   * @param {Object} selfParticle - The controlled particle
   * @param {Object} outerParticle - Particle in outer radius
   * @returns {Object} { pan: -1 to 1, gain: 0 to 1, distance: number }
   */
  calculateSpatialization(selfParticle, outerParticle) {
    const dx = outerParticle.position.x - selfParticle.position.x;
    const dy = outerParticle.position.y - selfParticle.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Pan: -1 (left) to 1 (right) based on horizontal position
    const pan = Math.max(-1, Math.min(1, dx / 400)); // Normalize to ±400px range
    
    // Gain: distance-based attenuation
    // Fade out at outer radius, max at inner radius
    const outerRadius = 150; // Should match SignalGenerator outerRadius
    const gain = Math.max(0, 1 - (distance / outerRadius));
    
    return {
      pan,
      gain,
      distance,
      angle: Math.atan2(dy, dx) // Angle for spatial audio
    };
  }

  /**
   * Generate updates for NoiseCraft sequencer nodes
   * @param {Object} signals - Signal data from generateSignals()
   * @param {Number} particleId - The controlled particle ID
   * @returns {Array} Array of update messages for NoiseCraft
   */
  generateNoiseCraftUpdates(signals, particleId) {
    const updates = [];
    
    // Individual audio: update sequencer patterns
    if (signals.innerParticles && signals.innerParticles.length > 0) {
      // This would need access to selfParticle to generate pattern
      // Pattern generation should be done at higher level with full particle data
    }
    
    // Outer particles: spatialization would be handled via pan/gain nodes
    // These would need to be mapped in the parameter mapping UI
    
    return updates;
  }
}

/**
 * Helper function to convert note pattern array to NoiseCraft MonoSeq format
 * NoiseCraft MonoSeq uses pattern format: patterns[patternIndex][stepIndex][rowIndex]
 * 
 * @param {Array} notePattern - Array like [1,0,0,0] indicating active note (4 elements for 4-row sequencer)
 * @param {Number} numSteps - Number of steps in sequencer (default 4 for individual)
 * @param {Number} stepPosition - Which step to place the note on (default 0, or cycle through steps)
 * @returns {Array} NoiseCraft pattern format: [step0[row0, row1, ...], step1[...], ...]
 */
export function convertNotePatternToNoiseCraft(notePattern, numSteps = 4, stepPosition = 0) {
  // Support both 12-element (old) and 4-element (new) patterns
  const expectedLength = notePattern.length;
  if (!Array.isArray(notePattern) || (expectedLength !== 4 && expectedLength !== 12)) {
    console.warn('Invalid note pattern, expected 4 or 12 elements:', notePattern);
    return Array(numSteps).fill(null).map(() => new Array(4).fill(0));
  }
  
  // Create empty pattern: array of steps, each step is array of 4 rows (or 12 for backward compat)
  const numRows = expectedLength === 12 ? 12 : 4;
  const pattern = Array(numSteps).fill(null).map(() => new Array(numRows).fill(0));
  
  // Find active note
  const activeNoteIndex = notePattern.findIndex(val => val === 1);
  if (activeNoteIndex >= 0 && activeNoteIndex < numRows && stepPosition < numSteps) {
    // Place note at stepPosition, row activeNoteIndex
    pattern[stepPosition][activeNoteIndex] = 1;
  }
  
  return pattern;
}

// Track current step position for each voice to create cycling pattern
const voiceStepPositions = new Map(); // nodeId -> current step (0-3)

/**
 * Update a MonoSeq sequencer node in NoiseCraft with a new pattern
 * @param {Object} iframeWindow - The NoiseCraft iframe window
 * @param {String} nodeId - The MonoSeq node ID
 * @param {Number} patternIndex - Which pattern to update (usually 0)
 * @param {Array} notePattern - Array like [1,0,0,...,0] for the note to play (12 elements)
 * @param {Number} numSteps - Number of steps in sequencer (default 4 for faster cycling)
 */
export function updateMonoSeqSequencer(iframeWindow, nodeId, patternIndex, notePattern, numSteps = 4) {
  if (!iframeWindow || !nodeId || !Array.isArray(notePattern)) {
    console.warn('Invalid parameters for updateMonoSeqSequencer:', { iframeWindow, nodeId, notePattern });
    return;
  }
  
  // Validate note pattern (now supports both 4 and 12 elements)
  if (notePattern.length !== 4 && notePattern.length !== 12) {
    console.warn('Note pattern must have 4 or 12 elements, got:', notePattern.length);
    return;
  }
  
  const numRows = notePattern.length; // 4 or 12
  
  // Find active note index (should be exactly one)
  const activeNoteIndex = notePattern.findIndex(val => val === 1);
  
  // Get or initialize step position for this voice (cycle through steps for continuity)
  let currentStep = voiceStepPositions.get(nodeId) ?? 0;
  
  // If no active note (all zeros), clear ALL steps and ALL rows to ensure silence
  // This is critical for baritone/tenor when particle is alone
  if (activeNoteIndex < 0) {
    requestAnimationFrame(() => {
      // Clear ALL steps and ALL rows for this voice (ensures complete silence)
      for (let step = 0; step < numSteps; step++) {
        for (let row = 0; row < numRows; row++) {
          iframeWindow.postMessage({
            type: "noiseCraft:toggleCell",
            nodeId: String(nodeId),
            patIdx: patternIndex,
            stepIdx: step,
            rowIdx: row,
            value: 0
          }, "*");
        }
      }
      console.log(`[Sequencer] Cleared all steps for node ${nodeId} (empty pattern)`);
    });
    return;
  }
  
  // Update pattern: Clear all steps first, then place note at current step
  // This creates a 4-step cycling pattern for more continuous sound
  requestAnimationFrame(() => {
    // Clear all steps and all rows for a clean slate
    for (let step = 0; step < numSteps; step++) {
      for (let row = 0; row < numRows; row++) {
        iframeWindow.postMessage({
          type: "noiseCraft:toggleCell",
          nodeId: String(nodeId),
          patIdx: patternIndex,
          stepIdx: step,
          rowIdx: row,
          value: 0 // Clear cell
        }, "*");
      }
    }
    
    // Place note at current step position
    requestAnimationFrame(() => {
      iframeWindow.postMessage({
        type: "noiseCraft:toggleCell",
        nodeId: String(nodeId),
        patIdx: patternIndex,
        stepIdx: currentStep,
        rowIdx: activeNoteIndex,
        value: 1 // Set cell
      }, "*");
      
      // Advance to next step for next update (cycle 0->1->2->3->0)
      currentStep = (currentStep + 1) % numSteps;
      voiceStepPositions.set(nodeId, currentStep);
      
      console.log(`[Sequencer] Updated node ${nodeId}, pattern ${patternIndex}, step ${(currentStep - 1 + numSteps) % numSteps}, row ${activeNoteIndex}, next step: ${currentStep}`);
    });
  });
}

/**
 * Multi-user scenario logic suggestion:
 * 
 * 1. **User Registration**: When a new user joins, create a particle for them
 *    - Assign random note profile [1,0,...,0] to [0,0,...,1]
 *    - Add to particle system
 * 
 * 2. **Individual Audio (per user)**:
 *    - Each user hears: their own note + notes of particles in inner radius
 *    - Pattern: bass[self note], baritone[first inner note], tenor[second inner note]
 *    - Maximum 3 notes (chord)
 *    - Spatial panning for outer particles (if any)
 * 
 * 3. **Global Audio (for audience)**:
 *    - All particles contribute to global sequencers
 *    - Pattern: bass 1st column -> baritone 1st column -> tenor 1st column -> 
 *               bass 2nd column -> baritone 2nd column -> ...
 *    - Creates chord progression as users join/leave
 *    - Multiple columns allow audience to hear full chord progression
 * 
 * 4. **Particle Management**:
 *    - When user disconnects: remove their particle
 *    - When user moves: update particle position/velocity
 *    - Note profile stays constant per user (or can be updated)
 * 
 * 5. **Implementation**:
 *    - Use WebSocket/Socket.IO for real-time updates
 *    - Each client maintains its own particle system with all users
 *    - Individual audio: local calculation from particle system
 *    - Global audio: aggregated and sent to all clients
 * 
 * 6. **Sequencer Updates**:
 *    - Individual: Update when inner particles change
 *    - Global: Update when any particle joins/leaves
 *    - Use NoiseCraft's ToggleCell action to update patterns
 */


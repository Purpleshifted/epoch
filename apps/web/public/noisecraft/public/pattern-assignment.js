/**
 * Modular Pattern Assignment Module
 * Centralized sequencer pattern assignment for individual and global audio
 * Designed to integrate with Tonal.js for sophisticated music theory
 */

export class PatternAssignmentManager {
  constructor(options = {}) {
    this.mode = options.mode || 'individual'; // 'individual' or 'global'
    this.key = options.key || 'C';
    this.scale = options.scale || 'major';
    
    // Track assigned patterns
    this.assignedPatterns = new Map(); // particleId -> pattern
    this.patternHistory = []; // For progression tracking
    
    // Tonal.js integration (will be set when available)
    this.tonalLibrary = null;
    this.useTonal = false;
  }

  /**
   * Set Tonal.js library for advanced music theory
   * @param {Object} tonal - Tonal.js library
   */
  setTonalLibrary(tonal) {
    this.tonalLibrary = tonal;
    this.useTonal = true;
  }

  /**
   * Generate a unique pattern for a new particle/user
   * Integrates with Tonal.js when available
   * @param {Number} particleId - Particle/user ID
   * @param {Array} existingPatterns - Array of existing patterns to harmonize with
   * @param {String} scaleName - Scale name (e.g., 'C Major')
   * @returns {Array} 12-element pattern array with one active note
   */
  generateUniquePattern(particleId, existingPatterns = [], scaleName = null) {
    if (this.useTonal && this.tonalLibrary) {
      return this.generateTonalPattern(particleId, existingPatterns, scaleName);
    }
    
    // Fallback to basic harmonization (uses window functions from music-theory.js)
    if (typeof window !== 'undefined' && window.generateHarmoniousPattern) {
      if (existingPatterns.length === 0) {
        return window.generateHarmoniousPattern(scaleName || 'C Pentatonic Major', null, 12);
      }
      if (window.generateHarmonizingPattern) {
        return window.generateHarmonizingPattern(existingPatterns, scaleName || 'C Pentatonic Major');
      }
    }
    
    // Ultimate fallback: random
    const pattern = new Array(12).fill(0);
    pattern[Math.floor(Math.random() * 12)] = 1;
    return pattern;
  }

  /**
   * Generate pattern using Tonal.js (when integrated)
   */
  generateTonalPattern(particleId, existingPatterns = [], scaleName = null) {
    if (!this.tonalLibrary) {
      return this.generateUniquePattern(particleId, existingPatterns, scaleName);
    }

    try {
      const { Progression, Chord, Note } = this.tonalLibrary;
      const scale = scaleName || `${this.key} ${this.scale}`;
      
      // Get existing notes
      const existingNotes = existingPatterns
        .map(pattern => pattern.findIndex(v => v === 1))
        .filter(index => index >= 0);
      
      // Use Tonal.js to generate harmonious pattern
      // TODO: Implement with Tonal.js Progression and Chord analysis
      // For now, fallback to basic
      return this.generateUniquePattern(particleId, existingPatterns, scaleName);
    } catch (e) {
      console.warn('Tonal.js pattern generation failed, using fallback:', e);
      return this.generateUniquePattern(particleId, existingPatterns, scaleName);
    }
  }

  /**
   * Assign pattern to a particle
   */
  assignPattern(particleId, pattern) {
    this.assignedPatterns.set(particleId, pattern);
    this.patternHistory.push({ particleId, pattern, timestamp: Date.now() });
  }

  /**
   * Get assigned pattern for a particle
   */
  getPattern(particleId) {
    return this.assignedPatterns.get(particleId);
  }

  /**
   * Get all assigned patterns
   */
  getAllPatterns() {
    return Array.from(this.assignedPatterns.entries()).map(([id, pattern]) => ({
      particleId: id,
      pattern
    }));
  }

  /**
   * Update scale/key
   */
  setScale(key, scale) {
    this.key = key;
    this.scale = scale;
  }
}

/**
 * Factory function
 */
export function createPatternAssignmentManager(options = {}) {
  return new PatternAssignmentManager(options);
}

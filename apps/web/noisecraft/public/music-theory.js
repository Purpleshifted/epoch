/**
 * Music Theory Utilities for Harmonious Pattern Generation
 * Provides scale-based note selection and chord-aware patterns
 */

/**
 * Common musical scales
 */
export const SCALES = {
  // Major scales
  'C Major': [0, 2, 4, 5, 7, 9, 11],
  'D Major': [2, 4, 6, 7, 9, 11, 13],
  'E Major': [4, 6, 8, 9, 11, 13, 15],
  'F Major': [5, 7, 9, 10, 12, 14, 16],
  'G Major': [7, 9, 11, 12, 14, 16, 18],
  'A Major': [9, 11, 13, 14, 16, 18, 20],
  
  // Minor scales
  'A Minor': [0, 2, 3, 5, 7, 8, 10], // Natural minor
  'E Minor': [4, 6, 7, 9, 11, 12, 14],
  'D Minor': [2, 4, 5, 7, 9, 10, 12],
  
  // Pentatonic scales (very harmonious)
  'C Pentatonic Major': [0, 2, 4, 7, 9],
  'A Pentatonic Minor': [0, 3, 5, 7, 10],
  
  // Blues scale
  'C Blues': [0, 3, 5, 6, 7, 10],
  
  // Chromatic (all notes - less harmonious but more flexible)
  'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
};

/**
 * Chord tones for common triads (12-tone chromatic system)
 * Returns note indices (0-11) that belong to the chord
 */
export const CHORD_TONES = {
  // Major triads
  'C Major': [0, 4, 7],      // C, E, G
  'D Major': [2, 6, 9],      // D, F#, A
  'E Major': [4, 8, 11],     // E, G#, B
  'F Major': [5, 9, 0],      // F, A, C (C is 0 = 12)
  'G Major': [7, 11, 2],     // G, B, D
  'A Major': [9, 1, 4],      // A, C#, E
  
  // Minor triads
  'C Minor': [0, 3, 7],      // C, Eb, G
  'D Minor': [2, 5, 9],      // D, F, A
  'E Minor': [4, 7, 11],     // E, G, B
  'A Minor': [9, 0, 4],      // A, C, E
  
  // Diminished
  'C Dim': [0, 3, 6],        // C, Eb, Gb
  
  // Augmented
  'C Aug': [0, 4, 8],        // C, E, G#
};

/**
 * Generate a harmonious note pattern based on scale and chord context
 * @param {String} scaleName - Name of the scale to use (from SCALES)
 * @param {String} chordName - Optional chord name to prefer chord tones
 * @param {Number} numNotes - Number of notes in the pattern (default 12)
 * @returns {Array} Pattern array with one active note
 */
export function generateHarmoniousPattern(scaleName = 'C Pentatonic Major', chordName = null, numNotes = 12) {
  const scale = SCALES[scaleName] || SCALES['C Pentatonic Major'];
  
  // Get valid note indices (modulo 12 to fit in chromatic system)
  const validNotes = scale.map(note => note % 12);
  
  // If chord is specified, prefer chord tones
  let candidateNotes = validNotes;
  if (chordName && CHORD_TONES[chordName]) {
    const chordNotes = CHORD_TONES[chordName].map(note => note % 12);
    // Prefer chord tones, but fall back to scale notes
    candidateNotes = [...new Set([...chordNotes, ...validNotes])];
  }
  
  // Randomly select one note from valid candidates
  const randomIndex = Math.floor(Math.random() * candidateNotes.length);
  const selectedNote = candidateNotes[randomIndex];
  
  // Create pattern with selected note active
  const pattern = new Array(numNotes).fill(0);
  pattern[selectedNote] = 1;
  
  return pattern;
}

/**
 * Generate a note pattern that works well with existing patterns (chord-aware)
 * Now tries to form actual chords (triads) to avoid dissonance
 * @param {Array} existingPatterns - Array of existing note patterns to harmonize with
 * @param {String} scaleName - Scale to constrain selection
 * @returns {Array} New pattern that harmonizes with existing ones
 */
export function generateHarmonizingPattern(existingPatterns = [], scaleName = 'C Pentatonic Major') {
  const scale = SCALES[scaleName] || SCALES['C Pentatonic Major'];
  const validNotes = scale.map(note => note % 12);
  
  // Find active notes in existing patterns
  const existingNotes = existingPatterns
    .map(pattern => pattern.findIndex(val => val === 1))
    .filter(index => index >= 0);
  
  // If we have existing notes, try to form a chord (triad)
  if (existingNotes.length > 0) {
    // Try to find a chord that includes the existing notes
    for (const [chordName, chordTones] of Object.entries(CHORD_TONES)) {
      const chordNotes = chordTones.map(note => note % 12);
      
      // Check if existing notes are all part of this chord
      const existingInChord = existingNotes.filter(note => chordNotes.includes(note));
      
      if (existingInChord.length > 0) {
        // Find chord tones that are in scale AND not already used
        const availableChordTones = chordNotes.filter(note => 
          validNotes.includes(note) && !existingNotes.includes(note)
        );
        
        if (availableChordTones.length > 0) {
          // Pick a chord tone that completes or extends the chord
          const selectedNote = availableChordTones[Math.floor(Math.random() * availableChordTones.length)];
          const pattern = new Array(12).fill(0);
          pattern[selectedNote] = 1;
          return pattern;
        }
      }
    }
    
    // If no perfect chord match, try scale notes that form intervals
    // Prefer notes that create consonant intervals (3rds, 5ths, 6ths)
    const consonantIntervals = [3, 4, 7, 8, 9]; // Minor 3rd, Major 3rd, Perfect 5th, Minor 6th, Major 6th
    const candidateNotes = [];
    
    for (const note of validNotes) {
      if (existingNotes.includes(note)) continue;
      
      // Check if this note forms a consonant interval with any existing note
      for (const existingNote of existingNotes) {
        const interval = Math.abs((note - existingNote + 12) % 12);
        if (consonantIntervals.includes(interval)) {
          candidateNotes.push(note);
          break;
        }
      }
    }
    
    if (candidateNotes.length > 0) {
      const selectedNote = candidateNotes[Math.floor(Math.random() * candidateNotes.length)];
      const pattern = new Array(12).fill(0);
      pattern[selectedNote] = 1;
      return pattern;
    }
  }
  
  // Fallback: pick a random scale note that's different
  const availableNotes = validNotes.filter(note => !existingNotes.includes(note));
  const candidateNotes = availableNotes.length > 0 ? availableNotes : validNotes;
  const randomIndex = Math.floor(Math.random() * candidateNotes.length);
  const selectedNote = candidateNotes[randomIndex];
  
  const pattern = new Array(12).fill(0);
  pattern[selectedNote] = 1;
  
  return pattern;
}

/**
 * Get a random scale name
 */
export function getRandomScale() {
  const scaleNames = Object.keys(SCALES);
  return scaleNames[Math.floor(Math.random() * scaleNames.length)];
}

/**
 * Generate multiple patterns that form a chord
 * @param {String} chordName - Name of the chord
 * @param {Number} numPatterns - Number of patterns to generate
 * @returns {Array} Array of patterns
 */
export function generateChordPatterns(chordName = 'C Major', numPatterns = 3) {
  if (!CHORD_TONES[chordName]) {
    chordName = 'C Major';
  }
  
  const chordNotes = CHORD_TONES[chordName].map(note => note % 12);
  const patterns = [];
  
  // Generate patterns for each chord tone
  for (let i = 0; i < numPatterns; i++) {
    const pattern = new Array(12).fill(0);
    const noteIndex = chordNotes[i % chordNotes.length];
    pattern[noteIndex] = 1;
    patterns.push(pattern);
  }
  
  return patterns;
}


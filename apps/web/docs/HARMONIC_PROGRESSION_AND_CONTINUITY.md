# Harmonic Progression Libraries and Sound Continuity

## 1. Reducing Sequencer Columns to 4

### Implementation
- Changed `numSteps` from 12/16 to **4 steps** for each voice (bass, baritone, tenor)
- Notes now cycle through steps 0→1→2→3→0 for continuous sound
- Each update advances to the next step automatically

### Benefits
- **Faster cycling**: 4-step patterns repeat 4x faster than 16-step patterns
- **More responsive**: Changes are heard immediately (within 1-2 clock cycles)
- **Continuous sound**: Notes cycle through steps, maintaining presence

## 2. Making Sound More Continuous/Interactive

### Current Issues
- Need to wait for a full cycle to hear sound changes
- Notes only trigger on sequencer clock

### Solutions Implemented

#### A. **Step Cycling (Implemented)**
- Notes automatically advance to next step position (0→1→2→3→0)
- Each voice cycles independently
- Creates continuous rhythmic pattern

#### B. **Increased Gate Time (To Implement)**
- Current gate time: 0.1 seconds (default MonoSeq)
- **Suggestion**: Increase to 0.3-0.5 seconds for longer note sustain
- Implementation: Modify MonoSeq `gateT` input parameter via parameter mapping
  - Node: MonoSeq node (211, 212, 213)
  - Parameter: `gateT`
  - Value: 0.3-0.5 (experiment for best results)

#### C. **Overlapping Notes / Legato (To Implement)**
- Place notes on adjacent steps for overlapping sound
- When particle changes, place new note on next step while old note still plays
- Creates smooth transitions without gaps

#### D. **Faster Clock Speed (To Implement)**
- Increase sequencer clock rate (BPM) for faster cycling
- Makes changes feel more immediate
- Can be adjusted in NoiseCraft Clock node

#### E. **Real-time Parameter Smoothing (Already Implemented)**
- Parameter smoothing prevents clicks/pops
- Already applied to volume, pan, reverb changes
- Makes all changes smooth and continuous

### Additional Suggestions

1. **Use Envelope with Longer Release**
   - Connect ADSR envelope with longer release time
   - Notes will continue to ring after gate ends
   - Creates more continuous, flowing sound

2. **Add Portamento/Slide**
   - Smooth frequency transitions between notes
   - Prevents abrupt pitch changes
   - Can be implemented via parameter mapping to oscillator frequency

3. **Trigger Updates on Particle Movement**
   - Update sequencer patterns not just when particles enter/leave inner radius
   - Update more frequently (e.g., every frame or every 2 frames)
   - Makes changes feel more real-time

4. **Parallel Patterns**
   - Use multiple pattern slots and alternate between them
   - Smoothly crossfade or switch patterns
   - Creates variation while maintaining continuity

## 3. Harmonic Progression Libraries for JavaScript

### Recommended Libraries

#### A. **Tonal.js** (Most Popular)
- **Package**: `@tonaljs/tonal`
- **NPM**: `npm install @tonaljs/tonal`
- **GitHub**: https://github.com/tonaljs/tonal
- **Features**:
  - Scale and chord generation
  - Chord progression analysis
  - Harmonic functions (I, IV, V, etc.)
  - Voice leading utilities
  - Roman numeral analysis
  - Mode detection

**Example Usage**:
```javascript
import { Chord, Progression, Scale } from '@tonaljs/tonal';

// Generate chord progression
const progression = Progression.fromRomanNumerals('C major', ['I', 'V', 'vi', 'IV']);
// Returns: ['CM', 'GM', 'Am', 'FM']

// Get chord tones
const chord = Chord.get('CM');
// Returns: { notes: ['C', 'E', 'G'], ... }

// Generate scale notes
const scale = Scale.get('C major pentatonic');
// Returns: { notes: ['C', 'D', 'E', 'G', 'A'], ... }
```

**For User Assignment**:
```javascript
// Create a pool of harmonious chords/notes
const key = 'C major';
const pool = Progression.fromRomanNumerals(key, ['I', 'ii', 'iii', 'IV', 'V', 'vi']);
// Randomly assign to users while maintaining musical coherence
```

#### B. **Tone.js** (For Audio Synthesis)
- **Package**: `tone`
- **Note**: More focused on audio synthesis than harmony theory
- Good for audio generation, less for progression logic

#### C. **Music21j** (Python Music21 port)
- **Package**: `music21j`
- Port of Python's Music21 library
- More complex, but very comprehensive
- Good for advanced analysis

#### D. **Music-Theory** (Simpler alternative)
- **Package**: `music-theory`
- Lightweight, focused on basic music theory
- Good for simple chord/scale operations

### Implementation Strategy

#### For Random User Assignment:

```javascript
import { Progression, Chord, Scale } from '@tonaljs/tonal';

class HarmonicPool {
  constructor(key = 'C major', progression = ['I', 'V', 'vi', 'IV']) {
    this.key = key;
    this.progression = Progression.fromRomanNumerals(key, progression);
    this.currentIndex = 0;
    this.usedChords = new Set();
  }

  // Get next chord from progression
  getNextChord() {
    const chord = this.progression[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.progression.length;
    return Chord.get(chord);
  }

  // Get random chord from pool (but follow progression rules)
  getRandomChord() {
    // Weighted random: prefer next in progression, but allow variation
    const nextIdx = this.currentIndex;
    const weights = [0.4, 0.2, 0.2, 0.2]; // 40% next, 20% others
    const rand = Math.random();
    
    if (rand < 0.4) {
      return this.getNextChord();
    } else {
      const randomIdx = Math.floor(Math.random() * this.progression.length);
      return Chord.get(this.progression[randomIdx]);
    }
  }

  // Get random note from chord (for user assignment)
  getRandomNoteFromChord(chord) {
    const notes = chord.notes;
    return notes[Math.floor(Math.random() * notes.length)];
  }
}

// Usage:
const pool = new HarmonicPool('C major', ['I', 'V', 'vi', 'IV']);

// Assign note to new user
const chord = pool.getRandomChord();
const userNote = pool.getRandomNoteFromChord(chord);
```

#### Integration with Existing System:

1. **Replace Random Pattern Generation**:
   ```javascript
   // Old: generateHarmoniousPattern(currentScale, null, 12)
   // New: Use harmonic pool
   const chord = harmonicPool.getRandomChord();
   const note = harmonicPool.getRandomNoteFromChord(chord);
   particle.sequencerPattern = convertNoteToPattern(note, currentScale);
   ```

2. **Maintain Voice Leading**:
   ```javascript
   // When assigning note to new particle, consider existing particles
   function assignHarmoniousNote(newParticle, existingParticles) {
     const nearbyNotes = getNearbyParticleNotes(existingParticles, newParticle);
     const chord = findBestChordForNotes(nearbyNotes);
     return harmonicPool.getRandomNoteFromChord(chord);
   }
   ```

3. **Progression-Based Assignment**:
   - Each new user gets a note from the next chord in progression
   - Creates natural harmonic flow as users join
   - Maintains musical coherence even with random assignment

### Installation

```bash
cd noisecraft
npm install @tonaljs/tonal
```

### Example Integration

```javascript
// In test-workspace.html or new file
import { Progression, Chord, Scale, Note } from '@tonaljs/tonal';

// Create harmonic pool
const harmonicPool = new HarmonicPool('C major', ['I', 'V', 'vi', 'IV']);

// When adding new particle
function addParticleWithHarmonicNote(particleSystem, harmonicPool) {
  const chord = harmonicPool.getRandomChord();
  const note = harmonicPool.getRandomNoteFromChord(chord);
  
  // Convert note to 12-tone pattern
  const noteIndex = getNoteIndexInChromatic(note);
  const pattern = new Array(12).fill(0);
  pattern[noteIndex] = 1;
  
  const particle = particleSystem.addParticle(...);
  particle.sequencerPattern = pattern;
  return particle;
}
```

## Summary

### Implemented:
✅ 4-step sequencers (faster cycling)
✅ Step cycling (notes advance automatically)
✅ Parameter smoothing (prevents clicks)

### To Implement:
- [ ] Increase gate time (0.3-0.5s)
- [ ] Install and integrate Tonal.js
- [ ] Create HarmonicPool class
- [ ] Update particle initialization to use harmonic pool
- [ ] Consider faster clock speed
- [ ] Add overlapping notes for legato effect

### Recommended Next Steps:
1. Install `@tonaljs/tonal`
2. Create `harmonic-pool.js` module
3. Integrate with particle system
4. Test with various progressions (I-V-vi-IV, ii-V-I, etc.)
5. Adjust gate time and clock speed for optimal continuity


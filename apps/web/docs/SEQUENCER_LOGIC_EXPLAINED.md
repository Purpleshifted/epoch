# Sequencer Logic Explanation and Issues

## How Current Logic Works

### 1. **Each Particle Has Its Own Original Tone** ✅

**YES!** Each particle stores its own unique note that never changes:

```javascript
// In VirtualParticle constructor:
this.sequencerPattern = this.generateRandomNoteProfile(12);
// This creates an array like [1,0,0,0,0,0,0,0,0,0,0,0] (note 0)
// or [0,0,1,0,0,0,0,0,0,0,0,0] (note 2), etc.

// The pattern is retrieved via:
particle.getActiveNoteIndex() // Returns 0-11 (which note is active)
```

**Key Points:**
- Each particle's `sequencerPattern` is set **once** when created
- This pattern represents the particle's "identity" - its unique note
- The pattern is **never modified** during the particle's lifetime
- When particles interact, their original notes are combined into chords

### 2. **Sequencer Pattern Generation Flow**

#### Step 1: Particle Initialization (test-workspace.html)
```javascript
// Particle 0 (central):
particle0.sequencerPattern = generateHarmoniousPattern(currentScale, null, 12);
// Randomly selects one note from the scale (e.g., C Pentatonic Major has 5 notes)
// Returns: [1,0,0,0,0,0,0,0,0,0,0,0] (example - note 0)

// Particle 1:
particle1.sequencerPattern = generateHarmonizingPattern([particle0.sequencerPattern], currentScale);
// Picks a different note from the same scale that harmonizes
// Returns: [0,0,1,0,0,0,0,0,0,0,0,0] (example - note 2)

// Particle 2:
particle2.sequencerPattern = generateHarmonizingPattern([particle0.sequencerPattern, particle1.sequencerPattern], currentScale);
// Picks another note that harmonizes with both
// Returns: [0,0,0,0,1,0,0,0,0,0,0,0] (example - note 4)
```

#### Step 2: Individual Audio Pattern Generation (sequencer-logic.js)
When particles interact, `generateIndividualPattern()` creates the sequencer pattern:

```javascript
generateIndividualPattern(selfParticle, innerParticles) {
  const pattern = {
    bass: [0,0,0,0,0,0,0,0,0,0,0,0],    // Self particle's note
    baritone: [0,0,0,0,0,0,0,0,0,0,0,0], // First inner particle's note
    tenor: [0,0,0,0,0,0,0,0,0,0,0,0]     // Second inner particle's note
  };

  // ALWAYS sets self particle's note to bass
  pattern.bass[selfParticle.getActiveNoteIndex()] = 1;

  // ONLY if inner particles exist, add their notes
  if (innerParticles.length > 0) {
    pattern.baritone[innerParticles[0].getActiveNoteIndex()] = 1;
  }
  if (innerParticles.length > 1) {
    pattern.tenor[innerParticles[1].getActiveNoteIndex()] = 1;
  }

  return pattern;
}
```

**This logic is CORRECT:**
- When **alone**: Only `bass` has a note (1), `baritone` and `tenor` are all zeros
- When **with 1 inner particle**: `bass` + `baritone` have notes (2-note chord)
- When **with 2+ inner particles**: `bass` + `baritone` + `tenor` have notes (3-note chord)

### 3. **Sequencer Update Process**

When the pattern changes, `updateMonoSeqSequencer()` is called for each voice:

```javascript
updateMonoSeqSequencer(iframeWindow, nodeId, patternIndex, notePattern, numSteps = 4) {
  // 1. Clear ALL steps and ALL rows (4 steps × 12 rows = 48 cells)
  // 2. Place the new note at current step position
  // 3. Advance to next step for next update (cycling)
}
```

## Issues Identified

### Issue 1: **Starting Chord Always Same**

**Problem:** Patterns appear identical on each refresh

**Root Causes:**
1. **Limited Scale Notes**: `C Pentatonic Major` only has 5 notes: [0, 2, 4, 7, 9]
   - After 3 particles, only 2 notes remain unused
   - With the same scale, same initialization order, results are very similar

2. **Harmonizing Logic**: `generateHarmonizingPattern()` tries to avoid duplicate notes:
   ```javascript
   const availableNotes = validNotes.filter(note => !existingNotes.includes(note));
   ```
   - If all scale notes are used, it falls back to all scale notes
   - This creates predictable patterns

3. **No Seed/Randomization**: `Math.random()` should work, but limited scale = limited variety

**Solution:**
- Use a larger scale (Major/Minor has 7 notes, Chromatic has 12)
- Randomize the scale selection on initialization
- Add seed-based randomization for reproducible but varied patterns
- Or: Use harmonic progression library for more variety

### Issue 2: **Hearing Chords When Alone**

**Problem:** When particle moves alone, chord is still heard instead of single tone

**Root Causes:**
1. **Sequencer Not Fully Cleared**: The clearing logic might not be working correctly
   ```javascript
   // Current logic clears all steps, but might have timing issues
   for (let step = 0; step < numSteps; step++) {
     for (let row = 0; row < 12; row++) {
       // Clear all cells
     }
   }
   ```
   - If clearing happens asynchronously, old notes might persist
   - Baritone/tenor might not be cleared properly

2. **Pattern Not Updated When Alone**: Code only updates when `innerParticlesChanged`
   - If previous state had inner particles, and now alone, update might be skipped
   - Need to explicitly clear baritone/tenor when no inner particles

3. **Sequencer Step Cycling**: The step cycling logic might be placing notes at wrong positions
   - Old notes at different steps might still be playing
   - Need to ensure ALL steps are cleared, not just current step

**Solution:**
- Ensure baritone/tenor are explicitly cleared when `innerParticles.length === 0`
- Add explicit clearing for empty voices
- Verify sequencer clearing completes before setting new notes

## Detailed Logic Flow

### When Particle is ALONE:
```
1. generateIndividualPattern(selfParticle, [])
   → bass: [1,0,0,0,0,0,0,0,0,0,0,0] (self note)
   → baritone: [0,0,0,0,0,0,0,0,0,0,0,0] (empty)
   → tenor: [0,0,0,0,0,0,0,0,0,0,0,0] (empty)

2. updateMonoSeqSequencer(..., bassPattern)
   → Clears all 4 steps, sets note at step 0
   
3. updateMonoSeqSequencer(..., baritonePattern) 
   → Should clear all steps (all zeros)
   
4. updateMonoSeqSequencer(..., tenorPattern)
   → Should clear all steps (all zeros)

RESULT: Only bass voice should play = single tone ✅
```

### When Particle Has 1 Inner Neighbor:
```
1. generateIndividualPattern(selfParticle, [innerParticle1])
   → bass: [1,0,0,0,0,0,0,0,0,0,0,0] (self note)
   → baritone: [0,0,1,0,0,0,0,0,0,0,0,0] (inner note)
   → tenor: [0,0,0,0,0,0,0,0,0,0,0,0] (empty)

RESULT: bass + baritone = 2-note chord ✅
```

### When Particle Has 2+ Inner Neighbors:
```
1. generateIndividualPattern(selfParticle, [innerParticle1, innerParticle2])
   → bass: [1,0,0,0,0,0,0,0,0,0,0,0] (self note)
   → baritone: [0,0,1,0,0,0,0,0,0,0,0,0] (first inner)
   → tenor: [0,0,0,0,1,0,0,0,0,0,0,0] (second inner)

RESULT: bass + baritone + tenor = 3-note chord ✅
```

## Recommendations

### Fix 1: Ensure Proper Clearing When Alone
```javascript
// In generateIndividualPattern or update logic:
if (innerParticles.length === 0) {
  // Explicitly ensure baritone and tenor are empty
  pattern.baritone = new Array(12).fill(0);
  pattern.tenor = new Array(12).fill(0);
}
```

### Fix 2: Add Explicit Clearing for Empty Voices
```javascript
// In updateMonoSeqSequencer, after clearing all steps:
if (activeNoteIndex < 0) {
  // Explicitly clear all steps for this voice
  // This handles the case when pattern is all zeros
}
```

### Fix 3: More Randomization
- Randomize scale on initialization
- Add seed parameter for reproducible but varied results
- Use larger scales or chromatic for more variety

### Fix 4: Verify Sequencer State
- Add logging to verify sequencer state after updates
- Check that baritone/tenor are actually cleared
- Ensure step cycling doesn't leave old notes

## Summary

**Each particle DOES have its own original tone** ✅
- Stored in `particle.sequencerPattern`
- Never changes during particle lifetime
- Retrieved via `particle.getActiveNoteIndex()`

**When alone, should only hear single tone** ✅ (Logic is correct)
- `generateIndividualPattern()` only sets bass when alone
- Issue is likely in sequencer clearing/updating, not logic

**Starting chord always same** ❌ (Issue identified)
- Limited scale notes (5 in Pentatonic)
- Need more randomization or larger scales


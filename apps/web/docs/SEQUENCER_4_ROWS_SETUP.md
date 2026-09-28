# Setting Up 4-Row Sequencers

## What Was Changed

### Code Updates
1. **Pattern Generation**: `generateIndividualPattern()` now creates 4-element arrays instead of 12
2. **12-to-4 Mapping**: Added `map12ToneTo4Row()` function that maps 12-tone chromatic notes (0-11) to 4 sequencer rows (0-3)
   - Notes 0-2 → Row 0
   - Notes 3-5 → Row 1
   - Notes 6-8 → Row 2
   - Notes 9-11 → Row 3
3. **Pattern Updates**: `updateMonoSeqSequencer()` now supports both 4 and 12-element patterns
4. **NCFT File**: Patterns in nodes 211, 212, 213 have been reduced from 12 rows to 4 rows

### How to Complete Setup in NoiseCraft Editor

Since NoiseCraft determines the number of rows based on the scale, you have two options:

#### Option 1: Use a Scale with 4 Notes (Recommended)
1. Open the embedded NoiseCraft editor
2. Click on each MonoSeq node (bass, baritone, tenor - nodes 211, 212, 213)
3. In the node's control panel, find the scale dropdown
4. Change from "chromatic" to a scale that gives 4 notes
   - Unfortunately, NoiseCraft doesn't have a built-in 4-note scale
   - You may need to use "major pentatonic" (5 notes) or "minor pentatonic" (5 notes) as the closest option
   - Or manually edit the .ncft file to use a custom scale

#### Option 2: Manually Edit .ncft File
You can manually change the scale in the .ncft file, but NoiseCraft will recalculate rows based on the scale.

#### Option 3: Keep Current Setup (Works but Shows 12 Rows)
- The patterns are now 4 rows
- The sequencer will still display 12 rows (because scale is chromatic)
- But only the first 4 rows will be used/updated
- This works functionally, but the UI will show extra empty rows

## Current State

- ✅ Pattern generation: Creates 4-element arrays
- ✅ Pattern updates: Sends 4-row patterns to sequencers
- ✅ NCFT patterns: Reduced to 4 rows
- ⚠️ Sequencer display: Still shows 12 rows (due to chromatic scale)

## Recommendation

**Edit in NoiseCraft Editor:**
1. Click on node 211 (bass)
2. Change scale dropdown to "major pentatonic" or "minor pentatonic" (5 notes - closest to 4)
3. Repeat for nodes 212 (baritone) and 213 (tenor)
4. Save with `Ctrl+S`

This will give you 5 rows instead of 12, which is closer to your desired 4 rows. The patterns will still work correctly with the 4-row mapping.

## Alternative: Custom 4-Note Scale

If you want exactly 4 rows, you would need to:
1. Modify NoiseCraft's `music.js` to add a custom 4-note scale
2. Or manually edit the .ncft file to use a scale that results in 4 notes

But the current setup (4-row patterns with 12-row display) will work functionally - only the first 4 rows will be active.


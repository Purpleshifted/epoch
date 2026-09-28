# Audio Localization and Sequencer Integration

## Overview

This document describes the audio localization and panning system for individual particles, and the integration with NoiseCraft sequencers for chord generation when particles are in distinct range.

## Audio Logic by Range

### Outer Range (within `outerRadius` but NOT `innerRadius`)
- **Audio Cue Only**: Orientation and distance-based audio
- **Visual**: Glowing overlay (add layer) when particles overlap
- **Audio Behavior**:
  - Localized and panned based on virtual stream (relative position)
  - Gain fades out at maximum range
  - Panning: -1 (left) to +1 (right) based on relative X position
  - Distance-based attenuation: inverse square law approximation
  - **No sequencer integration** - audio cue only

### Distinct Range (within `innerRadius`)
- **Audio + Visual Feedback**
- **Visual**: Visible connection lines, bright outline, particles clearly visible
- **Audio Behavior**:
  - Sequencer takes that particle's note position into controlled particle's sequencer
  - Creates distinct chord by adding notes
  - Full audio localization still applies
  - Gain based on proximity

## Implementation Plan

### 1. Audio Localization System

For each controlled particle:
- Calculate relative positions and distances to all other particles
- Determine range (outer vs distinct)
- Apply panning and gain based on relative position and distance
- Fade out audio at maximum range

### 2. Sequencer Integration

When particles enter distinct range:
- Read the note position from the other particle's sequencer
- Add that note to the controlled particle's sequencer pattern
- When particle leaves distinct range, remove the note
- This creates dynamic chord generation based on proximity

### 3. MonoSeq Editing

The NoiseCraft editor already supports:
- Clicking cells to toggle notes
- Pattern selection
- Scale/root note selection
- Pattern extension/shrinking

**Status**: Should already be functional. If not working, check:
- Event propagation in embedded iframe
- Cell click handlers being properly attached
- Model updates being broadcast correctly

## Technical Details

### Panning Calculation
```javascript
// Normalize relative X position to pan value
const relativeX = (otherParticle.x - selfParticle.x) / outerRadius;
const pan = Math.max(-1, Math.min(1, relativeX * panningRange));
```

### Gain Calculation (Distance-Based)
```javascript
// Inverse square law approximation
const normalizedDistance = distance / outerRadius; // 0 to 1
const gain = maxGain * (1 - normalizedDistance * normalizedDistance);
const clampedGain = Math.max(minGain, Math.min(maxGain, gain));
```

### Sequencer Note Integration
When in distinct range:
1. Read other particle's current note from its MonoSeq pattern
2. Find the active step in controlled particle's sequencer
3. Add the note to that step (create chord)
4. When leaving distinct range, restore original pattern

## Current Status

- ✅ Physics adjusted for realistic behavior
- ✅ Individual view with visual feedback (glowing, distinct connections)
- ✅ Delete key enabled for nodes
- ⏳ Audio localization logic (to be implemented)
- ⏳ Sequencer note integration (to be implemented)
- ⏳ Verify MonoSeq editing works (cells should already be clickable)




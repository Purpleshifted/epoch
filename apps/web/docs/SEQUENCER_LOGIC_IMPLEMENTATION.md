# Sequencer Logic Implementation Guide

## Overview

This document describes the implementation of sequencer logic for individual and global audio routing in the multi-user particle system.

## Signal Generation Changes

### Updated Parameters

1. **Closing Speed**: 
   - If Is Inner: Average value of all particles in inner radius that are approaching (positive closing speed)
   - Otherwise: Uses nearest particle's closing speed

2. **Distance**: 
   - From the most affecting particle, based on:
     - Mass (if collected/clustered, sum of masses)
     - Distance from it
   - "Collected" means particles that are Is Inner to each other

3. **Is Inner**: Returns `1` when true, `0` when false (numeric, not boolean)

4. **Is Outer**: Returns `1` when true, `0` when false (numeric, not boolean)

### Additional Signal Data

The `generateSignals()` function now returns:
- `innerParticles`: Array of particles in inner radius with their patterns and positions
- `outerParticles`: Array of particles in outer radius with their patterns and positions
- `mostAffectingParticleId`: ID of the particle with highest affect (mass/distance²)

## Sequencer Pattern System

### Individual Note Profile

Each particle has a unique note profile assigned at creation:
- Random pattern from `[1,0,...,0]` to `[0,0,...,1]`
- Exactly one note active per particle
- Stored in `particle.sequencerPattern`
- Can be accessed via `particle.getActiveNoteIndex()`

### Individual Audio Logic

**When particles are in Inner range:**

1. Self particle's note → bass sequencer column
2. First inner particle's note → baritone sequencer column
3. Second inner particle's note → tenor sequencer column
4. Maximum 3 notes (chord)

Example:
- Self has note pattern `[1,0,0,0,...]` (note 0)
- Inner particle 1 has `[0,0,1,0,...]` (note 2)
- Inner particle 2 has `[0,0,0,1,...]` (note 3)

Result:
- Bass: `[1,0,0,0,...]` (self's note)
- Baritone: `[0,0,1,0,...]` (inner 1's note)
- Tenor: `[0,0,0,1,...]` (inner 2's note)

This creates a chord where the user hears their own note plus the notes of nearby particles.

### Global Audio Logic

**Pattern distribution:**
- bass 1st column → baritone 1st column → tenor 1st column → 
- bass 2nd column → baritone 2nd column → ...

All particles contribute to the global sequencers in order of their ID.

Example with 6 particles:
- Particle 0 → bass column 0
- Particle 1 → baritone column 0
- Particle 2 → tenor column 0
- Particle 3 → bass column 1
- Particle 4 → baritone column 1
- Particle 5 → tenor column 1

This creates chord progressions as users join/leave.

### Outer Range Audio (Spatialized)

**For Is Outer particles:**
- Oscillators are spatialized and panned based on:
  - Orientation (angle from self)
  - Relative displacement (distance)
- Gain fades out at maximum range
- Pan: -1 (left) to +1 (right) based on horizontal position

## Implementation Steps

### 1. Update NoiseCraft Sequencer Nodes

Use NoiseCraft's `ToggleCell` action to update sequencer patterns:

```javascript
// Individual sequencer update
const individualPattern = sequencerLogic.generateIndividualPattern(selfParticle, innerParticles);
updateSequencerNode(bassNodeId, individualPattern.bass);
updateSequencerNode(baritoneNodeId, individualPattern.baritone);
updateSequencerNode(tenorNodeId, individualPattern.tenor);

// Global sequencer update
const globalPattern = sequencerLogic.generateGlobalPattern(allParticles);
updateSequencerNode(globalBassNodeId, globalPattern.bass);
// ... etc
```

### 2. Spatial Audio for Outer Particles

For each outer particle:
1. Calculate pan/gain using `sequencerLogic.calculateSpatialization()`
2. Map these values to NoiseCraft pan/gain nodes via stream mapping UI
3. Each outer particle needs its own oscillator/voice that is panned

### 3. Multi-User Scenario Architecture

**Current Architecture (Single User):**
- All particles are simulated locally
- Individual audio is calculated from local particle system
- Global audio uses all particles

**Future Multi-User Architecture:**

1. **Server-Side:**
   - Maintains authoritative particle positions
   - Broadcasts particle updates to all clients
   - Aggregates global audio pattern

2. **Client-Side:**
   - Receives updates from server
   - Maintains local copy of all particles
   - Calculates individual audio locally
   - Receives global audio pattern from server

3. **WebSocket Events:**
   ```
   - user-joined: { userId, particleId, noteProfile }
   - user-left: { userId, particleId }
   - particle-updated: { particleId, position, velocity }
   - global-pattern-updated: { bassPattern, baritonePattern, tenorPattern }
   ```

4. **Particle Management:**
   - When user joins: `particleSystem.addParticle(id, x, y, tone, mass)`
   - When user leaves: `particleSystem.removeParticle(id)`
   - When user moves: Update particle position/velocity via drag controls

## Usage in NoiseCraft

### Mapping Streams to Sequencer Nodes

You can map the new signal streams to NoiseCraft nodes:

1. **Is Inner / Is Outer**: Use as gates to trigger sequencer pattern updates
2. **Closing Speed**: Map to oscillator parameters for dynamic timbre
3. **Distance**: Map to delay time or reverb amount
4. **Inner/Outer Particle Data**: Use `window.particleSignals[particleId]` to access particle data

### Sequencer Pattern Updates

To update sequencer patterns programmatically:

```javascript
// Get sequencer node IDs from NoiseCraft project
const bassNodeId = 211; // From your indiv_audio_map.ncft
const baritoneNodeId = 212;
const tenorNodeId = 213;

// Generate pattern for particle 0
const signals = window.particleSignals[0];
if (signals && signals.innerParticles.length > 0) {
  const selfParticle = particleSystem.getParticles().find(p => p.id === 0);
  const innerParticles = signals.innerParticles.map(p => 
    particleSystem.getParticles().find(part => part.id === p.id)
  );
  
  const pattern = sequencerLogic.generateIndividualPattern(selfParticle, innerParticles);
  
  // Update NoiseCraft sequencers
  updateMonoSeqPattern(bassNodeId, pattern.bass);
  updateMonoSeqPattern(baritoneNodeId, pattern.baritone);
  updateMonoSeqPattern(tenorNodeId, pattern.tenor);
}
```

### Helper Functions Needed

```javascript
// Update MonoSeq pattern in NoiseCraft
function updateMonoSeqPattern(nodeId, notePattern) {
  // Convert note pattern [1,0,0,...] to NoiseCraft format
  const noiseCraftPattern = convertNotePatternToNoiseCraft(notePattern, 16);
  
  // Send ToggleCell actions for each step/row
  // This needs to be implemented based on NoiseCraft's pattern format
  iframe.contentWindow?.postMessage({
    type: "noiseCraft:updateSequencerPattern",
    nodeId: nodeId,
    pattern: noiseCraftPattern
  }, "*");
}
```

## Next Steps

1. **Integrate sequencer updates**: Add logic to detect when inner particles change and update sequencers
2. **Implement spatial audio**: Create per-particle oscillators for outer particles with panning
3. **Multi-user support**: Add WebSocket server and client synchronization
4. **Pattern persistence**: Save sequencer patterns with particle data
5. **User controls**: Allow users to manually change their note profile


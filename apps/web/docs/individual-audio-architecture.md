# Individual Audio Architecture

## Overview

The audio system has been refactored to separate **individual audio** (per-user) from **global audio** (ambient/cluster-based). This document describes the individual audio system for per-user interaction and spatialization.

## Completed Changes

### 1. Physics Fix - Stable 3-Body System

**File**: `noisecraft/public/test-workspace.html`

- Changed from 3 equal-mass particles to a **central heavy particle + 2 orbiting moons**
- Central particle: mass = 500 (relatively stationary)
- Moon particles: mass = 50 (orbit around center)
- This creates stable, predictable orbital motion instead of chaotic 3-body interactions
- Uses proper orbital velocity calculations: `v = sqrt(G*M/r) * 0.8`

**Benefits**:
- Stable orbits that don't drift apart
- Predictable motion for audio spatialization
- Mimics real planetary systems

### 2. Individual Audio Router Module

**File**: `noisecraft/public/individual-audio.js`

Created a new modular system for routing individual audio per user:

#### Key Features:

- **User-Particle Mapping**: Tracks which particle belongs to which user
- **Nearby Particle Detection**: Finds particles within `maxDistance` (default 300px)
- **Spatial Panning**: Calculates left/right panning based on relative positions
- **Distance-Based Gain**: Attenuates audio based on distance (inverse square law)
- **Interaction Analysis**: Tracks approaching/receding particles, closing speeds
- **Signal Integration**: Works with existing signal generator for stream values

#### Main Class: `IndividualAudioRouter`

```javascript
const router = new IndividualAudioRouter({
  maxDistance: 300,      // Max distance for audio interaction
  panningRange: 0.8,     // Max pan value (-0.8 to 0.8)
  updateRate: 60,        // Updates per second
});

// Register user with particle
router.registerUser('user_123', particleId);

// Generate individual audio data
const audioData = router.generateIndividualAudio(userId, allParticles, signalGenerator);
```

#### Audio Data Structure

```javascript
{
  enabled: true,
  selfParticle: {...},
  selfSignals: {
    attraction: 0.5,
    velocity: 0.3,
    distance: 120,
    closingSpeed: 45,
    // ... other signals
  },
  interactions: [
    {
      particleId: 1,
      userId: 'user_456',
      distance: 150,
      pan: 0.6,           // -1 (left) to 1 (right)
      gain: 0.7,          // 0 to 1
      closingSpeed: 45,
      isApproaching: true,
      attraction: 0.3,
      velocity: 0.2,
      isInner: false,
      isOuter: true,
    },
    // ... more nearby particles
  ],
  nearestDistance: 150,
  nearestPan: 0.6,
  nearestGain: 0.7,
  approachingCount: 2,
  totalNearbyCount: 3,
}
```

## Architecture Design

### Individual Audio vs Global Audio

#### Individual Audio (Per-User)
- **Purpose**: Personal auditory cues for each user
- **Focus**: Interaction with nearby particles, spatial awareness
- **Features**:
  - Panning/localization (left/right based on relative position)
  - Distance-based attenuation
  - Approaching/receding indicators
  - Velocity and attraction feedback
  - Connection to nearby particles

#### Global Audio (Future)
- **Purpose**: Ambient sound, cluster-based audio
- **Focus**: Overall system state, non-disturbing background
- **Features**:
  - Cluster size indication
  - Ambient textures
  - Global patterns

### Integration Points

1. **Particle System**: Uses existing `ParticleSystem` and `SignalGenerator`
2. **NoiseCraft**: Generates parameters compatible with NoiseCraft node mapping
3. **User Management**: Tracks user-to-particle mapping

## Next Steps

### 3. Implement Individual Audio Routing ✅ (In Progress)

- [x] Create `IndividualAudioRouter` module
- [x] Implement nearby particle detection
- [x] Implement panning calculation
- [x] Implement distance-based gain
- [ ] Integrate with NoiseCraft node mapping
- [ ] Create UI for individual audio configuration
- [ ] Test with multiple users

### 4. User-Particle Management

- [ ] Add particle when user joins
- [ ] Remove particle when user leaves
- [ ] Handle user reconnection
- [ ] Manage particle IDs for new users

### 5. User Control

- [ ] Allow user to control their particle position
- [ ] Allow user to control their particle velocity
- [ ] Sync user input with particle system

### 6. Global Audio System (Future)

- [ ] Design global audio architecture
- [ ] Implement cluster detection
- [ ] Create ambient sound generation
- [ ] Separate global audio routing

## Usage Examples

### Basic Individual Audio Setup

```javascript
import { IndividualAudioRouter } from '/public/individual-audio.js';

// Initialize router
const audioRouter = new IndividualAudioRouter({
  maxDistance: 300,
  panningRange: 0.8,
});

// Register users as they join
audioRouter.registerUser('user_123', 0);  // Particle ID 0
audioRouter.registerUser('user_456', 1);  // Particle ID 1

// Generate audio for a user
const particles = particleSystem.getParticles();
const audioData = audioRouter.generateIndividualAudio(
  'user_123',
  particles,
  signalGenerator
);

// Use audio data to control NoiseCraft nodes
if (audioData.enabled) {
  // Map to NoiseCraft parameters
  const params = audioData.interactions.map(interaction => ({
    nodeId: 'pan_node_id',
    paramName: 'value',
    value: interaction.pan, // -1 to 1
  }));
  
  // Send to NoiseCraft
  sendToNoiseCraft({ type: 'noiseCraft:setParams', params });
}
```

### Custom Mapping Function

```javascript
import { createDefaultIndividualMapping } from '/public/individual-audio.js';

const mappingFunction = createDefaultIndividualMapping({
  distanceNodeId: '17',      // % knob
  velocityNodeId: '183',     // Vol CHORDS
  panNodeId: 'custom_pan',   // Custom pan node
});

const params = audioRouter.generateNoiseCraftParams(
  'user_123',
  particles,
  signalGenerator,
  mappingFunction
);
```

## Notes

- Individual audio focuses on **interaction and spatial awareness**
- Each user gets their own audio stream based on nearby particles
- Panning and distance attenuation provide natural spatial cues
- The system is designed to be modular and extensible
- Global audio will be implemented separately as a complementary system




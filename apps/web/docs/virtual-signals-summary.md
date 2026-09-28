# Virtual Signals for Audio Modulation - Summary

## Overview

This system provides:
1. **Node Mapping**: Tools to map NoiseCraft nodes from `.ncft` files to browser view
2. **Virtual Signal Generator**: Test system for audio modulation based on particle interactions

## Files Created

### Core Libraries

1. **`src/lib/audio/nodeMapper.ts`**
   - Parse NoiseCraft `.ncft` files
   - Extract node information (position, type, parameters)
   - Find nodes by name, type, or position
   - Map nodes to browser view coordinates

2. **`src/lib/audio/virtualSignals.ts`**
   - Virtual particle system for testing
   - Calculate particle interactions (distance, velocity, attraction)
   - Generate virtual signal streams
   - Convert signals to NoiseCraft parameters

3. **`src/lib/audio/virtualSignals.test.ts`**
   - Example usage patterns
   - Test scenarios
   - Integration helpers

4. **`src/lib/audio/example-usage.ts`**
   - Complete workflow examples
   - Game state integration
   - Simulation loops

### Documentation

1. **`docs/audio-modulation.md`**
   - Complete guide for using the system
   - Examples and patterns
   - Browser view navigation tips

## Quick Start

### 1. Map Nodes from File to Browser

```typescript
import { parseNoiseCraftFile, findNodeByName } from "@/lib/audio/nodeMapper";

const fileContent = await fetch("/noisecraft/examples/falling_in_love_with_waterfalls (2).ncft").then(r => r.text());
const project = parseNoiseCraftFile(fileContent);
const nodesMap = extractNodeInfo(project);

// Find a node
const volKnob = findNodeByName(nodesMap, "Vol CHORDS");
console.log(`Node at (${volKnob?.x}, ${volKnob?.y})`);
```

### 2. Create Virtual Signal Generator

```typescript
import {
  VirtualSignalGenerator,
  createAttractionModulationConfig,
} from "@/lib/audio/virtualSignals";

const generator = new VirtualSignalGenerator(100);

// Add modulation config
generator.addSignal(
  createAttractionModulationConfig("206", "value", 0, 0.1)
);

// Create particles
generator.createParticle(
  "user-1",
  { x: 2500, y: 2500 },
  { x: 0, y: 0 },
  { tone: randomChromaticTone() }
);

// Generate parameters
const params = generator.generateParams("user-1");
```

### 3. Integrate with Game State

```typescript
import { updateVirtualSignalsFromGameState } from "@/lib/audio/example-usage";

updateVirtualSignalsFromGameState(
  generator,
  "user-1",
  gameState,
  iframe,
  origin
);
```

## Signal Types

The virtual signal generator supports these modulation types:

1. **`attraction`** - Proximity-based (inverse distance)
2. **`velocity`** - Particle speed
3. **`distance`** - Distance between particles
4. **`closingSpeed`** - Relative velocity when approaching
5. **`tone`** - Chromatic tone (0-11 for 12-tone scale)

## Particle Interactions

The system calculates:
- **Distance**: Euclidean distance between particles
- **Relative Velocity**: Speed difference
- **Closing Speed**: Approach velocity
- **Attraction**: Normalized proximity (0-1)
- **Threshold**: Interaction distance (default 100 pixels)

## Use Cases

### 1. Testing Audio Modulation

Create virtual particles to test how audio responds to:
- Particle proximity
- Movement speed
- Distance thresholds

### 2. New User Tone Assignment

Assign random chromatic tones (0-11) to new users:

```typescript
generator.createParticle(
  "new-user",
  position,
  velocity,
  { tone: randomChromaticTone() }
);
```

### 3. Interaction-Based Modulation

Modulate audio when particles are:
- Within interaction threshold
- Approaching each other
- Moving at high velocity

### 4. Debugging Node Mapping

Find nodes in browser view using coordinates:

```typescript
const node = findNodeByName(nodesMap, "fact");
// Node is at position (773, 1107) in browser view
```

## Integration Points

### With Game State

The system can sync with your game state:

```typescript
// Update from game players
generator.updateParticle("user-1", {
  position: player.cell.position,
  velocity: player.cell.velocity,
});
```

### With NoiseCraft

Parameters are sent to NoiseCraft via postMessage:

```typescript
postNoiseCraftParams(iframe, origin, params);
```

### With Real-time Updates

Run continuous simulation:

```typescript
const cleanup = startVirtualSignalSimulation(
  generator,
  "user-1",
  () => gameState,
  iframe,
  origin,
  100 // ms interval
);
```

## Example Workflow

```typescript
// 1. Setup
const setup = await setupAudioModulationWithVirtualSignals();

// 2. Create particles
setup.generator.createParticle(
  setup.userParticleId,
  { x: 2500, y: 2500 },
  { x: 0, y: 0 },
  { tone: randomChromaticTone() }
);

// 3. Run simulation
const cleanup = startVirtualSignalSimulation(
  setup.generator,
  setup.userParticleId,
  () => gameState,
  setup.iframe,
  setup.origin
);

// 4. Cleanup when done
cleanup();
```

## Key Nodes from Falling in Love With Waterfalls

From the example file:

- **Node 206** - `fact` knob (detune) at (773, 1107)
- **Node 183** - `Vol CHORDS` at (2430, 323)
- **Node 17** - `%` knob (probability) at (866, 297)
- **Node 5, 35, 107** - Const values for approach modulation
- **Node 70** - `vol` master volume at (3502, 748)

All of these can be modulated via virtual signals.

## Next Steps

1. **Customize Signal Configurations**: Adjust min/max values to match node ranges
2. **Add More Signal Types**: Extend `VirtualSignalConfig` for custom signals
3. **Integrate with Collision System**: Use collision events to trigger modulation
4. **Create UI Controls**: Build UI to adjust signal parameters in real-time
5. **Performance Optimization**: Batch parameter updates for better performance

## Browser View Navigation

To find nodes in the browser:

1. Open `https://noisecraft.app/1469`
2. Nodes are positioned at their (x, y) coordinates
3. Hover over nodes to see their names
4. Click nodes to view parameters
5. Use browser dev tools to search by node ID

## Notes

- Virtual signals are for **testing** - replace with real game state for production
- Particle positions use the same coordinate system as your game (5000x5000)
- Threshold distance (default 100) matches collision distance
- Tone values (0-11) map to chromatic scale semitones




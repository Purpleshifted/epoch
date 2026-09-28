# Audio Modulation with Virtual Signals

This document explains how to:
1. Map NoiseCraft nodes from `.ncft` files to browser view
2. Use virtual signal generators for testing audio modulation

## Mapping Nodes from File to Browser View

The `.ncft` file contains all node information including their positions (x, y coordinates). The browser view at `https://noisecraft.app/1469` displays these nodes at their specified positions.

### Using the Node Mapper

```typescript
import { parseNoiseCraftFile, extractNodeInfo, findNodeByName } from "@/lib/audio/nodeMapper";

// Load and parse the .ncft file
const fileContent = await fetch("/noisecraft/examples/falling_in_love_with_waterfalls (2).ncft").then(r => r.text());
const project = parseNoiseCraftFile(fileContent);

// Extract all node information
const nodesMap = extractNodeInfo(project);

// Find a specific node by name
const volKnob = findNodeByName(nodesMap, "Vol CHORDS");
console.log(`Found node: ${volKnob?.name} at position (${volKnob?.x}, ${volKnob?.y})`);
// Output: Found node: Vol CHORDS at position (2430, 323)

// Find all modulatable nodes (Knobs, Const values)
const modulatable = Array.from(nodesMap.values()).filter(
  node => node.type === "Knob" || node.type === "Const"
);
```

### Finding Nodes in the Browser

1. **By Node ID**: Each node has a unique ID (e.g., "206", "183")
   - In the file, nodes are stored as `{"0": {...}, "1": {...}}`
   - The key is the node ID

2. **By Position**: Nodes have `x` and `y` coordinates
   - These match the browser view coordinates
   - You can search for nodes near a specific position

3. **By Type**: Filter by node type (Knob, Const, Add, Mul, etc.)

Example from the file:
```json
{
  "206": {
    "type": "Knob",
    "name": "fact",
    "x": 773,
    "y": 1107,
    "params": {"minVal": 0, "maxVal": 0.1, "value": 0.01496484375000049}
  }
}
```

This node can be found in the browser at position (773, 1107) and is modulatable via its `value` parameter.

## Virtual Signal Generator

The virtual signal generator creates test streams for audio modulation based on:
- **Particle attraction** - How close particles are to each other
- **Velocity** - Speed of particle movement
- **Relative velocity** - Speed difference between particles
- **Distance** - Distance between particles
- **Tone** - Random 12-tone chromatic assignment

### Basic Usage

```typescript
import {
  VirtualSignalGenerator,
  createAttractionModulationConfig,
  createTestScenario,
} from "@/lib/audio/virtualSignals";

// Create generator with interaction threshold
const generator = new VirtualSignalGenerator(100); // 100 pixel threshold

// Create test particles
const particleIds = createTestScenario(generator, 5);

// Configure modulation signals
generator.addSignal(
  createAttractionModulationConfig(
    "206",        // node ID
    "value",      // parameter name
    0,            // min value
    0.1           // max value
  )
);

// Generate parameters for a particle
const params = generator.generateParams(particleIds[0]);

// Send to NoiseCraft
import { postNoiseCraftParams } from "@/lib/audio/noiseCraft";
postNoiseCraftParams(iframe, origin, params);
```

### Signal Types

1. **Attraction** - Based on proximity (inverse distance)
   ```typescript
   createAttractionModulationConfig("nodeId", "value", 0, 1)
   ```

2. **Velocity** - Based on particle speed
   ```typescript
   createVelocityModulationConfig("nodeId", "value", 0, 1)
   ```

3. **Distance** - Based on distance (can be inverted)
   ```typescript
   createDistanceModulationConfig("nodeId", "value", 0, 1, true)
   ```

4. **Closing Speed** - Based on relative velocity approaching
   ```typescript
   {
     nodeId: "nodeId",
     signalType: "closingSpeed",
     minValue: 0,
     maxValue: 1,
   }
   ```

5. **Tone** - Based on chromatic tone (0-11)
   ```typescript
   createToneModulationConfig("nodeId", "value", 0, 1)
   ```

### Integration with Game State

```typescript
// Sync particle from game state
import { syncParticleFromGameState } from "@/lib/audio/virtualSignals.test";

syncParticleFromGameState(generator, "user-1", {
  position: { x: player.x, y: player.y },
  velocity: { x: player.vx, y: player.vy },
});

// Generate parameters
const params = generator.generateParams("user-1");
postNoiseCraftParams(iframe, origin, params);
```

### Running a Simulation Loop

```typescript
import { runVirtualSignalSimulation } from "@/lib/audio/virtualSignals.test";

const cleanup = runVirtualSignalSimulation(
  generator,
  "user-1",
  iframe,
  origin,
  100 // update interval in ms
);

// Later, cleanup:
cleanup();
```

## Common Modulation Patterns

### Pattern 1: Attraction-Based Modulation
Modulate audio based on how close particles are:
```typescript
generator.addSignal({
  nodeId: "206",
  paramName: "value",
  signalType: "attraction",
  minValue: 0.01,
  maxValue: 0.05,
});
```

### Pattern 2: Velocity-Based Modulation
Modulate based on movement speed:
```typescript
generator.addSignal({
  nodeId: "183",
  paramName: "value",
  signalType: "velocity",
  minValue: 0.15,
  maxValue: 0.8,
});
```

### Pattern 3: Distance Threshold Interaction
Modulate when particles cross interaction threshold:
```typescript
generator.addSignal({
  nodeId: "17",
  paramName: "value",
  signalType: "distance",
  minValue: 0,
  maxValue: 1,
  inverted: true, // closer = higher value
});
```

### Pattern 4: Random Tone Assignment
Assign random chromatic tone (0-11) to new users:
```typescript
generator.createParticle(
  "new-user",
  { x: 2500, y: 2500 },
  { x: 0, y: 0 },
  {
    tone: randomChromaticTone(), // 0-11
  }
);
```

## Examples from Falling in Love With Waterfalls

From the file `falling_in_love_with_waterfalls (2).ncft`, here are some key modulatable nodes:

- **Node 206** (`fact` knob at 773, 1107) - Currently used for detune
- **Node 183** (`Vol CHORDS` at 2430, 323) - Currently used for chord volume
- **Node 17** (`%` knob at 866, 297) - Probability threshold
- **Node 56** (`*` knob at 1548, 360) - Filter modulation
- **Node 70** (`vol` at 3502, 748) - Master volume

You can map any of these nodes to virtual signals for testing.

## Browser View Navigation

To find a node in the browser view:

1. Open `https://noisecraft.app/1469`
2. Use the node's (x, y) coordinates to locate it visually
3. The node name appears when you hover over it
4. Click a node to see its parameters and connections

You can also use browser dev tools to search the DOM for node IDs if needed.




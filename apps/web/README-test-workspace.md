# NoiseCraft Virtual Signal Test Workspace

## Quick Start

**Single command to open the test workspace:**

```bash
node scripts/open-test-workspace.mjs
```

Or using the shell script:

```bash
./scripts/open-test-workspace.sh
```

## Features

### 3 Virtual Particles
- Each particle has displacement (position) and velocity streams
- Particles can be controlled with keyboard (WASD or Arrow keys)
- Each particle is assigned a chromatic tone (0-11)

### Two Interaction Radii

1. **Inner Radius (80px)** - Distinct feedback
   - When particles are within this radius, you get clear, distinct audio feedback
   - Strong interaction signals

2. **Outer Radius (150px)** - Starts to react
   - When particles are within this radius, audio starts to react to proximity
   - Gradual modulation begins

### Signal Streams

The workspace generates virtual signals based on particle interactions:

- **Attraction**: Proximity-based (inverse distance)
  - Modulates Node 206 (`fact` knob) - 0 to 0.1

- **Velocity**: Movement speed
  - Modulates Node 183 (`Vol CHORDS`) - 0.15 to 0.8

- **Distance**: Distance between particles (inverted)
  - Modulates Node 17 (`%` knob) - 0 to 1

### Tone Assignment

Particles are assigned to NoiseCraft MonoSeq nodes:

- **Particle 0** → Node 211 (`bass`) - C2 octave
- **Particle 1** → Node 212 (`baritone`) - C3 octave  
- **Particle 2** → Node 213 (`tenor`) - C4 octave

Each particle's tone (0-11 chromatic) is automatically assigned to the corresponding MonoSeq pattern row.

## Controls

1. **Adjust Radii**: Use sliders in left panel to change interaction thresholds
2. **Start/Stop Audio**: Use buttons in header
3. **Monitor Streams**: View real-time signal values in left panel

**Note**: Particles move automatically - no keyboard controls needed. The workspace focuses on signal stream generation and testing.

## Node Mapping

From the `falling_in_love_with_waterfalls (2).ncft` file:

- **Node 206** - `fact` knob at (773, 1107) - Detune modulation
- **Node 183** - `Vol CHORDS` at (2430, 323) - Volume modulation
- **Node 17** - `%` knob at (866, 297) - Probability threshold
- **Node 211** - `bass` MonoSeq at (131, 1864) - Bass tone
- **Node 212** - `baritone` MonoSeq at (636, 1862) - Baritone tone
- **Node 213** - `tenor` MonoSeq at (1147, 1864) - Tenor tone

## Browser View

You can view the NoiseCraft patch in the browser:
- Open: https://noisecraft.app/1469
- Or use the embedded view in the test workspace

Nodes are positioned at their (x, y) coordinates from the `.ncft` file.

## Architecture

The test workspace is **modular and independent** from the main system:

- Self-contained HTML file (`noisecraft/public/test-workspace.html`)
- Uses NoiseCraft embedded iframe
- Virtual signal generator runs in browser
- No external dependencies beyond NoiseCraft server

This allows testing audio modulation without connecting to the full game system.


# Performance and Music Theory Optimizations

## 1. Performance Optimizations (Lag Reduction)

### Throttling Updates
- **Signal Updates**: Throttled to 60fps (16ms interval) for UI updates
- **Parameter Updates**: Throttled to 30fps (33ms interval) for audio parameters
- **Sequencer Updates**: Throttled to 10fps (100ms interval) - only updates when patterns actually change

### Optimizations Applied:
1. **Signal Generation**: Only runs at 60fps max, reduces CPU load
2. **DOM Updates**: Batched together, prevents layout thrashing
3. **Sequencer Pattern Updates**: Heavy throttling prevents message spam
4. **requestAnimationFrame**: Used for batching instead of setTimeout chains

### Technical Details:
```javascript
const SIGNAL_UPDATE_INTERVAL = 16;   // ~60fps for signal updates
const PARAM_UPDATE_INTERVAL = 33;    // ~30fps for parameter updates
const SEQUENCER_UPDATE_THROTTLE = 100; // 10fps for sequencer updates
```

## 2. Spatial Reverb and Immersion

### Volume Reduction
- **Other Oscillators**: Reduced to 20% of original volume (node 183 "Vol CHORDS")
- **Ambient Sound**: Much quieter for better immersion
- **Default Value**: 0.00002 (was 0.000149)

### Reverb/Delay
- The `.ncft` file already includes delay nodes in the signal path
- Reverb is handled by NoiseCraft's built-in delay feedback
- Additional spatialization can be added via panning controls

### Implementation:
```javascript
// Volume reduction in update loop
chordVolumeKnob.value = Math.max(0.000005, chordVolumeKnob.value * 0.2);
```

## 3. Music Theory-Based Pattern Generation

### Scales Available
- **Major Scales**: C, D, E, F, G, A
- **Minor Scales**: A Minor, E Minor, D Minor
- **Pentatonic Scales**: Very harmonious, default choice
- **Blues Scale**: For more expressive patterns
- **Chromatic**: Full flexibility (less harmonious)

### Chord Tones
- Major triads: C, D, E, F, G, A
- Minor triads: C Minor, D Minor, E Minor, A Minor
- Patterns prioritize chord tones when in chord context

### Functions Available

1. **`generateHarmoniousPattern(scaleName, chordName, numNotes)`**
   - Generates a pattern using notes from the specified scale
   - If chord is specified, prefers chord tones

2. **`generateHarmonizingPattern(existingPatterns, scaleName)`**
   - Generates a pattern that harmonizes with existing patterns
   - Avoids duplicate notes when possible
   - Stays within the scale

3. **`generateChordPatterns(chordName, numPatterns)`**
   - Generates multiple patterns that form a chord
   - Useful for creating harmonious triads

### Default Scale
- **Current**: `'C Pentatonic Major'` - very harmonious, sounds good with any combination

### Particle Initialization
- Particles now start with harmonious patterns
- Each particle's pattern harmonizes with existing particles
- Patterns update harmoniously when particles interact

### Example Usage:
```javascript
// Generate a pattern using pentatonic scale
const pattern = generateHarmoniousPattern('C Pentatonic Major', null, 12);

// Generate a pattern that harmonizes with existing ones
const harmonized = generateHarmonizingPattern([pattern1, pattern2], 'C Pentatonic Major');
```

## Benefits

1. **Performance**: Significantly reduced lag through throttling
2. **Audio Quality**: More harmonious patterns, less dissonance
3. **Immersion**: Quieter ambient oscillators create better spatial depth
4. **Musicality**: Patterns sound more musical, less random

## Future Improvements

1. **Dynamic Scale Selection**: Change scale based on particle interactions
2. **Chord Progression**: Automatically progress through chord changes
3. **Voice Leading**: Smooth transitions between notes
4. **Web Workers**: Move particle calculations to worker thread for even better performance
   
   **What are Web Workers?**
   Web Workers are JavaScript threads that run in the background, separate from the main UI thread. They allow you to:
   - Run computationally intensive tasks without freezing the browser
   - Keep the UI responsive during heavy calculations
   - Process data in parallel
   
   **How they work:**
   - Main thread creates a Worker: `const worker = new Worker('worker.js')`
   - Communication via `postMessage()` (send data) and `onmessage` (receive results)
   - Workers can't access DOM or window object - they're isolated
   
   **For this project:**
   - Move particle physics calculations to a Web Worker
   - Main thread sends particle positions/velocities to worker
   - Worker calculates gravitational forces and updates positions
   - Worker sends results back to main thread for visualization/audio
   - This prevents particle calculations from blocking UI updates


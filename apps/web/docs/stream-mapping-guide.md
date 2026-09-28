# Stream-to-Node Mapping Guide

This guide explains how to use the advanced stream-to-node mapping features in the NoiseCraft test workspace.

## Features

### 1. Gravitational Force Calculation

The attraction signal is now calculated using Newton's law of universal gravitation:

**F = G × m₁ × m₂ / r²**

Where:
- **G**: Gravitational constant (adjustable slider, 10-500)
- **m₁, m₂**: Masses of particles (currently all set to 1)
- **r**: Distance between particles
- **F**: Resulting force used as the attraction signal

**Controls:**
- **G (Strength)**: Controls the strength of gravitational attraction
- **Min Distance**: Minimum distance to prevent division by zero and stabilize calculations

### 2. Stream-to-Node Mapping

Access the mapping interface by clicking the **"Mappings"** tab in the left panel.

#### Creating a Mapping

1. Click **"+ Add Mapping"** button
2. Configure:
   - **Node ID**: The NoiseCraft node ID (e.g., "206" for the "fact" knob)
   - **Param**: Parameter name (usually "value" for knobs)
   - **Operation**: How to combine multiple streams (if using more than one)
   - **Enabled**: Toggle to enable/disable the mapping

#### Adding Multiple Streams

1. Click **"+ Add Stream"** within a mapping
2. Configure each stream:
   - **Stream**: Select from available streams (attraction, velocity, distance, closingSpeed, isInner, isOuter)
   - **Interpolation**: Choose mapping mode:
     - **Linear**: Direct linear mapping
     - **Logarithmic**: Logarithmic curve (sensitive at low values)
     - **Exponential**: Exponential curve (sensitive at high values)
   - **Input Range**: Min/Max values from the stream
   - **Output Range**: Min/Max values to send to the node

#### Mathematical Operations

When multiple streams are mapped to one node, choose an operation:

- **None**: Uses only the first stream (or combined via other operations)
- **Add (+)**: Sum all stream values
- **Subtract (-)**: First stream minus all others
- **Multiply (×)**: Multiply all stream values
- **Divide (÷)**: First stream divided by all others
- **Min**: Take the minimum value
- **Max**: Take the maximum value
- **Average**: Average of all stream values

#### Example Configurations

**Example 1: Single Stream with Logarithmic Interpolation**
```
Node: 206 (fact knob)
Param: value
Stream: attraction
Interpolation: logarithmic
Input: 0 to 1
Output: 0 to 0.1
```
This maps attraction force (0-1) to the fact knob (0-0.1) with logarithmic scaling.

**Example 2: Multiple Streams with Addition**
```
Node: 183 (Vol CHORDS)
Param: value
Operation: Add
Streams:
  - velocity (linear, 0-1 → 0.15-0.5)
  - attraction (linear, 0-1 → 0-0.3)
```
This adds velocity and attraction signals together to control volume.

**Example 3: Distance-Based Control with Exponential**
```
Node: 17 (%)
Param: value
Stream: distance
Interpolation: exponential
Input: 0 to 300
Output: 1 to 0
```
This inverts distance (closer = higher value) with exponential response.

## Available Streams

- **attraction**: Gravitational force between particles (0 to 1)
- **velocity**: Particle velocity magnitude (0 to 1)
- **distance**: Distance to nearest particle (in pixels)
- **closingSpeed**: Relative velocity when approaching (0 to 1)
- **isInner**: Boolean (0 or 1) - within inner radius
- **isOuter**: Boolean (0 or 1) - within outer radius

## Tips

1. **Interpolation Modes**:
   - Use **logarithmic** for signals that need more sensitivity at low values
   - Use **exponential** for signals that need more sensitivity at high values
   - Use **linear** for straightforward proportional mapping

2. **Range Mapping**:
   - Adjust input ranges to match actual stream values
   - Adjust output ranges to match node parameter ranges
   - Check node min/max values in the NoiseCraft patch

3. **Multiple Streams**:
   - Start with a single stream, then add more
   - Use "Add" or "Average" for combining complementary signals
   - Use "Multiply" to create interactive effects

4. **Testing**:
   - Mappings are saved automatically to localStorage
   - Disable mappings individually to test their impact
   - Monitor the Signals tab to see real-time stream values

## Saving and Loading

All mappings are automatically saved to browser localStorage. They persist between browser sessions on the same machine.

To reset all mappings, clear browser localStorage or remove individual mappings using the "Remove" button.




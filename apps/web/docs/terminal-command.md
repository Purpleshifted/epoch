# Terminal Command to Run Test Workspace

## Quick Start

Run this command from the project root:

```bash
node scripts/open-test-workspace.mjs
```

Or use the shell script:

```bash
./scripts/open-test-workspace.sh
```

## What It Does

1. Checks if NoiseCraft server is running on port 3001
2. Starts the server if needed (background process)
3. Waits for server to be ready
4. Opens your default browser to the test workspace

## Features Available

- **Virtual Particles**: 3 particles with displacement & velocity streams
- **Gravitational Force**: Attraction calculated using F = G × m₁ × m₂ / r²
- **Node Browser**: Select nodes from dropdown instead of typing IDs
- **Stream Mapping**: Map multiple streams to nodes with:
  - Interpolation modes (linear/logarithmic/exponential)
  - Mathematical operations (add, subtract, multiply, divide, etc.)
  - Input/output range mapping

## Configuring Node Mappings

1. Click the **"Mappings"** tab in the left panel
2. Click **"+ Add Mapping"**
3. **Select Node**:
   - Use the dropdown to browse available nodes (Knobs, etc.)
   - Or type the node ID manually
   - The dropdown shows: `ID: Name (Type)` format
4. Configure:
   - Parameter name (usually "value" for Knobs)
   - Add streams with interpolation settings
   - Set input/output ranges
   - Choose mathematical operations if using multiple streams

## Example: Mapping Attraction to a Knob

1. Add mapping
2. Select node from dropdown (e.g., "206: fact (Knob)")
3. Add stream: "attraction"
4. Set interpolation: "logarithmic"
5. Set input: 0-1, output: 0-0.1
6. Enable the mapping checkbox

The mapping will automatically apply and is saved to localStorage.




# Node Selection and Stream Assignment Guide

## Overview

The NoiseCraft Editor is now fully integrated with the stream mapping system. You can select nodes in the visual editor and automatically assign streams to them.

## Features

### 1. Visual Node Selection
- **Click a node** to select it (single click selects one node)
- **Ctrl/Cmd + Click** to add/remove nodes from selection (multi-select)
- **Box Selection**: Drag a rectangle to select multiple nodes at once
- Selected nodes are highlighted with a **red border**

### 2. Automatic Stream Assignment

When you select a node in the NoiseCraft editor:

1. **Auto-populate mapping**: The selected node is automatically added to the active stream mapping (or a new mapping is created)
2. **Visual feedback**: The status bar shows which nodes are selected
3. **Quick assignment**: No need to manually enter node IDs

## How to Use

### Method 1: Click-to-Select
1. Open the workspace at `http://localhost:7773/public/test-workspace.html`
2. Look at the right panel - you should see the NoiseCraft workspace with all nodes visible
3. **Click on any node** in the workspace to select it
4. Go to the "Mappings" tab on the left panel
5. The selected node will automatically appear in the active mapping (or create a new one)
6. Add streams, configure interpolation, and assign them to the node

### Method 2: Box Selection
1. In the NoiseCraft editor, **click and drag** to draw a selection box
2. All nodes within the box will be selected
3. The first selected node will be used for the stream mapping

### Method 3: Dropdown Selection (Original Method)
1. Go to "Mappings" tab
2. Use the dropdown to browse and select nodes
3. Or use the "Browse" button to see all available nodes

## Node Types That Support Stream Mapping

Not all nodes can be mapped to streams. The system automatically filters to show only modulatable nodes:

- **Knob** nodes - Have a `value` parameter
- **Const** nodes - Have a `value` parameter  
- Nodes with a `value` parameter in their `params` object

## Example Workflow

1. **Select a node**: Click on node "183" (Vol CHORDS) in the editor
2. **Create mapping**: A new mapping is automatically created with node 183 selected
3. **Add streams**: Click "+ Add Stream" and select "velocity" stream
4. **Configure**: Set interpolation to "linear", input range 0-10, output range 0-1
5. **Enable**: Make sure the mapping is enabled
6. **Test**: The velocity stream will now control the "Vol CHORDS" knob value

## Troubleshooting

### Nodes not visible?
- Make sure the server is running on port 7773
- Refresh the page
- Check browser console for errors

### Selection not working?
- Make sure you're clicking directly on the node (not on connections)
- Try box selection instead
- Check if the iframe loaded correctly

### Mapping not updating?
- Click on the "Mappings" tab to refresh
- Manually select the node from the dropdown as a fallback

## Technical Details

- Node selection events are communicated via `postMessage` from the embedded iframe
- The parent window listens for `noiseCraft:nodeSelection` messages
- Selected node IDs are automatically populated in the stream mapping UI
- The Editor component fully supports visual node manipulation and selection




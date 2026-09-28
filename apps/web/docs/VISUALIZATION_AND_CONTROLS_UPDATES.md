# Visualization and Controls Updates

## Summary of Changes

This document describes the comprehensive updates made to address the following issues:

1. **Visualization panel doesn't show stable orbital motion** - Fixed with centered, fixed-bounds view
2. **Individual view panel** - Added second canvas showing one moon's perspective
3. **Particle drag controls** - Implemented drag-from-center for velocity/orientation control
4. **NoiseCraft editor controls** - Enabled full keyboard controls including delete key
5. **Duplicate .ncft file** - Created `indiv_audio_map.ncft` for individual audio editing

## Implementation Details

### 1. Fixed Visualization (Stable Orbital Motion)

**Problem**: Auto-scaling bounds caused the view to jump around as particles moved.

**Solution**: Use fixed bounds centered on the center of mass with a fixed zoom level.

**Changes in `test-workspace.html`**:
- Calculate center of mass for all particles
- Use fixed view bounds (±200px from center) instead of dynamic bounds
- Maintain consistent zoom level to show stable orbital motion

### 2. Individual View Panel

**Added**: Second canvas showing one moon's perspective with center of mass reference.

**Location**: Below the main particle visualization panel.

**Features**:
- Shows selected moon particle (default: particle 1)
- Centers view on the moon's position
- Shows other particles relative to the selected moon
- Displays velocity vectors and connections

### 3. Drag Controls

**Implementation**: Drag from center of canvas to set particle velocity.

**Mechanics**:
- Click and drag from center of individual view canvas
- Distance from center controls velocity magnitude
- Direction controls velocity orientation
- Updates particle velocity in real-time during drag
- Works with one of the moon particles (controllable)

**Based on**: MobileView.tsx drag control logic adapted for particle control.

### 4. NoiseCraft Editor Controls

**Enabled in `embedded.html`**:
- Delete/Backspace key to delete selected nodes
- Ctrl+Z for undo
- Ctrl+Y for redo
- Ctrl+A for select all
- Spacebar for play/stop (already working)
- All standard NoiseCraft keyboard shortcuts

**Implementation**: Added keyboard event listeners similar to `main.js`.

### 5. File Duplication

**Created**: `indiv_audio_map.ncft` as duplicate of `falling_in_love_with_waterfalls (2).ncft`

**Purpose**: Separate file for editing individual audio mapping parameters.

**Location**: `/noisecraft/examples/indiv_audio_map.ncft`

## Usage

### Individual View Panel

The individual view shows the perspective from one moon particle. This allows you to:
- See how other particles appear relative to the selected moon
- Control that moon's velocity by dragging from center
- Understand spatial relationships from a particle's perspective

### Drag Controls

1. Click on the individual view canvas at the center
2. Drag outward to set velocity
3. Distance from center = velocity magnitude
4. Direction = velocity orientation
5. Release to apply the velocity change

### Editing .ncft File

1. Load `indiv_audio_map.ncft` in the NoiseCraft editor
2. Edit nodes using full editor controls (delete, copy, paste, etc.)
3. Save changes via Ctrl+S (if save functionality is enabled)
4. Changes will be reflected in the workspace

## Technical Notes

- Fixed bounds prevent view jumping during orbital motion
- Center of mass calculation ensures stable reference point
- Drag controls update velocity directly, allowing user control
- Individual view uses relative positioning for spatial awareness
- All editor controls now work in embedded iframe context




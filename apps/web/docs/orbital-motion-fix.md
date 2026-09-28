# Orbital Motion Fix

## Problem
Particles were drifting apart and moving away from each other instead of forming orbital motion or having realistic escape behavior.

## Root Causes

### 1. **Initial Velocities Too High**
- Original velocities: `{x: 50, y: 30}`, `{x: -40, y: 50}`, `{x: 30, y: -35}`
- Magnitude: ~58 pixels/second
- This exceeded escape velocity for the given masses and distances

### 2. **Particles Started Too Far Apart**
- Original positions: 300-350 pixels apart
- At this distance, gravitational force is weaker
- High velocities allowed escape before gravity could pull them back

### 3. **Non-Orbital Velocities**
- Velocities were set in random directions
- For orbital motion, velocities should be tangential (perpendicular to radius from center of mass)

### 4. **Euler Integration Energy Drift**
- Simple Euler integration doesn't conserve energy perfectly
- Can cause orbits to spiral outward over time

## Solutions Implemented

### 1. **Closer Starting Positions**
```javascript
// Before: 300+ pixels apart
// After: ~150 pixels apart
const particle0 = particleSystem.addParticle(0, 500, 500, 0, 100);
const particle1 = particleSystem.addParticle(1, 650, 500, 4, 100);  // 150px from particle0
const particle2 = particleSystem.addParticle(2, 575, 575, 7, 100);  // ~106px from center
```

### 2. **Orbital Velocities (Tangential)**
```javascript
// Calculate center of mass
const cmX = (x0*m0 + x1*m1 + x2*m2) / totalMass;
const cmY = (y0*m0 + y1*m1 + y2*m2) / totalMass;

// Set tangential velocities (perpendicular to radius)
// For circular orbit: v = sqrt(G*M/r), using 30% for bound motion
const orbitalVelocity = Math.sqrt(G * totalMass / avgDistance) * 0.3;
particle.velocity = {
  x: (-ry / rmag) * orbitalVelocity,  // Perpendicular to radius
  y: (rx / rmag) * orbitalVelocity
};
```

### 3. **Sub-Orbital Velocities**
- Using 30% of circular orbital velocity
- Ensures bound orbits (elliptical or circular)
- Prevents escape

### 4. **Improved Integration**
- Better structure for potential Verlet/Leapfrog integration in future
- All accelerations calculated before position updates

## Physics Formulas

### Escape Velocity
```
v_escape = sqrt(2 * G * M / r)
```
- If velocity ≥ escape velocity, particle escapes
- If velocity < escape velocity, particle is bound

### Orbital Velocity (Circular)
```
v_orbital = sqrt(G * M / r)
```
- Perfect circular orbit
- We use 30% of this for stable bound motion

### Gravitational Force
```
F = G * m1 * m2 / r²
a = F / m1 = G * m2 / r²
```

## Current Parameters

- **G (Gravitational Constant)**: 5000
- **Mass per particle**: 100
- **Starting distance**: ~150 pixels
- **Velocity**: ~30% of orbital velocity
- **Integration**: Euler (can be upgraded to Verlet/Leapfrog)

## Expected Behavior

With these changes, particles should:
- ✅ Form bound orbits (elliptical or circular)
- ✅ Not drift apart indefinitely
- ✅ Demonstrate realistic gravitational motion
- ✅ Show orbital dynamics similar to real universe

## Future Improvements

1. **Verlet Integration**: Better energy conservation
2. **Adaptive Time Step**: Smaller steps for high acceleration
3. **Collision Detection**: Prevent particles from passing through each other
4. **Visual Debugging**: Show center of mass, velocity vectors, orbital paths




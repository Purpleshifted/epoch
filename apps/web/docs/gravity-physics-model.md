# Gravitational Physics Model

This document explains the gravitational simulation model used in the particle system.

## Physics Equations

The simulation uses standard Newtonian gravity:

1. **Gravitational Force**: `F = G * m₁ * m₂ / r²`
   - G: Gravitational constant (default: 5000)
   - m₁, m₂: Masses of the two particles
   - r: Distance between particles

2. **Acceleration**: `a = F / m`
   - Acceleration is force divided by mass
   - For particle p1 being pulled by p2: `a = G * m₂ / r²`

3. **Velocity Update**: `v = v + a * dt`
   - Velocity increases by acceleration times time step
   - This is Euler integration

4. **Position Update**: `x = x + v * dt`
   - Position increases by velocity times time step

## Key Parameters

- **G (Gravitational Constant)**: Default 5000
  - Higher values = stronger gravitational attraction
  - Affects how quickly particles pull toward each other

- **Mass**: Default 100 per particle
  - Larger masses = stronger gravitational forces
  - Force is proportional to the product of masses (m₁ * m₂)

- **minDistance**: Default 5
  - Minimum distance used in force calculation to prevent division by zero
  - Lower values allow stronger close-range gravity
  - Does NOT limit gravity range - gravity works at all distances

## Important Notes

- **Gravity works at ALL distances**: There is no maximum distance cutoff. Particles will always attract each other, regardless of how far apart they are.

- **Radii are for signals only**: The `innerRadius` and `outerRadius` parameters are ONLY used for signal generation (determining `isInner` and `isOuter` flags). They do NOT affect gravitational physics.

- **N-body simulation**: All particles attract all other particles. The force on each particle is the sum of gravitational forces from all other particles.

## Integration Method

The simulation uses **Euler integration**:
- Simple and computationally efficient
- Suitable for real-time web applications
- For better accuracy, consider Verlet or RK4 integration for more complex scenarios

## References

- Standard N-body gravitational simulation
- Based on Newton's law of universal gravitation
- Similar to implementations in game physics engines




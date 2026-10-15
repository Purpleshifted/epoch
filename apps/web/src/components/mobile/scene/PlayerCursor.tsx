"use client";
/**
 * PlayerCursor: the visitor ("me") as a blinking block, the TempleOS cursor and the "present line".
 * One flat palette square drawn through the shared pixel pipeline (ground/pixelPoints.ts), so it
 * is pixel-snapped like the sprites. `lifeFrac` (0 = just arrived … 1 = lifespan used up) speeds
 * up the blink. V2: `getWarn` (0 … 1 over the last seconds of the lifespan, lib/parliament/session.ts) makes it
 * blink fast and short, like a warning; it is read every frame, so it changes without re-rendering.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PointBuffer, makePixelMaterial } from "@/components/ground/pixelPoints";
import { blinkAt } from "@/lib/parliament/session";

export function PlayerCursor({
  position,
  size = 0.55,
  blinkHz = 1.2,
  lifeFrac = 0,
  getWarn,
}: {
  position: [number, number, number];
  /** World units of the block. */
  size?: number;
  blinkHz?: number;
  lifeFrac?: number;
  getWarn?: () => number;
}) {
  const buf = useMemo(() => new PointBuffer(1), []);
  const material = useMemo(() => makePixelMaterial({ size, snap: 1 }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const t = useRef(0);
  const phase = useRef(0);

  useEffect(() => {
    // flat squares are drawn at 0.45x the size scale, hence 1 / 0.45: the block is `size` wide
    buf.set(0, 0, 0, 0, -1, "plastic_foam", "fresh", 1 / 0.45); // plastic_foam = palette 15, white
    return () => {
      buf.dispose();
      material.dispose();
    };
  }, [buf, material]);

  material.uniforms.uSize.value = size;

  useFrame((state, delta) => {
    t.current += delta;
    material.uniforms.uCamConst.value =
      state.gl.domElement.height / (2 * Math.tan(((state.camera as THREE.PerspectiveCamera).fov * Math.PI) / 360));
    if (getWarn) {
      // the frequency changes while it blinks: integrate the phase, so a faster blink does not jump
      const { hz, duty } = blinkAt(getWarn(), blinkHz);
      phase.current = (phase.current + Math.min(delta, 0.1) * hz) % 1;
      buf.draw(phase.current < duty ? 1 : 0);
      return;
    }
    const ph = (t.current * blinkHz * (1 + 3 * lifeFrac)) % 1;
    buf.draw(ph < 0.6 ? 1 : 0); // on 60 % of the cycle, like a text cursor
  });

  return (
    <group position={position}>
      <points geometry={buf.geometry} material={material} frustumCulled={false} />
    </group>
  );
}

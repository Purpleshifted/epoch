"use client";
/**
 * PlayerCursor: the visitor ("me") as a blinking block, the TempleOS cursor and the "present line".
 * One flat palette square drawn through the shared pixel pipeline (ground/pixelPoints.ts), so it
 * is pixel-snapped like the sprites. `lifeFrac` (0 = just arrived … 1 = lifespan used up) speeds
 * up the blink; the lifespan itself is not implemented yet, so it defaults to 0.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PointBuffer, makePixelMaterial } from "@/components/ground/pixelPoints";

export function PlayerCursor({
  position,
  size = 0.55,
  blinkHz = 1.2,
  lifeFrac = 0,
}: {
  position: [number, number, number];
  /** World units of the block. */
  size?: number;
  blinkHz?: number;
  lifeFrac?: number;
}) {
  const buf = useMemo(() => new PointBuffer(1), []);
  const material = useMemo(() => makePixelMaterial({ size, snap: 1 }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const t = useRef(0);

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
    const phase = (t.current * blinkHz * (1 + 3 * lifeFrac)) % 1;
    buf.draw(phase < 0.6 ? 1 : 0); // on 60 % of the cycle, like a text cursor
  });

  return (
    <group position={position}>
      <points geometry={buf.geometry} material={material} frustumCulled={false} />
    </group>
  );
}

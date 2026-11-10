"use client";
/**
 * PlayerCursor: the visitor ("me") as a blinking block, the TempleOS cursor and the "present line".
 * One flat palette square drawn through the shared pixel pipeline (ground/pixelPoints.ts), so it
 * is pixel-snapped like the sprites. `lifeFrac` (0 = just arrived … 1 = lifespan used up) speeds
 * up the blink. V2: `getWarn` (0 … 1 over the last seconds of the lifespan, lib/parliament/session.ts) makes it
 * blink fast and short, like a warning; it is read every frame, so it changes without re-rendering. With `getRhythm`
 * (2026-11-01) it blinks the visitor's own melody (lib/parliament/glyph.ts), in the bar every square keeps; near the
 * end that rhythm runs faster and faster. For two bars after the visitor answers a call (`getAnswer`, the artist,
 * 2026-11-10) it jumps on each of its notes as the one who spoke did: the answer looks like what it answers.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PointBuffer, makePixelMaterial } from "@/components/ground/pixelPoints";
import { GLYPH_COLS, STEP_MS, stepAt } from "@/lib/parliament/glyph";
import { blinkAt } from "@/lib/parliament/session";

/** The visitor's answer as the square plays it (RoleField makes it; the engine plays the same notes from the same clock). */
export interface AnswerPhrase {
  /** performance.now() the phrase starts at (the next step's edge after SPACE). */
  startMs: number;
  stepMs: number;
  /** The notes: step and length, as the glyph writes them. */
  dots: readonly { col: number; len: number }[];
}

export function PlayerCursor({
  position,
  size = 0.55,
  blinkHz = 1.2,
  lifeFrac = 0,
  getWarn,
  getRhythm,
  getAnswer,
  hop = 1.4,
}: {
  position: [number, number, number];
  /** World units of the block. */
  size?: number;
  blinkHz?: number;
  lifeFrac?: number;
  getWarn?: () => number;
  /** Which of the bar's steps the visitor's melody sounds on (null until it is known). */
  getRhythm?: () => boolean[] | null;
  /** The visitor's answer being played now (null = none): the square jumps on each of its notes. */
  getAnswer?: () => AnswerPhrase | null;
  /** How high the square jumps on a note while answering (× its size). */
  hop?: number;
}) {
  const buf = useMemo(() => new PointBuffer(1), []);
  const material = useMemo(() => {
    const m = makePixelMaterial({ size, snap: 1 });
    m.depthTest = false; // nothing in the frame hides the visitor
    return m;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const t = useRef(0);
  const phase = useRef(0);
  const body = useRef<THREE.Group>(null);
  /** Steps the rhythm has run ahead of the bar near the end. */
  const ahead = useRef(0);

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
    const rhythm = getRhythm?.();
    if (rhythm) {
      const warn = getWarn?.() ?? 0;
      ahead.current += (Math.min(delta, 0.1) * 1000 * 8 * warn) / STEP_MS;
      const now = performance.now();
      const step = (stepAt(now) + Math.floor(ahead.current)) % GLYPH_COLS;
      // answering: the phrase's own notes (lit, and up at once, down over the step); between them dark; else the bar's blink
      const ph = getAnswer?.() ?? null;
      const dt = ph ? now - ph.startMs : -1;
      const note = ph && dt >= 0 ? ph.dots.find((d) => dt >= d.col * ph.stepMs && dt < (d.col + d.len) * ph.stepMs) : undefined;
      let lift = 0;
      if (ph && note) {
        lift = size * hop * (1 - (((dt - note.col * ph.stepMs) / ph.stepMs) % 1)) ** 2;
        buf.draw(1);
      } else if (ph && dt >= 0 && dt < GLYPH_COLS * ph.stepMs) buf.draw(0);
      else buf.draw(rhythm[step] ? 1 : 0);
      if (body.current) body.current.position.y = lift;
      return;
    }
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
      <group ref={body}>
        <points geometry={buf.geometry} material={material} frustumCulled={false} renderOrder={11} />
      </group>
    </group>
  );
}

"use client";
/**
 * Marks — what stands in the player's frame besides the grass (lib/parliament/marks.ts; the artist's direction,
 * 2026-10-28; Leva 개인뷰 비주얼 › 표식). Each thing has a shape of its own, tall enough to fill the view; greys only
 * (human traces). The lists are renewed with the fold (RoleField, 0.5 s); the heights that follow the eye are set
 * every frame from the camera.
 *   OtherDots      a glowing point (core + halo, additive) on the ground for every being within the view; or, in the
 *                  brutal version, a hard white square blinking the being's own rhythm, like the visitor's own
 *   ConcreteLines  a vertical line from the ground up through the frame on every sealed slab cell
 *   ConcreteOutline a brutal version: the building as a line drawing, its edges and the joints between its cells
 *   WordPlates     a black plate on the ground with an ended life's melody on it, where that life left its word
 * (the paths as floating curves / ribbons were dropped by the artist on 2026-10-28; they stay on the ground)
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "@/lib/stratum/field";
import { GLYPH_COLS, GLYPH_ROWS, glyphOf, hash2, outlineSegments, rhythmOf, stepAt, type ConcreteLine, type LeftWord, type OtherMark } from "@/lib/parliament";

export interface MarksData {
  others: OtherMark[];
  concrete: ConcreteLine[];
  words: LeftWord[];
}

const MAX_OTHERS = 128;
const MAX_CONCRETE = 6000;
const MAX_OUTLINE_SEGS = 24000;
const MAX_WORDS = 64;
const REFRESH = 0.5;
/** A square whose melody rests on this step is not off: it stays as a dark grey square. */
const SQUARE_REST = 0.22;

function lineGeom(maxVerts: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  g.setDrawRange(0, 0);
  return g;
}

/** A soft radial sprite: bright centre, falling off to nothing at the edge (for the glow). */
function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A hash of an id in 0 … 1 (to stagger the others' moves). */
function idHash(o: string): number {
  let h = 0;
  for (let i = 0; i < o.length; i++) h = (Math.imul(h, 31) + o.charCodeAt(i)) | 0;
  return hash2(h, 7, 3);
}

/**
 * A GLOWING point on the ground for every other being (the artist, 2026-10-28: at the grid's height, not the eye):
 * two additive soft sprites — a core and a wide faint halo — so the light bleeds without a bloom pass. The scene's
 * fog takes them with distance (knob: or not, so the far ones stay as a faint light in the haze); an optional pulse
 * breathes the size.
 *
 * Their PLACE moves only now and then (the artist: they must not look busy): each light holds a cell of the grid
 * and, every `holdSec` (staggered by id), jumps to the centre of the cell the being is in now — no gliding, a hard
 * cut like the rest of the frame. A being that left the view keeps its light until its next move.
 */
export function OtherDots({
  getMarks,
  size = 0.5,
  height = 0.02,
  bright = 0.8,
  halo = 4,
  haloStrength = 0.35,
  fog = true,
  pulseHz = 0,
  holdSec = 4,
  snap = true,
  square = false,
}: {
  getMarks: () => MarksData | null;
  size?: number;
  /** World height of the lights (0 = the grid). */
  height?: number;
  bright?: number;
  /** Seconds a light holds its place before it may move to the being's present cell (staggered ±25 % by id). */
  holdSec?: number;
  /** Whether the light sits at the centre of a grid cell (or exactly where the being is). */
  snap?: boolean;
  /** Halo size as a multiple of the core; 0 = core only. */
  halo?: number;
  /** Halo brightness relative to the core. */
  haloStrength?: number;
  /** Whether the scene's fog dims them with distance. */
  fog?: boolean;
  /** Breathing of the size (Hz); 0 = still. */
  pulseHz?: number;
  /** The brutal version: hard squares that blink each being's rhythm (glyph.ts), no glow, no fog, seen through walls. */
  square?: boolean;
}) {
  const lastStep = useRef(-1);
  const group = useRef<THREE.Group>(null);
  const coreMat = useRef<THREE.PointsMaterial>(null);
  const haloMat = useRef<THREE.PointsMaterial>(null);
  const tex = useMemo(() => glowTexture(), []);
  const geom = useMemo(() => lineGeom(MAX_OTHERS), []);
  const haloGeom = useMemo(() => lineGeom(MAX_OTHERS), []);
  const timer = useRef(10);
  /** Each being's held place: where its light stands and when it may next move (frame-clock seconds). */
  const held = useRef(new Map<string, { x: number; z: number; next: number; bright: number; moving: boolean; seen: number }>());
  useEffect(
    () => () => {
      geom.dispose();
      haloGeom.dispose();
      tex.dispose();
    },
    [geom, haloGeom, tex],
  );
  useFrame((state, dt) => {
    if (group.current) group.current.position.y = height;
    // the breath
    const k = pulseHz > 0 ? 1 + 0.25 * Math.sin(state.clock.elapsedTime * pulseHz * Math.PI * 2) : 1;
    if (coreMat.current) coreMat.current.size = size * k;
    if (haloMat.current) haloMat.current.size = size * halo * k;
    timer.current += dt;
    // the squares keep the bar's step: each one lit when its melody sounds
    if (square) {
      const step = stepAt(performance.now());
      if (step !== lastStep.current && timer.current < REFRESH) {
        lastStep.current = step;
        const col = geom.getAttribute("color") as THREE.BufferAttribute;
        const C = col.array as Float32Array;
        let i = 0;
        for (const id of held.current.keys()) {
          if (i >= MAX_OTHERS) break;
          C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = rhythmOf(id)[step] ? 1 : SQUARE_REST;
          i++;
        }
        col.needsUpdate = true;
      }
    }
    if (timer.current < REFRESH) return;
    timer.current = 0;
    const now = state.clock.elapsedTime;
    const list = getMarks()?.others ?? [];
    const H = held.current;
    // where each light stands: a new being takes its place at once; a known one only when its hold is over
    for (const o of list) {
      const place = snap ? { x: (Math.floor(o.x / CELL_SIZE) + 0.5) * CELL_SIZE, z: (Math.floor(o.z / CELL_SIZE) + 0.5) * CELL_SIZE } : { x: o.x, z: o.z };
      const h = H.get(o.o);
      const wait = holdSec * (0.75 + 0.5 * idHash(o.o));
      if (!h) H.set(o.o, { ...place, next: now + wait, bright: o.bright, moving: o.moving, seen: now });
      else {
        h.seen = now;
        h.bright = o.bright;
        h.moving = o.moving;
        if (now >= h.next) {
          h.x = place.x;
          h.z = place.z;
          h.next = now + wait;
        }
      }
    }
    // a light whose being is gone from the view goes out at its next move
    for (const [id, h] of H) if (now - h.seen > REFRESH * 1.5 && now >= h.next) H.delete(id);
    const shown = [...H.entries()].slice(0, MAX_OTHERS);
    const n = shown.length;
    const step = stepAt(performance.now());
    for (const [g, gain] of [
      [geom, 1],
      [haloGeom, haloStrength],
    ] as [THREE.BufferGeometry, number][]) {
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      const col = g.getAttribute("color") as THREE.BufferAttribute;
      const P = pos.array as Float32Array, C = col.array as Float32Array;
      for (let i = 0; i < n; i++) {
        const [id, h] = shown[i];
        P[i * 3] = h.x;
        P[i * 3 + 1] = 0;
        P[i * 3 + 2] = h.z;
        C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = square ? (rhythmOf(id)[step] ? 1 : SQUARE_REST) : gain * bright * (0.35 + 0.65 * h.bright);
      }
      g.setDrawRange(0, n);
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
  });
  if (square) {
    return (
      <group ref={group}>
        <points geometry={geom} frustumCulled={false} renderOrder={10}>
          <pointsMaterial key="square" ref={coreMat} size={size} sizeAttenuation vertexColors fog={false} depthTest={false} />
        </points>
      </group>
    );
  }
  return (
    <group ref={group}>
      <points geometry={geom} frustumCulled={false}>
        <pointsMaterial key="glow" ref={coreMat} size={size} sizeAttenuation vertexColors map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} fog={fog} />
      </points>
      {halo > 0 && (
        <points geometry={haloGeom} frustumCulled={false}>
          <pointsMaterial ref={haloMat} size={size * halo} sizeAttenuation vertexColors map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} fog={fog} />
        </points>
      )}
    </group>
  );
}

/** A vertical line from the ground up through the frame on every sealed slab cell. */
export function ConcreteLines({ getMarks, height = 40, bright = 0.6 }: { getMarks: () => MarksData | null; height?: number; bright?: number }) {
  const geom = useMemo(() => lineGeom(MAX_CONCRETE * 2), []);
  const timer = useRef(10);
  useEffect(() => () => geom.dispose(), [geom]);
  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < REFRESH) return;
    timer.current = 0;
    const list = getMarks()?.concrete ?? [];
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    const col = geom.getAttribute("color") as THREE.BufferAttribute;
    const P = pos.array as Float32Array, C = col.array as Float32Array;
    let v = 0;
    for (const c of list) {
      if (v + 2 > MAX_CONCRETE * 2) break;
      const shade = bright * (0.45 + 0.55 * Math.min(1, c.h / 3));
      for (const y of [0.02, height]) {
        P[v * 3] = c.x;
        P[v * 3 + 1] = y;
        P[v * 3 + 2] = c.z;
        C[v * 3] = C[v * 3 + 1] = C[v * 3 + 2] = shade;
        v++;
      }
    }
    geom.setDrawRange(0, v);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  return (
    <lineSegments geometry={geom} frustumCulled={false}>
      <lineBasicMaterial vertexColors />
    </lineSegments>
  );
}

/**
 * The other brutal version of the concrete: the building as a drawing (lib/parliament/marks.ts outlineSegments), its
 * outer edges and the joint between every two cells, as tall as the slabs (× `scale`), in hard white 1 px lines. The
 * inside is empty: what stands behind it stays visible.
 */
export function ConcreteOutline({ getMarks, scale = 1 }: { getMarks: () => MarksData | null; scale?: number }) {
  const geom = useMemo(() => lineGeom(MAX_OUTLINE_SEGS * 2), []);
  const timer = useRef(10);
  useEffect(() => () => geom.dispose(), [geom]);
  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < REFRESH) return;
    timer.current = 0;
    const segs = outlineSegments(getMarks()?.concrete ?? [], scale);
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    const col = geom.getAttribute("color") as THREE.BufferAttribute;
    const n = Math.min(segs.length / 6, MAX_OUTLINE_SEGS);
    (pos.array as Float32Array).set(n === segs.length / 6 ? segs : segs.slice(0, n * 6));
    (col.array as Float32Array).fill(1, 0, n * 6);
    geom.setDrawRange(0, n * 2);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  return (
    <lineSegments geometry={geom} frustumCulled={false}>
      <lineBasicMaterial vertexColors fog={false} />
    </lineSegments>
  );
}

/**
 * An ended life's word on the ground (leftWords.ts): a black plate with the melody's dots on it in white, lying flat, so
 * it can be seen from a way off and walked to. `cell` is one dot's world size.
 */
export function WordPlates({ getMarks, cell = 0.3 }: { getMarks: () => MarksData | null; cell?: number }) {
  const plates = useRef<THREE.InstancedMesh>(null);
  const dots = useRef<THREE.InstancedMesh>(null);
  const timer = useRef(10);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const geom = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  useEffect(() => () => geom.dispose(), [geom]);
  useFrame((_, dt) => {
    timer.current += dt;
    const P = plates.current, D = dots.current;
    if (timer.current < REFRESH || !P || !D) return;
    timer.current = 0;
    const words = (getMarks()?.words ?? []).slice(0, MAX_WORDS);
    let d = 0;
    words.forEach((w, i) => {
      matrix.makeScale((GLYPH_COLS + 2) * cell, 1, (GLYPH_ROWS + 2) * cell).setPosition(w.x, 0.03, w.z);
      P.setMatrixAt(i, matrix);
      for (const g of glyphOf(w.o)) {
        matrix.makeScale(g.len * cell, 1, cell).setPosition(w.x + (g.col + g.len / 2 - GLYPH_COLS / 2) * cell, 0.05, w.z + (g.row - GLYPH_ROWS / 2 + 0.5) * cell);
        D.setMatrixAt(d++, matrix);
      }
    });
    P.count = words.length;
    D.count = d;
    P.instanceMatrix.needsUpdate = true;
    D.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={plates} args={[geom, undefined, MAX_WORDS]} frustumCulled={false}>
        <meshBasicMaterial color="#000000" fog={false} />
      </instancedMesh>
      <instancedMesh ref={dots} args={[geom, undefined, MAX_WORDS * GLYPH_COLS]} frustumCulled={false}>
        <meshBasicMaterial color="#ffffff" fog={false} />
      </instancedMesh>
    </>
  );
}

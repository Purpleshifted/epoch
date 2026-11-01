"use client";
/**
 * DitherGround — the brutal version of the grass (Leva 개인뷰 비주얼; docs/session-logic.md §12): no points, a flat field
 * in one colour and black. Every cell around the walker takes the density NatureCloud would give it (nature.ts
 * grassDensity, with the quick stress of the walker's own trail), and an ordered dither in screen pixels turns that
 * density into how much of the cell is lit: where the walker goes the field goes black at once. It ends in a hard
 * circle: no fog, no fade. Far cheaper than the cloud: a small texture instead of tens of thousands of points.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "@/lib/stratum/field";
import { WORLD_SIZE, grassDensity, wrapCell, type NatureConfig, type Snapshot } from "@/lib/parliament";
import { markSpan } from "./usePerfMeter";

const REFRESH = 0.1;

const VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uG;
uniform vec2 uOrigin;
uniform float uSpan;
uniform vec2 uCentre;
uniform float uRadius;
uniform float uPx;
uniform vec3 uColor;
varying vec2 vXZ;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  if (distance(vXZ, uCentre) > uRadius) discard;
  float g = texture2D(uG, (vXZ - uOrigin) / uSpan).r;
  if (g <= bayer8(floor(gl_FragCoord.xy / uPx))) discard;
  gl_FragColor = vec4(uColor, 1.0);
}`;

export function DitherGround({
  playerPosRef,
  getStress,
  getSnapshot,
  getQuick,
  cfg,
  radius = 22,
  pixel = 2,
  color = "#33ff33",
  density = 1,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  getStress: () => Map<string, number> | null;
  getSnapshot: () => Snapshot | null;
  /** The walker's own recent trail as stress per cell (RoleField's quick StressState). */
  getQuick?: () => Map<string, number> | null;
  cfg: NatureConfig;
  /** World radius of the lit circle. */
  radius?: number;
  /** Size of a dither dot in CSS pixels. */
  pixel?: number;
  color?: string;
  /** Multiplies the density before it is dithered. */
  density?: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const timer = useRef(10);
  const laidAt = useRef({ x: NaN, z: NaN });
  const derived = useRef<{ snap: Snapshot | null; pathAt: Map<string, number>; sealed: Set<string> }>({ snap: null, pathAt: new Map(), sealed: new Set() });
  const n = Math.ceil(radius / CELL_SIZE);
  const size = 2 * n + 1;
  const data = useMemo(() => new Uint8Array(size * size), [size]);
  const tex = useMemo(() => {
    const t = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }, [data, size]);
  const geom = useMemo(() => new THREE.PlaneGeometry(2 * radius, 2 * radius).rotateX(-Math.PI / 2), [radius]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uG: { value: tex },
          uOrigin: { value: new THREE.Vector2() },
          uSpan: { value: size * CELL_SIZE },
          uCentre: { value: new THREE.Vector2() },
          uRadius: { value: radius },
          uPx: { value: pixel },
          uColor: { value: new THREE.Color(color) },
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tex],
  );
  useEffect(
    () => () => {
      tex.dispose();
      geom.dispose();
      mat.dispose();
    },
    [tex, geom, mat],
  );

  useFrame(({ gl }, dt) => {
    const p = playerPosRef.current;
    mesh.current?.position.set(p.x, 0.005, p.z);
    const u = mat.uniforms;
    (u.uCentre.value as THREE.Vector2).set(p.x, p.z);
    u.uRadius.value = radius;
    u.uPx.value = pixel * gl.getPixelRatio();
    (u.uColor.value as THREE.Color).set(color);
    timer.current += dt;
    const jumped = Number.isFinite(laidAt.current.x) && Math.hypot(p.x - laidAt.current.x, p.z - laidAt.current.z) > WORLD_SIZE / 4;
    if (timer.current < REFRESH && !jumped) return;
    timer.current = 0;
    laidAt.current = { x: p.x, z: p.z };
    const t0 = performance.now();
    const snap = getSnapshot();
    let { pathAt, sealed } = derived.current;
    if (derived.current.snap !== snap) {
      pathAt = new Map<string, number>();
      sealed = new Set<string>();
      if (snap) {
        for (const q of snap.paths) pathAt.set(q.key, q.p);
        for (const s of snap.slabs) if (s.h >= 0.15) sealed.add(s.key);
      }
      derived.current = { snap, pathAt, sealed };
    }
    const stress = getStress();
    const quick = getQuick?.() ?? null;
    const cx0 = Math.floor(p.x / CELL_SIZE);
    const cz0 = Math.floor(p.z / CELL_SIZE);
    (u.uOrigin.value as THREE.Vector2).set((cx0 - n) * CELL_SIZE, (cz0 - n) * CELL_SIZE);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        // drawn where it lies around the player, but it IS the canonical cell: the world wraps
        const wx = wrapCell(cx0 - n + i);
        const wz = wrapCell(cz0 - n + j);
        const key = `${wx},${wz}`;
        const S = (stress?.get(key) ?? 0) + (quick?.get(key) ?? 0);
        data[j * size + i] = Math.min(255, Math.round(255 * density * grassDensity(wx, wz, S, pathAt.get(key) ?? 0, sealed.has(key), cfg)));
      }
    }
    tex.needsUpdate = true;
    markSpan("cloud", performance.now() - t0);
  });

  return <mesh ref={mesh} geometry={geom} material={mat} frustumCulled={false} />;
}

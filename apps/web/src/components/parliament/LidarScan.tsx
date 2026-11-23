"use client";
/**
 * LidarScan — THE PRESENT READ AS A LIDAR SCAN ROUND ME (the artist, 2026-11-23: "현재 스캔 = 나를 중심으로 한 라이다 고리",
 * then "스캔비주얼 아까 준 사진에 맞춰서 포인트클라우드로 시작" — the photo: dotted rings on black round the sensor, coloured by
 * distance, broken where something stands; docs/reference-study-2026-11-23-pointclouds.md §6.1).
 *
 * A rotating sensor at the eye: `beams` beams fanned from `lowDeg` (down) to `highDeg`, swept round `hz` times a second,
 * `azimuths` readings a turn. Each beam goes out until it meets something: a building cell's wall (the sealed slabs the
 * view already reads, Marks.tsx's list) or the ground (y = 0). Whatever stands behind a wall is never reached — it is
 * EMPTY (what is hidden stays unrecorded); the beams never reach the ground right under me — my spot is an empty circle.
 * The rings are not drawn: they come from the beams' angles (near close together, far apart), as a real lidar's do.
 *
 * Every reading is a point in the WORLD with its time of birth: it stays where it was read and fades out over
 * `decaySec` (Foxglove's "decay time"), so walking leaves the last turns' rings behind. Points go into a ring buffer;
 * only the readings of this frame are uploaded (addUpdateRange) — never the whole buffer.
 *
 * Shown only where `lidarActive()` says (for now the scan (present) lab page alone), so no other page's picture moves.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "@/lib/stratum/field";
import { mobileLab } from "./mobileLab";
import { markSpan } from "./usePerfMeter";

/** A bucket of the cells' grid as one number (no strings in the ray march). */
function bucket(bx: number, bz: number): number {
  return (bx + 32768) * 65536 + (bz + 32768);
}

export type LidarColour = "distance" | "white" | "grey";

export interface LidarLook {
  on: boolean;
  /** The photo's black ground (ParliamentScene reads it for the background, the fog and the log's colours). */
  black: boolean;
  beams: number;
  lowDeg: number;
  highDeg: number;
  azimuths: number;
  hz: number;
  decaySec: number;
  /** How far a beam reaches (world). */
  range: number;
  /** A point's size on screen (CSS px). */
  dot: number;
  colour: LidarColour;
  /** Where the sensor is: at the walker, at eye height (world), `eyeBack` (world) ahead of the camera — so a camera
   *  set back and up (눈 › 뒤로, 눈높이) looks down on the rings round me, as the photo does. */
  eyeH: number;
  eyeBack: number;
}

export const DEFAULT_LIDAR: LidarLook = { on: true, black: true, beams: 32, lowDeg: -24, highDeg: 6, azimuths: 720, hz: 5, decaySec: 1.5, range: 22, dot: 2, colour: "distance", eyeH: 0.64, eyeBack: 0 };
const fwd = new THREE.Vector3();

/** Set by the scan (present) knobs (labKnobsScanPresent.ts), read per frame here and at render by ParliamentScene. */
export const lidarLook: LidarLook = { ...DEFAULT_LIDAR, on: false };
export function setLidarLook(v: Partial<LidarLook>): void {
  Object.assign(lidarLook, v);
}

/** Whether the scan is drawn on this page (for now: the scan (present) lab page only). */
export function lidarActive(): boolean {
  return lidarLook.on && mobileLab() === "scan-present";
}
/** …and whether the frame is on the photo's black ground. */
export function lidarBlack(): boolean {
  return lidarActive() && lidarLook.black;
}

/** A building cell as the view lists it (Marks.tsx ConcreteLine): centre and height (units × scale = world). */
interface Cell {
  x: number;
  z: number;
  h: number;
}

const MAX_POINTS = 240_000;

const VERT = /* glsl */ `
attribute float aBirth;
attribute float aDist;
uniform float uTime;
uniform float uDecay;
uniform float uSize;
uniform float uRange;
uniform float uMode;
uniform vec3 uNear;
uniform vec3 uMid;
uniform vec3 uFar;
varying vec3 vCol;
varying float vA;
void main() {
  float age = uTime - aBirth;
  vA = age < 0.0 ? 0.0 : 1.0 - smoothstep(0.0, uDecay, age);
  float t = clamp(aDist / uRange, 0.0, 1.0);
  vec3 dc = t < 0.5 ? mix(uNear, uMid, t * 2.0) : mix(uMid, uFar, t * 2.0 - 1.0);
  vCol = uMode < 0.5 ? dc : uMode < 1.5 ? vec3(1.0) : vec3(0.55);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // a lidar viewer's points: a fixed size on screen, a little larger close by
  gl_PointSize = uSize * clamp(4.0 / max(0.1, -mv.z), 1.0, 1.8);
}`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0 || vA <= 0.003) discard;
  gl_FragColor = vec4(vCol, vA * (1.0 - smoothstep(0.55, 1.0, r)));
}`;

/** A colour picked as seen on screen (sRGB), handed to the shader in the working (linear) space. */
function lin(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

export function LidarScan({ getCells, scale = 1 }: { getCells: () => readonly Cell[] | null; scale?: number }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3);
    const birth = new THREE.BufferAttribute(new Float32Array(MAX_POINTS).fill(-1e6), 1);
    const dist = new THREE.BufferAttribute(new Float32Array(MAX_POINTS), 1);
    for (const a of [pos, birth, dist]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", pos);
    g.setAttribute("aBirth", birth);
    g.setAttribute("aDist", dist);
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uDecay: { value: 1.5 },
          uSize: { value: 2 },
          uRange: { value: 22 },
          uMode: { value: 0 },
          // the photo's rings: mint close by, a pale yellow-green between, pink and peach far off
          uNear: { value: lin("#7ff5c8") },
          uMid: { value: lin("#d8f0a0") },
          uFar: { value: lin("#f5a0b4") },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      geom.dispose();
      mat.dispose();
    },
    [geom, mat],
  );
  const points = useRef<THREE.Points>(null);
  const st = useRef({ head: 0, filled: 0, sweep: 0, az: 0, cellsOf: null as readonly Cell[] | null, grid: new Map<number, Cell[]>() });

  useFrame((state, dt) => {
    const P = points.current;
    const on = lidarActive();
    if (P) P.visible = on;
    if (!on || !P) return;
    const L = lidarLook, s = st.current, cam = state.camera;
    const u = mat.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uDecay.value = L.decaySec;
    u.uSize.value = L.dot * state.viewport.dpr;
    u.uRange.value = L.range;
    u.uMode.value = L.colour === "distance" ? 0 : L.colour === "white" ? 1 : 2;

    // the building cells in a grid of buckets (each cell in every bucket it overlaps), renewed with the list
    const cells = getCells();
    if (cells !== s.cellsOf) {
      s.cellsOf = cells;
      s.grid.clear();
      const half = CELL_SIZE / 2;
      for (const c of cells ?? []) {
        const cell = { x: c.x, z: c.z, h: Math.max(0.2, c.h * scale) };
        for (const bx of new Set([Math.floor((c.x - half) / CELL_SIZE), Math.floor((c.x + half) / CELL_SIZE)]))
          for (const bz of new Set([Math.floor((c.z - half) / CELL_SIZE), Math.floor((c.z + half) / CELL_SIZE)])) {
            const k = bucket(bx, bz);
            const list = s.grid.get(k);
            if (list) list.push(cell);
            else s.grid.set(k, [cell]);
          }
      }
    }

    // this frame's share of the turn (at most a quarter turn a frame: a slow frame slows the sweep, not the frame)
    const t0 = performance.now();
    const A = Math.max(64, Math.round(L.azimuths)), B = Math.max(2, Math.round(L.beams));
    s.sweep += Math.min(0.25, dt) * L.hz * A;
    const n = Math.min(Math.floor(s.sweep), Math.ceil(A / 4));
    if (n <= 0) return;
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-6) fwd.normalize();
    const ex = cam.position.x + fwd.x * L.eyeBack, ez = cam.position.z + fwd.z * L.eyeBack, H = Math.max(0.05, L.eyeH);
    const R = L.range, step = CELL_SIZE / 2, half = CELL_SIZE / 2, now = state.clock.elapsedTime;
    const tans = new Float32Array(B);
    for (let b = 0; b < B; b++) tans[b] = Math.tan(((L.lowDeg + ((L.highDeg - L.lowDeg) * b) / (B - 1)) * Math.PI) / 180);
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    const birth = geom.getAttribute("aBirth") as THREE.BufferAttribute;
    const dist = geom.getAttribute("aDist") as THREE.BufferAttribute;
    const Pa = pos.array as Float32Array, Ba = birth.array as Float32Array, Da = dist.array as Float32Array;
    const start = s.head;
    let written = 0;
    const hitD: number[] = [], hitOut: number[] = [], hitH: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = ((s.az + i) % A) / A;
      const th = a * Math.PI * 2 + 0.37;
      const cx = Math.cos(th), cz = Math.sin(th);
      // the cells along this ray, in order: where the ray enters and leaves each, and its height (the cell the sensor
      // stands in is not one of them: a beam starts above it)
      hitD.length = 0;
      hitOut.length = 0;
      hitH.length = 0;
      let last: Cell | null = null;
      for (let d = step; d <= R; d += step) {
        const px = ex + cx * d, pz = ez + cz * d;
        const list = s.grid.get(bucket(Math.floor(px / CELL_SIZE), Math.floor(pz / CELL_SIZE)));
        if (!list) continue;
        for (const c of list) {
          if (Math.abs(px - c.x) > half || Math.abs(pz - c.z) > half) continue;
          if (c === last) {
            hitOut[hitOut.length - 1] = d;
            break;
          }
          if (Math.abs(ex - c.x) <= half && Math.abs(ez - c.z) <= half) break;
          last = c;
          hitD.push(d - step * 0.5);
          hitOut.push(d);
          hitH.push(c.h);
          break;
        }
      }
      for (let b = 0; b < B; b++) {
        const tn = tans[b];
        const dg = tn < 0 ? H / -tn : Infinity;
        let d = -1, y = 0;
        for (let k = 0; k < hitD.length; k++) {
          const dk = hitD[k], hk = hitH[k];
          if (dk >= dg) break;
          const yk = H + dk * tn;
          // its wall…
          if (yk >= 0 && yk <= hk) {
            d = dk;
            y = yk;
            break;
          }
          // …or, coming down onto a low one, its top
          if (tn < 0 && H > hk) {
            const dt2 = (H - hk) / -tn;
            if (dt2 >= dk && dt2 <= hitOut[k]) {
              d = dt2;
              y = hk;
              break;
            }
          }
        }
        if (d < 0) {
          if (dg > R) continue;
          d = dg;
          y = 0.01;
        }
        // a hair of the sensor's noise, so a ring is a row of readings, not a drawn line
        const jit = 1 + (Math.sin((a * 9137 + b * 71) * 12.9898) * 0.5) * 0.006;
        const j = s.head;
        Pa[j * 3] = ex + cx * d * jit;
        Pa[j * 3 + 1] = y;
        Pa[j * 3 + 2] = ez + cz * d * jit;
        Ba[j] = now;
        Da[j] = d;
        s.head = (s.head + 1) % MAX_POINTS;
        written++;
      }
    }
    s.sweep = Math.min(s.sweep - n, A / 4);
    s.az = (s.az + n) % A;
    markSpan("lidar", performance.now() - t0);
    if (!written) return;
    s.filled = Math.min(MAX_POINTS, s.filled + written);
    // upload only what this frame wrote (one range, or two when the ring buffer wrapped)
    for (const at of [pos, birth, dist]) {
      at.clearUpdateRanges();
      const k = at.itemSize;
      if (start + written <= MAX_POINTS) at.addUpdateRange(start * k, written * k);
      else {
        at.addUpdateRange(start * k, (MAX_POINTS - start) * k);
        at.addUpdateRange(0, (start + written - MAX_POINTS) * k);
      }
      at.needsUpdate = true;
    }
    geom.setDrawRange(0, s.filled);
  });

  return <points ref={points} geometry={geom} material={mat} frustumCulled={false} renderOrder={4} />;
}

"use client";
/**
 * LidarScan — THE PRESENT READ AS A LIDAR SCAN ROUND ME (the artist, 2026-11-23: "현재 스캔 = 나를 중심으로 한 라이다 고리",
 * then "스캔비주얼 아까 준 사진에 맞춰서 포인트클라우드로 시작" — the photo: dotted rings on black round the sensor, coloured by
 * distance, broken where something stands; docs/reference-study-2026-11-23-pointclouds.md §6.1).
 *
 * A rotating sensor at the eye: `beams` beams fanned from `lowDeg` (down) to `highDeg`, swept round `hz` times a second,
 * by default a DOME (−60° … +85°: the artist, 2026-11-24, "위아래도 좀 현재 덩어리 읽을 수 있으려면 나한테서 반구가 날아가야"),
 * so the buildings read up to their tops and the ground right round my feet;
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
/** Which way the sensor spins: about the VERTICAL (rings laid round me on the ground and walls — the first version), or
 *  about my HEADING (the artist, 2026-11-24: "나를 중심으로 진행방향에 수직한 원들이 날아가서 표면을 읽어야" — circles
 *  at right angles to where I walk, flown out ahead, read whatever surface they meet: the ground, the walls on both
 *  sides, what is above — together the hemisphere in front of me). She keeps both to compare ("비교를 해볼 수 있었으면"). */
export type LidarAxis = "view" | "heading" | "vertical";
/* THE VIEW (the artist, 2026-11-24: "원이 보이는 게 아쉽거든... 레퍼런스보면 '내가 보는 표면' 레이트레이싱처럼 … 시야각
 * 정해서 그렇게 점으로 보여주면 안 되나 … 내 시야 밖으로는 버퍼 구간만 조금 더"): no spinning sensor at all — rays from
 * the eye scattered evenly over what I see (an R2 sequence over the screen, a fresh share every frame) plus a margin
 * outside it, each kept as a point where it meets a surface. No rings, no scan lines: a depth camera's reading. */

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
  axis: LidarAxis;
  /** Heading axis: the narrowest circle's angle from the heading (°): the smaller, the further ahead it reads. The
   *  circles open from it to 90° (at right angles to the heading: the cross-section where I stand). */
  coneDeg: number;
  /** View: readings a second, and the margin read outside the view (a share of the screen's half-width/height). */
  rate: number;
  margin: number;
  /** How the surface's angle to the ray thins the readings (the artist, 2026-11-24: "내 시야에서 면 각도 따라 밀도
   *  다르게 보여야 하지 않나?"): a reading is kept with the chance cos(angle)^slant — a surface facing me full, one I
   *  look along (the ground far off, a wall beside me) sparse. 0 = even everywhere. Not the vertical spin. */
  slant: number;
  /** The distance ramp's four colours, near → far (the artist, 2026-11-24: "그냥 핑크-초록 말고도 내가 지정할 수 있게"). */
  c0: string;
  c1: string;
  c2: string;
  c3: string;
  /** LAG (the artist, 2026-11-24, "랙 줄일 방법 … 진행"): the view's readings gathered towards the middle of the view
   *  (0 = even; a reading at the screen's edge is kept with the chance 1 / (1 + fovea·r²)) … */
  fovea: number;
  /** …the scan's time budget a frame (ms: what is left goes to the next frame — a slow machine fills slower, the frame
   *  does not stop) … */
  budgetMs: number;
  /** …the refresh term: what is read stays; standing still, only this share of the readings is made anew (moving or
   *  turning brings it back to all) … */
  idle: number;
  /** …and far readings thinned into bigger dots past this distance (world; 0 = off): kept with the chance (lod/d)², drawn
   *  d/lod times larger (at most 4×). */
  lod: number;
  /** …and readings TOO NEAR thinned (the artist, 2026-11-24: "건물 부재속에 있을 때 렉이 심해지는데 … 너무 가까운 건 점점
   *  성기게"): within this distance (world; 0 = off) a reading is kept with the chance (d / near)², at least 3 %. */
  near: number;
  /** Where the sensor is: at the walker, at eye height (world), `eyeBack` (world) ahead of the camera — so a camera
   *  set back and up (눈 › 뒤로, 눈높이) looks down on the rings round me, as the photo does. */
  eyeH: number;
  eyeBack: number;
}

export const DEFAULT_LIDAR: LidarLook = { on: true, black: true, beams: 64, lowDeg: -60, highDeg: 85, azimuths: 720, hz: 5, decaySec: 1.5, range: 22, dot: 2, colour: "distance", axis: "view", coneDeg: 8, rate: 120_000, margin: 0.15, slant: 1, c0: "#5ff0c8", c1: "#c6f06a", c2: "#ffb86b", c3: "#ff7eb0", fovea: 1, budgetMs: 4, idle: 0.3, lod: 12, near: 2, eyeH: 0.64, eyeBack: 0 };
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

// 64 beams × 720 a turn × 5 turns/s × 1.5 s ≈ 346k live readings (the dome; the old band of 32 beams held ~173k)
const MAX_POINTS = 420_000;

const VERT = /* glsl */ `
attribute float aBirth;
attribute float aDist;
attribute float aSz;
uniform float uTime;
uniform float uDecay;
uniform float uSize;
uniform float uRange;
uniform float uMode;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
varying vec3 vCol;
varying float vA;
varying float vPx;
void main() {
  float age = uTime - aBirth;
  // a reading stays at full strength for most of its life and goes only at the end (a viewer's decay: the last turns
  // stand as crisp rings, not a fog of half-faded ones)
  vA = age < 0.0 ? 0.0 : 1.0 - smoothstep(uDecay * 0.55, uDecay, age);
  // the photo's ramp by distance from the sensor: mint, green-yellow, peach, pink
  float t = clamp(aDist / uRange, 0.0, 1.0) * 3.0;
  vec3 dc = t < 1.0 ? mix(uC0, uC1, t) : t < 2.0 ? mix(uC1, uC2, t - 1.0) : mix(uC2, uC3, t - 2.0);
  vCol = uMode < 0.5 ? dc : uMode < 1.5 ? vec3(1.0) : vec3(0.55);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // a lidar viewer's points: one size on screen wherever they lie, a little larger right by the eye
  vPx = uSize * aSz * clamp(3.0 / max(0.1, -mv.z), 1.0, 1.6);
  gl_PointSize = vPx;
}`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
varying float vPx;
void main() {
  // a round dot with a one-pixel edge: sharp at any size, never a square, never a blur
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float edge = clamp((1.0 - r) * vPx * 0.5 + 0.5, 0.0, 1.0);
  float a = vA * edge;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vCol, a);
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
    const sz = new THREE.BufferAttribute(new Float32Array(MAX_POINTS).fill(1), 1);
    for (const a of [pos, birth, dist, sz]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", pos);
    g.setAttribute("aBirth", birth);
    g.setAttribute("aDist", dist);
    g.setAttribute("aSz", sz);
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
          // the photo's rings: mint close by, then green-yellow, peach, and pink at the edge of the reach
          uC0: { value: lin("#5ff0c8") },
          uC1: { value: lin("#c6f06a") },
          uC2: { value: lin("#ffb86b") },
          uC3: { value: lin("#ff7eb0") },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        // (its depth written, so the paper's softening by depth reads each dot where it is — InkPaper.tsx)
        depthWrite: true,
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
  const st = useRef({ head: 0, filled: 0, sweep: 0, az: 0, cellsOf: null as readonly Cell[] | null, grid: new Map<number, Cell[]>(), hf: null as Float32Array | null, r2: 0, cols: "", camP: new THREE.Vector3(), camQ: new THREE.Quaternion(), camSet: false, decay: 0 });

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
    // her four colours (picked as seen: sRGB, turned into the working space by THREE.Color)
    const cols = `${L.c0}${L.c1}${L.c2}${L.c3}`;
    if (cols !== s.cols) {
      s.cols = cols;
      (u.uC0.value as THREE.Color).set(L.c0);
      (u.uC1.value as THREE.Color).set(L.c1);
      (u.uC2.value as THREE.Color).set(L.c2);
      (u.uC3.value as THREE.Color).set(L.c3);
    }

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
    if (n <= 0 && L.axis !== "view") return;
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-6) fwd.normalize();
    // (the view's rays leave the camera itself: what I see; the spinning sensors sit at the walker's eye)
    const view = L.axis === "view";
    const ex = view ? cam.position.x : cam.position.x + fwd.x * L.eyeBack, ez = view ? cam.position.z : cam.position.z + fwd.z * L.eyeBack;
    const H = view ? Math.max(0.05, cam.position.y) : Math.max(0.05, L.eyeH);
    const R = L.range, step = CELL_SIZE / 2, half = CELL_SIZE / 2, now = state.clock.elapsedTime;
    const tans = new Float32Array(B);
    for (let b = 0; b < B; b++) tans[b] = Math.tan(((L.lowDeg + ((L.highDeg - L.lowDeg) * b) / (B - 1)) * Math.PI) / 180);
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    const birth = geom.getAttribute("aBirth") as THREE.BufferAttribute;
    const dist = geom.getAttribute("aDist") as THREE.BufferAttribute;
    const sza = geom.getAttribute("aSz") as THREE.BufferAttribute;
    const Pa = pos.array as Float32Array, Ba = birth.array as Float32Array, Da = dist.array as Float32Array, Sa = sza.array as Float32Array;
    const start = s.head;
    let written = 0;
    /** How many of this frame's turn were done (the time budget may stop the heading axis early). */
    let done = n;
    const budget = Math.max(0.5, L.budgetMs);
    /** Far readings: dropped (−1) or the size to draw them at (LOD). */
    const lodSize = (d: number): number => {
      if (L.near > 0 && d < L.near && Math.random() > Math.max(0.03, (d / L.near) * (d / L.near))) return -1;
      if (L.lod <= 0 || d <= L.lod) return 1;
      const q = (L.lod / d) * (L.lod / d);
      return Math.random() < q ? Math.min(4, d / L.lod) : -1;
    };
    const put = (x: number, y: number, z: number, d: number, size = 1) => {
      const j = s.head;
      Sa[j] = size;
      Pa[j * 3] = x;
      Pa[j * 3 + 1] = y;
      Pa[j * 3 + 2] = z;
      Ba[j] = now;
      Da[j] = d;
      s.head = (s.head + 1) % MAX_POINTS;
      written++;
    };
    if (L.axis !== "vertical") {
      // A HEIGHT MAP of the cells round the sensor (one number a cell, the sensor's own cell empty), then each ray
      // marched through it in any direction — up, sideways, down
      const G = Math.ceil(R / CELL_SIZE) + 1, N = 2 * G + 1;
      if (!s.hf || s.hf.length !== N * N) s.hf = new Float32Array(N * N);
      const hf = s.hf;
      hf.fill(0);
      const i0 = Math.floor(ex / CELL_SIZE) - G, j0 = Math.floor(ez / CELL_SIZE) - G;
      let maxH = 0;
      for (const c of cells ?? []) {
        const ci = Math.floor(c.x / CELL_SIZE) - i0, cj = Math.floor(c.z / CELL_SIZE) - j0;
        if (ci < 0 || cj < 0 || ci >= N || cj >= N || (ci === G && cj === G)) continue;
        const h = Math.max(0.2, c.h * scale);
        if (h > hf[ci * N + cj]) hf[ci * N + cj] = h;
        if (h > maxH) maxH = h;
      }
      const solid = (x: number, y: number, z: number) => {
        const ci = Math.floor(x / CELL_SIZE) - i0, cj = Math.floor(z / CELL_SIZE) - j0;
        if (ci < 0 || cj < 0 || ci >= N || cj >= N) return false;
        return y <= hf[ci * N + cj];
      };
      const st2 = CELL_SIZE / 3;
      /** The surface's normal at the last hit (cast): a wall's face (x or z), a roof or the ground (up). */
      let nx = 0, ny = 1, nz = 0;
      /** Whether the last hit was the ground (not a wall or a roof). */
      let onGround = false;
      const cellI = (x: number) => Math.floor(x / CELL_SIZE);
      /** Where a ray from the sensor meets a wall, a roof or the ground within reach (its length), or −1. */
      const cast = (dx: number, dy: number, dz: number): number => {
        const tg = dy < -1e-6 ? H / -dy : Infinity;
        const tEnd = Math.min(R, tg);
        let prev = 0;
        for (let t = st2; t <= tEnd + st2; t += st2) {
          const tt = Math.min(t, tEnd);
          const y = H + dy * tt;
          if (y > maxH && dy >= 0) break; // above every roof and rising: the sky
          if (solid(ex + dx * tt, y, ez + dz * tt)) {
            // the surface between the last free step and this one (a few halvings)
            let lo = prev, hi = tt;
            for (let k = 0; k < 5; k++) {
              const m = (lo + hi) / 2;
              if (solid(ex + dx * m, H + dy * m, ez + dz * m)) hi = m;
              else lo = m;
            }
            onGround = false;
            // which face it came through: the same cell from above = its roof; else the side it crossed into
            const xi0 = cellI(ex + dx * lo), xi1 = cellI(ex + dx * hi), zi0 = cellI(ez + dz * lo), zi1 = cellI(ez + dz * hi);
            nx = 0;
            ny = 0;
            nz = 0;
            if (xi0 === xi1 && zi0 === zi1) ny = 1;
            else if (xi0 !== xi1 && (zi0 === zi1 || Math.abs(dx) >= Math.abs(dz))) nx = dx > 0 ? -1 : 1;
            else nz = dz > 0 ? -1 : 1;
            return hi;
          }
          prev = tt;
          if (tt >= tEnd) break;
        }
        nx = 0;
        ny = 1;
        nz = 0;
        onGround = true;
        return tg <= R ? tg : -1;
      };
      /** Kept, by the surface's angle to the ray (slant): facing me always, along my look seldom. */
      const slant = Math.max(0, L.slant);
      const keep = (dx: number, dy: number, dz: number) => slant <= 0 || Math.random() < Math.pow(Math.abs(dx * nx + dy * ny + dz * nz), slant);
      if (view) {
        // THE VIEW: this frame's share of the readings, scattered over the screen and a margin round it (R2: even,
        // never a grid), each turned into a ray through the camera's lens
        const pc = cam as THREE.PerspectiveCamera;
        const th = Math.tan(((pc.fov ?? 60) * Math.PI) / 360), asp = pc.aspect ?? 1;
        const e = cam.matrixWorld.elements;
        const m = 1 + Math.max(0, L.margin);
        // the refresh term: how much the eye moved or turned since the last frame (world/s, rad/s) → the share made anew
        let motion = 1;
        if (s.camSet && dt > 0) {
          const moved = cam.position.distanceTo(s.camP) / dt;
          const turned = (2 * Math.acos(Math.min(1, Math.abs(cam.quaternion.dot(s.camQ))))) / dt;
          motion = Math.min(1, moved / 1.5 + turned / 0.6);
        }
        s.camP.copy(cam.position);
        s.camQ.copy(cam.quaternion);
        s.camSet = true;
        const idle = Math.min(1, Math.max(0, L.idle));
        const share = Math.max(0.05, idle + (1 - idle) * motion);
        // …and what is read lives longer by as much (readings a second × life = the same density): eased over about a
        // second, so the dots do not all go at once when I start walking again
        const target = L.decaySec / share;
        s.decay = s.decay > 0 ? s.decay + (target - s.decay) * Math.min(1, dt) : target;
        u.uDecay.value = s.decay;
        const k = Math.min(30_000, Math.round(L.rate * share * Math.min(0.1, dt)));
        const fov = Math.max(0, L.fovea);
        for (let i = 0; i < k; i++) {
          // (the time budget, looked at every 64 rays)
          if ((i & 63) === 63 && performance.now() - t0 > budget) break;
          // a place on the screen: even (R2), then — fovea — kept more often the nearer the middle
          let sx = 0, sy = 0;
          for (let tries = 0; tries < 8; tries++) {
            s.r2 = (s.r2 + 1) % 1_000_003;
            sx = ((0.5 + s.r2 * 0.7548776662) % 1) * 2 - 1;
            sy = ((0.5 + s.r2 * 0.569840291) % 1) * 2 - 1;
            if (fov <= 0 || Math.random() * (1 + fov * (sx * sx + sy * sy)) < 1) break;
          }
          const px = sx * m * th * asp, py = sy * m * th;
          let dx = -e[8] + e[0] * px + e[4] * py, dy = -e[9] + e[1] * px + e[5] * py, dz = -e[10] + e[2] * px + e[6] * py;
          const l = Math.hypot(dx, dy, dz);
          dx /= l;
          dy /= l;
          dz /= l;
          const t = cast(dx, dy, dz);
          if (t < 0 || onGround || !keep(dx, dy, dz)) continue;
          const size = lodSize(t);
          if (size < 0) continue;
          put(ex + dx * t, Math.max(0.01, H + dy * t), ez + dz * t, t, size);
        }
      } else {
        // THE HEADING AXIS: circles at right angles to where I walk — F ahead (level), U up, S to the side
        const Fx = fwd.lengthSq() > 1e-6 ? fwd.x : 0, Fz = fwd.lengthSq() > 1e-6 ? fwd.z : -1;
        const Sx = -Fz, Sz = Fx;
        const a0 = (Math.max(0.5, Math.min(89, L.coneDeg)) * Math.PI) / 180;
        for (let i = 0; i < n; i++) {
          if (performance.now() - t0 > budget) {
            done = i;
            break;
          }
          const a = ((s.az + i) % A) / A;
          const ph = a * Math.PI * 2;
          const cu = Math.cos(ph), cs = Math.sin(ph);
          for (let b = 0; b < B; b++) {
            const al = a0 + ((Math.PI / 2 - a0) * b) / (B - 1);
            const ca = Math.cos(al), sa = Math.sin(al);
            const dx = ca * Fx + sa * cs * Sx, dy = sa * cu, dz = ca * Fz + sa * cs * Sz;
            const hit = cast(dx, dy, dz);
            if (hit < 0 || !keep(dx, dy, dz)) continue;
            const size = lodSize(hit);
            if (size < 0) continue;
            const jit = 1 + Math.sin((a * 9137 + b * 71) * 12.9898) * 0.003;
            const d = hit * jit;
            put(ex + dx * d, Math.max(0.01, H + dy * d), ez + dz * d, hit, size);
          }
        }
      }
    }
    // THE GROUND BY THE RING RADAR (the artist, 2026-11-24: "땅은... 원 레이더로만 그려서 비용 줄이고!"): with the view,
    // the vertical spin still runs, for the ground alone — its downward beams share one walk through the cells per
    // direction (and stop at what stands in front); the view's own rays leave the ground unmarked
    if (L.axis === "vertical" || view) {
    const groundOnly = view;
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
        if (groundOnly && tn >= 0) continue;
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
        } else if (groundOnly) continue; // (a wall or a roof: the view's rays read those)
        if (lodSize(d) < 0) continue; // (too near, thinned; the vertical spin's dots keep their size)
        // a hair of the sensor's noise, so a ring is a row of readings, not a drawn line
        const jit = 1 + (Math.sin((a * 9137 + b * 71) * 12.9898) * 0.5) * 0.006;
        const j = s.head;
        Pa[j * 3] = ex + cx * d * jit;
        Pa[j * 3 + 1] = y;
        Pa[j * 3 + 2] = ez + cz * d * jit;
        Ba[j] = now;
        Sa[j] = 1;
        // colour by the range the beam travelled (a wall high above reads as far as it is, not as its foot)
        Da[j] = Math.hypot(d, y - H);
        s.head = (s.head + 1) % MAX_POINTS;
        written++;
      }
    }
    }
    s.sweep = Math.min(s.sweep - done, A / 4);
    s.az = (s.az + done) % A;
    markSpan("lidar", performance.now() - t0);
    if (!written) return;
    s.filled = Math.min(MAX_POINTS, s.filled + written);
    // upload only what this frame wrote (one range, or two when the ring buffer wrapped)
    for (const at of [pos, birth, dist, sza]) {
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

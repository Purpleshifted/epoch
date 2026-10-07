"use client";
/**
 * ArchitectureLayer: the worker's concrete as seen from Top and Side (never in the player view).
 *
 * Slabs become stacked storeys (one box per height unit, thin gap between them); a slab worn to
 * its footprint is a flat outline plate; desire paths become low plates. Three materials,
 * switchable from Leva, share one box list:
 *   block  lit extruded boxes (solid, heavy)
 *   lines  architectural line drawing (box edges only)
 *   points a LiDAR-like point shell sampled on the box surfaces
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "@/lib/stratum/field";
import { hash2, DEFAULT_COLLAGE, DEFAULT_SHARDS, type CollageConfig, type ShardConfig, type ShardKind, type Snapshot } from "@/lib/parliament";
import { PhotoLayer } from "./PhotoLayer";
import { ShardLayer } from "./ShardLayer";

export type ArchStyle = "block" | "lines" | "points" | "shards" | "photo";

/** Thin lines the photo collage keeps from the procedural one: black struts / axis lines, ground strokes, paths. */
const PHOTO_EXTRAS: readonly ShardKind[] = ["strut", "axis", "ground", "path"];

interface Box {
  x: number;
  y0: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  c: number;
  seed: number;
}

const MAX_BOXES = 14000;
const MAX_POINTS = 160000;
const OUTLINE = 0x555555;
const LOW = 0xaaaaaa;
const HIGH = 0xffffff;
const PATH_LO = 0x3c3c3c;
const PATH_HI = 0x9a9a9a;

function slabColor(h: number): number {
  if (h < 0.15) return OUTLINE;
  if (h < 2.5) return LOW;
  return HIGH;
}

/** Turn a snapshot into a flat box list. */
export function buildBoxes(snap: Snapshot, heightUnit: number, showPaths: boolean): Box[] {
  const out: Box[] = [];
  const gap = 0.1;
  const ext = CELL_SIZE * 0.96;
  for (const s of snap.slabs) {
    const seed = Math.floor(hash2(Math.floor(s.x * 10), Math.floor(s.z * 10), 9) * 1e6);
    if (s.h < 0.15) {
      out.push({ x: s.x, y0: 0, z: s.z, sx: ext, sy: 0.04, sz: ext, c: OUTLINE, seed });
      continue;
    }
    const levels = Math.ceil(s.h - 1e-6);
    const col = slabColor(s.h);
    for (let l = 0; l < levels && out.length < MAX_BOXES; l++) {
      const part = Math.min(1, s.h - l);
      const hh = Math.max(0.04, (part - gap) * heightUnit);
      out.push({ x: s.x, y0: l * heightUnit, z: s.z, sx: ext, sy: hh, sz: ext, c: col, seed: seed + l * 7919 });
    }
  }
  if (showPaths) {
    const lo = new THREE.Color(PATH_LO);
    const hi = new THREE.Color(PATH_HI);
    const tmp = new THREE.Color();
    for (const q of snap.paths) {
      if (out.length >= MAX_BOXES) break;
      const e = CELL_SIZE * (0.55 + 0.4 * q.p);
      tmp.copy(lo).lerp(hi, q.p);
      out.push({ x: q.x, y0: 0, z: q.z, sx: e, sy: 0.03 + 0.05 * q.p, sz: e, c: tmp.getHex(), seed: 1 });
    }
  }
  return out;
}

const EDGES: [number, number][] = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function BoxArchitecture({
  getSnapshot,
  heightUnit,
  style,
  showPaths = true,
  every = 0.25,
  unlit = false,
}: {
  getSnapshot: () => Snapshot | null;
  heightUnit: number;
  style: Exclude<ArchStyle, "shards" | "photo">;
  showPaths?: boolean;
  every?: number;
  /** Top view: flat colours, no lighting. */
  unlit?: boolean;
}) {
  const timer = useRef(10);
  const boxMesh = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);

  const lineGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_BOXES * 24 * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_BOXES * 24 * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const pointGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);

  useEffect(() => {
    const m = boxMesh.current;
    if (m) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOXES * 3), 3);
      m.count = 0;
    }
    return () => { lineGeom.dispose(); pointGeom.dispose(); };
  }, [lineGeom, pointGeom]);

  // redraw immediately when the style changes
  useEffect(() => { timer.current = 10; }, [style, heightUnit, showPaths]);

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < every) return;
    timer.current = 0;
    const snap = getSnapshot();
    const boxes = snap ? buildBoxes(snap, heightUnit, showPaths) : [];

    if (style === "block") {
      const m = boxMesh.current;
      if (!m) return;
      boxes.forEach((b, i) => {
        tmp.position.set(b.x, b.y0 + b.sy / 2, b.z);
        tmp.scale.set(b.sx, b.sy, b.sz);
        tmp.updateMatrix();
        m.setMatrixAt(i, tmp.matrix);
        m.setColorAt(i, col.setHex(b.c));
      });
      m.count = boxes.length;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    } else if (style === "lines") {
      const P = (lineGeom.getAttribute("position") as THREE.BufferAttribute);
      const C = (lineGeom.getAttribute("color") as THREE.BufferAttribute);
      let k = 0;
      for (const b of boxes) {
        col.setHex(b.c);
        const x0 = b.x - b.sx / 2, x1 = b.x + b.sx / 2;
        const z0 = b.z - b.sz / 2, z1 = b.z + b.sz / 2;
        const y0 = b.y0, y1 = b.y0 + b.sy;
        const V: [number, number, number][] = [
          [x0, y0, z0], [x1, y0, z0], [x0, y0, z1], [x1, y0, z1],
          [x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [x1, y1, z1],
        ];
        for (const [a, c] of EDGES) {
          for (const v of [V[a], V[c]]) {
            P.setXYZ(k, v[0], v[1], v[2]);
            C.setXYZ(k, col.r, col.g, col.b);
            k++;
          }
        }
      }
      lineGeom.setDrawRange(0, k);
      P.needsUpdate = true;
      C.needsUpdate = true;
    } else {
      const P = (pointGeom.getAttribute("position") as THREE.BufferAttribute);
      const C = (pointGeom.getAttribute("color") as THREE.BufferAttribute);
      let k = 0;
      const density = 70; // points per square world unit of surface
      for (const b of boxes) {
        if (k >= MAX_POINTS - 400) break;
        col.setHex(b.c);
        const top = b.sx * b.sz;
        const sideA = b.sx * b.sy;
        const sideB = b.sz * b.sy;
        const total = top + 2 * sideA + 2 * sideB;
        const n = Math.max(6, Math.round(total * density));
        for (let i = 0; i < n; i++) {
          const r = hash2(b.seed, i, 1) * total;
          const u = hash2(b.seed, i, 2) - 0.5;
          const v = hash2(b.seed, i, 3) - 0.5;
          let x: number, y: number, z: number;
          if (r < top) { x = b.x + u * b.sx; z = b.z + v * b.sz; y = b.y0 + b.sy; }
          else if (r < top + sideA) { x = b.x + u * b.sx; z = b.z + b.sz / 2; y = b.y0 + (v + 0.5) * b.sy; }
          else if (r < top + 2 * sideA) { x = b.x + u * b.sx; z = b.z - b.sz / 2; y = b.y0 + (v + 0.5) * b.sy; }
          else if (r < top + 2 * sideA + sideB) { x = b.x + b.sx / 2; z = b.z + u * b.sz; y = b.y0 + (v + 0.5) * b.sy; }
          else { x = b.x - b.sx / 2; z = b.z + u * b.sz; y = b.y0 + (v + 0.5) * b.sy; }
          const lum = 0.7 + 0.5 * hash2(b.seed, i, 4);
          P.setXYZ(k, x, y, z);
          C.setXYZ(k, Math.min(1, col.r * lum), Math.min(1, col.g * lum), Math.min(1, col.b * lum));
          k++;
        }
      }
      pointGeom.setDrawRange(0, k);
      P.needsUpdate = true;
      C.needsUpdate = true;
    }
  });

  return (
    <>
      {style === "block" && (
        <instancedMesh ref={boxMesh} args={[undefined, undefined, MAX_BOXES]} frustumCulled={false}>
          <boxGeometry args={[1, 1, 1]} />
          {unlit ? <meshBasicMaterial /> : <meshLambertMaterial emissive="#303030" />}
        </instancedMesh>
      )}
      {style === "lines" && (
        <lineSegments geometry={lineGeom} frustumCulled={false}>
          <lineBasicMaterial vertexColors />
        </lineSegments>
      )}
      {style === "points" && (
        <points geometry={pointGeom} frustumCulled={false}>
          <pointsMaterial size={0.05} sizeAttenuation vertexColors />
        </points>
      )}
    </>
  );
}

/** Concrete in Top/Side: the shard collage, or one of the box-based materials. */
export function ArchitectureLayer({
  getSnapshot,
  heightUnit,
  style,
  showPaths = true,
  every = 0.25,
  unlit = false,
  shards = DEFAULT_SHARDS,
  collage = DEFAULT_COLLAGE,
  view = "side",
}: {
  getSnapshot: () => Snapshot | null;
  heightUnit: number;
  style: ArchStyle;
  showPaths?: boolean;
  every?: number;
  unlit?: boolean;
  shards?: ShardConfig;
  collage?: CollageConfig;
  view?: "side" | "top";
}) {
  const slow = Math.max(every, 0.5);
  if (style === "photo") {
    return (
      <>
        <PhotoLayer getSnapshot={getSnapshot} heightUnit={heightUnit} cfg={collage} view={view} every={slow} />
        <ShardLayer getSnapshot={getSnapshot} heightUnit={heightUnit} cfg={shards} every={slow} view={view} showPaths={showPaths} only={PHOTO_EXTRAS} />
      </>
    );
  }
  if (style === "shards") return <ShardLayer getSnapshot={getSnapshot} heightUnit={heightUnit} cfg={shards} every={slow} view={view} showPaths={showPaths} />;
  return <BoxArchitecture getSnapshot={getSnapshot} heightUnit={heightUnit} style={style} showPaths={showPaths} every={every} unlit={unlit} />;
}

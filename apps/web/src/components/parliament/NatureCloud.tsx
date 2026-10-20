"use client";
/**
 * NatureCloud: the player's ground as a POINT CLOUD (not sprites).
 *
 * For every cell around the player, `pointsPerCell` candidate points sit at deterministic
 * hashed positions; candidate i is drawn iff its threshold u_i < density G. So the number of
 * points IS the density, and lowering/raising G adds/removes points without any popping of
 * the others. Colour runs from fresh green to dry brown with stress; desire-path cells get
 * grey-brown dust points whose count follows the path strength.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "@/lib/stratum/field";
import { WORLD_SIZE, grassDensity, hash2, wrapCell, type NatureConfig, type Snapshot } from "@/lib/parliament";
import { markSpan } from "./usePerfMeter";

const RADIUS = 22; // world units around the player (default; the view's `radius` knob)
const MAX_POINTS = 240000;

const GREEN_FRESH = new THREE.Color(0x58c43c);
const GREEN_DEEP = new THREE.Color(0x1f7a2e);
const DRY = new THREE.Color(0xb59a45);
const DUST = new THREE.Color(0x8a7a62);
const PATH_LIGHT = new THREE.Color(0xc9c2b4);

function dotTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The cloud's reach and look. */
export interface CloudView {
  /** World units around the player that are drawn. */
  radius: number;
  /** Share of a cell's points still drawn at the edge (1 = as near; thinner farther, so it fades into the fog). */
  farKeep: number;
  /** × the height of the grass. */
  height: number;
}

export const DEFAULT_CLOUD_VIEW: CloudView = { radius: RADIUS, farKeep: 1, height: 1 };

export function NatureCloud({
  playerPosRef,
  getStress,
  getSnapshot,
  cfg,
  pointSize = 0.11,
  view = DEFAULT_CLOUD_VIEW,
  pathDots = 1,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  getStress: () => Map<string, number> | null;
  getSnapshot: () => Snapshot | null;
  cfg: NatureConfig;
  pointSize?: number;
  /** How far the cloud reaches and how it thins out there, and how tall it grows (the player's sense of scale). */
  view?: CloudView;
  /** Dust points per trodden cell relative to the base (14 at a fully formed path). */
  pathDots?: number;
}) {
  const ref = useRef<THREE.Points>(null);
  const timer = useRef(10);
  /** Where the cloud was last laid out: a jump of more than a quarter world = the player wrapped round the edge. */
  const laidAt = useRef({ x: NaN, z: NaN });
  const tex = useMemo(() => dotTexture(), []);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const tmp = useMemo(() => new THREE.Color(), []);

  useEffect(() => () => { geom.dispose(); tex.dispose(); }, [geom, tex]);

  useFrame((_, dt) => {
    timer.current += dt;
    const p = playerPosRef.current;
    const jumped = Number.isFinite(laidAt.current.x) && Math.hypot(p.x - laidAt.current.x, p.z - laidAt.current.z) > WORLD_SIZE / 4;
    if (timer.current < 0.25 && !jumped) return;
    timer.current = 0;
    laidAt.current = { x: p.x, z: p.z };
    const tCloud = performance.now();
    const stress = getStress();
    const snap = getSnapshot();
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    const col = geom.getAttribute("color") as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const Cc = col.array as Float32Array;

    const pathAt = new Map<string, number>();
    const sealed = new Set<string>();
    if (snap) {
      for (const q of snap.paths) pathAt.set(q.key, q.p);
      for (const s of snap.slabs) if (s.h >= 0.15) sealed.add(s.key);
    }

    const cx0 = Math.floor(p.x / CELL_SIZE);
    const cz0 = Math.floor(p.z / CELL_SIZE);
    const R = Math.max(4, view.radius);
    const n = Math.ceil(R / CELL_SIZE);
    let k = 0;
    for (let dx = -n; dx <= n && k < MAX_POINTS - 64; dx++) {
      for (let dz = -n; dz <= n && k < MAX_POINTS - 64; dz++) {
        // drawn where it lies around the player (ix, iz), but it IS the canonical cell (wx, wz): the world wraps
        const ix = cx0 + dx;
        const iz = cz0 + dz;
        const d = Math.hypot((ix + 0.5) * CELL_SIZE - p.x, (iz + 0.5) * CELL_SIZE - p.z);
        if (d > R) continue;
        // farther, fewer: the first candidates stay (no popping as the share changes), from 40 % of the reach out
        const keep = d <= R * 0.4 ? 1 : 1 - (1 - Math.max(0, Math.min(1, view.farKeep))) * ((d - R * 0.4) / (R * 0.6));
        const cands = Math.max(1, Math.round(cfg.pointsPerCell * keep));
        const wx = wrapCell(ix);
        const wz = wrapCell(iz);
        const key = `${wx},${wz}`;
        const S = stress?.get(key) ?? 0;
        const pp = pathAt.get(key) ?? 0;
        const G = grassDensity(wx, wz, S, pp, sealed.has(key), cfg);
        const worn = 1 - Math.exp(-S); // 0 fresh .. 1 trampled

        for (let i = 0; i < cands; i++) {
          if (hash2(wx, wz, 100 + i) >= G) continue; // candidate i is drawn iff its threshold < G
          const u = hash2(wx, wz, 200 + i);
          const v = hash2(wx, wz, 300 + i);
          const h = hash2(wx, wz, 400 + i);
          const y = 0.02 + h * (0.12 + 0.3 * G) * (1 - 0.6 * worn) * view.height;
          P[k * 3] = (ix + u) * CELL_SIZE;
          P[k * 3 + 1] = y;
          P[k * 3 + 2] = (iz + v) * CELL_SIZE;
          tmp.copy(GREEN_DEEP).lerp(GREEN_FRESH, h).lerp(DRY, Math.min(1, worn * 1.3 + (1 - G) * 0.25));
          Cc[k * 3] = tmp.r;
          Cc[k * 3 + 1] = tmp.g;
          Cc[k * 3 + 2] = tmp.b;
          k++;
        }
        if (pp > 0.05 && pathDots > 0) {
          const nd = Math.round(14 * pp * pathDots);
          for (let i = 0; i < nd; i++) {
            P[k * 3] = (ix + hash2(wx, wz, 500 + i)) * CELL_SIZE;
            P[k * 3 + 1] = 0.015 + hash2(wx, wz, 600 + i) * 0.03;
            P[k * 3 + 2] = (iz + hash2(wx, wz, 700 + i)) * CELL_SIZE;
            // a formed path reads lighter (greyscale: a human trace)
            tmp.copy(DUST).lerp(PATH_LIGHT, Math.min(1, pp * 0.8)).multiplyScalar(0.75 + 0.5 * hash2(wx, wz, 800 + i));
            Cc[k * 3] = tmp.r;
            Cc[k * 3 + 1] = tmp.g;
            Cc[k * 3 + 2] = tmp.b;
            k++;
          }
        }
      }
    }
    geom.setDrawRange(0, k);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    markSpan("cloud", performance.now() - tCloud);
  });

  return (
    <points ref={ref} geometry={geom} frustumCulled={false}>
      <pointsMaterial size={pointSize} sizeAttenuation vertexColors map={tex} alphaTest={0.3} transparent depthWrite />
    </points>
  );
}

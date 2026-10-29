"use client";
/**
 * NatureCloud: the player's ground as a POINT CLOUD (not sprites).
 *
 * For every cell around the player, `pointsPerCell` candidate points sit at deterministic
 * hashed positions; candidate i is drawn iff its threshold u_i < density G. So the number of
 * points IS the density, and lowering/raising G adds/removes points without any popping of
 * the others. Colour runs from fresh green to dry brown with stress; desire-path cells get
 * grey-brown dust points whose count follows the path strength.
 *
 * Since 2026-10-20 (docs/session-logic.md §12, Leva 개인뷰 비주얼 › 풀 반응) the cloud can REACT to the walker at
 * once: RoleField feeds the player's own recent trail into a second StressState (`getQuick`, every `nearEvery`
 * seconds, independent of the fold) and the cells within `nearRadius` of the player are laid out in a small second
 * geometry at that rate, while the far pass stays at 0.25 s and skips them — a few hundred points, not the cloud.
 *   A1 press    the quick stress adds to the folded one: the grass thins right under and behind the walker
 *   A2 flatten  … and the points there lie down and dry at once (then thin out as before)
 *   A3 mine     … and the walker's own folded stress (the ledger's, `getMine`) is raised by `mineGain`; the
 *               others' cells are untouched
 * `thick` (2026-10-28): the points' vertical spread × thick, denser low down — the grass stands as a layer.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "@/lib/stratum/field";
import { WORLD_SIZE, grassDensity, hash2, wrapCell, type NatureConfig, type Snapshot } from "@/lib/parliament";
import { markSpan } from "./usePerfMeter";

const RADIUS = 22; // world units around the player
const MAX_POINTS = 90000;
const NEAR_MAX = 8192;

const GREEN_FRESH = new THREE.Color(0x58c43c);
const GREEN_DEEP = new THREE.Color(0x1f7a2e);
const DRY = new THREE.Color(0xb59a45);
const DUST = new THREE.Color(0x8a7a62);
const PATH_LIGHT = new THREE.Color(0xc9c2b4);

export type GrassMode = "off" | "press" | "flatten" | "mine";

/** How the cloud reacts to the walker (Leva 개인뷰 비주얼). */
export interface GrassReaction {
  mode: GrassMode;
  /** World radius around the player laid out at `nearEvery` (the fast pass). */
  nearRadius: number;
  nearEvery: number;
  /** A3: the walker's own folded stress × this. */
  mineGain: number;
  /** The vertical spread of the points (1 = the old spread; more = the grass stands thicker, denser low down). */
  thick: number;
}

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

function makeGeom(n: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setDrawRange(0, 0);
  return g;
}

export function NatureCloud({
  playerPosRef,
  getStress,
  getSnapshot,
  cfg,
  pointSize = 0.11,
  pathDots = 1,
  getQuick,
  getMine,
  grass,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  getStress: () => Map<string, number> | null;
  getSnapshot: () => Snapshot | null;
  cfg: NatureConfig;
  pointSize?: number;
  /** Dust points per trodden cell relative to the base (14 at a fully formed path). */
  pathDots?: number;
  /** The walker's own recent trail as stress per cell (RoleField's quick StressState); null = none. */
  getQuick?: () => Map<string, number> | null;
  /** The walker's own folded stress per cell (the ledger's); null = none. */
  getMine?: () => Map<string, number> | null;
  grass?: GrassReaction;
}) {
  const timer = useRef(10);
  const nearTimer = useRef(10);
  /** Where the cloud was last laid out: a jump of more than a quarter world = the player wrapped round the edge. */
  const laidAt = useRef({ x: NaN, z: NaN });
  const tex = useMemo(() => dotTexture(), []);
  const geom = useMemo(() => makeGeom(MAX_POINTS), []);
  const nearGeom = useMemo(() => makeGeom(NEAR_MAX), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  /** The path strengths and sealed cells of the latest snapshot — built once per snapshot, not once per pass. */
  const derived = useRef<{ snap: Snapshot | null; pathAt: Map<string, number>; sealed: Set<string> }>({ snap: null, pathAt: new Map(), sealed: new Set() });

  useEffect(
    () => () => {
      geom.dispose();
      nearGeom.dispose();
      tex.dispose();
    },
    [geom, nearGeom, tex],
  );

  /**
   * Lay out the cells whose centre is at a distance `pick`ed from the player into `g`. The grass reaction (if any)
   * reads the quick and the walker's own stress.
   */
  const lay = (g: THREE.BufferGeometry, max: number, pick: (d: number) => boolean) => {
    const p = playerPosRef.current;
    const mode = grass?.mode ?? "off";
    const stress = getStress();
    const snap = getSnapshot();
    const quick = mode !== "off" ? (getQuick?.() ?? null) : null;
    const mine = mode === "mine" ? (getMine?.() ?? null) : null;
    const gain = grass?.mineGain ?? 1;
    const thick = grass?.thick ?? 1;
    const bend = 1 + 0.6 * Math.max(0, thick - 1); // h^bend: with more thickness, more of the points stay low
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const col = g.getAttribute("color") as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const Cc = col.array as Float32Array;

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

    const cx0 = Math.floor(p.x / CELL_SIZE);
    const cz0 = Math.floor(p.z / CELL_SIZE);
    const n = Math.ceil(RADIUS / CELL_SIZE);
    let k = 0;
    for (let dx = -n; dx <= n && k < max - 64; dx++) {
      for (let dz = -n; dz <= n && k < max - 64; dz++) {
        // drawn where it lies around the player (ix, iz), but it IS the canonical cell (wx, wz): the world wraps
        const ix = cx0 + dx;
        const iz = cz0 + dz;
        const d = Math.hypot((ix + 0.5) * CELL_SIZE - p.x, (iz + 0.5) * CELL_SIZE - p.z);
        if (d > RADIUS || !pick(d)) continue;
        const wx = wrapCell(ix);
        const wz = wrapCell(iz);
        const key = `${wx},${wz}`;
        let S = stress?.get(key) ?? 0;
        const q = quick?.get(key) ?? 0;
        if (mine) S += (gain - 1) * (mine.get(key) ?? 0);
        S += q;
        const pp = pathAt.get(key) ?? 0;
        const G = grassDensity(wx, wz, S, pp, sealed.has(key), cfg);
        const worn = 1 - Math.exp(-S); // 0 fresh .. 1 trampled
        const flat = mode === "flatten" ? 1 - Math.exp(-3 * q) : 0; // A2: lying down at once where the walker just was

        for (let i = 0; i < cfg.pointsPerCell; i++) {
          if (hash2(wx, wz, 100 + i) >= G) continue; // candidate i is drawn iff its threshold < G
          const u = hash2(wx, wz, 200 + i);
          const v = hash2(wx, wz, 300 + i);
          const h = hash2(wx, wz, 400 + i);
          const y = (0.02 + Math.pow(h, bend) * thick * (0.12 + 0.3 * G) * (1 - 0.6 * worn)) * (1 - 0.9 * flat);
          P[k * 3] = (ix + u) * CELL_SIZE;
          P[k * 3 + 1] = y;
          P[k * 3 + 2] = (iz + v) * CELL_SIZE;
          tmp.copy(GREEN_DEEP).lerp(GREEN_FRESH, h).lerp(DRY, Math.min(1, worn * 1.3 + (1 - G) * 0.25 + flat));
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
    g.setDrawRange(0, k);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  };

  useFrame((_, dt) => {
    timer.current += dt;
    nearTimer.current += dt;
    const p = playerPosRef.current;
    const jumped = Number.isFinite(laidAt.current.x) && Math.hypot(p.x - laidAt.current.x, p.z - laidAt.current.z) > WORLD_SIZE / 4;
    const on = !!grass && grass.mode !== "off";
    const near = on ? grass!.nearRadius : 0;
    // the far pass: everything (reaction off), or everything beyond the near radius
    if (timer.current >= 0.25 || jumped) {
      timer.current = 0;
      laidAt.current = { x: p.x, z: p.z };
      const t0 = performance.now();
      lay(geom, MAX_POINTS, on ? (d) => d > near : () => true);
      markSpan("cloud", performance.now() - t0);
      if (!on) nearGeom.setDrawRange(0, 0);
    }
    // the near pass: the cells around the walker, often (one cell of overlap with the far pass, so a cell that
    // leaves the near radius is never missing)
    if (on && (nearTimer.current >= grass!.nearEvery || jumped)) {
      nearTimer.current = 0;
      const t0 = performance.now();
      lay(nearGeom, NEAR_MAX, (d) => d <= near + CELL_SIZE);
      markSpan("cloud-near", performance.now() - t0);
    }
  });

  return (
    <>
      <points geometry={geom} frustumCulled={false}>
        <pointsMaterial size={pointSize} sizeAttenuation vertexColors map={tex} alphaTest={0.3} transparent depthWrite />
      </points>
      <points geometry={nearGeom} frustumCulled={false}>
        <pointsMaterial size={pointSize} sizeAttenuation vertexColors map={tex} alphaTest={0.3} transparent depthWrite />
      </points>
    </>
  );
}

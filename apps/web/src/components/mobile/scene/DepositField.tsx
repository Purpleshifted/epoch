"use client";
/**
 * DepositField — what the visitors leave behind.
 *
 * Replaces StarFieldSystem (GPGPU particle trails, N-body gravity, star lifecycle,
 * merging). There is no physics here: a visitor scatters items that they do not
 * choose (sampled from the JRC European beach-litter catalogue), and the fate of
 * each item is decided by lib/stratum (material persistence, burial by later
 * deposits, fossilisation). Rendering is a placeholder: flat 16-colour pixel
 * squares, one per item. Real sprites replace them in a later step.
 *
 * Multi-user (for now): every browser tab is a visitor; records are shared through
 * localStorage and merged by id. A server replaces this later.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  LS_DEPOSITS_KEY,
  LS_EPOCH_KEY,
  MATERIAL_PALETTE_INDEX,
  PALETTE_HEX,
  dimIndex,
  localSurvivors,
  makeDeposit,
  resolveField,
  sampleFromField,
  stageTint,
  type DepositRecord,
} from "@/lib/stratum";

const MAX_RECORDS = 3000;
const DROP_DIST = 1.0;        // scatter one item per this much distance walked...
const DROP_IDLE = 1.5;        // ...or after this many seconds standing still
const DROP_MIN_GAP = 0.2;     // never faster than this (s)
const RESOLVE_EVERY = 0.25;   // s between fate recomputations
const SYNC_EVERY = 1.0;       // s between localStorage merges
const VISITOR_KEY = "anthropocene:visitor:v1";

// ── palette as linear colours (so the post chain's sRGB output matches the hex) ──
const PALETTE_RGB: [number, number, number][] = PALETTE_HEX.map((hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
});

const VS = /* glsl */ `
  attribute vec3 aColor;
  attribute vec2 aFlags;       // x: dither, y: outline
  uniform float uCamConst;
  uniform float uSize;
  varying vec3 vColor;
  varying vec2 vFlags;
  void main() {
    vColor = aColor;
    vFlags = aFlags;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(4.0, floor(uSize * uCamConst / (-mv.z)));
    gl_Position = projectionMatrix * mv;
  }
`;

const FS = /* glsl */ `
  varying vec3 vColor;
  varying vec2 vFlags;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    if (vFlags.x > 0.5) {
      // two-colour checkerboard, the only dither TempleOS has
      float chk = mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0);
      if (chk < 0.5) discard;
    }
    vec3 col = vColor;
    if (vFlags.y > 0.5 && max(abs(p.x), abs(p.y)) > 0.34) col = vec3(1.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function loadRecords(): DepositRecord[] {
  try {
    const raw = localStorage.getItem(LS_DEPOSITS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as DepositRecord[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function getEpochMs(): number {
  try {
    const raw = localStorage.getItem(LS_EPOCH_KEY);
    if (raw) return Number(raw);
    const now = Date.now();
    localStorage.setItem(LS_EPOCH_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

function getVisitorId(): string {
  try {
    let id = sessionStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = "v_" + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return "v_anon";
  }
}

export function DepositField({
  playerPosRef,
  playerYRef,
  pointSize = 0.32,
  botCount = 0,
  poolK = 20,
  poolRadius = 4,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  playerYRef: React.MutableRefObject<number>;
  pointSize?: number;
  /** Debug visitors that wander on their own, each scattering from its own draw. */
  botCount?: number;
  /** Prior pseudo-count: how many "imaginary" items of the catalogue prior the ground is weighed against. 0 = only the ground. */
  poolK?: number;
  /** Radius (world units) of the ground a visitor inherits from. */
  poolRadius?: number;
}) {
  const lastResolved = useRef<ReturnType<typeof resolveField>>([]);
  const records = useRef<Map<string, DepositRecord>>(new Map());
  const dirty = useRef(false);
  const epochMs = useRef(0);
  const visitor = useRef("v_anon");
  const seq = useRef(0);

  // per-source drop state: key -> { x, z, t of last drop, last moved time }
  const drops = useRef(new Map<string, { x: number; z: number; last: number; moved: number }>());
  const resolveTimer = useRef(0);
  const syncTimer = useRef(0);
  const clock = useRef(0);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_RECORDS * 3), 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(MAX_RECORDS * 3), 3));
    g.setAttribute("aFlags", new THREE.BufferAttribute(new Float32Array(MAX_RECORDS * 2), 2));
    g.setDrawRange(0, 0);
    return g;
  }, []);

  const uniforms = useMemo(
    () => ({ uCamConst: { value: 400 }, uSize: { value: pointSize } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  uniforms.uSize.value = pointSize;

  const material = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms, toneMapped: false }),
    [uniforms],
  );

  useEffect(() => {
    epochMs.current = getEpochMs();
    visitor.current = getVisitorId();
    for (const r of loadRecords()) records.current.set(r.id, r);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_DEPOSITS_KEY) return;
      for (const r of loadRecords()) records.current.set(r.id, r);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  const nowSec = () => (Date.now() - epochMs.current) / 1000;

  /** Scatter one item from `src` at (x,z). The item is drawn, not chosen. */
  const scatter = (src: string, owner: string, x: number, y: number, z: number, t: number) => {
    const id = `${owner}_${Math.floor(t * 1000)}_${seq.current++}`;
    // Inheritance: the draw leans toward what has survived around this spot.
    const survivors = localSurvivors(lastResolved.current, x, z, poolRadius);
    const entry = sampleFromField(Math.random(), survivors, poolK);
    const rec = makeDeposit({ id, u: 0, entry, x, y, z, t, owner });
    records.current.set(id, rec);
    dirty.current = true;
    void src;
  };

  const maybeDrop = (src: string, owner: string, x: number, z: number, y: number, t: number) => {
    let s = drops.current.get(src);
    if (!s) {
      s = { x, z, last: t, moved: t };
      drops.current.set(src, s);
      return;
    }
    const d = Math.hypot(x - s.x, z - s.z);
    if (d > 0.02) s.moved = t;
    const sinceLast = t - s.last;
    if (sinceLast < DROP_MIN_GAP) return;
    if (d >= DROP_DIST || sinceLast >= DROP_IDLE) {
      scatter(src, owner, x, y, z, t);
      s.x = x;
      s.z = z;
      s.last = t;
    }
  };

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    clock.current += dt;
    const t = nowSec();

    // ── 1. scatter: the visitor, then any debug bots ─────────────
    const py = playerYRef.current;
    maybeDrop("me", visitor.current, playerPosRef.current.x, playerPosRef.current.z, py, t);
    for (let i = 0; i < botCount; i++) {
      const R = 3 + (i % 5) * 2.4;
      const w = (0.18 + 0.05 * (i % 4)) * (i % 2 ? 1 : -1);
      const a = clock.current * w + i * 2.399963;
      maybeDrop(`bot${i}`, `bot${i}`, Math.cos(a) * R, Math.sin(a) * R, py, t);
    }

    // ── 2. merge with other visitors (other tabs) via localStorage ──
    syncTimer.current += dt;
    if (syncTimer.current >= SYNC_EVERY) {
      syncTimer.current = 0;
      for (const r of loadRecords()) if (!records.current.has(r.id)) { records.current.set(r.id, r); dirty.current = true; }
      if (dirty.current) {
        dirty.current = false;
        // cap: oldest first
        if (records.current.size > MAX_RECORDS) {
          const sorted = [...records.current.values()].sort((a, b) => a.t - b.t);
          for (const r of sorted.slice(0, sorted.length - MAX_RECORDS)) records.current.delete(r.id);
        }
        try {
          localStorage.setItem(LS_DEPOSITS_KEY, JSON.stringify([...records.current.values()]));
        } catch { /* quota: ignore, memory copy continues */ }
      }
    }

    // ── 3. resolve fates, fill buffers ───────────────────────────
    resolveTimer.current += dt;
    if (resolveTimer.current < RESOLVE_EVERY) return;
    resolveTimer.current = 0;

    uniforms.uCamConst.value =
      window.innerHeight / (2 * Math.tan(((state.camera as THREE.PerspectiveCamera).fov * Math.PI) / 360));

    const resolved = resolveField([...records.current.values()], t);
    lastResolved.current = resolved;
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = geometry.getAttribute("aColor") as THREE.BufferAttribute;
    const flg = geometry.getAttribute("aFlags") as THREE.BufferAttribute;
    let n = 0;
    for (const { rec, fate } of resolved) {
      if (fate.stage === "vanished" || n >= MAX_RECORDS) continue;
      const tint = stageTint(fate.stage);
      let pi = MATERIAL_PALETTE_INDEX[rec.material];
      if (tint.dim) pi = dimIndex(pi);
      const c = PALETTE_RGB[pi];
      pos.setXYZ(n, rec.x, rec.y, rec.z);
      col.setXYZ(n, c[0], c[1], c[2]);
      flg.setXY(n, tint.dither ? 1 : 0, tint.outline ? 1 : 0);
      n++;
    }
    pos.needsUpdate = col.needsUpdate = flg.needsUpdate = true;
    geometry.setDrawRange(0, n);
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

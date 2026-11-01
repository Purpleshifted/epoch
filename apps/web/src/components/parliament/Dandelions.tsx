"use client";
/**
 * Dandelions — what the answers left, on the wall (lib/parliament/dandelion.ts): at the height of its time a stem, white
 * spokes and the seeds as points, and nothing with a surface. Where the masses cover one a faint ghost of it shows through
 * them, so one that stands inside a building is still there to see. A new one is large and throws a cloud of powder the
 * wind carries off, then it shrinks; where its layer fossilises some go and some stay. Leva 보기 › 응답의 홀씨.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SEEDS_PER_HEAD, SPOKE, STEM, dandelionShape, dandelionsIn, headScale, headVariation, latestS, scatterPoints, type Dandelion, type EventLog, type HeadLife, type SeedJitter } from "@/lib/parliament";

const MAX_HEADS = 160;
/** Points of powder in the air at once. */
const MAX_DUST = 8000;
const POLL_SEC = 1;
/** How often the heads are drawn again while one is new, and otherwise (s). */
const DRAW_NEW_SEC = 0.1;
const DRAW_SEC = 1;
/**
 * A head that appears this close to the world's newest time (s) was just born. Visitors' times differ by the assignment
 * window, so its birth is when the wall first reads it, not its time in the log.
 */
const NEW_WITHIN_S = 180;

/** Points with a world size and a light of their own (round; PointsMaterial has one size for all). */
const POINT_VERT = /* glsl */ `
  attribute float psize;
  attribute float light;
  uniform float scale;
  varying float vLight;
  void main() {
    vLight = light;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, psize * scale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const POINT_FRAG = /* glsl */ `
  uniform float opacity;
  varying float vLight;
  void main() {
    if (length(gl_PointCoord - 0.5) > 0.5) discard;
    gl_FragColor = vec4(vec3(1.0), vLight * opacity);
  }
`;

function pointMaterial(scale: { value: number }, opts: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: POINT_VERT, fragmentShader: POINT_FRAG, uniforms: { scale, opacity: { value: 1 } }, fog: false, ...opts });
}

function lineGeomOf(maxVerts: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  g.setDrawRange(0, 0);
  return g;
}

function pointGeomOf(maxVerts: number): THREE.BufferGeometry {
  const g = lineGeomOf(maxVerts);
  g.setAttribute("psize", new THREE.BufferAttribute(new Float32Array(maxVerts), 1));
  g.setAttribute("light", new THREE.BufferAttribute(new Float32Array(maxVerts).fill(1), 1));
  return g;
}

export interface DandelionLook {
  /** A new head's world size. */
  size: number;
  /** World size of a seed on a new head. */
  dot: number;
  /** How bright the ghost through the masses is (0: none). */
  through: number;
  dustCount: number;
  dustReach: number;
  dustSec: number;
  /** World size of a grain. */
  dustDot: number;
  life: HeadLife;
  jitter: SeedJitter;
}

export function Dandelions({ log, secPerUnit, unit, look }: { log: EventLog; secPerUnit: number; unit: number; look: DandelionLook }) {
  const scale = useRef({ value: 1 });
  const lineGeom = useMemo(() => lineGeomOf(MAX_HEADS * (SEEDS_PER_HEAD + 1) * 2), []);
  const dotGeom = useMemo(() => pointGeomOf(MAX_HEADS * SEEDS_PER_HEAD), []);
  const dustGeom = useMemo(() => pointGeomOf(MAX_DUST), []);
  const dotMat = useMemo(() => pointMaterial(scale.current, {}), []);
  const dotGhostMat = useMemo(() => pointMaterial(scale.current, { transparent: true, depthTest: false, depthWrite: false }), []);
  const dustMat = useMemo(() => pointMaterial(scale.current, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), []);
  const poll = useRef(POLL_SEC);
  const sinceDraw = useRef(DRAW_SEC);
  const heads = useRef<Dandelion[]>([]);
  const latest = useRef(0);
  const seen = useRef(new Set<string>());
  const readOnce = useRef(false);
  const born = useRef(new Map<string, { d: Dandelion; ms: number }>());
  const dustDrawn = useRef(0);
  useEffect(
    () => () => {
      for (const g of [lineGeom, dotGeom, dustGeom]) g.dispose();
      for (const m of [dotMat, dotGhostMat, dustMat]) m.dispose();
    },
    [lineGeom, dotGeom, dustGeom, dotMat, dotGhostMat, dustMat],
  );
  dotGhostMat.uniforms.opacity.value = look.through;
  const heightOf = (s: number) => (s / secPerUnit) * unit;
  useFrame((state, dt) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    scale.current.value = state.gl.domElement.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const now = performance.now();
    poll.current += dt;
    sinceDraw.current += dt;
    if (poll.current >= POLL_SEC) {
      poll.current = 0;
      const events = log.all();
      heads.current = dandelionsIn(events);
      latest.current = heads.current.length ? latestS(events) : 0;
      for (const d of heads.current) {
        if (seen.current.has(d.id)) continue;
        seen.current.add(d.id);
        // the first reading of the log is what was already there
        if (readOnce.current && latest.current - d.s < NEW_WITHIN_S) born.current.set(d.id, { d, ms: now });
      }
      if (events.length > 0) readOnce.current = true;
    }
    // ── the heads ──
    if (sinceDraw.current >= (born.current.size > 0 ? DRAW_NEW_SEC : DRAW_SEC)) {
      sinceDraw.current = 0;
      const lines: number[] = [];
      const dots: number[] = [];
      const sizes: number[] = [];
      const all = heads.current;
      // the newest when there are too many
      for (let i = all.length - 1; i >= Math.max(0, all.length - MAX_HEADS); i--) {
        const d = all[i];
        const v = headVariation(d.id, look.jitter);
        const b = born.current.get(d.id);
        const dustSec = look.dustSec * v.dustSec;
        const sinceBorn = b ? (now - b.ms) / 1000 : null;
        if (b && sinceBorn! >= dustSec + look.life.settleSec) born.current.delete(d.id);
        const s = headScale(v, sinceBorn, (latest.current - d.s) / secPerUnit, dustSec, look.life);
        if (s <= 0) continue;
        dandelionShape(d.id, d.x, heightOf(d.s), d.z, { size: look.size * v.size * s, stem: v.stem, shape: look.jitter.shape, dot: look.dot * s, dotJitter: look.jitter.dot }, lines, dots, sizes);
      }
      const lp = lineGeom.getAttribute("position") as THREE.BufferAttribute;
      const dp = dotGeom.getAttribute("position") as THREE.BufferAttribute;
      const ds = dotGeom.getAttribute("psize") as THREE.BufferAttribute;
      (lp.array as Float32Array).set(lines);
      (dp.array as Float32Array).set(dots);
      (ds.array as Float32Array).set(sizes);
      lineGeom.setDrawRange(0, lines.length / 3);
      dotGeom.setDrawRange(0, dots.length / 3);
      lp.needsUpdate = true;
      dp.needsUpdate = true;
      ds.needsUpdate = true;
    }
    // ── the powder of the new ones ──
    if (born.current.size === 0 && dustDrawn.current === 0) return;
    const pos = dustGeom.getAttribute("position") as THREE.BufferAttribute;
    const light = dustGeom.getAttribute("light") as THREE.BufferAttribute;
    const psize = dustGeom.getAttribute("psize") as THREE.BufferAttribute;
    const out = { pos: pos.array as Float32Array, light: light.array as Float32Array, size: psize.array as Float32Array };
    let n = 0;
    for (const { d, ms } of born.current.values()) {
      const v = headVariation(d.id, look.jitter);
      const size = look.size * v.size;
      const reach = look.dustReach * v.dustReach;
      const scatter = {
        count: Math.round(look.dustCount * v.dustCount),
        reach,
        lifeSec: look.dustSec * v.dustSec,
        wind: 0.7,
        rise: reach * 0.12,
        waver: reach * 0.1,
        from: SPOKE * size,
        dot: look.dustDot,
        dotJitter: look.jitter.dot,
      };
      n = scatterPoints(d.id, (now - ms) / 1000, d.x, heightOf(d.s) + STEM * size * v.stem, d.z, scatter, out, n);
    }
    dustGeom.setDrawRange(0, n);
    pos.needsUpdate = true;
    light.needsUpdate = true;
    psize.needsUpdate = true;
    dustDrawn.current = n;
  });
  return (
    <>
      <lineSegments geometry={lineGeom} frustumCulled={false}>
        <lineBasicMaterial color="#ffffff" fog={false} toneMapped={false} />
      </lineSegments>
      <points geometry={dotGeom} material={dotMat} frustumCulled={false} />
      {look.through > 0 && (
        <>
          <lineSegments geometry={lineGeom} frustumCulled={false} renderOrder={5}>
            <lineBasicMaterial color="#ffffff" fog={false} toneMapped={false} transparent opacity={look.through} depthTest={false} depthWrite={false} />
          </lineSegments>
          <points geometry={dotGeom} material={dotGhostMat} frustumCulled={false} renderOrder={5} />
        </>
      )}
      <points geometry={dustGeom} material={dustMat} frustumCulled={false} renderOrder={6} />
    </>
  );
}

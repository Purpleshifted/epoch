"use client";
/**
 * Dandelions — what the answers left, on the wall (lib/parliament/dandelion.ts): at the height of its time a stem, spokes
 * and the seeds as points, and nothing with a surface. Where the masses cover one a faint ghost of it shows through them,
 * so one that stands inside a building is still there to see. A new one is large and throws a cloud of powder the wind
 * carries off, then it shrinks; where its layer fossilises some go and some stay. Leva 보기 › 응답의 홀씨.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { MAX_SPOKES, dandelionShape, dandelionsIn, headState, headVariation, latestS, scatterEndSec, scatterPoints, type Dandelion, type EventLog, type HeadLife, type Scatter, type SeedJitter } from "@/lib/parliament";

const MAX_HEADS = 160;
/** Points of powder in the air at once. */
const MAX_DUST = 8000;
/** Soon after the relay brings a head into the log (markerRelay.ts): its powder bursts when the visitor answers. */
const POLL_SEC = 0.25;
/** How often the heads are drawn again while one is new, and otherwise (s). */
const DRAW_NEW_SEC = 0.1;
const DRAW_SEC = 1;
/**
 * A head that appears this close to the world's newest time (s) was just born. Visitors' times differ by the assignment
 * window, so its birth is when the wall first reads it, not its time in the log.
 */
const NEW_WITHIN_S = 180;

/** Points with a world size and a light of their own (PointsMaterial has one size for all). */
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
/** `dim`: 1: the light darkens the colour (seeds); 0: it is the alpha (powder, additive). `soft`: how far in the edge fades. */
const POINT_FRAG = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  uniform float dim;
  uniform float soft;
  uniform float square;
  varying float vLight;
  void main() {
    float edge = 1.0;
    if (square < 0.5) {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      if (soft > 0.0) edge = 1.0 - smoothstep(1.0 - soft, 1.0, d);
    }
    gl_FragColor = vec4(color * mix(1.0, vLight, dim), mix(vLight, 1.0, dim) * opacity * edge);
  }
`;

function pointMaterial(scale: { value: number }, dim: number, opts: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    uniforms: { scale, color: { value: new THREE.Color("#ffffff") }, opacity: { value: 1 }, dim: { value: dim }, soft: { value: 0 }, square: { value: 0 } },
    fog: false,
    ...opts,
  });
}

function pointGeom(maxVerts: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  g.setAttribute("psize", new THREE.BufferAttribute(new Float32Array(maxVerts), 1));
  g.setAttribute("light", new THREE.BufferAttribute(new Float32Array(maxVerts).fill(1), 1));
  g.setDrawRange(0, 0);
  return g;
}

/** Lines with a width in pixels. Their buffers are written in place (setPositions would make new ones each time). */
function lineGeom(maxSegs: number): LineSegmentsGeometry {
  const g = new LineSegmentsGeometry();
  g.setPositions(new Float32Array(maxSegs * 6));
  g.setColors(new Float32Array(maxSegs * 6));
  g.instanceCount = 0;
  return g;
}

function writeInterleaved(g: LineSegmentsGeometry, attribute: string, values: number[]): void {
  if (values.length === 0) return;
  const buf = (g.getAttribute(attribute) as THREE.InterleavedBufferAttribute).data;
  (buf.array as Float32Array).set(values);
  buf.clearUpdateRanges();
  buf.addUpdateRange(0, values.length);
  buf.needsUpdate = true;
}

const noRaycast = () => {};

export interface DandelionLook {
  /** A new head's size (world), which the rest of it is measured by. */
  size: number;
  /** The stem's length and the ball's radius (× size), how many spokes, and where they gather (0: the whole ball … 1: the upper half). */
  stem: number;
  radius: number;
  spokes: number;
  dome: number;
  /** The lines: width (px), colour, brightness. */
  lineWidth: number;
  lineColor: string;
  lineLight: number;
  /** The seeds: world size on a new head, colour, brightness, shape. */
  dot: number;
  dotColor: string;
  dotLight: number;
  dotSquare: boolean;
  /** How bright the ghost through the masses is (0: none). */
  through: number;
  /** The powder (Scatter): count, reach (world), time (s). `rise` and `waver` are × reach, `from` × the ball's radius. */
  dustCount: number;
  dustReach: number;
  dustSec: number;
  dustFrom: number;
  dustWind: number;
  /** The wind's heading (degrees), and how much it differs per head (0: all the same way … 1: any way). */
  dustHeading: number;
  dustHeadingSpread: number;
  dustRise: number;
  dustWaver: number;
  dustBurst: number;
  dustEmit: number;
  dustFirst: number;
  dustLifeSpread: number;
  dustFade: number;
  /** A grain: world size, colour, brightness, how soft its edge is (0 … 1), shape. */
  dustDot: number;
  dustColor: string;
  dustLight: number;
  dustSoft: number;
  dustSquare: boolean;
  life: HeadLife;
  jitter: SeedJitter;
}

export function Dandelions({ log, secPerUnit, unit, look }: { log: EventLog; secPerUnit: number; unit: number; look: DandelionLook }) {
  const scale = useRef({ value: 1 });
  const parts = useMemo(() => {
    const lines = lineGeom(MAX_HEADS * (MAX_SPOKES + 1));
    const dots = pointGeom(MAX_HEADS * MAX_SPOKES);
    const dust = pointGeom(MAX_DUST);
    const lineMat = new LineMaterial({ vertexColors: true, toneMapped: false });
    const ghostLineMat = new LineMaterial({ vertexColors: true, toneMapped: false, transparent: true, depthTest: false, depthWrite: false });
    const dotMat = pointMaterial(scale.current, 1, {});
    const ghostDotMat = pointMaterial(scale.current, 1, { transparent: true, depthTest: false, depthWrite: false });
    const dustMat = pointMaterial(scale.current, 0, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new LineSegments2(lines, lineMat);
    const ghostLine = new LineSegments2(lines, ghostLineMat);
    const dot = new THREE.Points(dots, dotMat);
    const ghostDot = new THREE.Points(dots, ghostDotMat);
    const grains = new THREE.Points(dust, dustMat);
    ghostLine.renderOrder = ghostDot.renderOrder = 5;
    grains.renderOrder = 6;
    for (const o of [line, ghostLine, dot, ghostDot, grains]) {
      o.frustumCulled = false;
      // the wall's click focus looks for what it hits in the whole scene
      o.raycast = noRaycast;
    }
    return { lines, dots, dust, lineMat, ghostLineMat, dotMat, ghostDotMat, dustMat, line, ghostLine, dot, ghostDot, grains };
  }, []);
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
      const { lines, dots, dust, lineMat, ghostLineMat, dotMat, ghostDotMat, dustMat } = parts;
      for (const g of [lines, dots, dust]) g.dispose();
      for (const m of [lineMat, ghostLineMat, dotMat, ghostDotMat, dustMat]) m.dispose();
    },
    [parts],
  );
  const heightOf = (s: number) => (s / secPerUnit) * unit;
  useFrame((state, dt) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    scale.current.value = state.gl.domElement.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const { lines, dots, dust, lineMat, ghostLineMat, dotMat, ghostDotMat, dustMat, ghostLine, ghostDot } = parts;
    // the knobs that need no redrawing
    lineMat.linewidth = ghostLineMat.linewidth = look.lineWidth;
    lineMat.color.set(look.lineColor).multiplyScalar(look.lineLight);
    ghostLineMat.color.copy(lineMat.color);
    ghostLineMat.opacity = look.through;
    ghostLine.visible = ghostDot.visible = look.through > 0;
    (dotMat.uniforms.color.value as THREE.Color).set(look.dotColor).multiplyScalar(look.dotLight);
    (ghostDotMat.uniforms.color.value as THREE.Color).copy(dotMat.uniforms.color.value);
    ghostDotMat.uniforms.opacity.value = look.through;
    dotMat.uniforms.square.value = ghostDotMat.uniforms.square.value = look.dotSquare ? 1 : 0;
    (dustMat.uniforms.color.value as THREE.Color).set(look.dustColor);
    dustMat.uniforms.opacity.value = look.dustLight;
    dustMat.uniforms.soft.value = look.dustSoft;
    dustMat.uniforms.square.value = look.dustSquare ? 1 : 0;

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
      const segs: number[] = [];
      const pts: number[] = [];
      const sizes: number[] = [];
      const segLight: number[] = [];
      const ptLight: number[] = [];
      const all = heads.current;
      // the newest when there are too many
      for (let i = all.length - 1; i >= Math.max(0, all.length - MAX_HEADS); i--) {
        const d = all[i];
        const v = headVariation(d.id, look.jitter);
        const b = born.current.get(d.id);
        const dustEnd = scatterEndSec({ lifeSec: look.dustSec * v.dustSec, emit: look.dustEmit });
        const sinceBorn = b ? (now - b.ms) / 1000 : null;
        if (b && sinceBorn! >= dustEnd + look.life.settleSec) born.current.delete(d.id);
        const h = headState(v, sinceBorn, (latest.current - d.s) / secPerUnit, dustEnd, look.life);
        if (h.scale <= 0) continue;
        const size = look.size * v.size * h.scale;
        const segsBefore = segs.length;
        const ptsBefore = pts.length;
        dandelionShape(
          d.id,
          d.x,
          heightOf(d.s),
          d.z,
          { stem: look.stem * size * v.stem, radius: look.radius * size, spokes: look.spokes * v.spokes, keepSpokes: h.spokes, dome: look.dome, shape: look.jitter.shape, dot: look.dot * h.scale, dotJitter: look.jitter.dot },
          segs,
          pts,
          sizes,
        );
        const light = h.light * v.light;
        for (let k = segsBefore; k < segs.length; k++) segLight.push(light);
        for (let k = ptsBefore; k < pts.length; k += 3) ptLight.push(light);
      }
      writeInterleaved(lines, "instanceStart", segs);
      writeInterleaved(lines, "instanceColorStart", segLight);
      lines.instanceCount = segs.length / 6;
      const dp = dots.getAttribute("position") as THREE.BufferAttribute;
      const ds = dots.getAttribute("psize") as THREE.BufferAttribute;
      const dl = dots.getAttribute("light") as THREE.BufferAttribute;
      (dp.array as Float32Array).set(pts);
      (ds.array as Float32Array).set(sizes);
      (dl.array as Float32Array).set(ptLight);
      dots.setDrawRange(0, pts.length / 3);
      dp.needsUpdate = ds.needsUpdate = dl.needsUpdate = true;
    }
    // ── the powder of the new ones ──
    if (born.current.size === 0 && dustDrawn.current === 0) return;
    const pos = dust.getAttribute("position") as THREE.BufferAttribute;
    const light = dust.getAttribute("light") as THREE.BufferAttribute;
    const psize = dust.getAttribute("psize") as THREE.BufferAttribute;
    const out = { pos: pos.array as Float32Array, light: light.array as Float32Array, size: psize.array as Float32Array };
    let n = 0;
    for (const { d, ms } of born.current.values()) {
      const v = headVariation(d.id, look.jitter);
      const size = look.size * v.size;
      const reach = look.dustReach * v.dustReach;
      const scatter: Scatter = {
        count: Math.round(look.dustCount * v.dustCount),
        reach,
        lifeSec: look.dustSec * v.dustSec,
        wind: look.dustWind,
        rise: reach * look.dustRise,
        waver: reach * look.dustWaver,
        from: look.radius * size * look.dustFrom,
        heading: (look.dustHeading * Math.PI) / 180,
        headingSpread: look.dustHeadingSpread,
        burst: look.dustBurst,
        emit: look.dustEmit,
        first: look.dustFirst,
        lifeSpread: look.dustLifeSpread,
        fade: look.dustFade,
        dot: look.dustDot,
        dotJitter: look.jitter.dot,
      };
      n = scatterPoints(d.id, (now - ms) / 1000, d.x, heightOf(d.s) + look.stem * size * v.stem, d.z, scatter, out, n);
    }
    dust.setDrawRange(0, n);
    pos.needsUpdate = light.needsUpdate = psize.needsUpdate = true;
    dustDrawn.current = n;
  });
  return (
    <>
      <primitive object={parts.line} />
      <primitive object={parts.dot} />
      <primitive object={parts.ghostLine} />
      <primitive object={parts.ghostDot} />
      <primitive object={parts.grains} />
    </>
  );
}

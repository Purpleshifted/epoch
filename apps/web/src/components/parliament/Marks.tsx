"use client";
/**
 * Marks — what stands in the player's frame besides the grass (lib/parliament/marks.ts; the artist's direction,
 * 2026-10-28; Leva 개인뷰 비주얼 › 표식). Each thing has a shape of its own, tall enough to fill the view; greys only
 * (human traces). The lists are renewed with the fold (RoleField, 0.5 s); the heights that follow the eye are set
 * every frame from the camera.
 *   OtherDots      a glowing point (core + halo, additive) on the ground for every being within the view; or, in the
 *                  brutal version, a hard white square blinking the being's own rhythm, like the visitor's own, with
 *                  its name over it (the wall's own pattern), which rises and hops on its melody when it speaks. Who
 *                  speaks is the only one left bright, marked at its corners, its name larger, and its notes come to
 *                  the visitor along one thin line
 *   ConcreteLines  a vertical line from the ground up through the frame on every sealed slab cell
 *   ConcreteOutline a brutal version: the building as a line drawing, its edges and the joints between its cells
 *   AnswerBurst    the answer: a burst of hard white points, gone in a moment
 * (the paths as floating curves / ribbons were dropped by the artist on 2026-10-28; they stay on the ground)
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "@/lib/stratum/field";
import { GLYPH_COLS, GLYPH_ROWS, glyphOf, hash2, outlineSegments, rhythmOf, scatterPoints, stepAt, type ConcreteLine, type GlyphDot, type OtherMark } from "@/lib/parliament";

export interface MarksData {
  others: OtherMark[];
  concrete: ConcreteLine[];
}

/** What the names follow: who speaks, where the music is, and the arrival's bars (RoleField). */
export interface NameVoice {
  asker: string | null;
  step: number;
  into: number;
  /** The arrival's bar now: which, and how far through it (0 … 1). */
  arrival: { phase: "dominant" | "tonic"; t: number } | null;
  /** Who stands with me when it comes. */
  near: ReadonlySet<string>;
}

export interface NameLook {
  cell: number;
  rest: number;
  rise: number;
  hop: number;
}

/**
 * Who speaks to me (the artist, 2026-11-10: it must be plain WHO, and stay minimal; a fan of wave fronts read as being
 * hit by a beam). Nothing is added to the one who speaks but four corner marks and a larger name; everyone else goes dark.
 */
export interface CallLook {
  /** The others' brightness while someone speaks (× their own). */
  dim: number;
  /** Corner marks round the one who speaks. */
  frame: boolean;
  /** One thin line from them to me, their notes coming along it as they sound. */
  line: boolean;
  /** Their name, this many times its size. */
  big: number;
}

/** Steps (0.25 s) a note takes along the line from them to me. */
const CALL_STEPS = 8;
const CALL_LINE_SHADE = 0.22;
const MAX_CALL_VERTS = (8 + 1 + GLYPH_COLS * 2) * 2;

const NAME_VERTEX = /* glsl */ `
uniform vec2 px;
uniform float cell;
uniform float ratio;
attribute vec2 offset;
attribute float shade;
attribute float lift;
attribute float end;
attribute float big;
varying float vShade;
varying float vEnd;
varying float vBig;
void main() {
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  p.xy += (offset * cell * big + vec2(0.0, 4.5 * cell * big + lift * ratio)) * px * p.w;
  gl_Position = p;
  gl_PointSize = cell * big;
  vShade = shade;
  vEnd = end;
  vBig = big;
}
`;

const NAME_FRAGMENT = /* glsl */ `
uniform float gap;
varying float vShade;
varying float vEnd;
varying float vBig;
void main() {
  float g = gap / vBig;
  if (gl_PointCoord.y > 1.0 - g || (vEnd > 0.5 && gl_PointCoord.x > 1.0 - g)) discard;
  gl_FragColor = vec4(vec3(vShade), 1.0);
  #include <colorspace_fragment>
}
`;

/** How far over the square (× its size, world) a name's anchor stands. */
const NAME_ABOVE = 0.6;
const NAME_RISE_MS = 300;
/** A note's hop: up at once, back down over this many steps. */
const HOP_STEPS = 1.6;
const hopAt = (d: number) => (d < HOP_STEPS ? (1 - d / HOP_STEPS) ** 2 : 0);

const MAX_OTHERS = 128;
const MAX_CONCRETE = 6000;
const MAX_OUTLINE_SEGS = 24000;
const MAX_BURST = 400;
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
  names = null,
  call = null,
  getVoice,
  getMe,
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
  /** The brutal version: the names over the squares (null = none). */
  names?: NameLook | null;
  /** The brutal version: how the one who speaks to me is told from the others (null = not at all). */
  call?: CallLook | null;
  getVoice?: () => NameVoice | null;
  /** Where I stand, in the frame the others are placed in. */
  getMe?: () => { x: number; z: number };
}) {
  const lastStep = useRef(-1);
  const group = useRef<THREE.Group>(null);
  const coreMat = useRef<THREE.PointsMaterial>(null);
  const haloMat = useRef<THREE.PointsMaterial>(null);
  const tex = useMemo(() => glowTexture(), []);
  const geom = useMemo(() => lineGeom(MAX_OTHERS), []);
  const haloGeom = useMemo(() => lineGeom(MAX_OTHERS), []);
  const nameGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = MAX_OTHERS * GLYPH_COLS;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("offset", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute("shade", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("lift", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("end", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("big", new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const callGeom = useMemo(() => lineGeom(MAX_CALL_VERTS), []);
  const callShown = useRef(0);
  const right = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(), []);
  const nameMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: NAME_VERTEX,
        fragmentShader: NAME_FRAGMENT,
        uniforms: { px: { value: new THREE.Vector2(0.001, 0.001) }, cell: { value: 3 }, ratio: { value: 1 }, gap: { value: 0 } },
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  /** Where each name's cells are in `nameGeom`. */
  const nameAt = useRef<{ id: string; from: number; dots: readonly GlyphDot[] }[]>([]);
  const nameMoving = useRef(false);
  const asked = useRef<{ who: string | null; at: number }>({ who: null, at: 0 });
  const buffer = useMemo(() => new THREE.Vector2(), []);
  const timer = useRef(10);
  /** Each being's held place: where its light stands and when it may next move (frame-clock seconds). */
  const held = useRef(new Map<string, { x: number; z: number; next: number; bright: number; moving: boolean; seen: number }>());
  useEffect(
    () => () => {
      geom.dispose();
      haloGeom.dispose();
      nameGeom.dispose();
      callGeom.dispose();
      nameMat.dispose();
      tex.dispose();
    },
    [geom, haloGeom, nameGeom, callGeom, nameMat, tex],
  );
  /** A square's grey: its own rhythm, and dark while someone else is the one speaking. */
  const squareShade = (id: string, step: number, who: string | null) => (rhythmOf(id)[step] ? 1 : SQUARE_REST) * (who !== null && id !== who ? (call?.dim ?? 1) : 1);
  const speakerNow = (): string | null => {
    const who = call ? (getVoice?.()?.asker ?? null) : null;
    return who !== null && held.current.has(who) ? who : null;
  };
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
        const who = speakerNow();
        for (const id of held.current.keys()) {
          if (i >= MAX_OTHERS) break;
          C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = squareShade(id, step, who);
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
    const speaker = speakerNow();
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
        C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = square ? squareShade(id, step, speaker) : gain * bright * (0.35 + 0.65 * h.bright);
      }
      g.setDrawRange(0, n);
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
    if (!names || !square) return;
    // the names stand where the squares do; `end` marks the last cell of each note, so that the notes stay apart
    const attr = (k: string) => nameGeom.getAttribute(k) as THREE.BufferAttribute;
    const P = attr("position").array as Float32Array, O = attr("offset").array as Float32Array, S = attr("shade").array as Float32Array, L = attr("lift").array as Float32Array, E = attr("end").array as Float32Array, B = attr("big").array as Float32Array;
    const at = nameAt.current;
    at.length = 0;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const [id, h] = shown[i];
      const dots = glyphOf(id);
      at.push({ id, from: v, dots });
      for (const d of dots) {
        for (let k = 0; k < d.len; k++) {
          P[v * 3] = h.x;
          P[v * 3 + 1] = size * NAME_ABOVE;
          P[v * 3 + 2] = h.z;
          O[v * 2] = d.col + k - (GLYPH_COLS - 1) / 2;
          O[v * 2 + 1] = (GLYPH_ROWS - 1) / 2 - d.row;
          S[v] = names.rest;
          L[v] = 0;
          B[v] = 1;
          E[v] = k === d.len - 1 ? 1 : 0;
          v++;
        }
      }
    }
    nameGeom.setDrawRange(0, v);
    for (const k of ["position", "offset", "shade", "lift", "end", "big"]) attr(k).needsUpdate = true;
    nameMoving.current = true; // a speaker's name is drawn again in this frame, below
  });
  // the names: still, until someone speaks. Who asks rises and hops on their melody, its sounding note lit, the others
  // dimmed; when a house is born those with me rise through the leaning bar and jump together on the beats of the next
  useFrame((state) => {
    if (!names || !square) return;
    state.gl.getDrawingBufferSize(buffer);
    const ratio = state.gl.getPixelRatio();
    const cell = names.cell * ratio;
    const u = nameMat.uniforms;
    u.px.value.set(2 / buffer.x, 2 / buffer.y);
    u.cell.value = cell;
    u.ratio.value = ratio;
    u.gap.value = cell > 2 ? 1 / cell : 0;
    const voice = getVoice?.() ?? null;
    const now = performance.now();
    const who = voice?.asker ?? null;
    if (who !== asked.current.who) asked.current = { who, at: now };
    const speaking = who !== null && held.current.has(who);
    const active = speaking || !!voice?.arrival;
    if (!active && !nameMoving.current) return;
    nameMoving.current = active;
    const shade = nameGeom.getAttribute("shade") as THREE.BufferAttribute;
    const lift = nameGeom.getAttribute("lift") as THREE.BufferAttribute;
    const size2 = nameGeom.getAttribute("big") as THREE.BufferAttribute;
    const S = shade.array as Float32Array, L = lift.array as Float32Array, Z = size2.array as Float32Array;
    const rose = 1 - (1 - Math.min(1, (now - asked.current.at) / NAME_RISE_MS)) ** 2;
    for (const { id, from, dots } of nameAt.current) {
      const together = !!voice?.arrival && voice.near.has(id);
      const speaks = speaking && id === who;
      let y = 0;
      if (together && voice?.arrival) y = voice.arrival.phase === "dominant" ? names.rise * voice.arrival.t : names.rise + names.hop * hopAt((voice.step % 2) + voice.into);
      else if (speaks && voice) {
        const note = dots.find((d) => voice.step >= d.col && voice.step < d.col + d.len);
        y = rose * names.rise + (note ? names.hop * hopAt(voice.step - note.col + voice.into) : 0);
      }
      const dim = speaking && !speaks && !together ? (call?.dim ?? 0.5) : 1;
      const z = speaks ? 1 + ((call?.big ?? 1) - 1) * rose : 1;
      let v = from;
      for (const d of dots) {
        const lit = speaks && !!voice && voice.step >= d.col && voice.step < d.col + d.len;
        for (let k = 0; k < d.len; k++) {
          S[v] = together || lit ? 1 : speaks ? Math.min(1, names.rest * 1.5) : names.rest * dim;
          L[v] = y;
          Z[v] = z;
          v++;
        }
      }
    }
    shade.needsUpdate = true;
    lift.needsUpdate = true;
    size2.needsUpdate = true;
  });
  // who speaks: four corner marks round their square (facing the eye), and one thin line from them to me along which
  // each note of their melody comes as it sounds, a short bright stroke. Nothing else is drawn
  useFrame((state) => {
    if (!square) return;
    const who = speakerNow();
    const from = who ? held.current.get(who) : undefined;
    const voice = getVoice?.() ?? null;
    const me = getMe?.();
    let v = 0;
    if (call && who && from && voice) {
      const P = (callGeom.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
      const C = (callGeom.getAttribute("color") as THREE.BufferAttribute).array as Float32Array;
      const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, shade: number) => {
        if (v + 2 > MAX_CALL_VERTS) return;
        P.set([ax, ay, az, bx, by, bz], v * 3);
        C.fill(shade, v * 3, v * 3 + 6);
        v += 2;
      };
      // a square's point is drawn about half its `size` wide (the point's size is cut by the lens): the marks stand clear of it
      const half = size * 0.5;
      if (call.frame) {
        right.setFromMatrixColumn(state.camera.matrixWorld, 0);
        up.setFromMatrixColumn(state.camera.matrixWorld, 1);
        const arm = half * 0.45;
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            const cx = from.x + (right.x * sx + up.x * sy) * half, cy = (right.y * sx + up.y * sy) * half, cz = from.z + (right.z * sx + up.z * sy) * half;
            seg(cx, cy, cz, cx - right.x * sx * arm, cy - right.y * sx * arm, cz - right.z * sx * arm, 1);
            seg(cx, cy, cz, cx - up.x * sy * arm, cy - up.y * sy * arm, cz - up.z * sy * arm, 1);
          }
        }
      }
      const dx = me ? me.x - from.x : 0, dz = me ? me.z - from.z : 0;
      const dist = Math.hypot(dx, dz);
      if (call.line && me && dist > half * 2) {
        const ux = dx / dist, uz = dz / dist;
        const a = half * 1.2, len = dist - a;
        seg(from.x + ux * a, 0, from.z + uz * a, me.x, 0, me.z, CALL_LINE_SHADE);
        const at = voice.step + voice.into;
        for (const d of glyphOf(who)) {
          // a note leaves them when it sounds and is with me CALL_STEPS later; as long as it is held
          const head = ((at - d.col + GLYPH_COLS) % GLYPH_COLS) / CALL_STEPS;
          const tail = Math.max(0, head - (d.len * 0.7) / CALL_STEPS);
          if (head <= 0 || head > 1) continue;
          seg(from.x + ux * (a + len * tail), 0, from.z + uz * (a + len * tail), from.x + ux * (a + len * head), 0, from.z + uz * (a + len * head), 1);
        }
      }
    }
    if (v === 0 && callShown.current === 0) return;
    callShown.current = v;
    callGeom.setDrawRange(0, v);
    callGeom.getAttribute("position").needsUpdate = true;
    callGeom.getAttribute("color").needsUpdate = true;
  });
  if (square) {
    return (
      <group ref={group}>
        <points geometry={geom} frustumCulled={false} renderOrder={10}>
          <pointsMaterial key="square" ref={coreMat} size={size} sizeAttenuation vertexColors fog={false} depthTest={false} />
        </points>
        {names && <points geometry={nameGeom} material={nameMat} frustumCulled={false} renderOrder={11} />}
        {call && (
          <lineSegments geometry={callGeom} frustumCulled={false} renderOrder={9}>
            <lineBasicMaterial vertexColors fog={false} depthTest={false} toneMapped={false} />
          </lineSegments>
        )}
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
export function ConcreteOutline({ getMarks, scale = 1, getHeave }: { getMarks: () => MarksData | null; scale?: number; getHeave?: () => number }) {
  const geom = useMemo(() => lineGeom(MAX_OUTLINE_SEGS * 2), []);
  const lines = useRef<THREE.LineSegments>(null);
  const timer = useRef(10);
  useEffect(() => () => geom.dispose(), [geom]);
  useFrame((_, dt) => {
    if (lines.current) lines.current.scale.y = 1 + (getHeave?.() ?? 0);
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
    <lineSegments ref={lines} geometry={geom} frustumCulled={false}>
      <lineBasicMaterial vertexColors fog={false} />
    </lineSegments>
  );
}

/** One answer's burst: where it went off, and when (performance.now()). */
export interface BurstAt {
  id: string;
  x: number;
  y: number;
  z: number;
  atMs: number;
}

/**
 * The answer in the player's frame (the artist, 2026-11-01): hard white square points thrown from where the visitor stands,
 * each simply gone at a time of its own. Nothing stays; what stays is on the wall (Dandelions).
 */
export function AnswerBurst({ getBurst, count, reach, lifeSec, dot }: { getBurst: () => BurstAt | null; count: number; reach: number; lifeSec: number; dot: number }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_BURST * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const shown = useRef(0);
  useEffect(() => () => geom.dispose(), [geom]);
  useFrame(() => {
    const b = getBurst();
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    const n = b ? scatterPoints(b.id, (performance.now() - b.atMs) / 1000, b.x, b.y, b.z, { count, reach, lifeSec, wind: 0, rise: reach * 0.1, waver: 0, from: 0 }, { pos: pos.array as Float32Array }) : 0;
    if (n === 0 && shown.current === 0) return;
    shown.current = n;
    geom.setDrawRange(0, n);
    pos.needsUpdate = true;
  });
  return (
    <points geometry={geom} frustumCulled={false} renderOrder={5}>
      <pointsMaterial color="#ffffff" size={dot} sizeAttenuation fog={false} depthTest={false} toneMapped={false} />
    </points>
  );
}

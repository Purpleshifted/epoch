"use client";
/**
 * PointLod — FAR POINTS CLUMP ON THE WALL (the artist, 2026-11-28: "글로벌 보편에서 먼 점은 뭉쳐보이는 lod 추가해서 레바로
 * 조절할 수 있게 하고, 그게 히어로샷에도 반영되어 그려지도록").
 *
 * The phone's rule for its far readings (FutureResidue, LidarScan): past `start` (world, from the eye) a point is drawn
 * g = (d / start)^strength times larger (at most `max`) and kept with the chance 1 / g² — the area a cloud covers stays,
 * the points drawn fall as 1 / g², so far off there are fewer, larger, merged points, and fewer pixels to fill.
 *
 * Applied to every point cloud of the wall's scene that has a size in the world: a PointsMaterial with size attenuation,
 * or a point shader of its own (a ShaderMaterial on a Points that writes gl_PointSize). That is, as of 2026-11-28:
 *   - the present's plants: Vegetation's clouds (ParliamentSpace VEG shader), the gathered plants (cloudPointsMaterial)
 *     and the other fading points (fadingPointsMaterial);
 *   - the future layer's: FutureVillage's plants, FutureUnder's plants and their glow, trees, grass, scrub, stones, wild
 *     forest, deposits, water belt, footprints, clumps;
 *   - Dandelions (seed heads, ghosts, dust).
 * Left as they are: points with a size on the screen (no size attenuation — the walkways' end dots), and any Points
 * whose userData.noPointLod is true.
 *
 * How: a few lines at the end of each one's vertex shader (its own onBeforeCompile kept, run first), found by walking the
 * scene once a second; a material its component replaces, or whose hook React sets again, is patched again then. The
 * distance is the eye's depth (gl_Position.w): the hero shot draws with the same camera, only zoomed, so a still at any
 * size clumps as the screen does. The same patch keeps the screen's one-pixel floor in a hero shot (setPointMinPx).
 */

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three";
import { savable } from "./levaSave";

const GROUP = "먼 점 뭉치기 (LOD)";

/** Shared by every patched shader: switch, start distance (world), strength, the most a point grows (×). */
const pointLodU = { uPlodOn: { value: 0 }, uPlodStart: { value: 180 }, uPlodPow: { value: 1 }, uPlodMax: { value: 3 }, uPlodMinPx: { value: 1 } };

/**
 * THE SCREEN'S ONE-PIXEL FLOOR, KEPT IN A LARGER STILL (the artist, 2026-11-28, of a hero shot: "이것봐, 히어로샷에서 식생 진짜
 * 안 보여"). A GPU draws no point smaller than a pixel: on the screen the present's finest plant dots (a hundredth of a
 * world wide) come out under one, are drawn one screen pixel wide, and read as greenery. A hero shot draws the same
 * frame with `px` times as many pixels, so the same floor is 1/px of a screen pixel there and the dots all but vanish.
 * While a shot is saved (HeroShot HeroCapture) every patched point is at least `px` pixels — the screen's look, larger.
 */
export function setPointMinPx(px: number): void {
  pointLodU.uPlodMinPx.value = Number.isFinite(px) ? Math.max(1, px) : 1;
}

const HEAD = "uniform float uPlodOn, uPlodStart, uPlodPow, uPlodMax, uPlodMinPx;\n";
const TAIL = `
  // FAR POINTS CLUMP (PointLod.tsx): past uPlodStart a point grows g times and is kept with the chance 1 / g^2
  if ( uPlodOn > 0.5 && gl_Position.w > uPlodStart ) {
    float plodG = min( uPlodMax, pow( gl_Position.w / uPlodStart, uPlodPow ) );
    uint plodH = uint( gl_VertexID ) * 747796405u + 2891336453u;
    plodH = ( ( plodH >> ( ( plodH >> 28u ) + 4u ) ) ^ plodH ) * 277803737u;
    plodH = ( plodH >> 22u ) ^ plodH;
    if ( float( plodH ) * ( 1.0 / 4294967296.0 ) * plodG * plodG > 1.0 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    else gl_PointSize *= plodG;
  }
  // (the screen's one-pixel floor, in a hero shot's larger pixels — setPointMinPx)
  gl_PointSize = max( gl_PointSize, uPlodMinPx );
`;

type Compile = THREE.Material["onBeforeCompile"];
type Shader = Parameters<Compile>[0];

function lodShader(shader: Shader): void {
  const vs = shader.vertexShader;
  const end = vs.lastIndexOf("}");
  if (end < 0 || !vs.includes("gl_PointSize")) return;
  Object.assign(shader.uniforms, pointLodU);
  shader.vertexShader = HEAD + vs.slice(0, end) + TAIL + vs.slice(end);
}

/** What was put on a material — to know when its component has put its own hook or key back (React sets the props
 *  again on a render), and what to build on then: its own key (null: the default, which is the hook's text). */
interface Rec {
  compile: Compile;
  key: () => string;
  base: (() => string) | null;
  prevText: string;
}
const patched = new WeakMap<THREE.Material, Rec>();

function wanted(m: THREE.Material): boolean {
  if ((m as THREE.PointsMaterial).isPointsMaterial) return (m as THREE.PointsMaterial).sizeAttenuation;
  return !!(m as THREE.ShaderMaterial).isShaderMaterial && /gl_PointSize/.test((m as THREE.ShaderMaterial).vertexShader);
}

/** Patches `m` (again, if its hook or key was set back); true when its shader must be built anew. */
function ensure(m: THREE.Material): boolean {
  const had = patched.get(m);
  const hookLost = !had || m.onBeforeCompile !== had.compile;
  const keyLost = !had || m.customProgramCacheKey !== had.key;
  if (!hookLost && !keyLost) return false;
  let compile = had?.compile;
  let prevText = had?.prevText ?? "";
  if (hookLost || !compile) {
    const prev = m.onBeforeCompile;
    prevText = prev.toString();
    compile = function (this: THREE.Material, shader, renderer) {
      prev.call(this, shader, renderer);
      lodShader(shader);
    };
    m.onBeforeCompile = compile;
  }
  // (its program is told apart from the same material unpatched: its own key + "|plod", or — the default key being the
  // hook's text, which is now this wrapper's for all — the text of the hook it had)
  let base = had?.base ?? null;
  if (keyLost) {
    const cur = m.customProgramCacheKey;
    base = cur !== THREE.Material.prototype.customProgramCacheKey ? cur : null;
  }
  const b = base, t = prevText;
  const key = b ? () => `${b.call(m)}|plod` : () => `${t}|plod`;
  m.customProgramCacheKey = key;
  patched.set(m, { compile, key, base, prevText });
  if (hookLost) m.needsUpdate = true;
  return hookLost;
}

export function PointLod() {
  const k = useControls(
    GROUP,
    savable(GROUP, {
      on: { value: true, label: "켜기 (멀리 있는 점은 성기고 크게 — 덮는 면적은 그대로, 그리는 점은 적게)" },
      start: { value: 180, min: 20, max: 600, step: 5, label: "시작 거리 (눈에서 · 월드)" },
      strength: { value: 1, min: 0, max: 3, step: 0.05, label: "세기 (1 = 거리에 비례해 커지고 그 제곱만큼 성겨짐)" },
      max: { value: 3, min: 1, max: 6, step: 0.1, label: "최대 커짐 (×)" },
    }),
    { collapsed: true },
  );
  const scene = useThree((s) => s.scene);
  const last = useRef(-Infinity);
  useFrame(() => {
    pointLodU.uPlodOn.value = k.on ? 1 : 0;
    pointLodU.uPlodStart.value = Math.max(1, k.start);
    pointLodU.uPlodPow.value = Math.max(0, k.strength);
    pointLodU.uPlodMax.value = Math.max(1, k.max);
    const now = performance.now();
    if (now - last.current < 1000) return;
    last.current = now;
    let n = 0, fresh = 0;
    scene.traverse((o) => {
      if (!(o as THREE.Points).isPoints || o.userData.noPointLod) return;
      const m = (o as THREE.Points).material;
      if (Array.isArray(m) || !wanted(m)) return;
      n++;
      if (ensure(m)) fresh++;
    });
    (window as unknown as { __pointLod?: unknown }).__pointLod = { on: k.on, materials: n, patchedNow: fresh };
  });
  return null;
}

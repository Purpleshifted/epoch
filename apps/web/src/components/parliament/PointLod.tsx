"use client";
/**
 * PointLod — FAR POINTS CLUMP ON THE WALL (the artist, 2026-11-28: "글로벌 보편에서 먼 점은 뭉쳐보이는 lod 추가해서 레바로
 * 조절할 수 있게 하고, 그게 히어로샷에도 반영되어 그려지도록").
 *
 * The phone's rule for its far readings (FutureResidue, LidarScan): past `start` (world, from the eye) a point is drawn
 * g = (d / start)^strength times larger (at most `max`) and kept with the chance 1 / g² — the area a cloud covers stays,
 * the points drawn fall as 1 / g², so far off there are fewer, larger, merged points, and fewer pixels to fill. And they
 * GATHER (뭉침, 덩어리 크기 — "유기적으로 뭉쳐보이진 않음 그냥 점이 커지고 줄어들었다 정도"): toward the centres of a jittered
 * lattice fixed in the world, into irregular clumps with lumpy, soft-rimmed outlines (GATHER below).
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
 * size clumps as the screen does. The same patch draws the finest points of a hero shot at the still's own fineness
 * (startPointShot).
 */

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three";
import { savable } from "./levaSave";

const GROUP = "먼 점 뭉치기 (LOD)";

/** Shared by every patched shader: switch, start distance (world), strength, the most a point grows (×). */
const pointLodU = { uPlodOn: { value: 0 }, uPlodStart: { value: 180 }, uPlodPow: { value: 1 }, uPlodMax: { value: 3 }, uPlodGather: { value: 0.5 }, uPlodCell: { value: 4 }, uPlodShot: { value: 1 }, uPlodView: { value: new THREE.Vector2(1, 1) } };

/**
 * A HERO SHOT'S FINER PIXELS (the artist, 2026-11-28, of a hero shot: "이것봐, 히어로샷에서 식생 진짜 안 보여", then, of a
 * first fix that held every point to two of the still's pixels: "그냥 *2만 하니깐 화질이 너무 떨어짐"). A GPU draws no point
 * smaller than a pixel: on the screen the present's finest plant dots (a hundredth of a world wide) come out under one,
 * are drawn one screen pixel wide, and read as greenery. A still of the same frame has `r` times the pixels each way, so
 * the same floor covers 1/r² of what it did and the dots all but vanish; one square r pixels wide (the first fix) is the
 * same green, but coarse. So in a still a point stays at its own size and is drawn in several COPIES, scattered over
 * about the width the screen's pixel had, as many as it takes to cover what that pixel covered (r² for the finest, one
 * for a point already r wide): the same green, at the still's own fineness. Copy 0 is the point itself.
 *
 * startPointShot (HeroShot HeroCapture, once the shot's size is applied) makes the copies — each patched Points of the
 * scene gets children sharing its geometry and its program, each with its copy's number — and gives the function that
 * takes them away; pointShotView tells the shaders the still's size in pixels.
 */
const copyUs = new WeakMap<THREE.Material, { value: number }>();
const copyU = (m: THREE.Material): { value: number } => {
  let u = copyUs.get(m);
  if (!u) copyUs.set(m, (u = { value: 0 }));
  return u;
};

export function pointShotView(w: number, h: number): void {
  pointLodU.uPlodView.value.set(Math.max(1, w), Math.max(1, h));
}

export function startPointShot(scene: THREE.Object3D, r: number): () => void {
  const R = Number.isFinite(r) ? Math.max(1, r) : 1;
  pointLodU.uPlodShot.value = R;
  // (how many copies the finest point takes: r², at most 16)
  const n = Math.min(16, Math.ceil(R * R - 1e-3));
  const made: { p: THREE.Points; m: THREE.Material }[] = [];
  if (n > 1) {
    const hosts: THREE.Points[] = [];
    scene.traverse((o) => {
      const pts = o as THREE.Points;
      if (!pts.isPoints || pts.userData.plodCopy || Array.isArray(pts.material) || !patched.has(pts.material)) return;
      hosts.push(pts);
    });
    for (const pts of hosts) {
      const m = pts.material as THREE.Material;
      for (let c = 1; c < n; c++) {
        const cm = m.clone();
        // (a point shader of its own keeps its live uniforms — the camera's zoom, the clock — not a copy of them)
        if ((m as THREE.ShaderMaterial).isShaderMaterial) (cm as THREE.ShaderMaterial).uniforms = { ...(m as THREE.ShaderMaterial).uniforms };
        // (the same hooks and key: the same program, built once; only its copy's number is its own)
        cm.onBeforeCompile = m.onBeforeCompile;
        cm.customProgramCacheKey = m.customProgramCacheKey;
        copyUs.set(cm, { value: c });
        const p = new THREE.Points(pts.geometry, cm);
        Object.assign(p.userData, { plodCopy: c, noPointLod: true });
        p.frustumCulled = pts.frustumCulled;
        p.renderOrder = pts.renderOrder;
        p.layers.mask = pts.layers.mask;
        pts.add(p);
        made.push({ p, m: cm });
      }
    }
  }
  return () => {
    pointLodU.uPlodShot.value = 1;
    for (const { p, m } of made) {
      p.removeFromParent();
      m.dispose();
    }
  };
}

/** (a cell's own three numbers, 0 … 1 — the jittered lattice of the clumps' centres) */
const HASH3 =
  "vec3 plodHash3( vec3 c ) {\n  uvec3 q = uvec3( ivec3( c ) ) * uvec3( 1597334673u, 3812015801u, 2798796415u );\n  uint n = ( q.x ^ q.y ^ q.z ) * 1597334673u;\n  return vec3( n, n * 16807u, n * 48271u ) * ( 1.0 / 4294967296.0 );\n}\n";
const HEAD = "uniform float uPlodOn, uPlodStart, uPlodPow, uPlodMax, uPlodGather, uPlodCell, uPlodShot, uPlodCopy;\nuniform vec2 uPlodView;\nvarying float vPlodSoft;\nvarying float vPlodShade;\n" + HASH3;
/**
 * FAR POINTS GATHER INTO CLUMPS (the artist, 2026-11-28, of the first far-point LOD in a hero shot: "lod 적용은 좋은데,
 * 유기적으로 뭉쳐보이진 않음 그냥 점이 커지고 줄어들었다 정도"): past the start a point moves toward the nearest of a
 * jittered lattice of centres fixed in the world (덩어리 크기 apart; the nearest of the 27 round it, so the clumps are
 * irregular and stay put as the eye turns), the further the more (뭉침, in full at twice the start) — neighbours merge
 * into one mass and the gaps between masses open. Those points also take sizes of their own and a round outline, the
 * larger ones a soft (dithered) rim: a clump's edge is lumpy, not a row of squares; and a clump's core is a little
 * lighter than its rim (by how far each point lay from its centre), so it reads as a volume ("다 넣으라 해"). A hero
 * shot's four averaged renders turn the dither into a soft edge.
 */
const GATHER = `
  vPlodSoft = 0.0;
  vPlodShade = 1.0;
  // FAR POINTS GATHER (PointLod.tsx): toward the nearest centre of a jittered lattice fixed in the world
  float plodF = 0.0;
  if ( uPlodOn > 0.5 && uPlodGather > 0.0 && gl_Position.w > uPlodStart && abs( gl_Position.x ) < 1.5 * gl_Position.w ) {
    plodF = clamp( ( gl_Position.w - uPlodStart ) / uPlodStart, 0.0, 1.0 );
    // (where it is in the world, from where it is drawn: the eye's space by the projection, then the view undone)
    float plodVz = -gl_Position.w;
    vec3 plodV = vec3( ( gl_Position.x - projectionMatrix[2][0] * plodVz ) / projectionMatrix[0][0], ( gl_Position.y - projectionMatrix[2][1] * plodVz ) / projectionMatrix[1][1], plodVz );
    vec3 plodW = transpose( mat3( viewMatrix ) ) * ( plodV - viewMatrix[3].xyz );
    float plodCs = max( 0.1, uPlodCell );
    vec3 plodG = plodW / plodCs;
    vec3 plodB = floor( plodG );
    vec3 plodC = plodG;
    float plodBest = 1e9;
    for ( int plodI = -1; plodI <= 1; plodI++ ) {
      for ( int plodJ = -1; plodJ <= 1; plodJ++ ) {
        for ( int plodK = -1; plodK <= 1; plodK++ ) {
          vec3 plodE = plodB + vec3( float( plodI ), float( plodJ ), float( plodK ) );
          vec3 plodQ = plodE + 0.5 + ( plodHash3( plodE ) - 0.5 ) * 0.9 - plodG;
          float plodD = dot( plodQ, plodQ );
          if ( plodD < plodBest ) {
            plodBest = plodD;
            plodC = plodQ + plodG;
          }
        }
      }
    }
    gl_Position = projectionMatrix * viewMatrix * vec4( mix( plodW, plodC * plodCs, uPlodGather * plodF ), 1.0 );
    // (the core a little lighter, the rim a little darker: by how far it lay from its centre, in cells)
    vPlodShade = 1.0 + 0.1 * uPlodGather * plodF * ( 1.0 - 2.0 * clamp( sqrt( plodBest ) / 0.7, 0.0, 1.0 ) );
  }
`;
const LUMPS = `
  // (gathered: a size of its own and a round, soft-rimmed outline — the clump's edge lumpy, no squares)
  if ( plodF > 0.0 && abs( gl_Position.x ) < 1.5 * gl_Position.w ) {
    float plodL = float( ( uint( gl_VertexID ) * 2246822519u ) >> 8u ) * ( 1.0 / 16777216.0 );
    gl_PointSize *= mix( 1.0, 0.55 + 0.9 * plodL, plodF * uPlodGather );
    vPlodSoft = 0.65 * plodF * smoothstep( 3.0, 8.0, gl_PointSize / max( 1.0, uPlodShot ) );
  }
`;
/** The round, soft-rimmed outline, in the fragment shader (only where the vertex side above was patched in). */
const FRAG_HEAD = "varying float vPlodSoft;\nvarying float vPlodShade;\n";
/** (at the very end: the clump's core against its rim) */
const FRAG_TAIL = "\n  gl_FragColor.rgb *= vPlodShade;\n";
const FRAG_BODY = `
  if ( vPlodSoft > 0.001 ) {
    float plodR = length( gl_PointCoord - 0.5 ) * 2.0;
    if ( plodR > 1.0 ) discard;
    if ( fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) > 1.0 - smoothstep( 1.0 - vPlodSoft, 1.0, plodR ) ) discard;
  }
`;
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
${LUMPS}
  // A HERO SHOT'S FINER PIXELS (startPointShot): at its own size, in as many scattered copies as it takes to cover what the
  // screen's pixel covered (copy 0 where it is; the rest within about that pixel's width; the ones not needed left out)
  if ( uPlodShot > 1.0 && abs( gl_Position.x ) < 1.5 * gl_Position.w ) {
    float plodS = max( gl_PointSize, 1.0 );
    float plodN = ceil( uPlodShot * uPlodShot / ( plodS * plodS ) - 0.001 );
    if ( uPlodCopy > plodN - 0.5 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    else if ( uPlodCopy > 0.5 ) {
      uint plodK = ( uint( gl_VertexID ) * 2654435761u ) ^ ( uint( uPlodCopy ) * 2246822519u + 3266489917u );
      plodK = ( plodK ^ ( plodK >> 15u ) ) * 2246822519u;
      plodK = plodK ^ ( plodK >> 13u );
      vec2 plodR = vec2( float( plodK & 65535u ), float( plodK >> 16u ) ) / 65535.0 - 0.5;
      gl_Position.xy += plodR * ( 1.4 * uPlodShot ) * 2.0 / uPlodView * gl_Position.w;
    }
  }
`;

type Compile = THREE.Material["onBeforeCompile"];
type Shader = Parameters<Compile>[0];

function lodShader(shader: Shader, m: THREE.Material): void {
  const vs = shader.vertexShader;
  const end = vs.lastIndexOf("}");
  if (end < 0 || !vs.includes("gl_PointSize")) return;
  Object.assign(shader.uniforms, pointLodU);
  // (each material its own copy's number — a hero shot's copies are materials of their own: startPointShot)
  shader.uniforms.uPlodCopy = copyU(m);
  shader.vertexShader = HEAD + vs.slice(0, end) + GATHER + TAIL + vs.slice(end);
  // (the gathered points' round, soft rim)
  const fs = shader.fragmentShader;
  const main = /void\s+main\s*\(\s*\)\s*\{/.exec(fs);
  const close = fs.lastIndexOf("}");
  if (main && close > main.index) {
    const at = main.index + main[0].length;
    shader.fragmentShader = FRAG_HEAD + fs.slice(0, at) + FRAG_BODY + fs.slice(at, close) + FRAG_TAIL + fs.slice(close);
  }
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
      lodShader(shader, this);
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
      // ("그냥 점이 커지고 줄어들었다 정도" → gathered into clumps: GATHER above)
      gather: { value: 0.5, min: 0, max: 1, step: 0.05, label: "뭉침 (먼 점이 가까운 덩어리 중심으로 모이는 정도 · 시작 거리의 두 배에서 다 · 0 = 커지고 성겨지기만)" },
      cell: { value: 4, min: 1, max: 20, step: 0.5, label: "덩어리 크기 (월드 · 덩어리 중심 사이의 거리)" },
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
    pointLodU.uPlodGather.value = Math.max(0, Math.min(1, k.gather));
    pointLodU.uPlodCell.value = Math.max(0.1, k.cell);
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

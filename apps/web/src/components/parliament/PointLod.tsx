"use client";
/**
 * PointLod — FAR POINTS CLUMP ON THE WALL (the artist, 2026-11-28: "글로벌 보편에서 먼 점은 뭉쳐보이는 lod 추가해서 레바로
 * 조절할 수 있게 하고, 그게 히어로샷에도 반영되어 그려지도록").
 *
 * The phone's rule for its far readings (FutureResidue, LidarScan): past `start` (world, from the eye) a point is drawn
 * g = (d / start)^strength times larger (at most `max`) and kept with the chance 1 / g² — the area a cloud covers stays,
 * the points drawn fall as 1 / g², so far off there are fewer, larger, merged points, and fewer pixels to fill. And they
 * GATHER (뭉침, 덩어리 크기 — "유기적으로 뭉쳐보이진 않음 그냥 점이 커지고 줄어들었다 정도"): toward the centres of a jittered
 * lattice fixed in the world, into irregular clumps (GATHER below), and further off MELT into soft additive clouds of
 * the same light (구름 — CLOUD below).
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

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three";
import { savable } from "./levaSave";

const GROUP = "먼 점 뭉치기 (LOD)";

/** Shared by every patched shader: switch, start distance (world), strength, the most a point grows (×). */
const pointLodU = { uPlodOn: { value: 0 }, uPlodStart: { value: 180 }, uPlodPow: { value: 1 }, uPlodMax: { value: 3 }, uPlodGather: { value: 0.5 }, uPlodCell: { value: 4 }, uPlodCloud: { value: 0.8 }, uPlodShot: { value: 1 }, uPlodView: { value: new THREE.Vector2(1, 1) } };

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

const splatUs = new WeakMap<THREE.Material, { value: number }>();
const splatU = (m: THREE.Material): { value: number } => {
  let u = splatUs.get(m);
  if (!u) splatUs.set(m, (u = { value: 0 }));
  return u;
};

/** A material as another draw of the same points: the same hooks and key (the same program), its own uniforms object
 *  for a point shader of its own (its live uniforms shared, not copied). */
function copyMaterial(m: THREE.Material): THREE.Material {
  const cm = m.clone();
  if ((m as THREE.ShaderMaterial).isShaderMaterial) (cm as THREE.ShaderMaterial).uniforms = { ...(m as THREE.ShaderMaterial).uniforms };
  cm.onBeforeCompile = m.onBeforeCompile;
  cm.customProgramCacheKey = m.customProgramCacheKey;
  return cm;
}

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
        // (the same program, built once; only its copy's number is its own)
        const cm = copyMaterial(m);
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
const HEAD = "uniform float uPlodOn, uPlodStart, uPlodPow, uPlodMax, uPlodGather, uPlodCell, uPlodCloud, uPlodShot, uPlodCopy, uPlodSplatOn;\nuniform vec2 uPlodView;\nvarying float vPlodRound;\nvarying float vPlodShade;\nvarying float vPlodSplat;\n" + HASH3;
/**
 * FAR POINTS GATHER INTO CLUMPS (the artist, 2026-11-28, of the first far-point LOD in a hero shot: "lod 적용은 좋은데,
 * 유기적으로 뭉쳐보이진 않음 그냥 점이 커지고 줄어들었다 정도"): past the start a point moves toward the nearest of a
 * jittered lattice of centres fixed in the world (덩어리 크기 apart; the nearest of the 27 round it, so the clumps are
 * irregular and stay put as the eye turns), the further the more (뭉침, in full at twice the start) — neighbours merge
 * into one mass and the gaps between masses open. Those points also take sizes of their own and, once a few pixels
 * wide, a round outline (no squares); and a clump's core is a little lighter than its rim (by how far each point lay
 * from its centre), so it reads as a volume ("다 넣으라 해"). Further off they melt into soft clouds (CLOUD below; the
 * dithered rim of 85428a7 is gone).
 */
const GATHER = `
  vPlodRound = 0.0;
  vPlodShade = 1.0;
  vPlodSplat = 0.0;
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
  // (gathered: a size of its own and, once a few pixels wide, a round outline — no squares)
  if ( plodF > 0.0 && abs( gl_Position.x ) < 1.5 * gl_Position.w ) {
    float plodL = float( ( uint( gl_VertexID ) * 2246822519u ) >> 8u ) * ( 1.0 / 16777216.0 );
    gl_PointSize *= mix( 1.0, 0.55 + 0.9 * plodL, plodF * uPlodGather );
    vPlodRound = step( 3.0, gl_PointSize / max( 1.0, uPlodShot ) );
  }
`;
/**
 * FAR POINTS MELT INTO CLOUDS (the artist, 2026-11-28, of the clumps: "멀리서 봐도 그렇게 뭉친다거나 그래 보이지 않음",
 * "부드럽게 구름처럼 뭉쳐야 하는데"). Each point cloud has a second draw of the same points (a CLOUD copy: additive, soft,
 * no depth written — the future layer's plant clouds' own way, plantCloudsGpu's halo): past the start a share of the
 * points (구름 × how far, all of that share by 1.6 × the start) is handed to it, each point drawn by one of the two, never
 * both. There it is a gaussian splat about a clump wide (0.9 × 덩어리 크기 in the world), and only as many of them are kept
 * as carry the same light as the points they stand for (peak 0.6; the gaussian's mean over its disc ≈ 0.245) — the
 * same green, as a soft mass that feathers into the dark, at about the same cost.
 */
const CLOUD = `
  if ( uPlodOn > 0.5 && uPlodCloud > 0.0 && abs( gl_Position.x ) < 1.5 * gl_Position.w ) {
    float plodCf = uPlodCloud * smoothstep( uPlodStart, 1.6 * uPlodStart, gl_Position.w );
    uint plodM = uint( gl_VertexID ) * 3266489917u + 668265263u;
    plodM = ( plodM ^ ( plodM >> 15u ) ) * 2246822519u;
    plodM = plodM ^ ( plodM >> 13u );
    float plodU = float( plodM >> 8u ) * ( 1.0 / 16777216.0 );
    if ( uPlodSplatOn < 0.5 ) {
      // (the point itself: handed to the cloud, it is not drawn here)
      if ( plodU < plodCf ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    } else if ( plodU >= plodCf ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    else {
      float plodD = max( 1.0, 0.9 * uPlodCell * projectionMatrix[1][1] * uPlodView.y / ( 2.0 * gl_Position.w ) );
      float plodS = max( gl_PointSize, 1.0 );
      float plodKeep = clamp( ( plodS * plodS ) / ( 0.6 * 0.1925 * plodD * plodD ), 0.0, 1.0 );
      if ( plodU >= plodCf * plodKeep ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
      else {
        gl_PointSize = max( plodD, plodS );
        vPlodSplat = 0.6;
        vPlodRound = 0.0;
      }
    }
  }
`;
/** The fragment side (only where the vertex side above was patched in): a cloud's splat, the gathered points' round
 *  outline, and — at the very end — the clump's core against its rim and the splat's falloff. */
const FRAG_HEAD = "varying float vPlodRound;\nvarying float vPlodShade;\nvarying float vPlodSplat;\n";
const FRAG_BODY = `
  float plodA = 1.0;
  if ( vPlodSplat > 0.0 ) {
    vec2 plodQ = gl_PointCoord - 0.5;
    float plodR2 = 4.0 * dot( plodQ, plodQ );
    if ( plodR2 > 1.0 ) discard;
    plodA = vPlodSplat * exp( -4.0 * plodR2 );
  } else if ( vPlodRound > 0.5 && length( gl_PointCoord - 0.5 ) > 0.5 ) discard;
`;
const FRAG_TAIL = "\n  gl_FragColor.rgb *= vPlodShade;\n  gl_FragColor.a *= plodA;\n";
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
${CLOUD}
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
  // (and whether it is a cloud copy — PointLod's own, below)
  shader.uniforms.uPlodSplatOn = splatU(m);
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
      cell: { value: 4, min: 1, max: 20, step: 0.5, label: "덩어리 크기 (월드 · 덩어리 중심 사이의 거리 · 구름 한 덩이의 폭)" },
      // ("부드럽게 구름처럼 뭉쳐야 하는데" → CLOUD above)
      cloud: { value: 0.8, min: 0, max: 1, step: 0.05, label: "구름 (먼 점이 부드러운 빛 덩어리로 녹는 정도 · 시작 거리에서 1.6배까지 · 0 = 점 그대로)" },
    }),
    { collapsed: true },
  );
  const scene = useThree((s) => s.scene);
  const last = useRef(-Infinity);
  /** Each patched Points' cloud copy (a child of it): the material it was made from, and its own. */
  const clouds = useRef(new Map<THREE.Points, { p: THREE.Points; src: THREE.Material; m: THREE.Material }>());
  const drawSize = useRef(new THREE.Vector2());
  useEffect(
    () => () => {
      for (const c of clouds.current.values()) {
        c.p.removeFromParent();
        c.m.dispose();
      }
      clouds.current.clear();
    },
    [],
  );
  useFrame((state) => {
    pointLodU.uPlodOn.value = k.on ? 1 : 0;
    pointLodU.uPlodStart.value = Math.max(1, k.start);
    pointLodU.uPlodPow.value = Math.max(0, k.strength);
    pointLodU.uPlodMax.value = Math.max(1, k.max);
    pointLodU.uPlodGather.value = Math.max(0, Math.min(1, k.gather));
    pointLodU.uPlodCell.value = Math.max(0.1, k.cell);
    pointLodU.uPlodCloud.value = Math.max(0, Math.min(1, k.cloud));
    state.gl.getDrawingBufferSize(drawSize.current);
    pointShotView(drawSize.current.x, drawSize.current.y);
    // (the cloud copies follow their points: the geometry a layer put in anew, the size and colour a knob set)
    const cloudsOn = k.on && k.cloud > 0;
    for (const [host, c] of clouds.current) {
      c.p.visible = cloudsOn;
      if (c.p.geometry !== host.geometry) c.p.geometry = host.geometry;
      const sm = c.src as THREE.PointsMaterial, cm = c.m as THREE.PointsMaterial;
      if (sm.isPointsMaterial) {
        cm.size = sm.size;
        cm.color.copy(sm.color);
      }
    }
    const now = performance.now();
    if (now - last.current < 1000) return;
    last.current = now;
    let n = 0, fresh = 0;
    const seen = new Set<THREE.Points>();
    scene.traverse((o) => {
      if (!(o as THREE.Points).isPoints || o.userData.noPointLod) return;
      const pts = o as THREE.Points, m = pts.material;
      if (Array.isArray(m) || !wanted(m)) return;
      n++;
      if (ensure(m)) fresh++;
      seen.add(pts);
      // ITS CLOUD COPY (CLOUD): the same points, another draw — additive, soft, no depth written
      const had = clouds.current.get(pts);
      if (had && had.src === m && had.p.parent === pts) return;
      if (had) {
        had.p.removeFromParent();
        had.m.dispose();
      }
      const cm = copyMaterial(m);
      cm.transparent = true;
      cm.depthWrite = false;
      cm.blending = THREE.AdditiveBlending;
      splatUs.set(cm, { value: 1 });
      const p = new THREE.Points(pts.geometry, cm);
      Object.assign(p.userData, { plodCloud: true, noPointLod: true });
      p.frustumCulled = pts.frustumCulled;
      p.renderOrder = pts.renderOrder + 1;
      p.layers.mask = pts.layers.mask;
      pts.add(p);
      clouds.current.set(pts, { p, src: m, m: cm });
    });
    // (points no longer in the scene: their copies go)
    for (const [host, c] of clouds.current) {
      if (seen.has(host)) continue;
      c.p.removeFromParent();
      c.m.dispose();
      clouds.current.delete(host);
    }
    (window as unknown as { __pointLod?: unknown }).__pointLod = { on: k.on, materials: n, patchedNow: fresh, clouds: clouds.current.size };
  });
  return null;
}

// THE FOSSIL AS ONE FIELD ON THE GPU — a trial (2026-11-18; the artist, offered five ways out of the piece-by-piece
// fossil: "5 궁금함"). Nothing of the wall is used or changed: the boxes are generated (gen.js), the field is made
// and drawn here.
//
// - THE FIELD: the space is cut into bricks of B³ voxels; only the bricks within reach of a box are kept (a page
//   table says where each lives in an atlas — a 3D texture). A voxel is filled ON THE GPU, slice by slice of the
//   atlas, by a fragment shader that reads the boxes in its brick's list and takes their SMOOTH UNION (the distance,
//   1 byte a voxel). Beside it a coarser field of THE PLACE'S VALUES (the top when what is there hardened — the
//   youngest weighs most —, the vegetation's share, frame or fill), as fuseUnits.placeValues blurs them.
// - A BOX THAT CHANGES: only the bricks round it are filled again (their lists rewritten, their squares of the atlas
//   drawn again — one pass a slice for all of them).
// - THE DRAWING: a ray is marched through the bricks (an empty brick is jumped), and at every sample the wall's
//   coming-out filter (ParliamentSpace FUSE_GROW_VERT_BODY, with the artist's values) says how far the mass is out
//   there: the mass is the parts' smooth union swollen by as much; and where its life has gone, holes (the same
//   noise as FUSE_GONE_FRAG_BODY) are carved through it.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";
import { generate, loadDump, brickLists, primAabb, rooms, units, UNIT } from "./gen.js";

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
// ?data=<name>: the wall's own boxes (data/<name>.json + .f32, gen.js loadDump) instead of a generated block
const DUMP = q.get("data") ? await loadDump(q.get("data")) : null;
// THE EXHIBITION'S TWO SETS OF FUSION VALUES (plan §5: ① the exhibition server's saves 11/01, ② the artist's export
// 11/15) — stage A reads its knobs from the one chosen (?set=1101|1115), and the panel changes them in place
const SETS = await (await fetch("./presets/exhibition-fusion.json")).json();

const canvas = document.getElementById("c");
const outEl = document.getElementById("out");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
const gl = renderer.getContext();

const P = {
  res: num("res", 0.7),
  n: num("n", 12000),
  slots: num("slots", 120),
  seed: num("seed", 7),
  w: num("w", 0),
  h: num("h", 0),
  scale: num("scale", 1),
  // the field
  R: 1.6, // the distance kept, ± (world): what a byte holds
  k: 0.25, // the smooth union's reach (world)
  vh: 1.4, // the place values' cell (world)
  kv: 0.8, // how far a part's values reach out of it (world)
  // the wall's filter (the artist's values, .leva-live 2026-11-18)
  top: num("top", 0),
  pad: 0.6, // how far the mass swells out of its parts when it is all out (= growThin)
  onset: 0.22,
  fullAt: 0.9,
  ageMix: 0.5,
  ageSpan: 40,
  after: 3,
  over: 3,
  late: 0.5,
  rise: 0.6,
  die: true,
  dieMix: 0.5,
  dieAt: 0.75,
  dieOver: 0.3,
  dieAfter: 60,
  dieSpan: 30,
  holes: 1,
  grain: 1.2,
  rag: 0.6,
  patch: 9,
  parts: q.get("parts") !== "0",
  fossil: true,
  steps: num("steps", q.get("mass") === "smooth" ? 220 : 360),
  // STAGE A (2026-11-20): "exhibit" = the exhibition's density field (fuse.ts: max(occupancy, gain · blur), cut at
  // iso, sag, outline, rooms) with the age read per pixel; "smooth" = the trial's first field (a smooth union swollen
  // by the wall's new filter)
  mass: q.get("mass") === "smooth" ? "smooth" : "exhibit",
  set: q.get("set") === "1115" ? "1115" : "1101",
  // the exhibition's layer age 0 … 1 is read here as the depth in the window (top → bottom) × this
  ageK: num("agek", 1),
  // the fossil's units: the boxes joined on a lattice this wide (world; 0 = the simplified boxes as dumped)
  unit: num("unit", 2),
};
/** The exhibition knobs in use (a copy of the chosen set, changed by the panel). */
let X = { ...SETS[P.set] };
const EXHIBIT = P.mass === "exhibit";
if (DUMP) {
  P.slots = DUMP.slots;
  if (!P.top) P.top = DUMP.top;
}
if (!P.top) P.top = P.slots;

// ───────────────────────── the boxes ─────────────────────────
let world = null; // { prims, count, bounds, … }
let primTex = null;
let bornBase = 0, bornRange = 1;

function makePrimTex(prims, count) {
  const W = 4096, texels = count * 3, H = Math.max(1, Math.ceil(texels / W));
  const data = new Float32Array(W * H * 4);
  data.set(prims.subarray(0, count * 12));
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

// ───────────────────────── a field of bricks ─────────────────────────
const QUAD_VERT = /* glsl */ `void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;
const SPLAT_FRAG = /* glsl */ `
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uPrims, uLists, uInfo;
uniform int uLayer, uA, uS, uNb;
uniform float uH, uB, uR, uK, uKv, uBornBase, uBornRange;
uniform float uVs, uW, uWe, uSag, uSkel, uWrap, uDown;
uniform vec3 uOrigin;
out vec4 fragColor;
vec4 fetch( sampler2D t, int i ) { return texelFetch( t, ivec2( i & 4095, i >> 12 ), 0 ); }
float hash13( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
float vnoise( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( hash13( i ), hash13( i + vec3( 1, 0, 0 ) ), f.x ), mix( hash13( i + vec3( 0, 1, 0 ) ), hash13( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( hash13( i + vec3( 0, 0, 1 ) ), hash13( i + vec3( 1, 0, 1 ) ), f.x ), mix( hash13( i + vec3( 0, 1, 1 ) ), hash13( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
// a box of half size h along one axis, seen through a box filter of half width w: the share of the filter inside it
float ov( float l, float h, float w ) { return clamp( min( l + w, h ) - max( l - w, -h ), 0.0, 2.0 * w ) / ( 2.0 * w ); }
void main() {
  ivec2 fc = ivec2( gl_FragCoord.xy );
  int bx = fc.x / uS, by = fc.y / uS, bz = uLayer / uS;
  int id = ( bz * uA + by ) * uA + bx;
  if ( id >= uNb ) { fragColor = vec4( 1.0, 0.0, 0.0, 0.0 ); return; }
  ivec3 j = ivec3( fc.x - bx * uS, fc.y - by * uS, uLayer - bz * uS );
  vec4 i0 = fetch( uInfo, id * 2 ), i1 = fetch( uInfo, id * 2 + 1 );
  vec3 p = uOrigin + ( i0.xyz * uB + vec3( j ) - 0.5 ) * uH;
  int off = int( i0.w ), cnt = int( i1.x );
  float sumE = 0.0;
#ifdef DENSITY
  // THE EXHIBITION'S FIELD (fuse.ts fuseChunk), each part's share worked out in closed form instead of filled and
  // blurred voxel by voxel: C = the parts (a skeleton part only skeletonWrap of it), Bs = the parts seen through the
  // box blur (blur voxels each way) and hanging down (sag: each row keeps a share of the row above, more in some
  // columns), Rm = the rooms between plates, Ea = the parts a little wider (the outline; plates exact)
  float C = 0.0, Bs = 0.0, Rm = 0.0, Ea = 0.0;
  float scol = uSag * ( 0.55 + 0.45 * vnoise( vec3( p.x * 0.8, 0.0, p.z * 0.8 ) ) );
  float hv = 0.5 * uVs;
#endif
#ifdef VALUES
  float wsum = 0.0, veg = 0.0, late = 0.0, bm = -1e9, bs = 0.0, bws = 0.0;
#endif
  for ( int n = 0; n < cnt; n++ ) {
    int pi = int( fetch( uLists, off + n ).r );
    vec4 a = fetch( uPrims, pi * 3 ), b = fetch( uPrims, pi * 3 + 1 ), c = fetch( uPrims, pi * 3 + 2 );
#ifdef DENSITY
    if ( c.w < 0.5 || c.w > 1.5 ) {
      vec3 dp = p - a.xyz;
      vec3 l = vec3( dp.x * a.w - dp.z * b.w, dp.y, dp.x * b.w + dp.z * a.w );
      vec3 h = max( b.xyz, vec3( hv ) );
      if ( c.w > 1.5 ) { Rm = max( Rm, ov( l.x, h.x, uWe ) * ov( l.y, h.y, uWe ) * ov( l.z, h.z, uWe ) ); continue; }
      // a plate is the frame when the rooms are filled (isSkeleton); the others by their own hash
      float sk = c.z < 0.5 ? 1.0 : step( hash13( a.xyz * 7.31 + 0.5 ), uSkel );
      float wt = mix( 1.0, uWrap, sk );
      C = max( C, wt * ov( l.x, h.x, hv ) * ov( l.y, h.y, hv ) * ov( l.z, h.z, hv ) );
      float fy = ov( l.y, h.y, uW );
      if ( scol > 0.0 && l.y < uW - h.y ) fy = max( fy, pow( scol, ( uW - h.y - l.y ) / uVs ) );
      Bs += wt * ov( l.x, h.x, uW ) * fy * ov( l.z, h.z, uW );
      float dd = c.z < 0.5 ? 0.0 : hv;
      Ea = max( Ea, ov( l.x, h.x + dd, uWe ) * ov( l.y, h.y + dd, uWe ) * ov( l.z, h.z + dd, uWe ) );
    } else {
      vec3 pa = p - a.xyz, ba = b.xyz - a.xyz;
      float hh = clamp( dot( pa, ba ) / max( dot( ba, ba ), 1e-6 ), 0.0, 1.0 );
      float dc = length( pa - ba * hh ) - max( a.w, 0.6 * uVs );
      C = max( C, clamp( 0.5 - dc / uVs, 0.0, 1.0 ) );
      Bs += clamp( 0.5 - dc / ( 2.0 * uW ), 0.0, 1.0 );
      Ea = max( Ea, clamp( 0.5 - ( dc - uVs ) / ( 3.0 * uVs ), 0.0, 1.0 ) );
    }
    continue;
#endif
    if ( c.w > 1.5 ) continue; // (a room: only the density field reads it)
    float d;
    if ( c.w < 0.5 ) {
      // a box in its own turn (writeMatrix's turn undone)
      vec3 dp = p - a.xyz;
#ifdef VALUES
      // (the density field's sag hangs below the boxes: the distance kept here is to the box made that much longer
      // downwards, so the march's steps never jump into it)
      dp.y += 0.5 * uDown;
#endif
      vec3 l = vec3( dp.x * a.w - dp.z * b.w, dp.y, dp.x * b.w + dp.z * a.w );
#ifdef VALUES
      vec3 qd = abs( l ) - ( b.xyz + vec3( 0.0, 0.5 * uDown, 0.0 ) );
#else
      vec3 qd = abs( l ) - b.xyz;
#endif
      d = length( max( qd, 0.0 ) ) + min( max( qd.x, max( qd.y, qd.z ) ), 0.0 );
    } else {
      // a pipe or a way
      vec3 pa = p - a.xyz, ba = b.xyz - a.xyz;
      float hh = clamp( dot( pa, ba ) / max( dot( ba, ba ), 1e-6 ), 0.0, 1.0 );
      d = length( pa - ba * hh ) - a.w;
    }
    sumE += exp( -d / uK );
#ifdef VALUES
    float w = exp( -max( d, 0.0 ) / uKv );
    wsum += w; veg += w * c.y; late += w * c.z;
    // THE YOUNGEST THING IN A PLACE IS THE PLACE'S AGE (fuseUnits.placeValues): the born tops weighed towards the latest
    float t = ( c.x - uBornBase ) / 4.0;
    if ( t > bm ) { float sc = exp( bm - t ); bs *= sc; bws *= sc; bm = t; }
    float e = w * exp( t - bm ); bs += e * ( c.x - uBornBase ); bws += e;
#endif
  }
#ifdef DENSITY
  fragColor = vec4( C, min( Bs, 1.0 ), Rm, Ea );
  return;
#endif
  float d = sumE > 0.0 ? -uK * log( sumE ) : uR;
#ifdef VALUES
  fragColor = vec4( bws > 0.0 ? clamp( bs / bws / uBornRange, 0.0, 1.0 ) : 0.0, wsum > 0.0 ? veg / wsum : 0.0, wsum > 0.0 ? late / wsum : 0.0, clamp( d / uR * 0.5 + 0.5, 0.0, 1.0 ) );
#else
  fragColor = vec4( clamp( d / uR * 0.5 + 0.5, 0.0, 1.0 ), 0.0, 0.0, 1.0 );
#endif
}`;

const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

class Field {
  constructor(name, h, B, values, dens = null, R = P.R, down = 0) {
    this.name = name;
    this.h = h;
    this.B = B;
    this.S = B + 2;
    this.values = values;
    this.dens = dens;
    this.R = R;
    this.down = down;
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: QUAD_VERT,
      fragmentShader: SPLAT_FRAG,
      defines: values ? { VALUES: 1 } : dens ? { DENSITY: 1 } : {},
      uniforms: {
        uPrims: { value: null }, uLists: { value: null }, uInfo: { value: null },
        uLayer: { value: 0 }, uA: { value: 1 }, uS: { value: this.S }, uNb: { value: 0 },
        uH: { value: h }, uB: { value: B }, uR: { value: P.R }, uK: { value: P.k }, uKv: { value: P.kv },
        uBornBase: { value: 0 }, uBornRange: { value: 1 }, uOrigin: { value: new THREE.Vector3() },
        uVs: { value: dens?.vs ?? h }, uW: { value: dens?.w ?? h }, uWe: { value: dens?.we ?? h }, uSag: { value: dens?.sag ?? 0 },
        uSkel: { value: dens?.skel ?? 0 }, uWrap: { value: dens?.wrap ?? 1 }, uDown: { value: down },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.patch = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.patch.frustumCulled = false;
    this.patchScene = new THREE.Scene();
    this.patchScene.add(this.patch);
  }

  dispose() {
    for (const t of [this.rt, this.pageTex, this.infoTex, this.listTex]) t?.dispose();
    this.rt = this.pageTex = this.infoTex = this.listTex = null;
  }

  /** The whole field: lists (CPU), textures, then every slice of the atlas filled (GPU). */
  build(w) {
    this.dispose();
    const t0 = performance.now();
    const L = brickLists(w.prims, w.count, w.bounds, this.h, this.B, this.R, this.down);
    this.L = L;
    const keys = [...L.lists.keys()].sort((a, b) => a - b);
    const nb = keys.length;
    const cap = Math.ceil(nb * 1.15) + 64;
    const A = Math.ceil(Math.cbrt(cap));
    const AZ = Math.ceil(cap / (A * A));
    this.A = A;
    this.AZ = AZ;
    this.cap = A * A * AZ;
    this.nb = nb;
    const [nx, ny, nz] = L.dims;
    this.page = new Uint8Array(nx * ny * nz * 4);
    this.idOf = new Map();
    this.keyOf = [];
    let total = 0;
    for (const k of keys) total += L.lists.get(k).length;
    this.listCap = Math.ceil(total * 1.3) + 65536;
    const LW = 4096;
    const LH = Math.ceil(this.listCap / LW);
    this.listCap = LW * LH;
    this.lists = new Float32Array(this.listCap);
    const IH = Math.ceil((this.cap * 2) / LW);
    this.info = new Float32Array(LW * IH * 4);
    this.listTail = 0;
    keys.forEach((key, id) => this.place(key, id, L.lists.get(key)));
    const t1 = performance.now();
    // textures
    this.pageTex = new THREE.Data3DTexture(this.page, nx, ny, nz);
    this.pageTex.format = THREE.RGBAFormat;
    this.pageTex.type = THREE.UnsignedByteType;
    this.pageTex.minFilter = this.pageTex.magFilter = THREE.NearestFilter;
    this.pageTex.unpackAlignment = 1;
    this.pageTex.needsUpdate = true;
    this.listTex = new THREE.DataTexture(this.lists, LW, LH, THREE.RedFormat, THREE.FloatType);
    this.listTex.minFilter = this.listTex.magFilter = THREE.NearestFilter;
    this.listTex.needsUpdate = true;
    this.infoTex = new THREE.DataTexture(this.info, LW, IH, THREE.RGBAFormat, THREE.FloatType);
    this.infoTex.minFilter = this.infoTex.magFilter = THREE.NearestFilter;
    this.infoTex.needsUpdate = true;
    const S = this.S;
    this.rt = new THREE.WebGL3DRenderTarget(A * S, A * S, AZ * S, {
      format: this.values || this.dens ? THREE.RGBAFormat : THREE.RedFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.rt.texture.wrapS = this.rt.texture.wrapT = this.rt.texture.wrapR = THREE.ClampToEdgeWrapping;
    const u = this.mat.uniforms;
    u.uPrims.value = primTex;
    u.uLists.value = this.listTex;
    u.uInfo.value = this.infoTex;
    u.uA.value = A;
    u.uNb.value = this.nb;
    u.uOrigin.value.set(...L.origin);
    u.uBornBase.value = bornBase;
    u.uBornRange.value = bornRange;
    // every slice that holds a brick
    const used = Math.ceil(nb / (A * A)) * S;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    const gq = gpuTime(() => {
      for (let layer = 0; layer < used; layer++) {
        u.uLayer.value = layer;
        renderer.setRenderTarget(this.rt, layer);
        renderer.render(this.scene, quadCam);
      }
    });
    renderer.setRenderTarget(null);
    renderer.autoClear = auto;
    const t2 = performance.now();
    syncGpu(this.rt, used - 1);
    const t3 = performance.now();
    this.stats = {
      bricks: nb,
      of: nx * ny * nz,
      voxels: nb * this.B ** 3,
      atlasMB: (A * S * A * S * AZ * S * (this.values || this.dens ? 4 : 1)) / 1e6,
      pageMB: (nx * ny * nz * 4) / 1e6,
      listMB: (this.lists.byteLength + this.info.byteLength) / 1e6,
      listAvg: total / nb,
      cpuListsMs: t1 - t0,
      gpuSubmitMs: t2 - t1,
      gpuWaitMs: t3 - t2,
      buildMs: t3 - t0,
      slices: used,
      gpuMs: null,
    };
    const st = this.stats;
    gq.then((ms) => {
      st.gpuMs = ms;
      report();
    });
    return this.stats;
  }

  /** A brick's list written at the end of the lists, its info and its page entry. */
  place(key, id, list) {
    const L = this.L;
    const [nx, ny] = L.dims;
    const ix = key % nx, iy = Math.floor(key / nx) % ny, iz = Math.floor(key / (nx * ny));
    this.idOf.set(key, id);
    this.keyOf[id] = key;
    const A = this.A;
    const ax = id % A, ay = Math.floor(id / A) % A, az = Math.floor(id / (A * A));
    this.page.set([ax, ay, az, 255], key * 4);
    if (this.listTail + list.length > this.listCap) return false;
    this.lists.set(list, this.listTail);
    this.info.set([ix, iy, iz, this.listTail, list.length, 0, 0, 0], id * 8);
    this.listTail += list.length;
    return true;
  }

  /** ONE BOX CHANGED: the bricks round where it was and where it is now get new lists and are filled again. */
  update(w, i, was) {
    const t0 = performance.now();
    const L = this.L;
    const [nx, ny, nz] = L.dims;
    const bw = this.B * this.h, [ox, oy, oz] = L.origin;
    const now = primAabb(w.prims, i, L.m);
    now[1] -= this.down;
    was = [...was];
    was[1] -= this.down;
    const range = (a) => [
      Math.max(0, Math.floor((a[0] - ox) / bw)), Math.min(nx - 1, Math.floor((a[3] - ox) / bw)),
      Math.max(0, Math.floor((a[1] - oy) / bw)), Math.min(ny - 1, Math.floor((a[4] - oy) / bw)),
      Math.max(0, Math.floor((a[2] - oz) / bw)), Math.min(nz - 1, Math.floor((a[5] - oz) / bw)),
    ];
    const keys = new Set();
    const rn = range(now);
    for (const r of [range(was), rn])
      for (let k = r[4]; k <= r[5]; k++) for (let j = r[2]; j <= r[3]; j++) for (let ii = r[0]; ii <= r[1]; ii++) keys.add((k * ny + j) * nx + ii);
    const inNow = (key) => {
      const ii = key % nx, j = Math.floor(key / nx) % ny, k = Math.floor(key / (nx * ny));
      return ii >= rn[0] && ii <= rn[1] && j >= rn[2] && j <= rn[3] && k >= rn[4] && k <= rn[5];
    };
    const ids = [];
    let full = false;
    const tail0 = this.listTail;
    for (const key of keys) {
      const list = (L.lists.get(key) ?? []).filter((x) => x !== i);
      if (inNow(key)) list.push(i);
      L.lists.set(key, list);
      let id = this.idOf.get(key);
      if (id === undefined) {
        if (!list.length) continue;
        if (this.nb >= this.cap) {
          full = true;
          break;
        }
        id = this.nb++;
      }
      if (!this.place(key, id, list)) {
        full = true;
        break;
      }
      ids.push(id);
    }
    if (full) return { ...this.build(w), rebuilt: true };
    const t1 = performance.now();
    // only what changed goes up
    this.listTex.addUpdateRange(tail0, this.listTail - tail0);
    this.listTex.needsUpdate = true;
    for (const id of ids) this.infoTex.addUpdateRange(id * 8, 8);
    this.infoTex.needsUpdate = true;
    this.pageTex.needsUpdate = true;
    const u = this.mat.uniforms;
    u.uNb.value = this.nb;
    const S = this.S, A = this.A;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    // THE BRICKS OF ONE SLAB OF THE ATLAS IN ONE PASS A SLICE (a pass a brick and a slice was 0.1 ms each on ANGLE
    // Metal — a render pass is begun every time the layer is set — and 24 ms for one box): a little square a brick,
    // all of them drawn together into each of the slab's slices.
    const groups = new Map();
    for (const id of ids) {
      const az = Math.floor(id / (A * A));
      if (!groups.has(az)) groups.set(az, []);
      groups.get(az).push(id);
    }
    const W = A * S;
    const gq = gpuTime(() => {
      for (const [az, list] of groups) {
        const pos = new Float32Array(list.length * 18);
        list.forEach((id, k) => {
          const ax = id % A, ay = Math.floor(id / A) % A;
          const x0 = ((ax * S) / W) * 2 - 1, x1 = (((ax + 1) * S) / W) * 2 - 1, y0 = ((ay * S) / W) * 2 - 1, y1 = (((ay + 1) * S) / W) * 2 - 1;
          pos.set([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0], k * 18);
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        this.patch.geometry = g;
        for (let l = 0; l < S; l++) {
          u.uLayer.value = az * S + l;
          renderer.setRenderTarget(this.rt, az * S + l);
          renderer.render(this.patchScene, quadCam);
        }
        g.dispose();
      }
    });
    renderer.setRenderTarget(null);
    renderer.autoClear = auto;
    const t2 = performance.now();
    syncGpu(this.rt, ids.length ? Math.floor(ids[ids.length - 1] / (A * A)) * S : 0);
    const t3 = performance.now();
    const r = { bricks: ids.length, passes: groups.size * S, cpuMs: t1 - t0, gpuSubmitMs: t2 - t1, gpuWaitMs: t3 - t2, totalMs: t3 - t0, gpuMs: null };
    gq.then((ms) => (r.gpuMs = ms));
    return r;
  }
}

/** Waits for the GPU: a pixel read back from what was last written (a slice of the atlas, or the canvas). */
const syncBuf = new Uint8Array(4);
/** THE GPU'S OWN CLOCK (EXT_disjoint_timer_query_webgl2): how long what fn draws takes on the GPU, without the
 *  round trip a read-back costs (65 ms on this machine under load, whatever is drawn). Resolves to ms, or null. */
const TE = gl.getExtension("EXT_disjoint_timer_query_webgl2");
const pendingQ = [];
// (back to the event loop without a timer: a hidden page's timers wait a second or more, a message does not)
const yieldCh = new MessageChannel();
const yieldQ = [];
yieldCh.port1.onmessage = () => yieldQ.shift()?.();
const yieldNow = () => new Promise((r) => (yieldQ.push(r), yieldCh.port2.postMessage(0)));
function gpuTime(fn) {
  if (!TE) {
    fn();
    return Promise.resolve(null);
  }
  const qy = gl.createQuery();
  gl.beginQuery(TE.TIME_ELAPSED_EXT, qy);
  fn();
  gl.endQuery(TE.TIME_ELAPSED_EXT);
  const t0 = performance.now();
  const p = new Promise((done) => {
    const poll = () => {
      // (a hidden page's queries may never be answered: given up after a second)
      if (performance.now() - t0 > 1000) return void done(null);
      if (!gl.getQueryParameter(qy, gl.QUERY_RESULT_AVAILABLE)) return void yieldNow().then(poll);
      const bad = gl.getParameter(TE.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(qy, gl.QUERY_RESULT);
      gl.deleteQuery(qy);
      done(bad ? null : ns / 1e6);
    };
    yieldNow().then(poll);
  });
  pendingQ.push(p);
  return p;
}
async function settle() {
  while (pendingQ.length) await pendingQ.shift();
}

function syncGpu(rt = null, layer = 0) {
  renderer.setRenderTarget(rt, layer);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncBuf);
  renderer.setRenderTarget(null);
}

// ───────────────────────── drawing ─────────────────────────
const MARCH_VERT = /* glsl */ `
out vec3 vW;
void main() { vec4 w = modelMatrix * vec4( position, 1.0 ); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const MARCH_FRAG = /* glsl */ `
precision highp float; precision highp int; precision highp sampler3D;
in vec3 vW;
out vec4 fragColor;
uniform mat4 projectionMatrix;
uniform sampler3D uDAtlas, uDPage, uVAtlas, uVPage;
uniform vec3 uDOrigin, uVOrigin, uDAtlasTex, uVAtlasTex, uBmin, uBmax;
uniform ivec3 uDDims, uVDims;
uniform float uDH, uDB, uDS, uVH, uVB, uVS, uR;
uniform float uTop, uHeight, uUnit, uPad, uOnset, uFullAt, uAgeMix, uAgeSpan, uAfter, uOver, uFloor, uLate, uRise;
uniform float uDie, uDieMix, uDieAt, uDieOver, uDieAfter, uDieSpan, uDieHoles, uGrain, uRag, uPatch;
uniform float uBornBase, uBornRange;
uniform int uSteps;
float goneHash( vec3 p ) { p = fract( p * 0.1031 + vec3( 0.71, 0.113, 0.419 ) ); p += dot( p, p.yzx + 33.33 ); return fract( ( p.x + p.y ) * p.z ); }
float goneNoise( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( goneHash( i ), goneHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ), mix( goneHash( i + vec3( 0.0, 1.0, 0.0 ) ), goneHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
              mix( mix( goneHash( i + vec3( 0.0, 0.0, 1.0 ) ), goneHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ), mix( goneHash( i + vec3( 0.0, 1.0, 1.0 ) ), goneHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ), f.z );
}
// the distance (world) at p; empty bricks read as far
float dAt( vec3 p ) {
  vec3 c = floor( ( p - uDOrigin ) / ( uDB * uDH ) );
  if ( any( lessThan( c, vec3( 0.0 ) ) ) || any( greaterThanEqual( c, vec3( uDDims ) ) ) ) return uR;
  vec4 pg = texelFetch( uDPage, ivec3( c ), 0 );
  if ( pg.a < 0.5 ) return uR;
  vec3 local = ( p - uDOrigin ) / uDH - c * uDB;
  return ( texture( uDAtlas, ( floor( pg.rgb * 255.0 + 0.5 ) * uDS + local + 1.0 ) / uDAtlasTex ).r * 2.0 - 1.0 ) * uR;
}
// the place's values: born (0..1 of the range), vegetation, late (fill)
vec3 vAt( vec3 p ) {
  vec3 c = floor( ( p - uVOrigin ) / ( uVB * uVH ) );
  if ( any( lessThan( c, vec3( 0.0 ) ) ) || any( greaterThanEqual( c, vec3( uVDims ) ) ) ) return vec3( 0.0 );
  vec4 pg = texelFetch( uVPage, ivec3( c ), 0 );
  if ( pg.a < 0.5 ) return vec3( 0.0 );
  vec3 local = ( p - uVOrigin ) / uVH - c * uVB;
  return texture( uVAtlas, ( floor( pg.rgb * 255.0 + 0.5 ) * uVS + local + 1.0 ) / uVAtlasTex ).rgb;
}
// FUSE_GROW_VERT_BODY, per sample: how far the mass is out here (x) and how far its life has gone (y)
vec2 grow( vec3 p, vec3 v ) {
  float layer = p.y / uUnit - 0.5;
  float born = uBornBase + v.r * uBornRange;
  float growDepth = ( uTop - ( layer + 0.5 ) ) / max( 1.0, uHeight );
  float age = uTop - born - uAfter;
  float growLayer = clamp( mix( ( growDepth - uOnset ) / max( 0.01, uFullAt - uOnset ), age / max( 1.0, uAgeSpan ), uAgeMix ), 0.0, 1.0 );
  float growAged = clamp( age / max( 0.1, uOver ), 0.0, 1.0 );
  float growKept = clamp( ( layer - uFloor ) * 0.5, 0.0, 1.0 );
  float dieArg = mix( ( growDepth - uDieAt ) / max( 0.01, uDieOver ), ( age - uDieAfter ) / max( 1.0, uDieSpan ), uDieMix );
  float growGone = uDie * clamp( dieArg, 0.0, 1.0 );
  float vGone = uDie * uDieHoles * clamp( dieArg, -4.0, 4.0 );
  float growTime = growLayer * growAged * growKept * ( 1.0 - growGone * ( 1.0 - uDieHoles ) );
  float growWait = uLate * v.b * ( 1.0 - uRise + uRise * fract( layer + 0.5 ) );
  float vGrow = clamp( ( growTime - growWait ) / max( 0.05, 1.0 - growWait ), 0.0, 1.0 ) * v.g;
  return vec2( vGrow, vGone );
}
#ifdef DENSITY
uniform float uVs, uW, uIso, uGain, uFOn, uFFull, uFFrom, uFTo, uFNoise, uBlocky, uScatter, uEnv, uFillOut, uAgeK, uReach;
vec4 dAt4( vec3 p ) {
  vec3 c = floor( ( p - uDOrigin ) / ( uDB * uDH ) );
  if ( any( lessThan( c, vec3( 0.0 ) ) ) || any( greaterThanEqual( c, vec3( uDDims ) ) ) ) return vec4( 0.0 );
  vec4 pg = texelFetch( uDPage, ivec3( c ), 0 );
  if ( pg.a < 0.5 ) return vec4( 0.0 );
  vec3 local = ( p - uDOrigin ) / uDH - c * uDB;
  return texture( uDAtlas, ( floor( pg.rgb * 255.0 + 0.5 ) * uDS + local + 1.0 ) / uDAtlasTex );
}
vec4 vAt4( vec3 p ) {
  vec3 c = floor( ( p - uVOrigin ) / ( uVB * uVH ) );
  if ( any( lessThan( c, vec3( 0.0 ) ) ) || any( greaterThanEqual( c, vec3( uVDims ) ) ) ) return vec4( 0.0, 0.0, 0.0, 1.0 );
  vec4 pg = texelFetch( uVPage, ivec3( c ), 0 );
  if ( pg.a < 0.5 ) return vec4( 0.0, 0.0, 0.0, 1.0 );
  vec3 local = ( p - uVOrigin ) / uVH - c * uVB;
  return texture( uVAtlas, ( floor( pg.rgb * 255.0 + 0.5 ) * uVS + local + 1.0 ) / uVAtlasTex );
}
float ramp01( float x, float a, float b ) { return clamp( ( x - a ) / max( 1e-4, b - a ), 0.0, 1.0 ); }
float sramp( float x, float a, float b ) { float t = ramp01( x, a, b ); return t * t * ( 3.0 - 2.0 * t ); }
// the exhibition's field at p (fuse.ts: the concrete mass, kept back outside the rooms, cut at the outline, broken up
// at the young edges) for a layer of this age
float fieldF( vec3 p, float fused, float g, float scat ) {
  vec4 s = dAt4( p );
  float f = fused * max( s.r, g * s.g * mix( uFillOut, 1.0, s.b ) );
  if ( uEnv > 0.0 ) { float E = max( s.a, s.b ); if ( E < 0.5 ) f += ( min( f, uIso * E / 0.5 ) - f ) * uEnv; }
  if ( scat > 0.0 && f > uIso * 0.5 ) {
    float edge = 1.0 - clamp( ( f - uIso ) / 0.6, 0.0, 1.0 );
    f -= scat * edge * max( 0.0, 0.7 - goneNoise( p * 1.6 + 5.3 ) ) * 1.6;
  }
  return f;
}
// THE MASS AS THE EXHIBITION MADE IT, its age read here (the layer's depth in the window: 0 at the top … 1 at the
// bottom). x = the implicit (solid < 0, roughly in world units), y = a safe step
vec2 massAt( vec3 p ) {
  vec4 v = vAt4( p );
  float dv = ( v.a * 2.0 - 1.0 ) * uR;
  if ( dv > uReach ) return vec2( dv - uReach + 0.01, dv - uReach );
  float born = uBornBase + v.r * uBornRange;
  float q = clamp( ( uTop - born ) / max( 1.0, uHeight ) * uAgeK, 0.0, 1.0 );
  float fused = ramp01( q, uFOn, max( uFOn + 0.01, uFFull ) );
  if ( fused <= 0.001 ) return vec2( uVH * 0.4, uVH * 0.4 );
  // (the fossil curve only says how blocky a young layer is: not worked out when nothing is blocky)
  float young = uBlocky > 0.0 ? uBlocky * ( 1.0 - sramp( q + ( goneNoise( p * 0.35 + 3.1 ) - 0.5 ) * uFNoise, uFFrom, max( uFFrom + 0.05, uFTo ) ) ) : 0.0;
  float g = uGain * ( 0.55 + 0.9 * q ) * ( 1.0 - 0.6 * young );
  float scat = uScatter * ( 1.0 - q );
  float f = fieldF( p, fused, g, scat );
  // the young layers keep the voxel steps (blocky)
  if ( young > 0.01 ) f = mix( f, fieldF( ( floor( p / uVs ) + 0.5 ) * uVs, fused, g, scat ), young );
  float L = fused * max( 1.0 / uVs, g / ( 2.0 * uW ) ) * 1.3 + 1e-3;
  float m = ( uIso - f ) / L;
  return vec2( m, max( uVs * 0.35, m ) );
}
#else
// THE MASS: the parts' smooth union swollen by how far it is out, nothing where it is not out, holes where it has gone.
// x = the implicit (solid < 0), y = a safe step
vec2 massAt( vec3 p ) {
  float d = dAt( p );
  if ( d - uPad > uDH ) return vec2( d - uPad, d - uPad );
  vec2 g = grow( p, vAt( p ) );
  float s = g.x * g.x * ( 3.0 - 2.0 * g.x );
  float f = d + 0.03 - uPad * s;
  float step = f > 0.0 ? f : max( uDH * 0.5, min( -d, uVH ) );
  f = max( f, ( 0.02 - g.x ) * 3.0 );
  // (not out here: nothing is solid until the place's values change — they change over a cell of their own)
  if ( g.x < 0.02 ) step = max( abs( d ), uVH * 0.4 );
  float goneAt = g.y == 0.0 ? 0.0 : clamp( g.y + ( goneNoise( p / max( 0.5, uPatch ) + 7.7 ) - 0.5 ) * 3.0 * uRag, 0.0, 1.0 );
  if ( goneAt > 0.001 ) {
    vec3 gp = p / max( 0.05, uGrain );
    float goneN = clamp( ( 0.65 * goneNoise( gp ) + 0.35 * goneNoise( gp * 2.7 + 11.3 ) - 0.5 ) * 1.9 + 0.5, 0.0, 0.999 );
    f = max( f, ( goneAt - goneN ) * uGrain * 0.6 );
  }
  return vec2( f, step );
}
#endif
void main() {
  vec3 ro = cameraPosition, rd = normalize( vW - ro );
  vec3 inv = 1.0 / rd;
  vec3 ta = ( uBmin - ro ) * inv, tb = ( uBmax - ro ) * inv;
  vec3 tn = min( ta, tb ), tf = max( ta, tb );
  float t = max( max( max( tn.x, tn.y ), tn.z ), 0.0 ), tEnd = min( min( tf.x, tf.y ), tf.z );
  float bw = uDB * uDH, minStep = uDH * 0.5;
  float tPrev = t;
  bool hit = false;
  for ( int i = 0; i < uSteps; i++ ) {
    if ( t > tEnd ) break;
    vec3 p = ro + rd * t;
    // an empty brick is jumped
    vec3 c = floor( ( p - uDOrigin ) / bw );
    bool inside = all( greaterThanEqual( c, vec3( 0.0 ) ) ) && all( lessThan( c, vec3( uDDims ) ) );
    if ( !inside || texelFetch( uDPage, ivec3( c ), 0 ).a < 0.5 ) {
      vec3 b0 = uDOrigin + c * bw, b1 = b0 + bw;
      vec3 e = max( ( b0 - ro ) * inv, ( b1 - ro ) * inv );
      tPrev = t;
      t = min( min( e.x, e.y ), e.z ) + 1e-3;
      continue;
    }
    vec2 m = massAt( p );
    if ( m.x < 0.0 ) { hit = true; break; }
    tPrev = t;
    t += max( m.y * 0.7, minStep );
  }
  if ( !hit ) discard;
  // the surface between the last sample out and the first in
  float a = tPrev, b = t;
  for ( int i = 0; i < 5; i++ ) { float mid = 0.5 * ( a + b ); if ( massAt( ro + rd * mid ).x < 0.0 ) b = mid; else a = mid; }
  vec3 p = ro + rd * b;
  float e = uDH * 0.6;
  vec3 n = normalize( vec3(
    massAt( p + vec3( e, 0, 0 ) ).x - massAt( p - vec3( e, 0, 0 ) ).x,
    massAt( p + vec3( 0, e, 0 ) ).x - massAt( p - vec3( 0, e, 0 ) ).x,
    massAt( p + vec3( 0, 0, e ) ).x - massAt( p - vec3( 0, 0, e ) ).x ) + 1e-6 );
  if ( dot( n, rd ) > 0.0 ) n = -n;
  float ao = clamp( 0.45 + 0.55 * massAt( p + n * 0.9 ).x / 0.9, 0.25, 1.0 );
  vec3 L = normalize( vec3( 0.45, 0.8, 0.35 ) );
  float dif = max( dot( n, L ), 0.0 );
  float hemi = 0.5 + 0.5 * n.y;
  vec3 stone = vec3( 0.86, 0.84, 0.79 );
  vec3 col = stone * ( 0.28 * hemi + 0.72 * dif ) * ao + stone * 0.08;
  fragColor = vec4( pow( col, vec3( 1.0 / 1.6 ) ), 1.0 );
  vec4 clip = projectionMatrix * viewMatrix * vec4( p, 1.0 );
  gl_FragDepth = clamp( clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0 );
}`;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d1d1c);
const camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);
const controls = new OrbitControls(camera, canvas);
controls.addEventListener("change", () => (dirty = true));
scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(0.45, 0.8, 0.35);
scene.add(sun);

const marchMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: MARCH_VERT,
  fragmentShader: MARCH_FRAG,
  side: THREE.BackSide,
  defines: EXHIBIT ? { DENSITY: 1 } : {},
  uniforms: {
    uVs: { value: 0.3 }, uW: { value: 0.45 }, uIso: { value: 0.39 }, uGain: { value: 1 }, uFOn: { value: 0.2 }, uFFull: { value: 0.5 },
    uFFrom: { value: 0.16 }, uFTo: { value: 0.66 }, uFNoise: { value: 0 }, uBlocky: { value: 0 }, uScatter: { value: 0 }, uEnv: { value: 0 },
    uFillOut: { value: 1 }, uAgeK: { value: 1 }, uReach: { value: 1 },
    uDAtlas: { value: null }, uDPage: { value: null }, uVAtlas: { value: null }, uVPage: { value: null },
    uDOrigin: { value: new THREE.Vector3() }, uVOrigin: { value: new THREE.Vector3() },
    uDAtlasTex: { value: new THREE.Vector3() }, uVAtlasTex: { value: new THREE.Vector3() },
    uBmin: { value: new THREE.Vector3() }, uBmax: { value: new THREE.Vector3() },
    uDDims: { value: new THREE.Vector3() }, uVDims: { value: new THREE.Vector3() },
    uDH: { value: 0 }, uDB: { value: 0 }, uDS: { value: 0 }, uVH: { value: 0 }, uVB: { value: 0 }, uVS: { value: 0 }, uR: { value: P.R },
    uTop: { value: 0 }, uHeight: { value: 1 }, uUnit: { value: UNIT }, uPad: { value: 0 }, uOnset: { value: 0 }, uFullAt: { value: 1 },
    uAgeMix: { value: 0 }, uAgeSpan: { value: 1 }, uAfter: { value: 0 }, uOver: { value: 1 }, uFloor: { value: -1e9 }, uLate: { value: 0 }, uRise: { value: 0 },
    uDie: { value: 0 }, uDieMix: { value: 0 }, uDieAt: { value: 0 }, uDieOver: { value: 1 }, uDieAfter: { value: 0 }, uDieSpan: { value: 1 },
    uDieHoles: { value: 0 }, uGrain: { value: 1 }, uRag: { value: 0 }, uPatch: { value: 9 },
    uBornBase: { value: 0 }, uBornRange: { value: 1 }, uSteps: { value: P.steps },
  },
});
const marchBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), marchMat);
marchBox.frustumCulled = false;
marchBox.renderOrder = 1;
scene.add(marchBox);

let partsMesh = null;
function makeParts(w) {
  if (partsMesh) {
    scene.remove(partsMesh);
    partsMesh.geometry.dispose();
    partsMesh.material.dispose();
  }
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x6d6b66 }), w.count);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), T = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < w.count; i++) {
    partMatrix(w.prims, i, M, Q, S, T, Y);
    m.setMatrixAt(i, M);
  }
  m.instanceMatrix.needsUpdate = true;
  partsMesh = m;
  m.visible = P.parts;
  scene.add(m);
}
function partMatrix(Pr, i, M, Q, S, T, Y) {
  const o = i * 12;
  if (Pr[o + 11] > 1.5) {
    M.makeScale(0, 0, 0); // a room is not a part
    return;
  }
  if (Pr[o + 11] < 0.5) {
    T.set(Pr[o], Pr[o + 1], Pr[o + 2]);
    Q.setFromAxisAngle(Y, Math.atan2(Pr[o + 7], Pr[o + 3]));
    S.set(Pr[o + 4] * 2, Pr[o + 5] * 2, Pr[o + 6] * 2);
  } else {
    const a = new THREE.Vector3(Pr[o], Pr[o + 1], Pr[o + 2]), b = new THREE.Vector3(Pr[o + 4], Pr[o + 5], Pr[o + 6]);
    T.copy(a).add(b).multiplyScalar(0.5);
    const d = b.clone().sub(a);
    const len = d.length();
    Q.setFromUnitVectors(Y, d.normalize());
    S.set(Pr[o + 3] * 2, len, Pr[o + 3] * 2);
  }
  M.compose(T, Q, S);
}

// ───────────────────────── building it all ─────────────────────────
let fieldD = null, fieldV = null;
let builtSig = "";
let last = {};
let dirty = true;

function setUniforms() {
  const u = marchMat.uniforms;
  const b = world.bounds;
  u.uBmin.value.set(b[0] - P.R, b[1] - P.R, b[2] - P.R);
  u.uBmax.value.set(b[3] + P.R, b[4] + P.R, b[5] + P.R);
  marchBox.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
  marchBox.scale.set(b[3] - b[0] + 2 * P.R + 1, b[4] - b[1] + 2 * P.R + 1, b[5] - b[2] + 2 * P.R + 1);
  for (const [f, D] of [[fieldD, "D"], [fieldV, "V"]]) {
    u[`u${D}Atlas`].value = f.rt.texture;
    u[`u${D}Page`].value = f.pageTex;
    u[`u${D}Origin`].value.set(...f.L.origin);
    u[`u${D}AtlasTex`].value.set(f.A * f.S, f.A * f.S, f.AZ * f.S);
    u[`u${D}Dims`].value.set(...f.L.dims);
    u[`u${D}H`].value = f.h;
    u[`u${D}B`].value = f.B;
    u[`u${D}S`].value = f.S;
  }
  u.uBornBase.value = bornBase;
  u.uBornRange.value = bornRange;
  u.uUnit.value = world.unit ?? UNIT;
  look();
}

/** The density field's shape numbers from the exhibition knobs (fuse.ts: the blur a box of 2r+1 voxels, the sag's rows). */
function densParams() {
  const vs = X.voxel, r = Math.max(0, Math.round(X.blur));
  const sag = Math.min(0.95, X.sag);
  const rows = X.sag > 0.01 ? Math.min(10, Math.ceil(Math.log(0.03) / Math.log(sag))) : 0;
  return { vs, w: (r + 0.5) * vs, we: 1.5 * vs, sag: X.sag > 0.01 ? sag : 0, skel: X.skeleton, wrap: X.skeletonWrap, down: rows * vs, sig: [vs, r, rows, sag, X.skeleton, X.skeletonWrap, P.unit].join() };
}

function look() {
  const u = marchMat.uniforms;
  if (EXHIBIT) {
    const dp = densParams();
    u.uVs.value = dp.vs;
    u.uW.value = dp.w;
    u.uIso.value = X.iso;
    u.uGain.value = X.gain;
    u.uFOn.value = X.fuseOnset;
    u.uFFull.value = X.fuseFull;
    u.uFFrom.value = X.fossilFrom;
    u.uFTo.value = X.fossilTo;
    u.uFNoise.value = X.fossilNoise;
    u.uBlocky.value = X.blocky;
    u.uScatter.value = X.scatter;
    u.uEnv.value = X.envelope;
    u.uFillOut.value = X.fill ? 0.35 : 1; // FILL_OUTSIDE: outside the rooms the mass hardly swells past its parts
    u.uAgeK.value = P.ageK;
    u.uReach.value = 2 * dp.vs + 0.5 * P.vh;
  }
  u.uTop.value = P.top;
  u.uHeight.value = world.slots;
  u.uPad.value = P.pad;
  u.uOnset.value = P.onset;
  u.uFullAt.value = Math.max(P.onset + 0.01, P.fullAt);
  u.uAgeMix.value = P.ageMix;
  u.uAgeSpan.value = P.ageSpan;
  u.uAfter.value = P.after;
  u.uOver.value = P.over;
  u.uFloor.value = P.top - world.slots - 2;
  u.uLate.value = P.late;
  u.uRise.value = P.rise;
  u.uDie.value = P.die ? 1 : 0;
  u.uDieMix.value = P.dieMix;
  u.uDieAt.value = P.dieAt;
  u.uDieOver.value = P.dieOver;
  u.uDieAfter.value = P.dieAfter;
  u.uDieSpan.value = P.dieSpan;
  u.uDieHoles.value = P.holes;
  u.uGrain.value = P.grain;
  u.uRag.value = P.rag;
  u.uPatch.value = P.patch;
  u.uSteps.value = P.steps;
  marchBox.visible = P.fossil;
  if (partsMesh) partsMesh.visible = P.parts;
  dirty = true;
}

function buildAll() {
  const t0 = performance.now();
  world = DUMP ? { ...DUMP, prims: DUMP.prims.slice() } : generate({ n: P.n, slots: P.slots, seed: P.seed });
  const dp = EXHIBIT ? densParams() : null;
  if (EXHIBIT && P.unit > 0) {
    const u = units(world.prims, world.count, P.unit, world.unit ?? UNIT);
    world = { ...world, prims: u.prims, count: u.count, units: u.units };
  }
  if (EXHIBIT) {
    // the rooms between plates (fuse.ts B FILL: at most FILL_MAX_GAP = 6 slots, at least two voxels)
    const r = rooms(world.prims, world.count, { maxGap: 6 * (world.unit ?? UNIT), minGap: 2 * dp.vs });
    world = { ...world, prims: r.prims, count: r.count, rooms: r.rooms };
  }
  const t1 = performance.now();
  bornBase = Infinity;
  let bmax = -Infinity;
  for (let i = 0; i < world.count; i++) {
    const b = world.prims[i * 12 + 8];
    bornBase = Math.min(bornBase, b);
    bmax = Math.max(bmax, b);
  }
  bornRange = Math.max(1, bmax - bornBase);
  primTex?.dispose();
  primTex = makePrimTex(world.prims, world.count);
  fieldD?.dispose();
  fieldV?.dispose();
  // a brick of 16 at the fine grid (lists stay short to make; 8 at the coarse)
  if (EXHIBIT) {
    // the density field on the exhibition's own grid (voxel); what it holds reaches two voxels past a part, and the
    // sag's rows below it
    fieldD = new Field("density", dp.vs, 16, false, dp, Math.max(dp.w, dp.we + 0.5 * dp.vs) + dp.vs, dp.down);
    fieldV = new Field("values", P.vh, 8, true, null, P.R, dp.down);
    builtSig = dp.sig;
  } else {
    fieldD = new Field("distance", P.res, P.res < 0.5 ? 16 : 8, false);
    fieldV = new Field("values", P.vh, 8, true);
  }
  const sd = fieldD.build(world);
  const sv = fieldV.build(world);
  makeParts(world);
  setUniforms();
  last.build = { boxes: world.boxes, tubes: world.tubes, buildings: world.buildings, genMs: t1 - t0, d: sd, v: sv, totalMs: performance.now() - t0 };
  report();
  return last.build;
}

/** One box moves (a part changed): what it costs to bring the field up to date. */
function changeOne(dx = 1.2) {
  let i;
  do i = Math.floor(Math.random() * world.count);
  while (world.prims[i * 12 + 11] > 0.5);
  const wasD = primAabb(world.prims, i, fieldD.L.m), wasV = primAabb(world.prims, i, fieldV.L.m);
  const o = i * 12;
  world.prims[o] += dx;
  world.prims[o + 5] *= 1.3; // and it grows
  const t0 = performance.now();
  primTex.image.data.set(world.prims.subarray(o, o + 12), o);
  primTex.addUpdateRange(o, 12);
  primTex.needsUpdate = true;
  const sd = fieldD.update(world, i, wasD);
  const sv = fieldV.update(world, i, wasV);
  if (sd.rebuilt || sv.rebuilt) setUniforms();
  const o2 = new THREE.Matrix4();
  partMatrix(world.prims, i, o2, new THREE.Quaternion(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  partsMesh.setMatrixAt(i, o2);
  partsMesh.instanceMatrix.needsUpdate = true;
  last.update = { box: i, d: sd, v: sv, totalMs: performance.now() - t0 };
  dirty = true;
  report();
  return last.update;
}

// ───────────────────────── size, view, measuring ─────────────────────────
function size(w, h, scale = P.scale) {
  const W = w || window.innerWidth, H = h || window.innerHeight;
  renderer.setPixelRatio(scale);
  renderer.setSize(W, H, false);
  canvas.style.aspectRatio = `${W} / ${H}`;
  canvas.style.width = W / H > window.innerWidth / window.innerHeight ? "100vw" : "auto";
  canvas.style.height = W / H > window.innerWidth / window.innerHeight ? "auto" : "100vh";
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  dirty = true;
}

/** The two views of the gallery shots: from above (shot1) and from the side (shot3), the column filling the frame. */
function cam(kind) {
  const b = world.bounds;
  const c = new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
  const ext = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
  const vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * camera.aspect);
  const dist = (0.62 * ext) / Math.tan(Math.min(vf, hf));
  const dir = kind === "top" ? new THREE.Vector3(0.18, 1, 0.3) : new THREE.Vector3(1, 0.1, 0.35);
  camera.position.copy(c).addScaledVector(dir.normalize(), dist);
  controls.target.copy(c);
  camera.lookAt(c);
  controls.update();
  P.cam = kind;
  const img = document.getElementById("shotimg");
  if (img) img.src = `./gallery/${kind === "top" ? "shot1" : "shot3"}.webp`;
  dirty = true;
}

function frameView() {
  if (EXHIBIT) return cam(P.cam);
  const b = world.bounds;
  const c = new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
  controls.target.copy(c);
  camera.position.set(c.x + 330, c.y + 120, c.z + 420);
  camera.lookAt(c);
  if (q.get("view") === "close") {
    camera.position.set(c.x + 70, c.y - 20, c.z + 90);
    controls.target.set(c.x, c.y - 45, c.z);
  }
  controls.update();
}

let timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2");

function frame() {
  renderer.render(scene, camera);
}

/**
 * Frames at a size. WAITED FOR: each frame drawn and read back before the next (the camera turning round the
 * column) — what a frame costs the GPU, whether the pane is shown or not; its inverse is the most frames a second
 * this machine could draw. And, when the page is shown, the browser's own pace (rAF, capped by the display).
 */
async function bench(w, h, sec = 4, scale = P.scale) {
  size(w, h, scale);
  const c = controls.target.clone(), off = camera.position.clone().sub(c);
  const turn = (i) => {
    const a = i * 0.02;
    camera.position.set(c.x + off.x * Math.cos(a) - off.z * Math.sin(a), c.y + off.y, c.z + off.x * Math.sin(a) + off.z * Math.cos(a));
    camera.lookAt(c);
  };
  const waited = [];
  // (the first frames at a new size compile and allocate: not counted)
  for (let i = 0; i < 3; i++) {
    turn(i);
    frame();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncBuf);
  }
  const tStart = performance.now();
  let i = 0;
  const gpu = [];
  while (performance.now() - tStart < sec * 1000) {
    const t = performance.now();
    turn(i++);
    const g = await gpuTime(frame);
    if (g !== null) gpu.push(g);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncBuf);
    waited.push(performance.now() - t);
  }
  // A BATCH WAITED FOR ONCE (works hidden too): K frames and one read-back, less K empty frames and one read-back
  const K = 12;
  const batch = (draw) => {
    const t = performance.now();
    for (let k = 0; k < K; k++) {
      turn(i++);
      if (draw) frame();
      else renderer.clear();
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncBuf);
    return performance.now() - t;
  };
  const full = [], empty = [];
  for (let r = 0; r < 3; r++) {
    empty.push(batch(false));
    full.push(batch(true));
    await yieldNow();
  }
  const dts = [];
  if (!document.hidden) {
    // (the pane may say it is shown and paint nothing: no frame within a second, and this part is left out)
    await new Promise((done) => {
      let t0 = 0, prev = 0, n = 0, alive = performance.now();
      const tick = (now) => {
        alive = performance.now();
        turn(i++);
        frame();
        n++;
        if (n === 10) t0 = now;
        if (n > 10) dts.push(now - prev);
        prev = now;
        if (n > 10 && now - t0 > sec * 1000) done();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const guard = () => (performance.now() - alive > 1000 ? done() : yieldNow().then(guard));
      guard();
    });
  }
  camera.position.copy(c).add(off);
  camera.lookAt(c);
  dirty = true;
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  const p95 = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] : null);
  const r = {
    w: w || window.innerWidth,
    h: h || window.innerHeight,
    scale,
    frames: waited.length,
    batchMs: (Math.min(...full) - Math.min(...empty)) / K,
    gpuMs: med(gpu),
    gpuP95: p95(gpu),
    waitedMs: med(waited),
    waitedP95: p95(waited),
    maxFps: 1000 / med(waited),
    rafFps: dts.length ? 1000 / (dts.reduce((s, x) => s + x, 0) / dts.length) : null,
    jsHeapMB: performance.memory ? performance.memory.usedJSHeapSize / 1e6 : null,
  };
  (last.bench ??= []).push(r);
  report();
  return r;
}

function gpuMB() {
  const f = (x) => (x ? x.atlasMB + x.pageMB + x.listMB : 0);
  const prim = primTex ? primTex.image.data.byteLength / 1e6 : 0;
  const px = renderer.domElement.width * renderer.domElement.height;
  return { fieldMB: f(fieldD?.stats) + f(fieldV?.stats) + prim, canvasMB: (px * 4 * 3) / 1e6 };
}

function report() {
  const b = last.build;
  const lines = [];
  if (b) {
    const d = b.d, v = b.v, g = gpuMB();
    if (EXHIBIT) lines.push(`<b>A · 덩어리</b> — 값 ${P.set === "1101" ? "① 전시 서버 저장값 11/01" : "② 작가의 11/15 내보내기"} · 격자 ${+X.voxel.toFixed(2)} · 단위 ${P.unit ? `${P.unit} 월드 (몸통 ${world.units})` : "없음"} · 방 ${world.rooms ?? 0}개`);
    lines.push(`<b>${b.boxes} boxes + ${b.tubes} pipes/ways</b> (${b.buildings} buildings) · fine grid ${EXHIBIT ? +X.voxel.toFixed(2) : P.res} · values ${P.vh}`);
    lines.push(`distance: ${d.bricks}/${d.of} bricks (${((100 * d.bricks) / d.of).toFixed(0)}%) · ${(d.voxels / 1e6).toFixed(1)} M voxels · atlas ${d.atlasMB.toFixed(0)} MB · list ${d.listAvg.toFixed(0)}/brick`);
    lines.push(`build: lists ${d.cpuListsMs.toFixed(0)} ms + GPU ${d.gpuMs?.toFixed(0) ?? "…"} ms · values lists ${v.cpuListsMs.toFixed(0)} + GPU ${v.gpuMs?.toFixed(0) ?? "…"} ms · waited for, all ${b.totalMs.toFixed(0)} ms`);
    lines.push(`GPU memory ≈ field ${g.fieldMB.toFixed(0)} MB + canvas ${g.canvasMB.toFixed(0)} MB`);
  }
  if (last.update) {
    const u = last.update;
    lines.push(`one box changed: distance ${u.d.bricks} bricks GPU ${u.d.gpuMs?.toFixed(2) ?? "…"} ms · values ${u.v.bricks} bricks GPU ${u.v.gpuMs?.toFixed(2) ?? "…"} ms · CPU ${(u.d.cpuMs + u.v.cpuMs).toFixed(1)} ms`);
  }
  for (const r of (last.bench ?? []).slice(-4)) lines.push(`${r.w}×${r.h}${r.scale !== 1 ? ` ×${r.scale}` : ""}: GPU ${r.gpuMs?.toFixed(1) ?? "?"} ms a frame (p95 ${r.gpuP95?.toFixed(0) ?? "?"}) · waited for ${r.waitedMs.toFixed(0)} ms${r.rafFps ? ` · shown ${r.rafFps.toFixed(0)} fps` : ""}`);
  outEl.innerHTML = lines.join("\n");
}

// ───────────────────────── controls ─────────────────────────
P.cam = q.get("cam") === "top" ? "top" : "side";
P.shot = q.get("shot") === "1";
const gui = new GUI({ title: EXHIBIT ? "화석 GPU 장 — A 덩어리" : "fossil GPU trial" });
if (EXHIBIT) {
  // THE STAGE'S KNOBS ONLY (the exhibition's names; plan §6 A): the set of values, then each knob in place
  let rebuildTimer = 0;
  const knob = () => {
    if (densParams().sig !== builtSig) {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => buildAll(), 350);
    }
    look();
    report();
  };
  const fa = gui.addFolder("A · 덩어리 — 전시 값");
  const setCtl = fa.add(P, "set", { "① 전시 서버 저장값 (11/01)": "1101", "② 작가의 11/15 내보내기": "1115" }).name("값 벌");
  const ks = [];
  const add = (k, a, b, st, name) => ks.push(fa.add(X, k, a, b, st).name(name).onChange(knob));
  add("voxel", 0.2, 0.5, 0.05, "격자 간격 (월드 · 다시 만듦)");
  add("blur", 0, 3, 1, "메워지는 틈의 너비 (복셀 · 다시 만듦)");
  add("gain", 0.5, 6, 0.1, "이어 붙는 세기");
  add("iso", 0.05, 0.9, 0.01, "덩어리로 치는 밀도 기준 (낮출수록 두꺼움)");
  add("sag", 0, 0.95, 0.01, "아래로 흘러내림 (다시 만듦)");
  add("envelope", 0, 1, 0.05, "겉면은 건물 윤곽대로");
  ks.push(fa.add(X, "fill").name("판 사이 방 밖에서는 덜 부풂 (채우기 켬)").onChange(knob));
  add("skeleton", 0, 1, 0.01, "뼈대로 남는 부재 비율 (다시 만듦)");
  add("skeletonWrap", 0, 1, 0.05, "뼈대가 덩어리에 덮이는 정도 (다시 만듦)");
  add("blocky", 0, 1, 0.05, "젊은 층의 블로키 (복셀 계단)");
  add("scatter", 0, 2, 0.05, "얇은 덩어리를 조각냄 (젊은 층)");
  add("fuseOnset", 0, 1, 0.01, "덩어리가 나오기 시작하는 층의 나이");
  add("fuseFull", 0, 1, 0.01, "덩어리가 다 나온 층의 나이");
  add("fossilFrom", 0, 1, 0.01, "화석이 되기 시작하는 층의 나이");
  add("fossilTo", 0.05, 1, 0.01, "다 화석이 되는 층의 나이");
  add("fossilNoise", 0, 0.6, 0.01, "화석화 경계의 흔들림");
  fa.add(P, "ageK", 0.3, 2, 0.05).name("층의 나이 = 창 깊이 × 이 값").onChange(knob);
  fa.add(P, "unit", { "덤프된 상자 그대로 (0.2 격자)": 0, "1 월드": 1, "2 월드 (벽의 기본)": 2, "3 월드": 3 }).name("화석의 단위 — 더 크게 어림한 몸통 (다시 만듦)").onChange((v) => ((P.unit = Number(v)), knob()));
  setCtl.onChange(() => {
    Object.assign(X, SETS[P.set]);
    for (const c of ks) c.updateDisplay();
    knob();
  });
  const fv = gui.addFolder("보기 · 재기");
  fv.add({ go: () => cam("top") }, "go").name("위에서 (전시 사진 1처럼)");
  fv.add({ go: () => cam("side") }, "go").name("옆에서 (전시 사진 3처럼)");
  fv.add(P, "shot").name("전시 사진을 옆에 띄움").onChange((v) => (document.getElementById("shot").style.display = v ? "block" : "none"));
  fv.add(P, "parts").name("부재 보기").onChange(look);
  fv.add(P, "fossil").name("화석 보기").onChange(look);
  fv.add(P, "top", 1, P.slots + 40, 0.5).name("창의 꼭대기 (단)").onChange(look);
  fv.add(P, "scale", { "제 해상도": 1, "절반 해상도": 0.5 }).name("화석 해상도").onChange((v) => size(P.w, P.h, Number(v)));
  fv.add({ go: () => { P.w = 1080; P.h = 1920; size(P.w, P.h, P.scale); cam(P.cam); } }, "go").name("세로 TV 크기 (1080 × 1920)");
  fv.add({ go: () => { P.w = 0; P.h = 0; size(0, 0, P.scale); cam(P.cam); } }, "go").name("창 크기에 맞춤");
  fv.add({ go: async () => { await bench(P.w, P.h, 3, Number(P.scale)); cam(P.cam); } }, "go").name("이 크기에서 한 프레임 재기");
  fv.add(P, "steps", 64, 800, 1).name("광선 걸음 수").onChange(look);
}
if (!EXHIBIT) {
  gui.add(P, "top", 1, P.slots + 40, 0.5).name("창의 꼭대기 (단)").onChange(look);
  gui.add(P, "parts").name("부재 보기").onChange(look);
  gui.add(P, "fossil").name("화석 보기").onChange(look);
}
const fb = gui.addFolder(EXHIBIT ? "시험 (값 재기)" : "필드 (다시 만듦)");
if (!EXHIBIT) {
  fb.add(P, "res", [0.35, 0.5, 0.7, 1.0]).name("격자 (world)");
  fb.add(P, "n", 2000, 30000, 1000).name("상자 수");
}
fb.add({ go: () => buildAll() }, "go").name("다시 만들기");
fb.add({ go: () => changeOne() }, "go").name("상자 하나 바꾸기");
const fl = gui.addFolder("모양 (작가 값)");
if (EXHIBIT) fl.hide();
fl.add(P, "pad", 0, 1.5, 0.05).name("덩어리 두께").onChange(look);
fl.add(P, "onset", 0, 1, 0.01).onChange(look);
fl.add(P, "fullAt", 0, 1, 0.01).onChange(look);
fl.add(P, "ageMix", 0, 1, 0.05).onChange(look);
fl.add(P, "ageSpan", 2, 200, 1).onChange(look);
fl.add(P, "late", 0, 0.9, 0.05).name("골조 먼저").onChange(look);
fl.add(P, "die").name("수명").onChange(look);
fl.add(P, "dieAt", 0, 1.5, 0.01).onChange(look);
fl.add(P, "holes", 0, 1, 0.05).onChange(look);
fl.add(P, "grain", 0.1, 4, 0.05).onChange(look);
fl.add(P, "rag", 0, 1, 0.05).onChange(look);
fl.add(P, "steps", 32, 512, 1).name("광선 걸음 수").onChange(look);
fl.close();
fb.close();
if (q.get("gui") === "0") gui.hide();

window.addEventListener("resize", () => {
  if (!P.w) size(P.w, P.h);
});

size(P.w, P.h);
try {
  buildAll();
} catch (e) {
  outEl.textContent = String(e?.stack ?? e);
  throw e;
}
frameView();
let paused = false;
function loop() {
  controls.update();
  if (!paused && (dirty || controls.autoRotate)) {
    frame();
    dirty = false;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

if (EXHIBIT && P.shot) document.getElementById("shot").style.display = "block";
/** One frame drawn and read back small (a check of the look while the page is hidden). */
function snap(w = 900) {
  frame();
  const src = renderer.domElement, c = document.createElement("canvas");
  c.width = w;
  c.height = Math.round((w * src.height) / src.width);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}
window.__trial = { snap, cam, X, SETS, densParams, yieldNow, pause: (v) => (paused = v), settle, gpuTime, P, buildAll, changeOne, bench, size, look, report, gpuMB, last: () => last, timer: !!timerExt, renderer, controls, camera };

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
import { generate, brickLists, primAabb, UNIT } from "./gen.js";

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);

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
  steps: num("steps", 220),
};
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
uniform vec3 uOrigin;
out vec4 fragColor;
vec4 fetch( sampler2D t, int i ) { return texelFetch( t, ivec2( i & 4095, i >> 12 ), 0 ); }
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
#ifdef VALUES
  float wsum = 0.0, veg = 0.0, late = 0.0, bm = -1e9, bs = 0.0, bws = 0.0;
#endif
  for ( int n = 0; n < cnt; n++ ) {
    int pi = int( fetch( uLists, off + n ).r );
    vec4 a = fetch( uPrims, pi * 3 ), b = fetch( uPrims, pi * 3 + 1 ), c = fetch( uPrims, pi * 3 + 2 );
    float d;
    if ( c.w < 0.5 ) {
      // a box in its own turn (writeMatrix's turn undone)
      vec3 dp = p - a.xyz;
      vec3 l = vec3( dp.x * a.w - dp.z * b.w, dp.y, dp.x * b.w + dp.z * a.w );
      vec3 qd = abs( l ) - b.xyz;
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
  float d = sumE > 0.0 ? -uK * log( sumE ) : uR;
#ifdef VALUES
  fragColor = vec4( bws > 0.0 ? clamp( bs / bws / uBornRange, 0.0, 1.0 ) : 0.0, wsum > 0.0 ? veg / wsum : 0.0, wsum > 0.0 ? late / wsum : 0.0, clamp( d / uR * 0.5 + 0.5, 0.0, 1.0 ) );
#else
  fragColor = vec4( clamp( d / uR * 0.5 + 0.5, 0.0, 1.0 ), 0.0, 0.0, 1.0 );
#endif
}`;

const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

class Field {
  constructor(name, h, B, values) {
    this.name = name;
    this.h = h;
    this.B = B;
    this.S = B + 2;
    this.values = values;
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: QUAD_VERT,
      fragmentShader: SPLAT_FRAG,
      defines: values ? { VALUES: 1 } : {},
      uniforms: {
        uPrims: { value: null }, uLists: { value: null }, uInfo: { value: null },
        uLayer: { value: 0 }, uA: { value: 1 }, uS: { value: this.S }, uNb: { value: 0 },
        uH: { value: h }, uB: { value: B }, uR: { value: P.R }, uK: { value: P.k }, uKv: { value: P.kv },
        uBornBase: { value: 0 }, uBornRange: { value: 1 }, uOrigin: { value: new THREE.Vector3() },
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
    const L = brickLists(w.prims, w.count, w.bounds, this.h, this.B, P.R);
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
      format: this.values ? THREE.RGBAFormat : THREE.RedFormat,
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
      atlasMB: (A * S * A * S * AZ * S * (this.values ? 4 : 1)) / 1e6,
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
  uniforms: {
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
  look();
}

function look() {
  const u = marchMat.uniforms;
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
  world = generate({ n: P.n, slots: P.slots, seed: P.seed });
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
  fieldD = new Field("distance", P.res, P.res < 0.5 ? 16 : 8, false);
  fieldV = new Field("values", P.vh, 8, true);
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

function frameView() {
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
    lines.push(`<b>${b.boxes} boxes + ${b.tubes} pipes/ways</b> (${b.buildings} buildings) · fine grid ${P.res} · values ${P.vh}`);
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
const gui = new GUI({ title: "fossil GPU trial" });
gui.add(P, "top", 1, P.slots + 40, 0.5).name("창의 꼭대기 (단)").onChange(look);
gui.add(P, "parts").name("부재 보기").onChange(look);
gui.add(P, "fossil").name("화석 보기").onChange(look);
const fb = gui.addFolder("필드 (다시 만듦)");
fb.add(P, "res", [0.35, 0.5, 0.7, 1.0]).name("격자 (world)");
fb.add(P, "n", 2000, 30000, 1000).name("상자 수");
fb.add({ go: () => buildAll() }, "go").name("다시 만들기");
fb.add({ go: () => changeOne() }, "go").name("상자 하나 바꾸기");
const fl = gui.addFolder("모양 (작가 값)");
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

window.__trial = { yieldNow, pause: (v) => (paused = v), settle, gpuTime, P, buildAll, changeOne, bench, size, look, report, gpuMB, last: () => last, timer: !!timerExt, renderer, controls, camera };

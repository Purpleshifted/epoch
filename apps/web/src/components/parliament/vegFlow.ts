/**
 * THE VEGETATION AS ONE BODY THAT FLOWS (the artist, 2026-11-21: "식생구름 허공에서 돌아다니게 하는 것보다 그냥 전체 식생
 * 생성해서 밀도장 따라 curl 처럼 몰려다니게 하는 거 gpu 로 가능한지").
 *
 * No clouds: the points are made over the whole block, once, and then MOVE — every frame each point takes one step
 * along a flow, on the GPU. WebGL2 has no compute shaders, so a point's place is a texel of a float texture and a
 * small fragment pass writes the next places from the last ones (two targets, turn about); the vegetation's vertex
 * shader reads its place there (ParliamentSpace VEG_VERT, uFlow). Nothing is computed or uploaded per frame on the CPU.
 *
 * THE FLOW is made from the vegetation's own density — the very share its points live by (VEG_VERT `veg`):
 *   V = (1 − the people's share) × (1 − worn by water) × the range round the ground in use
 * and it is the sum of
 *   · a SWIRL: curl noise (the curl of a slowly changing noise potential — it has no sources or sinks, so it stirs
 *     without piling up), slower where no plant can live;
 *   · ALONG THE DENSITY: the same potential bent by V (curl(V ψ) = V curl ψ + ∇V × ψ) — the flow slides along V's
 *     contours, round buildings, along ways and banks, instead of through them;
 *   · UP THE DENSITY: a drift towards where V is higher — off what is built and walked, off the water; and from far
 *     outside the range, towards the ground in use (uToward), as far as the range's rim;
 *   · HERDS: a drift towards the crests of a large slow pattern, so the points bunch and travel in flocks;
 *   · BELTS: a share of the points is drawn to the borders between the villages of their own time (uBelt);
 *   · HOME: past `stray` from where it was made a point is pulled back (0 = no limit); in height it always stays near
 *     its own, so the points go on filling the rising window.
 * What a point SHOWS is not decided here: it is still as large as V at its place is past its own draw (VEG_VERT).
 */
import * as THREE from "three";
import type { Border } from "@/lib/parliament/villageBorders";

/** The width of the places' texture (one texel a point, row after row). */
export const VEG_FLOW_W = 256;
/** How much slower (and flatter) the flow is along time than over the ground. */
const VERT = 0.35;
/** The belts' field: cells per side (half the ground's), and how far from a border it is felt (world). */
const BELT_REACH = 48;

export interface VegFlowKnobs {
  /** World units a second, about (0 = the points stand). */
  speed: number;
  /** The size of a swirl (world). */
  swirl: number;
  /** How strongly the flow follows the density: along its contours, up it, and in from beyond the range. */
  follow: number;
  /** How strongly the points bunch into herds (0 = evenly stirred). */
  herd: number;
  /** How far a point may go from where it was made (world; 0 = no limit). */
  stray: number;
}

export interface VegFlowBelts {
  share: number;
  secPerUnit: number;
  at: (t: number) => Border[];
}

export interface VegFlowEnv {
  /** The people's share and the water's wear per cell-slot, the range over the ground (the newest snapshots). */
  human: THREE.Texture | null;
  water: THREE.Texture | null;
  range: THREE.Texture | null;
  /** The window: its corner and its size (VEG_VERT uMin, uSpan), and a slot's height. */
  min: THREE.Vector3;
  span: THREE.Vector3;
  unit: number;
  knobs: VegFlowKnobs;
}

const SIM_VERT = /* glsl */ `
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const SIM_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
uniform sampler2D uState;
uniform sampler2D uHome;
uniform sampler3D uHuman;
uniform sampler3D uWater;
uniform sampler2D uRange;
uniform sampler2D uToward;
uniform sampler3D uBelt;
uniform float uInit;
uniform float uDt;
uniform float uTime;
uniform vec3 uMin;
uniform vec3 uSpan;
uniform float uCell;
uniform float uUnit;
uniform float uSpeed;
uniform float uSwirl;
uniform float uFollow;
uniform float uHerd;
uniform float uStray;
uniform float uBeltShare;
out vec4 outState;
const float VERT = ${VERT.toFixed(3)};

// (an integer hash: pcg3d — Jarzynski & Olano, "Hash Functions for GPU Rendering", JCGT 2020 — exact however long the
// wall has run, where a hash through sin() loses its digits)
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash3(vec3 cell) {
  uvec3 h = pcg3d(uvec3(ivec3(cell) + 65536));
  return vec3(h) * (2.0 / 4294967295.0) - 1.0;
}
// gradient noise with its own derivative: x = the value, yzw = its gradient (one call gives both — the curl needs
// only gradients)
vec4 noised(vec3 x) {
  vec3 i = floor(x);
  vec3 f = x - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec3 ga = hash3(i);
  vec3 gb = hash3(i + vec3(1.0, 0.0, 0.0));
  vec3 gc = hash3(i + vec3(0.0, 1.0, 0.0));
  vec3 gd = hash3(i + vec3(1.0, 1.0, 0.0));
  vec3 ge = hash3(i + vec3(0.0, 0.0, 1.0));
  vec3 gf = hash3(i + vec3(1.0, 0.0, 1.0));
  vec3 gg = hash3(i + vec3(0.0, 1.0, 1.0));
  vec3 gh = hash3(i + vec3(1.0, 1.0, 1.0));
  float va = dot(ga, f);
  float vb = dot(gb, f - vec3(1.0, 0.0, 0.0));
  float vc = dot(gc, f - vec3(0.0, 1.0, 0.0));
  float vd = dot(gd, f - vec3(1.0, 1.0, 0.0));
  float ve = dot(ge, f - vec3(0.0, 0.0, 1.0));
  float vf = dot(gf, f - vec3(1.0, 0.0, 1.0));
  float vg = dot(gg, f - vec3(0.0, 1.0, 1.0));
  float vh = dot(gh, f - vec3(1.0, 1.0, 1.0));
  float kxy = va - vb - vc + vd;
  float kyz = va - vc - ve + vg;
  float kzx = va - vb - ve + vf;
  float kk = -va + vb + vc - vd + ve - vf - vg + vh;
  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va) + u.x * u.y * kxy + u.y * u.z * kyz + u.z * u.x * kzx + u.x * u.y * u.z * kk;
  vec3 g = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga) + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg) + u.z * u.x * (ga - gb - ge + gf) + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh);
  vec3 dv = du * vec3(
    (vb - va) + u.y * kxy + u.z * kzx + u.y * u.z * kk,
    (vc - va) + u.x * kxy + u.z * kyz + u.x * u.z * kk,
    (ve - va) + u.y * kyz + u.x * kzx + u.x * u.y * kk);
  return vec4(v, g + dv);
}
// the vegetation's share at a place of the textures (x, y = the ground's x, z; depth = the slot) — VEG_VERT's veg
float vegAt(vec3 uvw) {
  float human = textureLod(uHuman, uvw, 0.0).r;
  float worn = textureLod(uWater, uvw, 0.0).r;
  return (1.0 - human) * (1.0 - worn) * textureLod(uRange, uvw.xy, 0.0).r;
}
void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  vec4 home = texelFetch(uHome, tc, 0);
  vec3 p = texelFetch(uState, tc, 0).xyz;
  // (the first frame, and a place that is no number: where it was made)
  if (uInit > 0.5 || !(dot(p, p) < 1.0e12)) {
    outState = vec4(home.xyz, 1.0);
    return;
  }
  float rnd = home.w;
  // where it is in the window, as the vertex shader takes it (its height round the window)
  float yl = mod(p.y - uMin.y, uSpan.y);
  vec3 uvw = vec3((p.x - uMin.x) / uSpan.x, (p.z - uMin.z) / uSpan.z, yl / uSpan.y);
  // one cell over the ground, one slot in time
  vec3 e = vec3(uCell / uSpan.x, uCell / uSpan.z, uUnit / uSpan.y);
  float v0 = vegAt(uvw);
  // the density's slope (a cell or a slot either way): world x, y (time), z
  vec3 g = 0.5 * vec3(
    vegAt(uvw + vec3(e.x, 0.0, 0.0)) - vegAt(uvw - vec3(e.x, 0.0, 0.0)),
    vegAt(uvw + vec3(0.0, 0.0, e.z)) - vegAt(uvw - vec3(0.0, 0.0, e.z)),
    vegAt(uvw + vec3(0.0, e.y, 0.0)) - vegAt(uvw - vec3(0.0, e.y, 0.0)));
  // THE SWIRL: the curl of a potential of three noises, each sliding its own way so the pattern changes rather than
  // passes by; flatter along time
  float L = max(1.0, uSwirl);
  vec3 q = vec3(p.x, p.y / VERT, p.z) / L;
  float tt = uTime * uSpeed / L * 0.2;
  vec4 n1 = noised(q + vec3(0.0, tt, 0.0));
  vec4 n2 = noised(q + vec3(37.2 + tt, 11.7, 5.3));
  vec4 n3 = noised(q + vec3(-19.1, 71.3, 43.9 - tt));
  vec3 psi = vec3(n1.x, n2.x, n3.x);
  vec3 curl = vec3(n3.z - n2.w, n1.w - n3.y, n2.y - n1.z);
  // HERDS: towards the crests of a larger, slower pattern
  vec3 herd = noised(q * 0.4 + vec3(91.7, 13.1 + tt * 0.5, -57.3)).yzw;
  // (which way the ground in use lies, and how far beyond the range this place is)
  vec4 tw = textureLod(uToward, uvw.xy, 0.0);
  // slower where no plant lives (but stirred whole far outside, on the way in); along the density's contours; up the
  // density; the herds gather only where plants live (a crest out in the bare ground draws nothing out of the range)
  vec3 vel = mix(0.3, 1.0, max(v0, tw.b)) * curl + uFollow * 2.0 * (cross(g, psi) + g) + uHerd * v0 * herd;
  // BELTS: a share of the points goes to the borders of its own time and stays within a band of them
  bool onBelt = false;
  if (rnd < uBeltShare) {
    float b0 = textureLod(uBelt, uvw, 0.0).r;
    if (b0 > 0.004) {
      vec2 eb = 2.0 * e.xy;
      vec2 gb = vec2(
        textureLod(uBelt, uvw + vec3(eb.x, 0.0, 0.0), 0.0).r - textureLod(uBelt, uvw - vec3(eb.x, 0.0, 0.0), 0.0).r,
        textureLod(uBelt, uvw + vec3(0.0, eb.y, 0.0), 0.0).r - textureLod(uBelt, uvw - vec3(0.0, eb.y, 0.0), 0.0).r);
      float gbl = length(gb);
      if (gbl > 1.0e-5) vel.xz += 1.5 * (1.0 - smoothstep(0.8, 0.95, b0)) * gb / gbl;
      onBelt = true;
    }
  }
  // how far it is from where it was made (the shortest way round)
  vec3 d = p - home.xyz;
  d -= uSpan * floor(d / uSpan + 0.5);
  if (!onBelt) {
    // from beyond the range: towards the ground in use, as far as the range's rim — each a little to its own side
    // of the straight way, so they come in as a front and not along a few lines
    float ta = (fract(rnd * 31.7) - 0.5) * 1.6;
    vec2 td = tw.rg * 2.0 - 1.0;
    vel.xz += uFollow * 1.5 * tw.b * vec2(cos(ta) * td.x - sin(ta) * td.y, sin(ta) * td.x + cos(ta) * td.y);
    // past its stray it is pulled back
    if (uStray > 0.0) {
      float r = length(d.xz) / uStray;
      vel.xz -= 2.0 * r * r * d.xz / uStray;
    }
  }
  // in height it stays near its own (three slots): the points go on filling the window
  float ry = d.y / (3.0 * uUnit);
  vel.y -= 3.0 * ry * abs(ry);
  float sp = length(vel);
  if (sp > 4.0) vel *= 4.0 / sp;
  vel.y *= VERT;
  // (each at a pace of its own, so a herd is not a rigid sheet)
  vec3 stp = vel * uSpeed * (0.6 + 0.8 * fract(rnd * 7.13)) * uDt;
  // the window's foot and top are not crossed
  float ny = yl + stp.y;
  if (ny < 0.0 || ny > uSpan.y) stp.y = 0.0;
  p += stp;
  // (the ground wraps; the height is kept round the window)
  p.x = uMin.x + mod(p.x - uMin.x, uSpan.x);
  p.z = uMin.z + mod(p.z - uMin.z, uSpan.z);
  p.y = mod(p.y, uSpan.y);
  outState = vec4(p, 1.0);
}`;

/** Whether this renderer can draw into float textures (the places' texture needs whole floats: a half float's step
 *  is larger than a point's step a frame). */
export function vegFlowSupported(gl: THREE.WebGLRenderer): boolean {
  return gl.extensions.has("EXT_color_buffer_float");
}

export class VegFlow {
  /** Rows of the places' texture. */
  readonly rows: number;
  private readonly targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly home: THREE.DataTexture;
  private readonly toward: THREE.DataTexture;
  private readonly belt: THREE.Data3DTexture;
  private readonly beltN: number;
  private readonly mat: THREE.RawShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.Camera();
  private readonly tri: THREE.BufferGeometry;
  private now = 0;
  private fresh = true;
  private time = 0;
  private beltKey: unknown = undefined;
  private beltBase = -1;
  private beltShare = 0;
  private readonly beltFields = new WeakMap<Border[], Uint8Array>();

  /**
   * @param homes where each point was made (x, y, z a point — the geometry's own positions)
   * @param cells the ground's cells per side (the people's texture's width)
   * @param depth the window's slots (the people's texture's depth)
   */
  constructor(homes: ArrayLike<number>, private readonly cells: number, private readonly depth: number) {
    const n = Math.floor(homes.length / 3);
    this.rows = Math.max(1, Math.ceil(n / VEG_FLOW_W));
    const hd = new Float32Array(VEG_FLOW_W * this.rows * 4);
    let a = 0x51f15e3;
    const rnd = () => ((a = Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296;
    for (let i = 0; i < n; i++) {
      hd[i * 4] = homes[i * 3];
      hd[i * 4 + 1] = homes[i * 3 + 1];
      hd[i * 4 + 2] = homes[i * 3 + 2];
      // (a number of its own: its pace, and whether it is a belt's)
      hd[i * 4 + 3] = rnd();
    }
    this.home = new THREE.DataTexture(hd, VEG_FLOW_W, this.rows, THREE.RGBAFormat, THREE.FloatType);
    this.home.minFilter = this.home.magFilter = THREE.NearestFilter;
    this.home.generateMipmaps = false;
    this.home.needsUpdate = true;
    const mk = () => {
      const t = new THREE.WebGLRenderTarget(VEG_FLOW_W, this.rows, {
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      return t;
    };
    this.targets = [mk(), mk()];
    // which way the ground in use lies from each cell (rg), and how far beyond the range the cell is (b)
    this.toward = new THREE.DataTexture(new Uint8Array(cells * cells * 4), cells, cells, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.toward.minFilter = this.toward.magFilter = THREE.LinearFilter;
    this.toward.generateMipmaps = false;
    this.toward.needsUpdate = true;
    // how near each cell-slot is to a border of its time (half the ground's cells a side)
    this.beltN = Math.max(8, Math.round(cells / 2));
    this.belt = new THREE.Data3DTexture(new Uint8Array(this.beltN * this.beltN * depth), this.beltN, this.beltN, depth);
    this.belt.format = THREE.RedFormat;
    this.belt.type = THREE.UnsignedByteType;
    this.belt.minFilter = this.belt.magFilter = THREE.LinearFilter;
    this.belt.wrapS = this.belt.wrapT = this.belt.wrapR = THREE.ClampToEdgeWrapping;
    this.belt.unpackAlignment = 1;
    this.belt.needsUpdate = true;
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SIM_VERT,
      fragmentShader: SIM_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      uniforms: {
        uState: { value: this.home },
        uHome: { value: this.home },
        uHuman: { value: null },
        uWater: { value: null },
        uRange: { value: null },
        uToward: { value: this.toward },
        uBelt: { value: this.belt },
        uInit: { value: 1 },
        uDt: { value: 0 },
        uTime: { value: 0 },
        uMin: { value: new THREE.Vector3() },
        uSpan: { value: new THREE.Vector3(1, 1, 1) },
        uCell: { value: 1 },
        uUnit: { value: 1 },
        uSpeed: { value: 0 },
        uSwirl: { value: 14 },
        uFollow: { value: 1 },
        uHerd: { value: 0 },
        uStray: { value: 0 },
        uBeltShare: { value: 0 },
      },
    });
    // (one triangle over the whole target)
    this.tri = new THREE.BufferGeometry();
    this.tri.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const mesh = new THREE.Mesh(this.tri, this.mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** Whether the places have been written at all (before the first step the texture holds nothing). */
  get ready(): boolean {
    return !this.fresh;
  }

  /** Where the points are now (xyz a texel; the vertex shader's uFlow). */
  get texture(): THREE.Texture {
    return this.targets[this.now].texture;
  }

  /** One step of every point along the flow (once a frame, before the wall is drawn). */
  step(gl: THREE.WebGLRenderer, dt: number, env: VegFlowEnv): void {
    if (!env.human || !env.water || !env.range) return;
    const u = this.mat.uniforms;
    const k = env.knobs;
    // (a stalled frame does not throw the points)
    const d = Math.max(0, Math.min(0.1, dt));
    this.time += d;
    u.uState.value = this.fresh ? this.home : this.targets[this.now].texture;
    u.uInit.value = this.fresh ? 1 : 0;
    u.uHuman.value = env.human;
    u.uWater.value = env.water;
    u.uRange.value = env.range;
    u.uDt.value = d;
    u.uTime.value = this.time;
    (u.uMin.value as THREE.Vector3).copy(env.min);
    (u.uSpan.value as THREE.Vector3).copy(env.span);
    u.uCell.value = env.span.x / this.cells;
    u.uUnit.value = env.unit;
    u.uSpeed.value = Math.max(0, k.speed);
    u.uSwirl.value = Math.max(1, k.swirl);
    u.uFollow.value = Math.max(0, k.follow);
    u.uHerd.value = Math.max(0, k.herd);
    u.uStray.value = Math.max(0, k.stray);
    u.uBeltShare.value = this.beltShare;
    const to = this.fresh ? this.now : 1 - this.now;
    const was = gl.getRenderTarget();
    gl.setRenderTarget(this.targets[to]);
    gl.render(this.scene, this.cam);
    gl.setRenderTarget(was);
    this.now = to;
    this.fresh = false;
  }

  /**
   * WHICH WAY THE GROUND IN USE LIES, for the points beyond the range: from the map of how far each cell lies from it
   * (cells; the vegetation's own — ParliamentSpace Vegetation), the way down that distance, felt from about the
   * range's rim (`rim` cells) outwards. null = no range (plants over the whole ground): nothing is drawn in.
   */
  writeToward(dist: Float32Array | null, rim: number): void {
    const N = this.cells;
    const out = this.toward.image.data as Uint8Array;
    if (!dist || dist.length !== N * N) out.fill(0);
    else {
      const lo = 0.85 * rim, hi = Math.max(lo + 1, 1.5 * rim);
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const c = j * N + i, v = dist[c];
          const gx = dist[i < N - 1 ? c + 1 : c] - dist[i > 0 ? c - 1 : c];
          const gz = dist[j < N - 1 ? c + N : c] - dist[j > 0 ? c - N : c];
          const gl = Math.hypot(gx, gz);
          // (nothing in use anywhere: no way to go)
          const ok = v < 1e8 && gl > 1e-6;
          const far = ok ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0;
          out[c * 4] = ok ? Math.round(127.5 - 127.5 * (gx / gl)) : 128;
          out[c * 4 + 1] = ok ? Math.round(127.5 - 127.5 * (gz / gl)) : 128;
          out[c * 4 + 2] = Math.round(255 * far * far * (3 - 2 * far));
          out[c * 4 + 3] = 255;
        }
    }
    this.toward.needsUpdate = true;
  }

  /**
   * THE BELTS' FIELD: per slot of the window, how near each place is to a border between the villages alive at that
   * slot's time (1 on it, 0 from BELT_REACH on). Laid again only when the borders or the window's first slot change;
   * one map a set of borders (the sets in a window are few), copied into each of its slots.
   */
  writeBelts(belts: VegFlowBelts | null, base: number, halfWorld: number): void {
    this.beltShare = belts ? Math.max(0, Math.min(1, belts.share)) : 0;
    if (belts === this.beltKey && base === this.beltBase) return;
    this.beltKey = belts;
    this.beltBase = base;
    const NB = this.beltN, data = this.belt.image.data as Uint8Array;
    data.fill(0);
    if (belts) {
      const C = (2 * halfWorld) / NB;
      for (let k = 0; k < this.depth; k++) {
        const bs = belts.at((base + k + 0.5) * belts.secPerUnit);
        if (!bs.length) continue;
        let f = this.beltFields.get(bs);
        if (!f) {
          f = new Uint8Array(NB * NB);
          for (let j = 0; j < NB; j++)
            for (let i = 0; i < NB; i++) {
              const x = -halfWorld + (i + 0.5) * C, z = -halfWorld + (j + 0.5) * C;
              let best = Infinity;
              for (const b of bs) {
                const ex = b.bx - b.ax, ez = b.bz - b.az, L2 = ex * ex + ez * ez || 1e-9;
                const t = Math.max(0, Math.min(1, ((x - b.ax) * ex + (z - b.az) * ez) / L2));
                const dd = Math.hypot(b.ax + ex * t - x, b.az + ez * t - z);
                if (dd < best) best = dd;
              }
              f[j * NB + i] = Math.round(255 * Math.max(0, 1 - best / BELT_REACH));
            }
          this.beltFields.set(bs, f);
        }
        data.set(f, k * NB * NB);
      }
    }
    this.belt.needsUpdate = true;
  }

  dispose(): void {
    this.targets.forEach((t) => t.dispose());
    this.home.dispose();
    this.toward.dispose();
    this.belt.dispose();
    this.mat.dispose();
    this.tri.dispose();
  }
}

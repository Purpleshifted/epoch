/**
 * THE FOSSIL AS ONE FIELD ON THE GPU — the textures and the baking (2026-11-20, branch gpu-optimized; fuse.ts `field`;
 * the artist: "건물은 그대로 두고 화석만 장으로", "실제 벽에서만 보여 주기").
 *
 * Two fields of bricks (lib/parliament/fossilField.ts), each an atlas in a 3D texture and a page table:
 *
 * - THE DISTANCES (a sample 0.35 world): to the nearest of the fossil's boxes; the same with the two nearest joined
 *   softly (what an old layer rounds into); to the nearest EDGE of a body or a plate (the frame: the pipes that
 *   stand first); to the nearest plate.
 * - THE PLACE'S VALUES (a sample 1 world — the redesign's "place values", fuseUnits.ts placeValues): when the place
 *   hardened — THE YOUNGEST THING THERE IS THE PLACE'S AGE — and the means of what stands there of `own` (sooner or
 *   later) and `most` (how much of it the vegetation makes), each reaching 2.5 world out of its box.
 *
 * Nothing here knows the time: the fields are baked from the boxes alone, a few bricks a frame where a box came,
 * went or changed. How far the fossil is out at a place, and in what shape, is worked out per pixel when it is
 * drawn (FossilFieldPass.tsx), from the place's age on the wall's one ruler.
 */

import * as THREE from "three";
import { BrickGrid, FossilStore, PAGE, PRIM_FLOATS, type BrickSpec } from "@/lib/parliament/fossilField";
import { FOSSIL_BOX, type FossilDiff } from "@/lib/parliament/spaceModel";

/** How far from a box the distances are kept (world): what a byte holds, ± this. */
export const FIELD_REACH = 1.6;
/** How far out of a box its place's values reach (world). */
export const VALUE_REACH = 2.5;
/** The hardening times are kept over this many slots from their base (16 bits: 1/64 of a slot). */
const BORN_RANGE = 1024;
const PRIM_W = 1024;
const LIST_W = 512, LIST_H = 128;

const QUAD_VERT = /* glsl */ `
in vec3 aBrick; in vec2 aList; in vec2 aOrigin;
flat out vec3 vBrick; flat out vec2 vList; flat out vec2 vOrigin;
void main() { vBrick = aBrick; vList = aList; vOrigin = aOrigin; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const BAKE_FRAG = /* glsl */ `
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uPrims, uLists;
uniform int uLayer;
uniform float uH, uB, uR, uSoft, uJoint, uReachV, uBornBase, uBornRange;
flat in vec3 vBrick; flat in vec2 vList; flat in vec2 vOrigin;
out vec4 fragColor;
vec4 prim( int i ) { return texelFetch( uPrims, ivec2( i & ${PRIM_W - 1}, i >> ${Math.log2(PRIM_W)} ), 0 ); }
float enc( float d ) { return clamp( d / uR * 0.5 + 0.5, 0.0, 1.0 ); }
void main() {
  ivec3 j = ivec3( ivec2( gl_FragCoord.xy ) - ivec2( vOrigin ), uLayer );
  vec3 p = ( vBrick * uB + vec3( j ) - 0.5 ) * uH;
  int off = int( vList.x ), cnt = int( vList.y );
#ifdef VALUES
  float ws = 0.0, own = 0.0, most = 0.0, bm = -1e9, bs = 0.0, bw = 0.0;
#else
  float d1 = 1e3, d2 = 1e3, fr = 1e3, pl = 1e3;
#endif
  for ( int n = 0; n < cnt; n++ ) {
    int li = off + n;
    int pi = int( texelFetch( uLists, ivec2( li & ${LIST_W - 1}, li >> ${Math.log2(LIST_W)} ), 0 ).r );
    vec4 a = prim( pi * 3 ), b = prim( pi * 3 + 1 ), c = prim( pi * 3 + 2 );
    if ( c.w < -0.5 ) continue;
    // a box in its own turn (the wall's writeMatrix turn undone, as fuseUnits growData does)
    vec3 dp = p - a.xyz;
    vec3 l = vec3( dp.x * a.w - dp.z * b.w, dp.y, dp.x * b.w + dp.z * a.w );
    vec3 q = abs( l ) - b.xyz;
    float d = length( max( q, 0.0 ) ) + min( max( q.x, max( q.y, q.z ) ), 0.0 );
#ifdef VALUES
    float w = max( 0.0, 1.0 - max( d, 0.0 ) / uReachV );
    w *= w;
    if ( w <= 0.0 ) continue;
    ws += w; own += w * c.y; most += w * c.z;
    // THE YOUNGEST THING IN A PLACE IS THE PLACE'S AGE (fuseUnits placeValues): the hardening times weighed towards
    // the latest (half a slot of softness), so a new building among old ones does not inherit their age
    float t = ( c.x - uBornBase ) * 2.0;
    if ( t > bm ) { float sc = exp( bm - t ); bs *= sc; bw *= sc; bm = t; }
    float e = w * exp( t - bm ); bs += e * ( c.x - uBornBase ); bw += e;
#else
    if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d;
    if ( c.w < 0.5 ) pl = min( pl, d );
    if ( c.w < 1.5 ) {
      // THE FRAME: the box's twelve edges (a body's — the fossil's unit: a building's few wide bodies — and a plate's
      // rim), with a ball at each corner (the joints)
      float ex = length( vec3( max( q.x, 0.0 ), q.y, q.z ) ), ey = length( vec3( q.x, max( q.y, 0.0 ), q.z ) ), ez = length( vec3( q.x, q.y, max( q.z, 0.0 ) ) );
      fr = min( fr, min( min( ex, min( ey, ez ) ), length( q ) - uJoint ) );
    }
#endif
  }
#ifdef VALUES
  float v = bw > 0.0 ? clamp( bs / bw / uBornRange, 0.0, 1.0 ) * 255.0 : 0.0;
  fragColor = ws > 0.0 ? vec4( floor( v ) / 255.0, fract( v ), clamp( own / ws * 0.5, 0.0, 1.0 ), clamp( most / ws, 0.0, 1.0 ) ) : vec4( 0.0 );
#else
  // the two nearest joined softly (bounded: never more than a quarter of uSoft past the nearest, however many overlap)
  float hh = max( uSoft - abs( d1 - d2 ), 0.0 ) / uSoft;
  fragColor = vec4( enc( d1 ), enc( d1 - hh * hh * uSoft * 0.25 ), enc( fr ), enc( pl ) );
#endif
}`;

const COPY_FRAG = /* glsl */ `
precision highp float; precision highp sampler3D;
uniform sampler3D uSrc; uniform int uLayer; out vec4 fragColor;
void main() { fragColor = texelFetch( uSrc, ivec3( ivec2( gl_FragCoord.xy ), uLayer ), 0 ); }`;

const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** One field's GPU side: its atlas (grown slab by slab), its page table, and the baking of its dirty bricks. */
class FieldGpu {
  readonly grid: BrickGrid;
  readonly S: number;
  rt: THREE.WebGL3DRenderTarget | null = null;
  slabsAlloc = 0;
  pageTex: THREE.Data3DTexture;
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private scene = new THREE.Scene();
  baked = 0;

  constructor(readonly spec: BrickSpec, values: boolean, private readonly shared: { prims: { value: THREE.Texture | null }; lists: { value: THREE.Texture | null } }) {
    this.grid = new BrickGrid(spec);
    this.S = spec.B + 2;
    this.pageTex = new THREE.Data3DTexture(this.grid.page, PAGE, PAGE, PAGE);
    this.pageTex.format = THREE.RGBAFormat;
    this.pageTex.type = THREE.UnsignedByteType;
    this.pageTex.minFilter = this.pageTex.magFilter = THREE.NearestFilter;
    this.pageTex.unpackAlignment = 1;
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: QUAD_VERT,
      fragmentShader: BAKE_FRAG,
      defines: values ? { VALUES: 1 } : {},
      uniforms: {
        uPrims: shared.prims, uLists: shared.lists, uLayer: { value: 0 },
        uH: { value: spec.h }, uB: { value: spec.B }, uR: { value: FIELD_REACH }, uSoft: { value: 0.9 }, uJoint: { value: 0.18 },
        uReachV: { value: VALUE_REACH }, uBornBase: { value: 0 }, uBornRange: { value: BORN_RANGE },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  set bornBase(v: number) {
    this.mat.uniforms.uBornBase.value = v;
  }
  get atlasMB(): number {
    const w = this.spec.A * this.S;
    return (w * w * this.slabsAlloc * this.S * 4) / 1e6;
  }
  dispose(): void {
    this.rt?.dispose();
    this.rt = null;
    this.pageTex.dispose();
    this.mat.dispose();
    this.mesh.geometry.dispose();
  }

  /** The atlas's contents are gone (its renderer is another): it is made anew and every brick baked again. */
  lost(): void {
    this.rt?.dispose();
    this.rt = null;
    this.slabsAlloc = 0;
    this.grid.allDirty();
    this.grid.pageDirty = true;
  }

  /** The atlas is as tall as the bricks need (twice as tall each time it grows; what it held is copied over). */
  private fit(renderer: THREE.WebGLRenderer): void {
    const need = Math.max(1, this.grid.slabs);
    if (this.rt && need <= this.slabsAlloc) return;
    let slabs = Math.max(2, this.slabsAlloc);
    while (slabs < need) slabs *= 2;
    slabs = Math.min(slabs, this.spec.slabsMax);
    const w = this.spec.A * this.S;
    const rt = new THREE.WebGL3DRenderTarget(w, w, slabs * this.S, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
    rt.texture.wrapS = rt.texture.wrapT = rt.texture.wrapR = THREE.ClampToEdgeWrapping;
    const old = this.rt;
    if (old) {
      const copy = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: `void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }`, fragmentShader: COPY_FRAG, uniforms: { uSrc: { value: old.texture }, uLayer: { value: 0 } }, depthTest: false, depthWrite: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copy), sc = new THREE.Scene();
      m.frustumCulled = false;
      sc.add(m);
      for (let l = 0; l < this.slabsAlloc * this.S; l++) {
        copy.uniforms.uLayer.value = l;
        renderer.setRenderTarget(rt, l);
        renderer.render(sc, quadCam);
      }
      copy.dispose();
      m.geometry.dispose();
      old.dispose();
    }
    this.rt = rt;
    this.slabsAlloc = slabs;
  }

  /** Bakes the next dirty bricks (one slab's, at most so many). Returns how many. */
  bake(renderer: THREE.WebGLRenderer, lists: Float32Array, listTex: THREE.DataTexture, maxBricks: number): number {
    if (this.grid.pageDirty) {
      this.grid.pageDirty = false;
      this.pageTex.needsUpdate = true;
    }
    if (!this.grid.dirty.size) return 0;
    this.fit(renderer);
    const b = this.grid.take(maxBricks, lists.length);
    if (!b || !this.rt) return 0;
    const A = this.spec.A, S = this.S, W = A * S, n = b.ids.length;
    const pos = new Float32Array(n * 18), brick = new Float32Array(n * 18), list = new Float32Array(n * 12), origin = new Float32Array(n * 12);
    let tail = 0;
    for (let k = 0; k < n; k++) {
      const id = b.ids[k], ax = id % A, ay = Math.floor(id / A) % A, c = b.coords[k], l = b.lists[k];
      const len = Math.min(l.length, lists.length - tail);
      for (let i = 0; i < len; i++) lists[tail + i] = l[i];
      const x0 = ((ax * S) / W) * 2 - 1, x1 = (((ax + 1) * S) / W) * 2 - 1, y0 = ((ay * S) / W) * 2 - 1, y1 = (((ay + 1) * S) / W) * 2 - 1;
      pos.set([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0], k * 18);
      for (let v = 0; v < 6; v++) {
        brick.set(c, k * 18 + v * 3);
        list[k * 12 + v * 2] = tail;
        list[k * 12 + v * 2 + 1] = len;
        origin[k * 12 + v * 2] = ax * S;
        origin[k * 12 + v * 2 + 1] = ay * S;
      }
      tail += len;
    }
    listTex.needsUpdate = true;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aBrick", new THREE.BufferAttribute(brick, 3));
    g.setAttribute("aList", new THREE.BufferAttribute(list, 2));
    g.setAttribute("aOrigin", new THREE.BufferAttribute(origin, 2));
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    for (let l = 0; l < S; l++) {
      this.mat.uniforms.uLayer.value = l;
      renderer.setRenderTarget(this.rt, b.slab * S + l);
      renderer.render(this.scene, quadCam);
    }
    this.baked += n;
    return n;
  }
}

export interface FossilFieldStats {
  boxes: number;
  bricks: number;
  /** Bricks still to bake, and boxes said but not yet put in their bricks. */
  toBake: number;
  toPlace: number;
  mb: number;
  grid: number;
  /** Bricks not made: no place left in the page table / in the atlas. */
  refused: number;
  full: number;
}

/** The fossil's field: the boxes, the two fields of bricks, what the model said and is not yet taken in. */
export class FossilFieldGpu {
  readonly store = new FossilStore();
  readonly dist: FieldGpu;
  readonly vals: FieldGpu;
  private primTex: THREE.DataTexture | null = null;
  private lists = new Float32Array(LIST_W * LIST_H);
  private listTex: THREE.DataTexture;
  private shared = { prims: { value: null as THREE.Texture | null }, lists: { value: null as THREE.Texture | null } };
  private queue: { d: FossilDiff; at: number; dropAt: number }[] = [];
  bornBase = 0;
  private bornSet = false;
  private renderer: THREE.WebGLRenderer | null = null;
  private tmp = [0, 0, 0, 0, 0, 0];

  constructor(readonly token: number, readonly h: number) {
    this.listTex = new THREE.DataTexture(this.lists, LIST_W, LIST_H, THREE.RedFormat, THREE.FloatType);
    this.listTex.minFilter = this.listTex.magFilter = THREE.NearestFilter;
    this.shared.lists.value = this.listTex;
    // (what hangs below a box — the fossil runs down as it comes — is kept a little farther below it)
    this.dist = new FieldGpu({ h, B: 16, reach: FIELD_REACH, down: 1.2, A: 24, slabsMax: 16 }, false, this.shared);
    this.vals = new FieldGpu({ h: 1, B: 8, reach: VALUE_REACH, down: 1.2, A: 16, slabsMax: 16 }, true, this.shared);
  }
  dispose(): void {
    this.dist.dispose();
    this.vals.dispose();
    this.primTex?.dispose();
    this.listTex.dispose();
  }
  /** What the model said (spaceModel takeFossil), to be taken in over the next frames. */
  take(d: FossilDiff): void {
    if (d.token !== this.token) return;
    if (d.reset) {
      this.queue.length = 0;
      this.store.clear();
      this.dist.grid.clear();
      this.vals.grid.clear();
      this.bornSet = false;
    }
    this.queue.push({ d, at: 0, dropAt: 0 });
  }
  private place(maxBoxes: number): void {
    const s = this.store, t = this.tmp;
    let n = 0;
    while (this.queue.length && n < maxBoxes) {
      const q = this.queue[0], d = q.d;
      for (; q.dropAt < d.drop.length && n < maxBoxes; q.dropAt++, n++) {
        const i = s.slot(d.drop[q.dropAt]);
        if (i === undefined) continue;
        for (const f of [this.dist, this.vals]) f.grid.remove(i, s.bounds(i, f.spec.reach + f.spec.h * 1.5, f.spec.down, t));
        s.drop(d.drop[q.dropAt]);
      }
      for (; q.at < d.keys.length && n < maxBoxes; q.at++, n++) {
        const key = d.keys[q.at], was = s.slot(key);
        if (was !== undefined) for (const f of [this.dist, this.vals]) f.grid.remove(was, s.bounds(was, f.spec.reach + f.spec.h * 1.5, f.spec.down, t));
        const i = s.set(key, d.add, q.at * FOSSIL_BOX);
        for (const f of [this.dist, this.vals]) f.grid.add(i, s.bounds(i, f.spec.reach + f.spec.h * 1.5, f.spec.down, t));
        // (the hardening times are kept from a base: set by the first box, moved when what comes is out of its range)
        const born = d.add[q.at * FOSSIL_BOX + 9];
        if (!this.bornSet || born < this.bornBase || born > this.bornBase + BORN_RANGE - 8) {
          const r = s.bornRange();
          this.bornBase = Math.floor(Math.max(r ? r[0] : born, born - BORN_RANGE + 64)) - 8;
          this.bornSet = true;
          this.vals.bornBase = this.bornBase;
          this.vals.grid.allDirty();
        }
      }
      if (q.at >= d.keys.length && q.dropAt >= d.drop.length) this.queue.shift();
    }
  }
  /** A frame's share of the work: boxes into their bricks, the boxes' texture, some bricks baked. Leaves the render target changed. */
  update(renderer: THREE.WebGLRenderer): void {
    // (another renderer — the canvas was made again: what the atlases held is gone, every brick is baked again)
    if (this.renderer !== renderer) {
      this.renderer = renderer;
      for (const f of [this.dist, this.vals]) f.lost();
    }
    if (this.queue.length) this.place(6000);
    const s = this.store;
    if (s.grown || !this.primTex) {
      s.grown = false;
      this.primTex?.dispose();
      const hgt = Math.max(1, Math.ceil(s.data.length / 4 / PRIM_W));
      if (s.data.length < PRIM_W * hgt * 4) {
        const d = new Float32Array(PRIM_W * hgt * 4);
        d.set(s.data);
        s.data = d;
      }
      this.primTex = new THREE.DataTexture(s.data, PRIM_W, hgt, THREE.RGBAFormat, THREE.FloatType);
      this.primTex.minFilter = this.primTex.magFilter = THREE.NearestFilter;
      this.primTex.needsUpdate = true;
      this.shared.prims.value = this.primTex;
      s.dirty = null;
    } else if (s.dirty) {
      s.dirty = null;
      this.primTex.needsUpdate = true;
    }
    // (more bricks a frame while much waits — the first filling, a new grid — and few when only a building changed)
    const waiting = this.dist.grid.dirty.size;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    this.dist.bake(renderer, this.lists, this.listTex, waiting > 400 ? 48 : 12);
    this.vals.bake(renderer, this.lists, this.listTex, 32);
    renderer.autoClear = auto;
  }
  get stats(): FossilFieldStats {
    let toPlace = 0;
    for (const q of this.queue) toPlace += q.d.keys.length - q.at + q.d.drop.length - q.dropAt;
    return {
      boxes: this.store.size,
      bricks: this.dist.grid.count,
      toBake: this.dist.grid.dirty.size + this.vals.grid.dirty.size,
      toPlace,
      mb: this.dist.atlasMB + this.vals.atlasMB + (this.store.data.byteLength + 2 * PAGE * PAGE * PAGE * 4) / 1e6,
      grid: this.h,
      refused: this.dist.grid.refused,
      full: this.dist.grid.full,
    };
  }
}

/** What the wall's shader reads of the fossil's clock (ParliamentSpace FuseUniforms — the same object, read each frame). */
export type FieldClock = Record<string, { value: number }>;

/**
 * THE ONE FIELD OF THE PAGE (as futureLink is for the layer above): the model's answers are handed in where the wall
 * applies a result, the pass that draws it reads it — both outside React's tree, and it outlives the composer being
 * made again.
 */
export const fossilLink = {
  field: null as FossilFieldGpu | null,
  /** The wall's fused uniforms (the fossil's clock and the knobs of its growing and going). */
  clock: null as FieldClock | null,
  /** A slot's height (world), the pipes' radius, how round an old layer is, the fossil's colour and glow. */
  look: { unit: 1.8, pipe: 0.3, round: 1, color: new THREE.Color("#fbfbfa"), glow: 0.1, scale: 0.5, steps: 200 },
};
let tokens = 0;
/** A new, empty field (the old one is let go). Returns its token: what the model is asked with (fuse.ts field). */
export function fossilOpen(h: number): number {
  fossilLink.field?.dispose();
  const token = ++tokens;
  fossilLink.field = new FossilFieldGpu(token, h);
  return token;
}
export function fossilClose(): void {
  fossilLink.field?.dispose();
  fossilLink.field = null;
}
export { PRIM_FLOATS };

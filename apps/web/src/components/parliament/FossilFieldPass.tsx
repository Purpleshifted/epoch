"use client";

/**
 * THE FOSSIL DRAWN FROM ITS FIELD (2026-11-20, branch gpu-optimized; fuse.ts `field`; the artist: "건물은 그대로 두고
 * 화석만 장으로"). The buildings are drawn as they always were; this pass comes right after them in the composer:
 *
 * 1. a frame's share of the field's baking (fossilFieldGpu.ts: only the bricks round what came, went or changed);
 * 2. rays marched through the field at a share of the screen's size (half by default — the cost is by the pixel),
 *    stopping at what the scene has already drawn there;
 * 3. the result put over the scene by depth (it writes depth too: what follows — the ambient occlusion, the focus
 *    blur — sees the fossil as a thing in the scene).
 *
 * THE SHAPE IS READ OFF THE AGE, PER PIXEL — the wall's one ruler (ParliamentSpace FUSE_GROW_VERT_BODY: the slots since
 * the place hardened, slowed towards the window's top, a little sooner or later place by place; the same uniforms,
 * read each frame), so nothing is made again as time passes, and a layer's shape goes on changing as it ages (what
 * the mesh, made once as it will be, could not: "획일화"):
 *
 *   the frame first      the bodies' edges stand as pipes over the first `growLate` of the coming-out
 *   out of its own unit  then the body swells out of the inside of its unit (`growPress`), to `growThin` past it,
 *                        and runs down below it as it comes (`growMelt`, `growReach`)
 *   round with age       past whole, neighbours join softly — an old layer is one rounded mass
 *   its life             the going in holes, on the same ruler (FUSE_GONE_FRAG_BODY's noise and patches)
 */

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CopyPass, Pass } from "postprocessing";
import { PAGE } from "@/lib/parliament/fossilField";
import { FIELD_REACH, fossilLink } from "./fossilFieldGpu";

const FULL_VERT = /* glsl */ `out vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const MARCH_FRAG = /* glsl */ `
precision highp float; precision highp int; precision highp sampler3D; precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
uniform sampler3D uDAtlas, uDPage, uVAtlas, uVPage;
uniform sampler2D uDepth;
uniform vec3 uDTex, uVTex, uBmin, uBmax, uCamPos, uColor, uAmb, uL1, uL1c, uL2, uL2c;
uniform mat4 uProjInv, uCamWorld, uView;
uniform vec2 uDepthTexel;
uniform float uDH, uDB, uDS, uVB, uVS, uR, uBornBase, uBornRange, uUnit;
uniform float uTop, uStood, uHeight, uAfter, uOver, uAgeSpan, uDeep, uLate, uMelt, uReach, uPress, uPad, uFloor;
uniform float uDie, uDieAfter, uDieSpan, uDieHoles, uGrain, uRag, uPatch, uPipe, uRound, uGlow, uShadow;
uniform int uSteps;
const float PAGE = ${PAGE}.0;
float goneHash( vec3 p ) { p = fract( p * 0.1031 + vec3( 0.71, 0.113, 0.419 ) ); p += dot( p, p.yzx + 33.33 ); return fract( ( p.x + p.y ) * p.z ); }
float goneNoise( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( goneHash( i ), goneHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ), mix( goneHash( i + vec3( 0.0, 1.0, 0.0 ) ), goneHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
              mix( mix( goneHash( i + vec3( 0.0, 0.0, 1.0 ) ), goneHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ), mix( goneHash( i + vec3( 0.0, 1.0, 1.0 ) ), goneHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ), f.z );
}
// the distances at p (world): nearest box · the two nearest joined softly · nearest edge (the frame) · nearest plate
vec4 dAt( vec3 p ) {
  float bw = uDB * uDH;
  vec3 c = floor( p / bw );
  vec4 pg = texelFetch( uDPage, ivec3( mod( c, PAGE ) ), 0 );
  if ( pg.a < 0.5 ) return vec4( uR );
  vec3 local = p / uDH - c * uDB;
  return ( texture( uDAtlas, ( floor( pg.rgb * 255.0 + 0.5 ) * uDS + local + 1.0 ) / uDTex ) * 2.0 - 1.0 ) * uR;
}
// the place's values: when it hardened (slots) · own (sooner or later) · most (how much the vegetation makes of it)
vec3 vAt( vec3 p ) {
  vec3 c = floor( p / uVB );
  vec4 pg = texelFetch( uVPage, ivec3( mod( c, PAGE ) ), 0 );
  if ( pg.a < 0.5 ) return vec3( 0.0 );
  vec3 local = p - c * uVB;
  vec4 v = texture( uVAtlas, ( floor( pg.rgb * 255.0 + 0.5 ) * uVS + local + 1.0 ) / uVTex );
  return vec3( uBornBase + ( v.r + v.g / 255.0 ) * uBornRange, v.b * 2.0, v.a );
}
float ease( float x ) { return x * x * ( 3.0 - 2.0 * x ); }
// THE MASS at p for the place's age. x = the implicit (solid < 0, about world units), y = a step that is safe.
vec2 massAt( vec3 p ) {
  vec4 d = dAt( p );
  float near = min( d.x, d.z );
  float most = uPad + uPipe + 0.2;
  if ( near - most > uDH ) return vec2( near - most, near - most );
  vec3 v = vAt( p );
  // (FUSE_GROW_VERT_BODY: the layer off the sample's own height; one ruler, the age, slowed towards the top)
  float layer = p.y / uUnit - 0.5;
  float depth = clamp( ( uTop - ( layer + 0.5 ) ) / max( 1.0, uHeight ), 0.0, 1.0 );
  float age = uTop + uStood - v.x - uAfter;
  float T = age * max( 0.2, v.y ) * ( 1.0 - uDeep * ( 1.0 - depth ) );
  float q = T / max( 1.0, uAgeSpan );
  float goneAt = ( T - uDieAfter ) / max( 1.0, uDieSpan );
  float amt = clamp( age / max( 0.1, uOver ), 0.0, 1.0 ) * clamp( ( layer - uFloor ) * 0.5, 0.0, 1.0 ) * ( 1.0 - uDie * clamp( goneAt, 0.0, 1.0 ) * ( 1.0 - uDieHoles ) ) * v.z;
  // (not out here: nothing is solid until the place's values change — they change over a cell of their own)
  if ( q <= 0.0 || amt <= 0.004 ) return vec2( 1.0, max( abs( near ), 0.4 ) );
  // THE FRAME FIRST: the edges as pipes over the first uLate of the coming-out, whole while the filling comes
  float late = uLate > 0.05 ? min( uLate, 0.95 ) : 0.0;
  float qf = ( late > 0.0 ? clamp( q / late, 0.0, 1.0 ) : clamp( q, 0.0, 1.0 ) ) * amt;
  float f = d.z - uPipe * ease( qf ) + ( qf < 0.02 ? 1.0 : 0.0 );
  // OUT OF ITS OWN UNIT: the body from the inside of its unit outwards, running down below it as it comes; neighbours
  // join softly once it is whole and older
  float qb = clamp( ( q - late ) / max( 0.05, 1.0 - late ), 0.0, 1.0 ) * amt;
  if ( qb > 0.02 ) {
    float eb = ease( qb );
    float round = uRound * smoothstep( 0.7, 1.8, q );
    float body = mix( d.x, d.y, round );
    if ( uMelt > 0.0 ) {
      float s = uMelt * uReach * 0.45 * eb * ( 0.35 + 0.65 * goneNoise( vec3( p.x, 0.0, p.z ) * 0.9 + 3.3 ) );
      vec4 up = dAt( p + vec3( 0.0, s, 0.0 ) );
      body = min( body, mix( up.x, up.y, round ) + s * 0.45 );
    }
    float fb = body - mix( -1.2 * uPress, uPad, eb );
    float k = 0.18, hh = max( k - abs( f - fb ), 0.0 ) / k;
    f = min( f, fb ) - hh * hh * k * 0.25;
  }
  // ITS LIFE: holes eaten through it, each patch of the world ahead of or behind the going (FUSE_GONE_FRAG_BODY)
  float gv = uDie * uDieHoles * clamp( goneAt, -4.0, 4.0 );
  float ga = gv == 0.0 ? 0.0 : clamp( gv + ( goneNoise( p / max( 0.5, uPatch ) + 7.7 ) - 0.5 ) * 3.0 * uRag, 0.0, 1.0 );
  if ( ga > 0.001 ) {
    vec3 gp = p / max( 0.05, uGrain );
    float gn = clamp( ( 0.65 * goneNoise( gp ) + 0.35 * goneNoise( gp * 2.7 + 11.3 ) - 0.5 ) * 1.9 + 0.5, 0.0, 0.999 );
    f = max( f, ( ga - gn ) * uGrain * 0.6 );
  }
  return vec2( f, f > 0.0 ? f : uDH * 0.5 );
}
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 pf = uProjInv * vec4( ndc, 1.0, 1.0 );
  vec3 dv = normalize( pf.xyz / pf.w );
  vec3 rd = normalize( mat3( uCamWorld ) * dv ), ro = uCamPos;
  // what the scene has drawn here already (the farthest of the screen's pixels this one covers: the edges are cut
  // by the depth test when it is put over the scene)
  float z = max( max( texture( uDepth, vUv + vec2( -0.5, -0.5 ) * uDepthTexel ).r, texture( uDepth, vUv + vec2( 0.5, -0.5 ) * uDepthTexel ).r ),
                 max( texture( uDepth, vUv + vec2( -0.5, 0.5 ) * uDepthTexel ).r, texture( uDepth, vUv + vec2( 0.5, 0.5 ) * uDepthTexel ).r ) );
  float tScene = 1e9;
  if ( z < 1.0 ) { vec4 ps = uProjInv * vec4( ndc, z * 2.0 - 1.0, 1.0 ); tScene = length( ps.xyz / ps.w ); }
  vec3 inv = 1.0 / ( rd + vec3( equal( rd, vec3( 0.0 ) ) ) * 1e-6 );
  vec3 ta = ( uBmin - ro ) * inv, tb = ( uBmax - ro ) * inv;
  vec3 tn = min( ta, tb ), tf = max( ta, tb );
  float t = max( max( max( tn.x, tn.y ), tn.z ), 0.0 ), tEnd = min( min( min( tf.x, tf.y ), tf.z ), tScene );
  float bw = uDB * uDH, minStep = uDH * 0.5, tPrev = t;
  bool hit = false;
  for ( int i = 0; i < uSteps; i++ ) {
    if ( t > tEnd ) break;
    vec3 p = ro + rd * t;
    // an empty brick is jumped
    vec3 c = floor( p / bw );
    if ( texelFetch( uDPage, ivec3( mod( c, PAGE ) ), 0 ).a < 0.5 ) {
      vec3 e = max( ( c * bw - ro ) * inv, ( c * bw + bw - ro ) * inv );
      tPrev = t;
      t = min( min( e.x, e.y ), e.z ) + 1e-3;
      continue;
    }
    vec2 m = massAt( p );
    if ( m.x < 0.0 ) { hit = true; break; }
    tPrev = t;
    t += max( m.y * 0.7, minStep );
  }
  if ( !hit ) { fragColor = vec4( 0.0, 0.0, 0.0, -1.0 ); return; }
  float a = tPrev, b = t;
  for ( int i = 0; i < 4; i++ ) { float mid = 0.5 * ( a + b ); if ( massAt( ro + rd * mid ).x < 0.0 ) b = mid; else a = mid; }
  vec3 p = ro + rd * b;
  float e = uDH * 0.7;
  vec3 n = normalize( vec3(
    massAt( p + vec3( e, 0, 0 ) ).x - massAt( p - vec3( e, 0, 0 ) ).x,
    massAt( p + vec3( 0, e, 0 ) ).x - massAt( p - vec3( 0, e, 0 ) ).x,
    massAt( p + vec3( 0, 0, e ) ).x - massAt( p - vec3( 0, 0, e ) ).x ) + 1e-6 );
  if ( dot( n, rd ) > 0.0 ) n = -n;
  // lit as the wall's stone is (a matte surface under the scene's own lights; linear — the composer has no tone mapping)
  float open = clamp( 0.55 + 0.45 * massAt( p + n * 0.7 ).x / 0.7, 0.35, 1.0 );
  // THE FOSSIL SHADOWS ITSELF (the mesh took the sun's shadow map; the field is asked along the way to the sun: what
  // of it stands between — a soft edge by how near the way passes). The buildings' shadows on it are not in this.
  float sun = max( dot( n, uL1 ), 0.0 );
  if ( sun > 0.0 && uShadow > 0.0 ) {
    float sh = 1.0, ts = 0.3;
    vec3 ps = p + n * 0.12;
    for ( int i = 0; i < 12; i++ ) {
      float m = massAt( ps + uL1 * ts ).x;
      if ( m < 0.01 ) { sh = 0.0; break; }
      sh = min( sh, 5.0 * m / ts );
      ts += clamp( m, 0.2, 1.6 );
      if ( ts > 16.0 ) break;
    }
    sun *= mix( 1.0, clamp( sh, 0.0, 1.0 ), uShadow );
  }
  vec3 light = uAmb * open + uL1c * sun + uL2c * max( dot( n, uL2 ), 0.0 );
  vec3 col = uColor * light * 0.31830989 + uColor * uGlow;
  // (the distance along the view's axis: what its depth is worked out of when it is put over the scene)
  fragColor = vec4( col, -( uView * vec4( p, 1.0 ) ).z );
}`;

const COMPOSE_FRAG = /* glsl */ `
precision highp float; precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uMarch;
uniform vec2 uSize;
uniform float uP22, uP32;
void main() {
  ivec2 mx = ivec2( uSize ) - 1;
  vec4 o = texelFetch( uMarch, clamp( ivec2( floor( vUv * uSize ) ), ivec2( 0 ), mx ), 0 );
  if ( o.a < 0.0 ) discard;
  // (between four samples that all hit, at about one depth: blended — the surface is smooth at the screen's own
  // size; at a silhouette the nearest sample alone, so nothing is smeared across it)
  vec2 st = vUv * uSize - 0.5;
  ivec2 i0 = ivec2( floor( st ) );
  vec2 f = fract( st );
  vec4 a = texelFetch( uMarch, clamp( i0, ivec2( 0 ), mx ), 0 ), b = texelFetch( uMarch, clamp( i0 + ivec2( 1, 0 ), ivec2( 0 ), mx ), 0 );
  vec4 c = texelFetch( uMarch, clamp( i0 + ivec2( 0, 1 ), ivec2( 0 ), mx ), 0 ), d = texelFetch( uMarch, clamp( i0 + ivec2( 1, 1 ), ivec2( 0 ), mx ), 0 );
  float lo = min( min( a.a, b.a ), min( c.a, d.a ) ), hi = max( max( a.a, b.a ), max( c.a, d.a ) );
  if ( lo > 0.0 && hi - lo < 0.02 * hi + 0.05 ) o = mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
  fragColor = vec4( o.rgb, 1.0 );
  // (a little behind where it was found: where the fossil's face lies in a building's own face — it comes out of the
  // inside of its unit — the building's is the one seen, not a stipple of the two at this pass's coarser size)
  float vz = o.a * 1.003 + 0.06;
  gl_FragDepth = clamp( ( ( -uP22 * vz + uP32 ) / vz ) * 0.5 + 0.5, 0.0, 1.0 );
}`;

const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fullscreen = (frag: string, uniforms: Record<string, THREE.IUniform>, depth: boolean): { scene: THREE.Scene; mat: THREE.ShaderMaterial } => {
  const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULL_VERT, fragmentShader: frag, uniforms, depthTest: depth, depthWrite: depth, depthFunc: THREE.LessEqualDepth });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { scene, mat };
};
const V3 = () => ({ value: new THREE.Vector3() });
const F = (v = 0) => ({ value: v });

export class FossilFieldPass extends Pass {
  view: THREE.Camera | null = null;
  world: THREE.Scene | null = null;
  private depthTex: THREE.Texture | null = null;
  private half: THREE.WebGLRenderTarget;
  private full = new THREE.Vector2(1, 1);
  private march: { scene: THREE.Scene; mat: THREE.ShaderMaterial };
  private compose: { scene: THREE.Scene; mat: THREE.ShaderMaterial };
  private copy = new CopyPass();
  private lights: THREE.Light[] = [];
  private lightsAt = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private frames = 0;
  private query: WebGLQuery | null = null;

  constructor() {
    super("FossilFieldPass");
    this.needsSwap = false;
    this.needsDepthTexture = true;
    // (the fossil writes depth into the scene's buffer: what the following passes read is taken again after it)
    this.needsDepthBlit = true;
    this.half = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.march = fullscreen(
      MARCH_FRAG,
      {
        uDAtlas: { value: null }, uDPage: { value: null }, uVAtlas: { value: null }, uVPage: { value: null }, uDepth: { value: null },
        uDTex: V3(), uVTex: V3(), uBmin: V3(), uBmax: V3(), uCamPos: V3(), uColor: V3(), uAmb: V3(), uL1: V3(), uL1c: V3(), uL2: V3(), uL2c: V3(),
        uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uView: { value: new THREE.Matrix4() }, uDepthTexel: { value: new THREE.Vector2() },
        uDH: F(), uDB: F(), uDS: F(), uVB: F(), uVS: F(), uR: F(FIELD_REACH), uBornBase: F(), uBornRange: F(1024), uUnit: F(1.8),
        uTop: F(), uStood: F(), uHeight: F(1), uAfter: F(), uOver: F(3), uAgeSpan: F(40), uDeep: F(), uLate: F(), uMelt: F(), uReach: F(2), uPress: F(1), uPad: F(0.6), uFloor: F(-1e9),
        uDie: F(), uDieAfter: F(60), uDieSpan: F(30), uDieHoles: F(), uGrain: F(1.2), uRag: F(), uPatch: F(9), uPipe: F(0.3), uRound: F(1), uGlow: F(0.1), uShadow: F(1), uSteps: { value: 200 },
      },
      false,
    );
    this.compose = fullscreen(COMPOSE_FRAG, { uMarch: { value: this.half.texture }, uSize: { value: new THREE.Vector2(1, 1) }, uP22: F(), uP32: F() }, true);
    this.copy.renderToScreen = true;
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.depthTex = depthTexture;
  }
  override getDepthTexture(): THREE.Texture {
    return this.depthTex as THREE.Texture;
  }
  override initialize(renderer: THREE.WebGLRenderer, alpha: boolean, frameBufferType: number): void {
    this.copy.initialize(renderer, alpha, frameBufferType);
  }
  override setSize(width: number, height: number): void {
    this.full.set(width, height);
    this.resize();
  }
  private resize(): void {
    const s = Math.max(0.2, Math.min(1, fossilLink.look.scale));
    const w = Math.max(1, Math.ceil(this.full.x * s)), h = Math.max(1, Math.ceil(this.full.y * s));
    if (this.half.width !== w || this.half.height !== h) this.half.setSize(w, h);
    this.compose.mat.uniforms.uSize.value.set(w, h);
    this.march.mat.uniforms.uDepthTexel.value.set(1 / this.full.x, 1 / this.full.y);
  }
  override dispose(): void {
    this.half.dispose();
    this.march.mat.dispose();
    this.compose.mat.dispose();
    this.copy.dispose();
    super.dispose();
  }

  /** The scene's own lights, as the fossil's shader takes them (looked for again now and then). */
  private light(): void {
    const u = this.march.mat.uniforms, now = performance.now();
    if (this.world && now - this.lightsAt > 1000) {
      this.lightsAt = now;
      this.lights.length = 0;
      this.world.traverse((o) => {
        const l = o as THREE.Light;
        if (l.isLight && l.visible && (l.type === "AmbientLight" || l.type === "DirectionalLight")) this.lights.push(l);
      });
    }
    this.lights.sort((a, b) => b.intensity - a.intensity);
    const amb = (u.uAmb.value as THREE.Vector3).set(0, 0, 0);
    const dirs = [
      [u.uL1.value as THREE.Vector3, u.uL1c.value as THREE.Vector3],
      [u.uL2.value as THREE.Vector3, u.uL2c.value as THREE.Vector3],
    ];
    for (const [, c] of dirs) c.set(0, 0, 0);
    let n = 0;
    for (const l of this.lights) {
      const k = l.intensity;
      if (l.type === "AmbientLight") amb.x += l.color.r * k, (amb.y += l.color.g * k), (amb.z += l.color.b * k);
      else if (n < 2) {
        const d = l as THREE.DirectionalLight;
        d.getWorldPosition(this.tmp);
        d.target.getWorldPosition(this.tmp2);
        dirs[n][0].copy(this.tmp).sub(this.tmp2).normalize();
        dirs[n][1].set(l.color.r * k, l.color.g * k, l.color.b * k);
        n++;
      }
    }
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget): void {
    const field = fossilLink.field, clock = fossilLink.clock, cam = this.view as THREE.PerspectiveCamera | null;
    if (field && clock && cam && this.depthTex) {
      const auto = renderer.autoClear;
      field.update(renderer);
      const b = field.dist.grid.bounds();
      const D = field.dist, V = field.vals;
      if (b && D.rt && V.rt) {
        this.resize();
        const u = this.march.mat.uniforms, look = fossilLink.look, c = (k: string, d = 0) => clock[k]?.value ?? d;
        u.uDAtlas.value = D.rt.texture;
        u.uDPage.value = D.pageTex;
        u.uVAtlas.value = V.rt.texture;
        u.uVPage.value = V.pageTex;
        u.uDepth.value = this.depthTex;
        (u.uDTex.value as THREE.Vector3).set(D.spec.A * D.S, D.spec.A * D.S, D.slabsAlloc * D.S);
        (u.uVTex.value as THREE.Vector3).set(V.spec.A * V.S, V.spec.A * V.S, V.slabsAlloc * V.S);
        (u.uBmin.value as THREE.Vector3).set(b[0], b[1], b[2]);
        (u.uBmax.value as THREE.Vector3).set(b[3], b[4], b[5]);
        u.uDH.value = D.spec.h;
        u.uDB.value = D.spec.B;
        u.uDS.value = D.S;
        u.uVB.value = V.spec.B;
        u.uVS.value = V.S;
        u.uBornBase.value = field.bornBase;
        u.uUnit.value = look.unit;
        cam.getWorldPosition(u.uCamPos.value as THREE.Vector3);
        (u.uProjInv.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
        (u.uCamWorld.value as THREE.Matrix4).copy(cam.matrixWorld);
        (u.uView.value as THREE.Matrix4).copy(cam.matrixWorldInverse);
        // the wall's own clock and knobs (ParliamentSpace FuseUniforms, set each frame there)
        u.uTop.value = c("uGrowTop");
        u.uStood.value = c("uGrowStood");
        u.uHeight.value = c("uGrowHeight", 1);
        u.uAfter.value = c("uGrowAfter");
        u.uOver.value = c("uGrowOver", 3);
        u.uAgeSpan.value = c("uGrowAgeSpan", 40);
        u.uDeep.value = c("uGrowDeep");
        u.uLate.value = c("uGrowLate");
        u.uMelt.value = c("uGrowMelt");
        u.uReach.value = c("uGrowReach", 2);
        u.uPress.value = c("uGrowPress", 1);
        u.uPad.value = c("uGrowThin", 0.6);
        u.uFloor.value = c("uGrowFloor", -1e9);
        u.uDie.value = c("uGrowDie");
        u.uDieAfter.value = c("uGrowDieAfter", 60);
        u.uDieSpan.value = c("uGrowDieSpan", 30);
        u.uDieHoles.value = c("uGrowDieHoles");
        u.uGrain.value = c("uGrowDieGrain", 1.2);
        u.uRag.value = c("uGrowDieRag");
        u.uPatch.value = c("uGrowDiePatch", 9);
        u.uPipe.value = look.pipe;
        u.uRound.value = look.round;
        u.uGlow.value = look.glow;
        u.uSteps.value = look.steps;
        (u.uColor.value as THREE.Vector3).set(look.color.r, look.color.g, look.color.b);
        this.light();
        renderer.autoClear = false;
        // (what the drawing costs the GPU, measured now and then — for the status line: fossilLink.gpuMs)
        const gl = renderer.getContext() as WebGL2RenderingContext, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
        let timing = false;
        if (ext) {
          if (this.query) {
            if (gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) {
              if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) fossilLink.gpuMs = (gl.getQueryParameter(this.query, gl.QUERY_RESULT) as number) / 1e6;
              gl.deleteQuery(this.query);
              this.query = null;
            }
          } else if (++this.frames % 20 === 0) {
            this.query = gl.createQuery();
            if (this.query) {
              gl.beginQuery(ext.TIME_ELAPSED_EXT, this.query);
              timing = true;
            }
          }
        }
        renderer.setRenderTarget(this.half);
        renderer.render(this.march.scene, quadCam);
        const cu = this.compose.mat.uniforms, pe = cam.projectionMatrix.elements;
        cu.uP22.value = pe[10];
        cu.uP32.value = pe[14];
        renderer.setRenderTarget(inputBuffer);
        renderer.render(this.compose.scene, quadCam);
        if (timing && ext) gl.endQuery(ext.TIME_ELAPSED_EXT);
      }
      renderer.autoClear = auto;
    }
    // (the last pass of the composer: the scene's buffer goes to the screen as it is)
    if (this.renderToScreen) this.copy.render(renderer, inputBuffer, null as unknown as THREE.WebGLRenderTarget, 0, false);
  }
}

/** The fossil's field, drawn (a child of the composer, before everything else that reads the scene's depth). */
export function FossilField() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const pass = useMemo(() => new FossilFieldPass(), []);
  useEffect(() => {
    pass.view = camera;
    pass.world = scene;
  }, [pass, camera, scene]);
  useEffect(() => () => pass.dispose(), [pass]);
  return <primitive object={pass} dispose={null} />;
}

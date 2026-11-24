"use client";
/**
 * DitherGround — the brutal versions of the grass (Leva 개인뷰 비주얼; docs/session-logic.md §12): no points, a field in
 * one colour. Every cell around the walker takes the density NatureCloud would give it (nature.ts grassDensity, with the
 * quick stress of the walker's own trail). With `dither` an ordered dither in screen pixels turns the density into how
 * much of the cell is lit; without it (the default since the artist found the dither hard on the eyes) the density is
 * simply how bright the field is, smooth from cell to cell. Where the walker goes the field goes dark at once. It ends in
 * a hard circle: no fog, no fade. Far cheaper than the cloud: a small texture instead of tens of thousands of points.
 * 길거리 (2026-11-22): when the scene HAS a fog (the street trial's 깊이 안개 switch — the brutal look has none otherwise) the
 * field takes it, and its rim fades into the fog's colour instead of being cut, so the ground ends in a horizon, not a disc.
 * And with the trial on (streetLook.ts, read per frame): where a path has formed the cell is WORN — an achromatic grey (a
 * human trace) with a grain, and a dark seam where two cells' wear differs (a kerb's line) — and slow waves of shade cross
 * the grass (wind). The texture carries two channels: r = the grass density, g = the path's strength.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL_SIZE } from "@/lib/stratum/field";
import { WORLD_SIZE, grassDensity, wrapCell, type NatureConfig, type Snapshot } from "@/lib/parliament";
import { markSpan } from "./usePerfMeter";
import { streetGround } from "./streetLook";
import { lidarActive } from "./LidarScan";

const REFRESH = 0.1;

const VERT = /* glsl */ `
varying vec2 vXZ;
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uG;
uniform vec2 uOrigin;
uniform float uSpan;
uniform vec2 uCentre;
uniform float uRadius;
uniform float uPx;
uniform vec3 uColor;
uniform float uDither;
uniform float uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;
uniform float uStreet;
uniform float uCell;
uniform float uWear;
uniform float uWearGrey;
uniform float uSeam;
uniform float uGrain;
uniform float uWind;
uniform float uWindSpeed;
uniform float uTime;
uniform float uPaper;
uniform float uGroundOnPaper;
varying vec2 vXZ;
varying vec3 vW;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
// the worn share of the cell whose texel centre is uv (a path from 0.08 up is worn, fully from 0.6)
float wearAt(vec2 uv) { return smoothstep(0.08, 0.6, texture2D(uG, uv).g) * uWear; }
void main() {
  float dc = distance(vXZ, uCentre);
  if (dc > uRadius) discard;
  // 흰 바탕: no ground plane unless asked — the floor is read from the vegetation (the artist, 2026-11-22)
  if (uPaper > 0.5 && uGroundOnPaper < 0.5) discard;
  vec2 rel = vXZ - uOrigin;
  float g = texture2D(uG, rel / uSpan).r;
  // 길거리: the worn ground where a path has formed (achromatic), per cell, with a grain and a seam where two cells'
  // wear differs; the wind as slow waves of shade over the grass
  float wear = 0.0, seam = 0.0, grain = 1.0, wind = 1.0;
  if (uStreet > 0.5) {
    vec2 cell = floor(rel / uCell);
    vec2 cuv = (cell + 0.5) * uCell / uSpan;
    wear = wearAt(cuv);
    grain = 1.0 - uGrain * 0.35 * hash12(floor(vXZ * 9.0));
    vec2 f = fract(rel / uCell);
    float t = 0.03 / uCell;
    vec2 o = vec2(uCell / uSpan, 0.0);
    if (f.x < t) seam = max(seam, step(0.1, abs(wear - wearAt(cuv - o.xy))));
    if (f.x > 1.0 - t) seam = max(seam, step(0.1, abs(wear - wearAt(cuv + o.xy))));
    if (f.y < t) seam = max(seam, step(0.1, abs(wear - wearAt(cuv - o.yx))));
    if (f.y > 1.0 - t) seam = max(seam, step(0.1, abs(wear - wearAt(cuv + o.yx))));
    wind = 1.0 - uWind * 0.18 * (0.5 + 0.5 * sin(dot(vXZ, vec2(0.6, 0.35)) * 0.8 + uTime * uWindSpeed * 1.1 + 1.5 * sin(vXZ.y * 0.21 - uTime * uWindSpeed * 0.37)));
  }
  // the scene's fog (when there is one), and the rim fading into it
  float fk = uFog * max(smoothstep(uFogNear, uFogFar, distance(vW, cameraPosition)), smoothstep(uRadius * 0.55, uRadius, dc));
  vec3 worn = vec3(uWearGrey) * grain * (1.0 - 0.6 * seam * uSeam);
  // 흰 바탕: the vegetation a light green smudge on the paper (uFogColor is the paper), the worn ground a pressed grey — no
  // seams, the grain barely; everything pales into the paper with distance
  if (uPaper > 0.5) {
    // a mottled wash: the vegetation's density × a slow mottle at two scales (a brush's unevenness), one low-chroma green
    float mottle = 0.55 + 0.45 * vnoise2(vXZ * 0.45) * (0.7 + 0.3 * vnoise2(vXZ * 2.3 + 11.0));
    vec3 c = mix(uFogColor, vec3(0.55, 0.68, 0.46), clamp(g * wind * mottle, 0.0, 1.0));
    c = mix(c, vec3(0.58) * (1.0 - 0.15 * (1.0 - grain)), wear * 0.75);
    gl_FragColor = vec4(mix(c, uFogColor, fk), 1.0);
    return;
  }
  if (uDither < 0.5) {
    vec3 c = mix(uColor * g * wind, worn, wear);
    gl_FragColor = vec4(mix(c, uFogColor, fk), 1.0);
    return;
  }
  float b = bayer8(floor(gl_FragCoord.xy / uPx));
  if (wear * grain > b) {
    gl_FragColor = vec4(mix(worn, uFogColor, fk), 1.0);
    return;
  }
  if (g * wind <= b) discard;
  gl_FragColor = vec4(mix(uColor, uFogColor, fk), 1.0);
}`;

export function DitherGround({
  playerPosRef,
  getStress,
  getSnapshot,
  getQuick,
  cfg,
  radius = 22,
  pixel = 2,
  dither = false,
  color = "#2f8f3f",
  density = 1,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  getStress: () => Map<string, number> | null;
  getSnapshot: () => Snapshot | null;
  /** The walker's own recent trail as stress per cell (RoleField's quick StressState). */
  getQuick?: () => Map<string, number> | null;
  cfg: NatureConfig;
  /** World radius of the lit circle. */
  radius?: number;
  /** Size of a dither dot in CSS pixels. */
  pixel?: number;
  /** Two values in dots (true), or the density as a smooth brightness (false). */
  dither?: boolean;
  color?: string;
  /** Multiplies the density before it is dithered. */
  density?: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const timer = useRef(10);
  const laidAt = useRef({ x: NaN, z: NaN });
  const derived = useRef<{ snap: Snapshot | null; pathAt: Map<string, number>; sealed: Set<string> }>({ snap: null, pathAt: new Map(), sealed: new Set() });
  const n = Math.ceil(radius / CELL_SIZE);
  const size = 2 * n + 1;
  // two channels a cell: r = the grass density, g = the path's strength (the street's wear)
  const data = useMemo(() => new Uint8Array(size * size * 2), [size]);
  const tex = useMemo(() => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGFormat, THREE.UnsignedByteType);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }, [data, size]);
  const geom = useMemo(() => new THREE.PlaneGeometry(2 * radius, 2 * radius).rotateX(-Math.PI / 2), [radius]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uG: { value: tex },
          uOrigin: { value: new THREE.Vector2() },
          uSpan: { value: size * CELL_SIZE },
          uCentre: { value: new THREE.Vector2() },
          uRadius: { value: radius },
          uPx: { value: pixel },
          uColor: { value: new THREE.Color(color) },
          uDither: { value: dither ? 1 : 0 },
          uFog: { value: 0 },
          uFogNear: { value: 1 },
          uFogFar: { value: 100 },
          uFogColor: { value: new THREE.Color("#000000") },
          uStreet: { value: 0 },
          uCell: { value: CELL_SIZE },
          uWear: { value: 0 },
          uWearGrey: { value: 0.42 },
          uSeam: { value: 0.6 },
          uGrain: { value: 0.5 },
          uWind: { value: 0 },
          uWindSpeed: { value: 1 },
          uTime: { value: 0 },
          uPaper: { value: 0 },
          uGroundOnPaper: { value: 0 },
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tex],
  );
  useEffect(
    () => () => {
      tex.dispose();
      geom.dispose();
      mat.dispose();
    },
    [tex, geom, mat],
  );

  useFrame(({ gl, scene, clock }, dt) => {
    // no ground while the lidar scan is the place: its black is the scan's only (the artist, 2026-11-24, "배경 색은 또
    // 왜이래" — the green grass face and the grey worn paths showed under the scan with 흰 바탕 off)
    const scanning = lidarActive();
    if (mesh.current) mesh.current.visible = !scanning;
    if (scanning) return;
    const p = playerPosRef.current;
    mesh.current?.position.set(p.x, 0.005, p.z);
    const u = mat.uniforms;
    (u.uCentre.value as THREE.Vector2).set(p.x, p.z);
    u.uRadius.value = radius;
    // 길거리 (streetLook.ts): the worn ground and the wind, nothing unless the trial is on
    const st = streetGround;
    u.uStreet.value = st.on ? 1 : 0;
    u.uWear.value = st.wear;
    u.uWearGrey.value = st.wearGrey;
    u.uSeam.value = st.seam;
    u.uGrain.value = st.grain;
    u.uWind.value = st.wind;
    u.uWindSpeed.value = st.windSpeed;
    u.uTime.value = clock.elapsedTime;
    u.uPaper.value = st.on && st.paper ? 1 : 0;
    u.uGroundOnPaper.value = st.groundOnPaper ? 1 : 0;
    // the scene's fog, if any (길거리 › 깊이 안개 in the brutal look; the soft look never draws this field)
    const fog = scene.fog as THREE.Fog | null;
    u.uFog.value = fog && fog.isFog ? 1 : 0;
    if (fog && fog.isFog) {
      u.uFogNear.value = fog.near;
      u.uFogFar.value = fog.far;
      (u.uFogColor.value as THREE.Color).copy(fog.color);
    }
    u.uPx.value = pixel * gl.getPixelRatio();
    (u.uColor.value as THREE.Color).set(color);
    u.uDither.value = dither ? 1 : 0;
    const filter = dither ? THREE.NearestFilter : THREE.LinearFilter;
    if (tex.magFilter !== filter) {
      tex.magFilter = tex.minFilter = filter;
      tex.needsUpdate = true;
    }
    timer.current += dt;
    const jumped = Number.isFinite(laidAt.current.x) && Math.hypot(p.x - laidAt.current.x, p.z - laidAt.current.z) > WORLD_SIZE / 4;
    if (timer.current < REFRESH && !jumped) return;
    timer.current = 0;
    laidAt.current = { x: p.x, z: p.z };
    const t0 = performance.now();
    const snap = getSnapshot();
    let { pathAt, sealed } = derived.current;
    if (derived.current.snap !== snap) {
      pathAt = new Map<string, number>();
      sealed = new Set<string>();
      if (snap) {
        for (const q of snap.paths) pathAt.set(q.key, q.p);
        for (const s of snap.slabs) if (s.h >= 0.15) sealed.add(s.key);
      }
      derived.current = { snap, pathAt, sealed };
    }
    const stress = getStress();
    const quick = getQuick?.() ?? null;
    const cx0 = Math.floor(p.x / CELL_SIZE);
    const cz0 = Math.floor(p.z / CELL_SIZE);
    (u.uOrigin.value as THREE.Vector2).set((cx0 - n) * CELL_SIZE, (cz0 - n) * CELL_SIZE);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        // drawn where it lies around the player, but it IS the canonical cell: the world wraps
        const wx = wrapCell(cx0 - n + i);
        const wz = wrapCell(cz0 - n + j);
        const key = `${wx},${wz}`;
        const S = (stress?.get(key) ?? 0) + (quick?.get(key) ?? 0);
        const pp = pathAt.get(key) ?? 0;
        const k = (j * size + i) * 2;
        data[k] = Math.min(255, Math.round(255 * density * grassDensity(wx, wz, S, pp, sealed.has(key), cfg)));
        data[k + 1] = Math.min(255, Math.round(255 * Math.min(1, pp)));
      }
    }
    tex.needsUpdate = true;
    markSpan("cloud", performance.now() - t0);
  });

  return <mesh ref={mesh} geometry={geom} material={mat} frustumCulled={false} />;
}

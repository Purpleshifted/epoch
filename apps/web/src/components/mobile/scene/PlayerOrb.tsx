"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}
function simpleNoise(x: number, y: number, t: number) {
  return (
    Math.sin(x * 0.5 + t) * 0.5 +
    Math.cos(y * 0.5 + t * 0.7) * 0.3 +
    Math.sin((x + y) * 0.3 + t * 1.2) * 0.2
  );
}

// ─── 외핵 cloud 셰이더 ────────────────────────────────
// vNormalView.z = 1 at center (faces camera), 0 at silhouette edge
// → soft center-bright, edge-transparent = nebula cloud
const NUCLEUS_VS = /* glsl */`
  varying vec3 vNormalView;
  varying vec3 vLocalPos;
  void main() {
    vNormalView = normalize(normalMatrix * normal);
    vLocalPos   = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NUCLEUS_FS = /* glsl */`
  uniform vec3  uColor;
  uniform float uAlpha;
  uniform float uTime;
  varying vec3 vNormalView;
  varying vec3 vLocalPos;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i),             hash(i+vec3(1,0,0)), f.x),
          mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
          mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z
    );
  }

  void main() {
    float center = max(0.0, vNormalView.z);
    float n1 = vnoise(vLocalPos * 5.5 + uTime * 0.18);
    float n2 = vnoise(vLocalPos * 11.0 - uTime * 0.12);
    float organic = n1 * 0.65 + n2 * 0.35;
    float cloud = pow(center, 0.85) * (0.5 + organic * 0.5);
    cloud = smoothstep(0.0, 1.0, cloud);
    gl_FragColor = vec4(uColor, cloud * uAlpha);
  }
`;

// ─── 파티클 셰이더 ────────────────────────────────────
const VS = /* glsl */`
  attribute float aAlpha;
  uniform float uPointSize;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize;
    gl_Position = projectionMatrix * mv;
  }
`;

const FS = /* glsl */`
  uniform vec3  uColor;
  uniform float uGlow;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float hard = step(d, 0.46);
    float soft = 1.0 / (1.0 + exp(16.0 * (d - 0.25)));
    float shape = mix(hard, soft, uGlow);
    gl_FragColor = vec4(uColor, vAlpha * shape);
  }
`;

export interface PlayerOrbProps {
  position: [number, number, number];
  color: string;
  depth: number;
  count: number;
  orbRadius: number;
  pointSize: number;
  baseAlpha: number;
  wobbleScale: number;
  glowAmount: number;
  nucleusSize: number;
  nucleusAlpha: number;
}

export function PlayerOrb({
  position, color, depth,
  count, orbRadius, pointSize, baseAlpha, wobbleScale, glowAmount,
  nucleusSize, nucleusAlpha,
}: PlayerOrbProps) {
  const seeds = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        u1: seededRandom(i * 17.3),
        u2: seededRandom(i * 31.7),
        phiSeed: seededRandom(i * 47.9),
        wobX: i * 13.7,
        wobY: i * 19.1,
      });
    }
    return arr;
  }, [count]);

  const posBuf = useMemo(() => new Float32Array(count * 3), [count]);
  const alBuf  = useMemo(() => new Float32Array(count),     [count]);

  const uColor  = useMemo(() => ({ value: new THREE.Color(color) }), [color]);
  const uSize   = useMemo(() => ({ value: pointSize }),  []);
  const uGlow   = useMemo(() => ({ value: glowAmount }), []);
  uColor.value.set(color);
  uSize.value  = pointSize;
  uGlow.value  = glowAmount;

  const uNColor = useMemo(() => ({ value: new THREE.Color(color) }), [color]);
  const uNAlpha = useMemo(() => ({ value: nucleusAlpha * 0.5 }), []);
  const uNTime  = useMemo(() => ({ value: 0 }), []);
  uNColor.value.set(color);
  uNAlpha.value = nucleusAlpha * 0.5;

  const pointsRef = useRef<THREE.Points>(null);
  const tRef = useRef(0);

  useFrame((_, delta) => {
    tRef.current += delta;
    const time  = tRef.current;
    const scale = orbRadius * (1 + depth * 0.2);
    uNTime.value = time;

    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      const angle    = s.u1 * Math.PI * 2;
      const edgeBias = Math.pow(s.u2, 0.2);
      const baseR    = edgeBias * scale;

      const wobR = wobbleScale * 0.15 * scale *
        simpleNoise(s.wobX * 0.3, s.wobY * 0.3, time * 0.15);
      const wobA = wobbleScale * 2.0 *
        simpleNoise(s.wobX * 0.5, s.wobY * 0.5, time * 0.18);

      const r     = Math.min(baseR + wobR, baseR * 1.15);
      const theta = angle + wobA;
      const phi   = Math.acos(2 * s.phiSeed - 1);

      posBuf[i*3]   = r * Math.sin(phi) * Math.cos(theta);
      posBuf[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
      posBuf[i*3+2] = r * Math.cos(phi);

      const flicker = 0.6 *
        simpleNoise(i * 0.7, 0.0, time * 0.1 * ((i % 8) + 1));
      alBuf[i] = Math.max(0.1, Math.min(1.0, baseAlpha + flicker * 0.5));
    }

    if (pointsRef.current) {
      const geo = pointsRef.current.geometry;
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (geo.attributes.aAlpha   as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  const nR     = orbRadius * nucleusSize;
  const cloudR = orbRadius * nucleusSize * 2.8;

  return (
    <group position={position}>
      {/* 내핵 */}
      <mesh>
        <sphereGeometry args={[nR, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={nucleusAlpha} />
      </mesh>

      {/* 외핵 cloud: 중심→엣지 그라디언트 + 3D noise 요동 */}
      <mesh>
        <sphereGeometry args={[cloudR, 24, 24]} />
        <shaderMaterial
          vertexShader={NUCLEUS_VS}
          fragmentShader={NUCLEUS_FS}
          uniforms={{ uColor: uNColor, uAlpha: uNAlpha, uTime: uNTime }}
          transparent
          depthWrite={false}
          side={THREE.FrontSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* 파티클 클라우드 */}
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[posBuf, 3]} />
          <bufferAttribute attach="attributes-aAlpha"   args={[alBuf,  1]} />
        </bufferGeometry>
        <shaderMaterial
          vertexShader={VS}
          fragmentShader={FS}
          uniforms={{ uColor, uPointSize: uSize, uGlow }}
          transparent
          depthWrite={false}
          blending={THREE.NormalBlending}
        />
      </points>
    </group>
  );
}

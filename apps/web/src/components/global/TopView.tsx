"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StarBody {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  phaseAge: number;
  mass: number;
  phase:
    | "nebula"
    | "protostar"
    | "mainSequence"
    | "redGiant"
    | "supernova"
    | "remnant";
  age: number;
  radius: number;
  isPermanent: boolean;
}

const LS_KEY = "anthropocene:stars:v1";

function loadStars(): StarBody[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const all: StarBody[] = JSON.parse(raw);
    return all.filter((s) => s.isPermanent === true);
  } catch {
    return [];
  }
}

// ─── Shaders ──────────────────────────────────────────────────────────────────

const vertexShader = /* glsl */ `
attribute float aPhase;
attribute float aMass;
attribute float aOffset;
uniform float uTime;
varying vec3 vColor;

vec3 kelvinToRGB(float tempK) {
  float t = clamp(tempK, 1000.0, 40000.0) / 100.0;
  vec3 c;
  c.r = t <= 66.0 ? 1.0 : clamp(329.6987 * pow(t - 60.0, -0.1332) / 255.0, 0.0, 1.0);
  c.g = t <= 66.0 ? clamp((99.4708 * log(t) - 161.1195) / 255.0, 0.0, 1.0) : clamp(288.1221 * pow(t - 60.0, -0.0755) / 255.0, 0.0, 1.0);
  c.b = t >= 66.0 ? 1.0 : t <= 19.0 ? 0.0 : clamp((138.5177 * log(t - 10.0) - 305.0447) / 255.0, 0.0, 1.0);
  return c;
}

void main() {
  float massSun = max(aMass / 180.0, 0.01);
  float L = pow(massSun, 3.5);
  float R = pow(massSun, 0.7);
  float T = 5778.0 * pow(L / (R * R), 0.25);

  vec3 baseColor;
  if (aPhase < 0.5) {
    baseColor = kelvinToRGB(clamp(T, 4000.0, 40000.0));
    vec3 gray = vec3(dot(baseColor, vec3(0.299, 0.587, 0.114)));
    baseColor = clamp(mix(gray, baseColor, 2.2), 0.0, 1.0);
  } else if (aPhase < 1.5) {
    baseColor = vec3(1.0, 0.4, 0.1);
  } else if (aPhase < 2.5) {
    baseColor = vec3(0.8, 0.88, 1.0);
  } else {
    baseColor = vec3(0.3, 0.9, 1.0);
  }
  vColor = baseColor;

  float pulse = 0.85 + 0.15 * sin(uTime * 2.0 + aOffset);
  float sz = (6.0 + pow(aMass, 0.4) * 8.0) * pulse;
  gl_PointSize = clamp(sz, 4.0, 50.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
varying vec3 vColor;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float core = exp(-d*d * 14.0);
  float halo = exp(-d*d * 3.0) * 0.5;
  gl_FragColor = vec4(vColor, core + halo);
}
`;

// ─── Phase helpers ─────────────────────────────────────────────────────────────

function phaseIndex(phase: StarBody["phase"]): number {
  if (phase === "mainSequence") return 0;
  if (phase === "redGiant") return 1;
  if (phase === "remnant") return 2;
  return 3; // supernova → NS
}

function phaseEmoji(phase: StarBody["phase"]): string {
  if (phase === "mainSequence") return "⭐";
  if (phase === "redGiant") return "🔴";
  return "💀";
}

// ─── Orthographic camera auto-fit ─────────────────────────────────────────────

function AutoFitCamera({ stars }: { stars: StarBody[] }) {
  const { camera, size } = useThree();

  useEffect(() => {
    const ortho = camera as THREE.OrthographicCamera;
    if (stars.length === 0) {
      const half = 20;
      const aspect = size.width / size.height;
      ortho.left = -half * aspect;
      ortho.right = half * aspect;
      ortho.top = half;
      ortho.bottom = -half;
      ortho.near = 0.1;
      ortho.far = 1000;
      ortho.position.set(0, 100, 0);
      ortho.lookAt(0, 0, 0);
      ortho.updateProjectionMatrix();
      return;
    }

    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const s of stars) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }

    const spanX = Math.max(maxX - minX, 40) * 1.2;
    const spanZ = Math.max(maxZ - minZ, 40) * 1.2;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const aspect = size.width / size.height;

    const halfH = Math.max(spanZ / 2, spanX / aspect / 2);
    const halfW = halfH * aspect;

    ortho.left = cx - halfW;
    ortho.right = cx + halfW;
    ortho.top = cz + halfH;
    ortho.bottom = cz - halfH;
    ortho.near = 0.1;
    ortho.far = 1000;
    ortho.position.set(cx, 100, cz);
    ortho.lookAt(cx, 0, cz);
    ortho.updateProjectionMatrix();
  }, [stars, camera, size]);

  return null;
}

// ─── Star Points ──────────────────────────────────────────────────────────────

function StarPoints({ stars }: { stars: StarBody[] }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const { geometry, uniforms } = useMemo(() => {
    const positions = new Float32Array(stars.length * 3);
    const aPhase = new Float32Array(stars.length);
    const aMass = new Float32Array(stars.length);
    const aOffset = new Float32Array(stars.length);

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      positions[i * 3] = s.x;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = s.z;
      aPhase[i] = phaseIndex(s.phase);
      aMass[i] = s.mass;
      aOffset[i] = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(aPhase, 1));
    geo.setAttribute("aMass", new THREE.BufferAttribute(aMass, 1));
    geo.setAttribute("aOffset", new THREE.BufferAttribute(aOffset, 1));

    const uni = {
      uTime: { value: 0 },
    };

    return { geometry: geo, uniforms: uni };
  }, [stars]);

  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = clock.getElapsedTime();
    }
  });

  if (stars.length === 0) return null;

  return (
    <points geometry={geometry}>
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ─── Connection Lines ─────────────────────────────────────────────────────────

const CONNECT_DIST = 15;

function ConnectionLines({ stars }: { stars: StarBody[] }) {
  const geometry = useMemo(() => {
    const verts: number[] = [];
    const colors: number[] = [];

    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const dx = stars[i].x - stars[j].x;
        const dz = stars[i].z - stars[j].z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < CONNECT_DIST) {
          const alpha = 1 - dist / CONNECT_DIST;
          const brightness = alpha * 0.2;
          verts.push(stars[i].x, 0, stars[i].z);
          colors.push(brightness, brightness, brightness);
          verts.push(stars[j].x, 0, stars[j].z);
          colors.push(brightness, brightness, brightness);
        }
      }
    }

    if (verts.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(verts), 3)
    );
    geo.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(colors), 3)
    );
    return geo;
  }, [stars]);

  if (!geometry) return null;

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.8} depthWrite={false} />
    </lineSegments>
  );
}

// ─── Star Labels ──────────────────────────────────────────────────────────────

function StarLabels({ stars }: { stars: StarBody[] }) {
  return (
    <>
      {stars.map((s) => (
        <Html
          key={s.id}
          position={[s.x, 0, s.z]}
          center
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          <div
            style={{
              transform: "translateY(-18px)",
              color: "rgba(255,255,255,0.55)",
              fontSize: "9px",
              letterSpacing: "0.05em",
              whiteSpace: "nowrap",
              textShadow: "0 0 4px rgba(0,0,0,0.8)",
            }}
          >
            {phaseEmoji(s.phase)} {Math.round(s.mass)}
          </div>
        </Html>
      ))}
    </>
  );
}

// ─── Scene ────────────────────────────────────────────────────────────────────

function Scene({ stars }: { stars: StarBody[] }) {
  return (
    <>
      <AutoFitCamera stars={stars} />
      <gridHelper args={[200, 40, "#111111", "#0a0a0a"]} rotation={[0, 0, 0]} />
      <StarPoints stars={stars} />
      <ConnectionLines stars={stars} />
      <StarLabels stars={stars} />
      <EffectComposer>
        <Bloom
          intensity={1.5}
          luminanceThreshold={0.1}
          luminanceSmoothing={0.9}
          radius={0.8}
        />
      </EffectComposer>
    </>
  );
}

// ─── TopView (root export) ────────────────────────────────────────────────────

export default function TopView() {
  const router = useRouter();
  const [stars, setStars] = useState<StarBody[]>([]);

  // Initial load + polling every 3 s
  useEffect(() => {
    const poll = () => setStars(loadStars());
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {/* HUD */}
      <div className="absolute top-4 left-4 text-white/40 text-xs tracking-widest uppercase font-light z-10 pointer-events-none">
        Galaxy Map
      </div>
      <div className="absolute top-4 right-4 text-white/40 text-xs z-10 pointer-events-none">
        {stars.length} permanent stars
      </div>
      <button
        className="absolute bottom-6 left-6 text-white/50 text-xs border border-white/20 px-4 py-2 rounded hover:text-white/80 transition-colors z-10"
        onClick={() => router.push("/")}
      >
        ← Back
      </button>

      {/* Empty state */}
      {stars.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm tracking-wider z-10 pointer-events-none">
          탐험을 시작하면 별이 나타납니다
        </div>
      )}

      {/* Three.js canvas */}
      <Canvas
        orthographic
        camera={{ position: [0, 100, 0], near: 0.1, far: 1000 }}
        style={{ background: "#000000" }}
        gl={{ antialias: true, alpha: false }}
      >
        <Scene stars={stars} />
      </Canvas>
    </div>
  );
}

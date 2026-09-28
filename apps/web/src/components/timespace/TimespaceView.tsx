"use client";

/**
 * timespace/TimespaceView.tsx
 *
 * 시공간 블록 전체를 3D로 돌려보는 뷰.
 * - OrbitControls로 자유 회전
 * - X, Z = 공간 / Y = 시간(age)
 * - 별 = colored point at (star.x, star.age * scale, star.z)
 * - 기둥 = 별이 존재한 시간만큼 t=0에서 위로 뻗는 선
 * - 색상 = creatorAngle 기반 (어느 관측자 평면의 별인지)
 * - localStorage 1초 폴링 → 모바일 탭과 실시간 싱크
 */

import { useRef, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { useRouter } from "next/navigation";
import { useSpacetimeStarsWithRef } from "@/components/spacetime/useSpacetimeStars";
import { PLANE_COLORS, PLANE_SLOT_COUNT, type StarBody } from "@/components/spacetime/types";

// ──────────────────────────────────────────────────────────────
const AGE_SCALE   = 0.055;   // 1초 = 0.055 units 높이
const STRATA_STEP = 30;      // 30초마다 수평 격자면

function starPlaneColor(star: StarBody): [number, number, number] {
  if (star.creatorAngle == null) {
    // phase-based fallback
    if (star.phase === "redGiant")  return [1, 0.42, 0.1];
    if (star.phase === "remnant")   return [0.75, 0.88, 1];
    return [1, 1, 1];
  }
  const slot = Math.round(
    ((star.creatorAngle / (Math.PI * 2)) * PLANE_SLOT_COUNT + PLANE_SLOT_COUNT) % PLANE_SLOT_COUNT
  ) % PLANE_SLOT_COUNT;
  const hex = PLANE_COLORS[slot];
  const n   = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

// ──────────────────────────────────────────────────────────────
// 수평 격자 (t 구간마다 한 장)
// ──────────────────────────────────────────────────────────────
function StratumGrid({ maxAge, extent }: { maxAge: number; extent: number }) {
  const geos = useMemo(() => {
    const planes: JSX.Element[] = [];
    const count = Math.ceil(maxAge / STRATA_STEP) + 1;
    for (let i = 0; i <= count; i++) {
      const y  = i * STRATA_STEP * AGE_SCALE;
      const geo = new THREE.PlaneGeometry(extent * 2, extent * 2, 1, 1);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, y, 0);
      planes.push(
        <mesh key={i} geometry={geo}>
          <meshBasicMaterial color="#0a1233" transparent opacity={i === 0 ? 0.35 : 0.12} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      );
    }
    return planes;
  }, [maxAge, extent]);
  return <>{geos}</>;
}

// ──────────────────────────────────────────────────────────────
// t 축 (y축 중심 기둥)
// ──────────────────────────────────────────────────────────────
function TimeAxis({ height }: { height: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, height, 0], 3));
    return g;
  }, [height]);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#223399" transparent opacity={0.6} />
    </lineSegments>
  );
}

// ──────────────────────────────────────────────────────────────
// 별 + 기둥 (Stars + Existence Pillars)
// ──────────────────────────────────────────────────────────────
const STAR_VS = /* glsl */`
  attribute float aAge;
  attribute float aTimeDelta;  // per-star: will use uniform instead
  attribute vec3  aColor;
  uniform   float uTime;
  uniform   float uTimeDelta;
  varying   vec3  vColor;

  void main() {
    vColor = aColor;
    float y = (aAge + uTimeDelta) * ${AGE_SCALE.toFixed(4)};
    float pulse = 0.85 + 0.15 * sin(uTime * 2.0 + position.x * 3.7 + position.z * 2.3);
    gl_PointSize = clamp((3.0 + sqrt(max(0.0, position.y)) * 0.8) * pulse, 2.0, 28.0);
    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position.x, y, position.z, 1.0);
  }
`;
const STAR_FS = /* glsl */`
  precision highp float;
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv); if (d > 0.5) discard;
    float a = exp(-d*d*8.0) + exp(-d*d*2.0)*0.5;
    gl_FragColor = vec4(vColor, a);
  }
`;

function StarsAndPillars({ stars, pollTimeRef }: { stars: StarBody[]; pollTimeRef: React.RefObject<number> }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const { pos, ages, colors } = useMemo(() => {
    const n = stars.length;
    const pos    = new Float32Array(n * 3);
    const ages   = new Float32Array(n);
    const colors = new Float32Array(n * 3);
    stars.forEach((s, i) => {
      pos[i*3]   = s.x;
      pos[i*3+1] = 0;   // shader computes Y from aAge+uTimeDelta
      pos[i*3+2] = s.z;
      ages[i]    = s.age;
      const [r,g,b] = starPlaneColor(s);
      colors[i*3]=r; colors[i*3+1]=g; colors[i*3+2]=b;
    });
    return { pos, ages, colors };
  }, [stars]);

  // Pillar geometry: bottom(y=0) → top(y=age*scale)
  const pillarGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pts: number[] = [], col: number[] = [];
    stars.forEach((s) => {
      const yTop = s.age * AGE_SCALE;
      const [r,gv,b] = starPlaneColor(s);
      pts.push(s.x, 0, s.z,  s.x, yTop, s.z);
      col.push(r*0.5, gv*0.5, b*0.5,  r*0.08, gv*0.08, b*0.08);
    });
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute("color",    new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [stars]);

  useFrame((_, dt) => {
    if (!matRef.current) return;
    matRef.current.uniforms.uTime.value      += dt;
    matRef.current.uniforms.uTimeDelta.value  = (Date.now() - pollTimeRef.current) / 1000;
  });

  if (!stars.length) return null;
  return (
    <>
      {/* 기둥 */}
      <lineSegments geometry={pillarGeo}>
        <lineBasicMaterial vertexColors transparent opacity={0.5} depthWrite={false} />
      </lineSegments>
      {/* 별 포인트 */}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" array={pos}    itemSize={3} count={stars.length} />
          <bufferAttribute attach="attributes-aAge"     array={ages}   itemSize={1} count={stars.length} />
          <bufferAttribute attach="attributes-aColor"   array={colors} itemSize={3} count={stars.length} />
        </bufferGeometry>
        <shaderMaterial
          ref={matRef}
          vertexShader={STAR_VS}
          fragmentShader={STAR_FS}
          uniforms={{ uTime: { value: 0 }, uTimeDelta: { value: 0 } }}
          transparent depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// "지금" 슬라이스 — 최신 별의 Y 위치에 얇은 평면
// ──────────────────────────────────────────────────────────────
function NowSlice({ stars, pollTimeRef }: { stars: StarBody[]; pollTimeRef: React.RefObject<number> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const maxBaseAge = Math.max(0, ...stars.map(s => s.age));
  useFrame(() => {
    if (!meshRef.current) return;
    const elapsed = (Date.now() - pollTimeRef.current) / 1000;
    meshRef.current.position.y = (maxBaseAge + elapsed) * AGE_SCALE;
  });
  if (!stars.length) return null;
  return (
    <mesh ref={meshRef} rotation={[-Math.PI/2, 0, 0]}>
      <planeGeometry args={[40, 40]} />
      <meshBasicMaterial color="#3355ff" transparent opacity={0.06} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// ──────────────────────────────────────────────────────────────
// Scene
// ──────────────────────────────────────────────────────────────
function Scene({ stars, pollTimeRef }: { stars: StarBody[]; pollTimeRef: React.RefObject<number> }) {
  const maxAge = Math.max(60, ...stars.map(s => s.age));
  const height = (maxAge + STRATA_STEP * 2) * AGE_SCALE;
  const extent = Math.max(20, ...stars.flatMap(s => [Math.abs(s.x), Math.abs(s.z)])) * 1.3;

  return (
    <>
      <color attach="background" args={["#000000"]} />
      <ambientLight intensity={0.05} />

      <TimeAxis height={height} />
      <StratumGrid maxAge={maxAge + STRATA_STEP} extent={extent} />
      <NowSlice stars={stars} pollTimeRef={pollTimeRef} />
      <StarsAndPillars stars={stars} pollTimeRef={pollTimeRef} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.6}
        zoomSpeed={0.8}
        minDistance={5}
        maxDistance={200}
      />

      <EffectComposer>
        <Bloom intensity={2.5} luminanceThreshold={0.02} luminanceSmoothing={0.9} radius={1.2} />
      </EffectComposer>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// HUD overlay
// ──────────────────────────────────────────────────────────────
function HUD({ stars, pollTimeRef }: { stars: StarBody[]; pollTimeRef: React.RefObject<number> }) {
  const router = useRouter();
  // Collect unique planes active
  const planes = useMemo(() => {
    const seen = new Set<number>();
    stars.forEach(s => {
      if (s.creatorAngle != null) {
        const slot = Math.round(
          ((s.creatorAngle / (Math.PI*2)) * PLANE_SLOT_COUNT + PLANE_SLOT_COUNT) % PLANE_SLOT_COUNT
        ) % PLANE_SLOT_COUNT;
        seen.add(slot);
      }
    });
    return Array.from(seen);
  }, [stars]);

  return (
    <>
      {/* 상단 정보 */}
      <div className="absolute top-4 left-4 pointer-events-none select-none">
        <div className="text-white/30 text-[10px] tracking-widest uppercase mb-2">Spacetime Block</div>
        <div className="text-white/20 text-[9px] font-mono">
          {stars.length} permanent · {planes.length} planes active
        </div>
        {planes.length > 0 && (
          <div className="flex gap-1 mt-1">
            {planes.map(slot => (
              <div
                key={slot}
                className="w-2 h-2 rounded-full"
                style={{ background: PLANE_COLORS[slot] }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 범례 */}
      <div className="absolute top-4 right-4 pointer-events-none select-none text-[9px] text-white/20 font-mono text-right space-y-0.5">
        <div>Y = time (age)</div>
        <div>XZ = space</div>
        <div>color = observer θ</div>
        <div>pillar = lifetime</div>
      </div>

      {/* 빈 상태 */}
      {stars.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-3">
          <div className="text-white/20 text-sm font-light tracking-widest">시공간이 비어있습니다</div>
          <div className="text-white/12 text-xs font-mono">
            /mobile 에서 탐험을 시작하면 별이 여기에 기록됩니다
          </div>
        </div>
      )}

      {/* 네비게이션 */}
      <div className="absolute bottom-5 left-5 flex gap-2">
        <button
          className="text-white/25 text-xs border border-white/10 px-3 py-1.5 rounded hover:text-white/50 hover:border-white/20 transition-colors"
          onClick={() => router.push("/")}
        >←</button>
        <a
          href="/mobile"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/25 text-xs border border-white/10 px-3 py-1.5 rounded hover:text-white/50 hover:border-white/20 transition-colors"
        >
          mobile ↗
        </a>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
export default function TimespaceView() {
  const { stars, pollTimeRef } = useSpacetimeStarsWithRef({ pollMs: 1000, permanentOnly: false });

  return (
    <div className="relative h-screen w-full bg-black overflow-hidden">
      <Canvas
        camera={{ position: [22, 12, 22], fov: 45, near: 0.1, far: 2000 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: "#000" }}
      >
        <Scene stars={stars} pollTimeRef={pollTimeRef} />
      </Canvas>
      <HUD stars={stars} pollTimeRef={pollTimeRef} />
    </div>
  );
}

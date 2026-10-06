"use client";

/**
 * TimespaceView — 시공간 블록 3D 뷰
 *
 * 핵심 비주얼 요소:
 *   1. XZ 바닥면 ("birth plane") — 모바일 뷰와 동일한 공간 배치
 *   2. Worldline pillar — 발생지점부터 (φ, β) 방향으로 실시간 성장
 *   3. 수직 참조선 — β=0 기준선과의 차이로 기울기 직관화
 *   4. XZ shadow — 현재 별의 공간 위치를 바닥면에 투영
 *   5. "지금" 절단면 — 현재 시각의 강한 수평선
 *   6. 별 점 — worldline의 현재 끝(tip), 매 프레임 갱신
 */

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { useRouter } from "next/navigation";
import { useSpacetimeStarsWithRef } from "@/components/spacetime/useSpacetimeStars";
import { PLANE_COLORS, type StarBody } from "@/components/spacetime/types";
import { starPhiBeta } from "@/components/spacetime/legacy/worldline";

// ──────────────────────────────────────────────────────────────
const AGE_SCALE   = 0.055;  // 1초 = 0.055 world units (Y)
const STRATA_STEP = 30;     // 30초마다 격자면

// ── 별 실제 색상 (StarFieldSystem GLSL과 동일) ──
function kelvinToRGB(K: number): [number, number, number] {
  const t = Math.max(10, Math.min(400, K / 100));
  const r = t <= 66 ? 1.0 : Math.max(0, Math.min(1, 329.6987 * Math.pow(t-60,-0.1332)/255));
  const g = t <= 66
    ? Math.max(0, Math.min(1, (99.4708*Math.log(t)-161.1195)/255))
    : Math.max(0, Math.min(1, 288.1221*Math.pow(t-60,-0.0755)/255));
  const b = t >= 66 ? 1.0 : t <= 19 ? 0.0
    : Math.max(0, Math.min(1, (138.5177*Math.log(t-10)-305.0447)/255));
  return [r, g, b];
}

function starActualColor(s: StarBody): [number, number, number] {
  switch (s.phase) {
    case "mainSequence": {
      const ms = Math.max(s.mass/180, 0.01);
      const T  = 5778 * Math.pow(Math.pow(ms,3.5) / Math.pow(ms,1.4), 0.25);
      const [r,g,b] = kelvinToRGB(Math.min(T, 40000));
      const gray = r*0.299 + g*0.587 + b*0.114;
      return [Math.min(1,gray+(r-gray)*2.2), Math.min(1,gray+(g-gray)*2.2), Math.min(1,gray+(b-gray)*2.2)];
    }
    case "redGiant":  return [1.0, 0.42, 0.1];
    case "supernova": return [1.0, 0.85, 0.35];
    case "remnant":   return [0.75, 0.88, 1.0];
    case "protostar": return [1.0, 0.6, 0.2];
    case "nebula":    return [0.5, 0.3, 0.85];
    default:          return [0.9, 0.9, 0.9];
  }
}

// ──────────────────────────────────────────────────────────────
// XZ 바닥면 (birth plane) + 격자
// ──────────────────────────────────────────────────────────────
function BirthPlane({ extent }: { extent: number }) {
  const s = Math.ceil(extent * 2 / 5) * 5;
  return (
    <>
      <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[s, s]} />
        <meshBasicMaterial color="#050814" transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <gridHelper args={[s, Math.floor(s/4), "#0d1a3a", "#070f24"]} position={[0, 0.001, 0]} />
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// T축 + 30초마다 수평 참조선
// ──────────────────────────────────────────────────────────────
function TimeAxis({ height, extent }: { height: number; extent: number }) {
  const axisGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0,0,0, 0,height,0], 3));
    return g;
  }, [height]);

  const stratumGeos = useMemo(() => {
    const count = Math.ceil(height / (STRATA_STEP * AGE_SCALE)) + 1;
    return Array.from({ length: count }, (_, i) => {
      const y = i * STRATA_STEP * AGE_SCALE;
      const g = new THREE.BufferGeometry();
      const s = extent * 1.4;
      g.setAttribute("position", new THREE.Float32BufferAttribute([
        -s, y, 0,  s, y, 0,
        0, y, -s,  0, y, s,
      ], 3));
      return { g, y };
    });
  }, [height, extent]);

  return (
    <>
      <lineSegments geometry={axisGeo}>
        <lineBasicMaterial color="#1a2a77" transparent opacity={0.6} />
      </lineSegments>
      {stratumGeos.map(({ g, y }, i) => (
        <lineSegments key={i} geometry={g}>
          <lineBasicMaterial color={i===0 ? "#334488" : "#0d1433"} transparent opacity={i===0 ? 0.5 : 0.2} />
        </lineSegments>
      ))}
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// 핵심: Worldline Pillars
//
// 각 별마다:
//   A. XZ shadow: (x, ε, z) — 바닥면에 투영된 공간 위치 (정적)
//   B. 수직 참조선: (x, 0, z) → (x, nowY, z) — β=0일 때의 worldline (회색)
//   C. Worldline pillar: (x, 0, z) → tip(τ) — 매 프레임 useFrame에서 tip 갱신
//   D. Star point (tip): pillar 끝, 빛나는 별 점
// ──────────────────────────────────────────────────────────────

function WorldlinePillars({
  stars,
  pollTimeRef,
}: {
  stars: StarBody[];
  pollTimeRef: React.RefObject<number>;
}) {
  // ── per-star 상수 (stars 변경 시만 재계산) ──
  const starData = useMemo(() => stars.map(s => {
    const [r,g,b] = starActualColor(s);
    const { phi, beta } = starPhiBeta(s);
    return { x: s.x, z: s.z, birthAge: s.age, r, g, b, phi, beta,
             cx: Math.cos(phi)*beta, cz: Math.sin(phi)*beta };
  }), [stars]);

  // ── Worldline pillar (live-growing top vertex) ──
  const pillarLineRef = useRef<THREE.LineSegments>(null);
  const pillarPosRef  = useRef<Float32Array | null>(null);
  const pillarColRef  = useRef<Float32Array | null>(null);

  const pillarStaticData = useMemo(() => {
    const n   = starData.length;
    const pos = new Float32Array(n * 6); // 2 vertices × 3 per star
    const col = new Float32Array(n * 6);
    starData.forEach(({ x, z, r, g, b }, i) => {
      // bottom (birth): always at (x, 0, z)
      pos[i*6]=x;  pos[i*6+1]=0;    pos[i*6+2]=z;
      col[i*6]=r*0.05; col[i*6+1]=g*0.05; col[i*6+2]=b*0.05;
      // top (tip): initialized, updated in useFrame
      pos[i*6+3]=x; pos[i*6+4]=0.01; pos[i*6+5]=z;
      col[i*6+3]=r; col[i*6+4]=g;    col[i*6+5]=b;
    });
    pillarPosRef.current = pos;
    pillarColRef.current = col;
    return { pos, col, n };
  }, [starData]);

  // ── Vertical reference (β=0 line: pure time axis per star) ──
  const refLineRef = useRef<THREE.LineSegments>(null);
  const refPosRef  = useRef<Float32Array | null>(null);

  const refStaticData = useMemo(() => {
    const n   = starData.length;
    const pos = new Float32Array(n * 6);
    starData.forEach(({ x, z }, i) => {
      pos[i*6]=x; pos[i*6+1]=0; pos[i*6+2]=z;
      pos[i*6+3]=x; pos[i*6+4]=0.01; pos[i*6+5]=z; // top updated in useFrame
    });
    refPosRef.current = pos;
    return { pos, n };
  }, [starData]);

  // ── Star tip points (shader-based, live tip position) ──
  const tipRef       = useRef<THREE.Points>(null);
  const tipMatRef    = useRef<THREE.ShaderMaterial>(null);
  const tipPosRef    = useRef<Float32Array | null>(null);
  const tipColRef    = useRef<Float32Array | null>(null);

  const tipStaticData = useMemo(() => {
    const n   = starData.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    starData.forEach(({ x, z, r, g, b }, i) => {
      pos[i*3]=x; pos[i*3+1]=0.01; pos[i*3+2]=z;
      col[i*3]=r; col[i*3+1]=g; col[i*3+2]=b;
    });
    tipPosRef.current = pos;
    tipColRef.current = col;
    return { pos, col, n };
  }, [starData]);

  // ── useFrame: 매 프레임 tip 위치 갱신 ──
  useFrame((_, dt) => {
    if (!starData.length) return;
    const elapsed = (Date.now() - pollTimeRef.current) / 1000;

    const pPos = pillarPosRef.current;
    const rPos = refPosRef.current;
    const tPos = tipPosRef.current;

    starData.forEach(({ x, z, birthAge, cx, cz }, i) => {
      const tau  = birthAge + elapsed;      // 별의 현재 총 나이 (초)
      const tipY = tau * AGE_SCALE;
      const tipX = x + cx * tau;
      const tipZ = z + cz * tau;

      // pillar top
      if (pPos) { pPos[i*6+3]=tipX; pPos[i*6+4]=tipY; pPos[i*6+5]=tipZ; }
      // ref line top (수직)
      if (rPos) { rPos[i*6+3]=x;    rPos[i*6+4]=tipY; rPos[i*6+5]=z; }
      // star tip point
      if (tPos) { tPos[i*3]=tipX;   tPos[i*3+1]=tipY; tPos[i*3+2]=tipZ; }
    });

    if (pillarLineRef.current) {
      const attr = pillarLineRef.current.geometry.attributes.position as THREE.BufferAttribute;
      attr.needsUpdate = true;
    }
    if (refLineRef.current) {
      const attr = refLineRef.current.geometry.attributes.position as THREE.BufferAttribute;
      attr.needsUpdate = true;
    }
    if (tipRef.current) {
      const attr = tipRef.current.geometry.attributes.position as THREE.BufferAttribute;
      attr.needsUpdate = true;
      if (tipMatRef.current) tipMatRef.current.uniforms.uTime.value += dt;
    }
  });

  // ── XZ shadow (바닥 투영 — 정적) ──
  const shadowGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(starData.length * 3);
    const col = new Float32Array(starData.length * 3);
    starData.forEach(({ x, z, r, g: gv, b }, i) => {
      pos[i*3]=x; pos[i*3+1]=0.002; pos[i*3+2]=z;
      col[i*3]=r*0.3; col[i*3+1]=gv*0.3; col[i*3+2]=b*0.3;
    });
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color",    new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [starData]);

  if (!starData.length) return null;

  return (
    <>
      {/* A. XZ shadow: 별이 공간에서 어디에 있는지 */}
      <points geometry={shadowGeo}>
        <pointsMaterial vertexColors size={0.18} transparent opacity={0.6} depthWrite={false} />
      </points>

      {/* B. 수직 참조선 (β=0 기준 — 기울기 비교용) */}
      <lineSegments ref={refLineRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" array={refStaticData.pos} itemSize={3} count={refStaticData.n*2} />
        </bufferGeometry>
        <lineBasicMaterial color="#1a2a44" transparent opacity={0.35} depthWrite={false} />
      </lineSegments>

      {/* C. Worldline pillar (실시간 성장, 색상 그라디언트) */}
      <lineSegments ref={pillarLineRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" array={pillarStaticData.pos} itemSize={3} count={pillarStaticData.n*2} />
          <bufferAttribute attach="attributes-color"    array={pillarStaticData.col} itemSize={3} count={pillarStaticData.n*2} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent opacity={0.95} depthWrite={false} />
      </lineSegments>

      {/* D. Star tip point (worldline의 현재 끝, 빛남) */}
      <points ref={tipRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" array={tipStaticData.pos} itemSize={3} count={tipStaticData.n} />
          <bufferAttribute attach="attributes-color"    array={tipStaticData.col} itemSize={3} count={tipStaticData.n} />
        </bufferGeometry>
        <shaderMaterial
          ref={tipMatRef}
          uniforms={{ uTime: { value: 0 } }}
          vertexShader={`
            attribute vec3 color; varying vec3 vColor;
            uniform float uTime;
            void main() {
              vColor = color;
              float pulse = 0.8 + 0.2 * sin(uTime * 2.5 + position.x * 4.0);
              gl_PointSize = clamp(dot(color, vec3(0.3,0.6,0.1)) * 20.0 * pulse + 4.0, 4.0, 32.0);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            precision highp float; varying vec3 vColor;
            void main() {
              vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
              if (d > 0.5) discard;
              gl_FragColor = vec4(vColor, exp(-d*d*8.0) + exp(-d*d*2.0)*0.4);
            }
          `}
          transparent depthWrite={false} blending={THREE.AdditiveBlending}
        />
      </points>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// "지금" 절단면 + 플레이어 마커
// ──────────────────────────────────────────────────────────────
interface PlayerInfo { x: number; z: number; color: string; phi?: number; beta?: number; ts: number; }

function NowPlane({
  stars, pollTimeRef, player,
}: {
  stars: StarBody[]; pollTimeRef: React.RefObject<number>; player: PlayerInfo | null;
}) {
  const planeRef   = useRef<THREE.Mesh>(null);
  const markerRef  = useRef<THREE.Mesh>(null);
  const maxBaseAge = useMemo(() => Math.max(0, ...stars.map(s => s.age)), [stars]);

  useFrame(() => {
    const elapsed = (Date.now() - pollTimeRef.current) / 1000;
    const nowY    = (maxBaseAge + elapsed) * AGE_SCALE;
    if (planeRef.current)  planeRef.current.position.y  = nowY;
    if (markerRef.current) {
      if (player) {
        const tau  = (maxBaseAge + elapsed);
        const phi  = player.phi  ?? 0;
        const beta = player.beta ?? 0;
        markerRef.current.position.set(
          player.x + Math.cos(phi)*beta*tau,
          nowY,
          player.z + Math.sin(phi)*beta*tau,
        );
      } else {
        markerRef.current.position.y = nowY;
      }
    }
  });

  const extent = Math.max(20, ...stars.flatMap(s => [Math.abs(s.x), Math.abs(s.z)])) * 1.6;

  return (
    <>
      {/* "지금" 절단면 — 강하고 얇은 */}
      <mesh ref={planeRef} rotation={[-Math.PI/2, 0, 0]}>
        <planeGeometry args={[extent*2, extent*2]} />
        <meshBasicMaterial color="#2255ff" transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* 플레이어 마커 */}
      {player && (
        <mesh ref={markerRef} position={[player.x, 0, player.z]}>
          <sphereGeometry args={[0.3, 8, 8]} />
          <meshBasicMaterial color={player.color ?? "#ffffff"} transparent opacity={0.9} />
        </mesh>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// Scene
// ──────────────────────────────────────────────────────────────
function Scene({
  stars, pollTimeRef, player,
}: {
  stars: StarBody[]; pollTimeRef: React.RefObject<number>; player: PlayerInfo | null;
}) {
  const maxAge = Math.max(60, ...stars.map(s => s.age));
  const height = (maxAge + STRATA_STEP * 2) * AGE_SCALE;
  const extent = Math.max(15, ...stars.flatMap(s => [Math.abs(s.x), Math.abs(s.z)])) * 1.4;

  return (
    <>
      <color attach="background" args={["#000509"]} />

      <BirthPlane extent={extent} />
      <TimeAxis height={height} extent={extent} />
      <WorldlinePillars stars={stars} pollTimeRef={pollTimeRef} />
      <NowPlane stars={stars} pollTimeRef={pollTimeRef} player={player} />

      <OrbitControls
        makeDefault enableDamping dampingFactor={0.07}
        rotateSpeed={0.55} zoomSpeed={0.8}
        minDistance={2} maxDistance={400}
        target={[0, height * 0.35, 0]}
      />
      <EffectComposer>
        <Bloom intensity={3.0} luminanceThreshold={0.01} luminanceSmoothing={0.9} radius={1.4} />
      </EffectComposer>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// HUD
// ──────────────────────────────────────────────────────────────
function HUD({ stars, player }: { stars: StarBody[]; player: PlayerInfo | null }) {
  const router   = useRouter();
  const isStale  = player ? Date.now() - player.ts > 5000 : true;
  const betaPct  = player?.beta ? Math.round(player.beta * 100) : null;

  return (
    <>
      <div className="absolute top-4 left-4 pointer-events-none select-none space-y-1">
        <div className="text-white/20 text-[10px] tracking-widest uppercase">Spacetime Block</div>
        <div className="text-white/12 text-[9px] font-mono">{stars.length} worldlines</div>
        {player && !isStale && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: player.color ?? "#fff" }} />
            <span className="text-white/25 text-[9px] font-mono">
              φ={Math.round((player.phi ?? 0) * 180 / Math.PI)}° β={betaPct}%c
            </span>
          </div>
        )}
      </div>

      <div className="absolute top-4 right-4 pointer-events-none select-none text-[9px] text-white/15 font-mono text-right leading-relaxed">
        <div>Y ↑ = time</div>
        <div>XZ = birth position</div>
        <div>tilt = φ direction</div>
        <div>lean = β speed</div>
        <div className="mt-1 text-white/10">— = β=0 reference</div>
      </div>

      {stars.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-2">
          <div className="text-white/18 text-sm tracking-widest">/mobile 에서 별을 만들면</div>
          <div className="text-white/10 text-xs font-mono">worldline이 여기에 그려집니다</div>
        </div>
      )}

      <div className="absolute bottom-5 left-5 flex gap-2">
        <button
          className="text-white/20 text-xs border border-white/10 px-3 py-1.5 rounded hover:text-white/40 transition-colors"
          onClick={() => router.push("/legacy")}
        >←</button>
        <a href="/legacy/mobile" target="_blank" rel="noopener noreferrer"
          className="text-white/20 text-xs border border-white/10 px-3 py-1.5 rounded hover:text-white/40 transition-colors">
          mobile ↗
        </a>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
export default function TimespaceView() {
  const { stars, pollTimeRef } = useSpacetimeStarsWithRef({ pollMs: 1500, permanentOnly: false });
  const [player, setPlayer]   = useState<PlayerInfo | null>(null);

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem("anthropocene:player:v1");
        if (!raw) { setPlayer(null); return; }
        const p = JSON.parse(raw) as PlayerInfo;
        if (Date.now() - p.ts > 5000) { setPlayer(null); return; }
        setPlayer(p);
      } catch { setPlayer(null); }
    };
    load();
    const id = setInterval(load, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative h-screen w-full bg-black overflow-hidden">
      <Canvas
        camera={{ position: [18, 8, 18], fov: 50, near: 0.05, far: 2000 }}
        gl={{ antialias: true, alpha: false }}
      >
        <Scene stars={stars} pollTimeRef={pollTimeRef} player={player} />
      </Canvas>
      <HUD stars={stars} player={player} />
    </div>
  );
}

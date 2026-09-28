"use client";

/**
 * SideView — 회전하는 시공간 기둥 (Rotating Spacetime Column)
 *
 * - 지금(now) = 화면 아래, 과거 = 위
 * - 전체가 실제론 3D 기둥이 천천히 Y축 회전 중
 * - 화면엔 2D처럼 꽉 채워 보임
 * - 깊이 (Z) 기반으로 뒤에 있는 별은 희미하게
 * - 수평 단층선만 구조로, 레이블 없음
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { useRouter } from "next/navigation";

// ──────────────────────────────────────────────────────────────
const LS_KEY        = "anthropocene:stars:v1";
const AGE_SCALE     = 0.055;   // 1초 = 0.055 units — 아래(now)=0, 위(past)=age×scale
const STRATA_STEP   = 30;      // 30초마다 수평 단층선
const ROT_SPEED     = 0.003;   // rad/s 회전 속도 (매우 천천히)
const COL_RADIUS    = 16;      // 기둥 반지름 (units) — 깊이 페이드 기준

interface StarBody {
  id: string; x: number; y: number; z: number;
  mass: number;
  phase: "nebula"|"protostar"|"mainSequence"|"redGiant"|"supernova"|"remnant";
  age: number; phaseAge: number; radius: number; isPermanent: boolean;
}

// ──────────────────────────────────────────────────────────────
// 별 포인트 셰이더
// ──────────────────────────────────────────────────────────────
const STAR_VS = /* glsl */`
  attribute float aPhase;
  attribute float aMass;
  attribute float aOffset;
  uniform   float uTime;
  varying   vec3  vColor;
  varying   float vAlpha;

  vec3 kelvinToRGB(float K) {
    float t = clamp(K, 1000.0, 40000.0) / 100.0;
    vec3 c;
    c.r = t <= 66.0 ? 1.0 : clamp(329.6987*pow(t-60.0,-0.1332)/255.0, 0.0,1.0);
    c.g = t <= 66.0 ? clamp((99.4708*log(t)-161.1195)/255.0,0.0,1.0)
                    : clamp(288.1221*pow(t-60.0,-0.0755)/255.0,0.0,1.0);
    c.b = t >= 66.0 ? 1.0 : t <= 19.0 ? 0.0
        : clamp((138.5177*log(t-10.0)-305.0447)/255.0,0.0,1.0);
    return c;
  }

  void main() {
    vec3 col;
    if (aPhase < 0.5) {
      float ms = max(aMass/180.0, 0.01);
      float L  = pow(ms, 3.5);
      float R  = pow(ms, 0.7);
      float T  = 5778.0 * pow(L/(R*R), 0.25);
      col = kelvinToRGB(clamp(T, 4000.0, 40000.0));
      vec3 g = vec3(dot(col, vec3(0.299,0.587,0.114)));
      col = clamp(mix(g, col, 2.2), 0.0, 1.0);
    } else if (aPhase < 1.5) { col = vec3(1.0, 0.42, 0.1);  }
    else if   (aPhase < 2.5) { col = vec3(0.75,0.88, 1.0);  }
    else                     { col = vec3(1.0, 0.85, 0.35); }
    vColor = col;

    // 깊이 페이드: 뒤(큰 mvZ 음수)일수록 희미
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // mv.z 범위: camera at z=200 ortho → worldZ=+COL_RADIUS 면 mv.z≈-(200-COL_RADIUS)
    // 우리가 원하는 건 localZ 기반 페이드
    // modelMatrix의 Z열로 local→worldZ 추정: local +Z → mv.z 덜 음수 (앞쪽)
    vAlpha = clamp(0.08 + (mv.z + 185.0) / float(${COL_RADIUS} * 2 + 4), 0.05, 1.0);

    float pulse  = 0.82 + 0.18 * sin(uTime * 2.2 + aOffset);
    float sz     = (4.0 + pow(max(aMass,1.0), 0.38) * 5.5) * pulse;
    gl_PointSize = clamp(sz, 2.0, 44.0);
    gl_Position  = projectionMatrix * mv;
  }
`;

const STAR_FS = /* glsl */`
  precision highp float;
  varying vec3  vColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float core = exp(-d*d*10.0);
    float halo = exp(-d*d*2.5)*0.4;
    gl_FragColor = vec4(vColor, (core+halo)*vAlpha);
  }
`;

// ──────────────────────────────────────────────────────────────
// 수평 단층선 (회전 그룹 밖 — 항상 화면 가득 가로선)
// ──────────────────────────────────────────────────────────────
function StratumLines({ maxAge, width }: { maxAge: number; width: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pts: number[] = [];
    const count = Math.ceil(maxAge / STRATA_STEP) + 1;
    for (let i = 0; i <= count; i++) {
      const y = i * STRATA_STEP * AGE_SCALE; // 위로 갈수록 오래됨
      pts.push(-width, y, 0,  width, y, 0);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [maxAge, width]);

  const nowGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([
      -width, 0, 0,  width, 0, 0,
    ], 3));
    return g;
  }, [width]);

  return (
    <>
      {/* 과거 단층선들 */}
      <lineSegments geometry={geo}>
        <lineBasicMaterial color="#0d1a44" transparent opacity={0.5} />
      </lineSegments>
      {/* "now" 라인 (맨 아래, 조금 더 밝게) */}
      <lineSegments geometry={nowGeo}>
        <lineBasicMaterial color="#2244aa" transparent opacity={0.6} />
      </lineSegments>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// 별에서 아래(now=0)로 내려오는 수직 기둥 선 (회전 그룹 안)
// ──────────────────────────────────────────────────────────────
function StarPillars({ stars }: { stars: StarBody[] }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pts: number[] = [];
    const col: number[] = [];
    stars.forEach((s) => {
      const yTop = s.age * AGE_SCALE; // 위 = 과거
      const yBot = 0;                 // 아래 = now
      let r=1, gv=0.85, b=0.45;
      if (s.phase==="redGiant")  { r=1;   gv=0.42; b=0.1; }
      if (s.phase==="remnant")   { r=0.7; gv=0.85; b=1.0; }
      pts.push(s.x, yBot, s.z,   s.x, yTop, s.z);
      col.push(r*0.6, gv*0.6, b*0.6,   r*0.12, gv*0.12, b*0.12);
    });
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute("color",    new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [stars]);

  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial vertexColors transparent opacity={0.45} depthWrite={false} />
    </lineSegments>
  );
}

// ──────────────────────────────────────────────────────────────
// 별 포인트 (회전 그룹 안)
// ──────────────────────────────────────────────────────────────
function StarPoints({ stars }: { stars: StarBody[] }) {
  const matRef  = useRef<THREE.ShaderMaterial>(null);
  const timeRef = useRef({ value: 0 });

  const { positions, phases, masses, offsets } = useMemo(() => {
    const n=stars.length;
    const pos=new Float32Array(n*3), ph=new Float32Array(n),
          ma=new Float32Array(n),  off=new Float32Array(n);
    stars.forEach((s, i) => {
      pos[i*3]   = s.x;
      pos[i*3+1] = s.age * AGE_SCALE;  // 위=과거, 아래=now(0)
      pos[i*3+2] = s.z;
      ph[i]  = s.phase==="mainSequence"?0:s.phase==="redGiant"?1:s.phase==="remnant"?2:3;
      ma[i]  = s.mass;
      off[i] = ((s.x*13.7+s.z*7.3)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
    });
    return { positions:pos, phases:ph, masses:ma, offsets:off };
  }, [stars]);

  useFrame((_,dt) => {
    timeRef.current.value += dt;
    if (matRef.current) matRef.current.uniforms.uTime.value = timeRef.current.value;
  });

  if (!stars.length) return null;
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={positions} itemSize={3} count={stars.length} />
        <bufferAttribute attach="attributes-aPhase"   array={phases}    itemSize={1} count={stars.length} />
        <bufferAttribute attach="attributes-aMass"    array={masses}    itemSize={1} count={stars.length} />
        <bufferAttribute attach="attributes-aOffset"  array={offsets}   itemSize={1} count={stars.length} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        vertexShader={STAR_VS}
        fragmentShader={STAR_FS}
        uniforms={{ uTime: timeRef.current }}
        transparent depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ──────────────────────────────────────────────────────────────
// Orthographic camera auto-fit
// ──────────────────────────────────────────────────────────────
function AutoOrthoCamera({ stars }: { stars: StarBody[] }) {
  const { camera, size } = useThree();
  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    const aspect = size.width / size.height;
    // 기둥 반지름 = max(sqrt(x²+z²)) — 회전 시 최대 X 범위
    const radii = stars.map(s => Math.sqrt(s.x*s.x + s.z*s.z));
    const halfW = Math.max(COL_RADIUS, ...radii) * 1.2;
    const maxAge = Math.max(30, ...stars.map(s => s.age));
    const halfH = Math.max(halfW / aspect, maxAge * AGE_SCALE * 0.6);
    // 화면 꽉 채우기: Y 중심을 기둥 중간에
    const midY = maxAge * AGE_SCALE * 0.5;
    camera.left   = -halfW;
    camera.right  =  halfW;
    camera.bottom = midY - halfH;
    camera.top    = midY + halfH;
    camera.near   = 0.1;
    camera.far    = 1000;
    camera.position.set(0, midY, 200);
    camera.lookAt(0, midY, 0);
    camera.updateProjectionMatrix();
  }, [camera, size, stars]);
  return null;
}

// ──────────────────────────────────────────────────────────────
// Scene — 기둥 회전
// ──────────────────────────────────────────────────────────────
function Scene({ stars }: { stars: StarBody[] }) {
  const colRef = useRef<THREE.Group>(null);
  const maxAge = Math.max(30, ...stars.map(s => s.age));

  // viewport width for stratum lines (need to cover full ortho width)
  const lineWidth = Math.max(COL_RADIUS, ...stars.map(s=>Math.sqrt(s.x*s.x+s.z*s.z))) * 1.4;

  useFrame((_, dt) => {
    if (colRef.current) colRef.current.rotation.y += ROT_SPEED * dt;
  });

  return (
    <>
      <AutoOrthoCamera stars={stars} />

      {/* 수평 단층선 (회전 안 함 — 항상 화면 가득 가로선) */}
      <StratumLines maxAge={maxAge} width={lineWidth} />

      {/* 회전하는 기둥 */}
      <group ref={colRef}>
        <StarPillars stars={stars} />
        <StarPoints  stars={stars} />
      </group>

      <EffectComposer>
        <Bloom intensity={2.0} luminanceThreshold={0.04} luminanceSmoothing={0.85} radius={1.0} />
      </EffectComposer>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
export default function SideView() {
  const router = useRouter();
  const [stars, setStars] = useState<StarBody[]>([]);

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return;
        const all: StarBody[] = JSON.parse(raw);
        setStars(all.filter(s =>
          s.isPermanent || s.phase==="redGiant" || s.phase==="remnant"
        ));
      } catch {}
    };
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative h-screen w-full bg-black overflow-hidden">
      <Canvas
        orthographic
        camera={{ position: [0, 5, 200], zoom: 1 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: "#000000" }}
      >
        <Scene stars={stars} />
      </Canvas>

      {/* 빈 상태 */}
      {stars.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-white/20 text-sm font-light tracking-wider">
            탐험을 시작하면 시공간 기둥이 형성됩니다
          </div>
        </div>
      )}

      {/* 최소 HUD: back 버튼만 */}
      <button
        className="absolute bottom-5 left-5 text-white/25 text-xs border border-white/10 px-3 py-1.5 rounded hover:text-white/50 hover:border-white/20 transition-colors"
        onClick={() => router.push("/")}
      >
        ←
      </button>
    </div>
  );
}

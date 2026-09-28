"use client";

/**
 * SideView — 회전하는 시공간 기둥 (Rotating Spacetime Column)
 *
 * - now = 화면 아래, 과거 = 위
 * - 기둥이 Y축으로 천천히 회전하며 깊이 생김
 * - 직교 투영(orthographic)으로 화면 꽉 채움
 * - 별은 프레임마다 부드럽게 위로 이동 (uTimeDelta 유니폼)
 * - 레이블 없음
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { useRouter } from "next/navigation";

// ──────────────────────────────────────────────────────────────
const LS_KEY      = "anthropocene:stars:v1";
const AGE_SCALE   = 0.045;  // 1s = 0.045 units (아래=now, 위=과거)
const STRATA_STEP = 45;     // 초 단위 단층 간격
const ROT_SPEED   = 0.004;  // rad/s
const COL_HALF    = 14;     // 기둥 반지름 (world units)

interface StarBody {
  id: string; x: number; y: number; z: number;
  mass: number;
  phase: "nebula"|"protostar"|"mainSequence"|"redGiant"|"supernova"|"remnant";
  age: number; phaseAge: number; radius: number; isPermanent: boolean;
}

// ──────────────────────────────────────────────────────────────
// Shaders
// 위치: position.xz = star 위치, position.y = poll 시점 age
// uTimeDelta: poll 이후 경과 초 → 실시간으로 Y 위로 이동
// ──────────────────────────────────────────────────────────────
const STAR_VS = /* glsl */`
  attribute float aPhase;
  attribute float aMass;
  attribute float aOffset;
  attribute float aAge;       // poll 시점 age (초)
  uniform   float uTime;
  uniform   float uTimeDelta; // poll 이후 경과(초) — 이걸로 Y 실시간 갱신
  varying   vec3  vColor;
  varying   float vAlpha;

  vec3 kelvinToRGB(float K) {
    float t = clamp(K, 1000.0, 40000.0) / 100.0;
    vec3 c;
    c.r = t <= 66.0 ? 1.0 : clamp(329.6987*pow(t-60.0,-0.1332)/255.0,0.0,1.0);
    c.g = t <= 66.0 ? clamp((99.4708*log(t)-161.1195)/255.0,0.0,1.0)
                    : clamp(288.1221*pow(t-60.0,-0.0755)/255.0,0.0,1.0);
    c.b = t >= 66.0 ? 1.0 : t <= 19.0 ? 0.0
        : clamp((138.5177*log(t-10.0)-305.0447)/255.0,0.0,1.0);
    return c;
  }

  void main() {
    // 위상별 색상
    vec3 col;
    if (aPhase < 0.5) {
      float ms = max(aMass/180.0,0.01);
      float L  = pow(ms,3.5); float R = pow(ms,0.7);
      float T  = 5778.0*pow(L/(R*R),0.25);
      col = kelvinToRGB(clamp(T,4000.0,40000.0));
      vec3 g = vec3(dot(col,vec3(0.299,0.587,0.114)));
      col = clamp(mix(g,col,2.2),0.0,1.0);
    } else if (aPhase < 1.5) { col = vec3(1.0,0.42,0.1);  }
    else if   (aPhase < 2.5) { col = vec3(0.75,0.88,1.0); }
    else                     { col = vec3(1.0,0.85,0.35); }
    vColor = col;

    // 실시간 Y 위치: 시간이 흐를수록 위로
    float currentAge = aAge + uTimeDelta;
    vec3 pos3 = vec3(position.x, currentAge * ${AGE_SCALE.toFixed(4)}, position.z);

    // 깊이 페이드: mv.z 범위 ≈ -(200 ± COL_HALF)
    vec4 mv = modelViewMatrix * vec4(pos3, 1.0);
    float depthAlpha = clamp((mv.z + ${200 + COL_HALF + 2}.0) / ${(COL_HALF * 2 + 4).toFixed(1)}, 0.05, 1.0);
    vAlpha = depthAlpha;

    float pulse  = 0.84 + 0.16 * sin(uTime * 2.2 + aOffset);
    float sz     = (4.0 + pow(max(aMass,1.0),0.38) * 5.0) * pulse;
    gl_PointSize = clamp(sz, 2.0, 40.0);
    gl_Position  = projectionMatrix * mv;
  }
`;

const STAR_FS = /* glsl */`
  precision highp float;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv); if (d > 0.5) discard;
    float core = exp(-d*d*10.0);
    float halo = exp(-d*d*2.5)*0.4;
    gl_FragColor = vec4(vColor,(core+halo)*vAlpha);
  }
`;

// ──────────────────────────────────────────────────────────────
// 수평 단층선 — 회전 그룹 밖 (항상 화면 가득 가로선으로 보임)
// ──────────────────────────────────────────────────────────────
function StratumLines({ halfW, maxAge }: { halfW: number; maxAge: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pts: number[] = [];
    const count = Math.ceil(maxAge / STRATA_STEP) + 2;
    for (let i = 0; i <= count; i++) {
      const y = i * STRATA_STEP * AGE_SCALE;
      pts.push(-halfW * 1.5, y, 0,  halfW * 1.5, y, 0);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [halfW, maxAge]);

  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#0c1840" transparent opacity={0.55} />
    </lineSegments>
  );
}

// ──────────────────────────────────────────────────────────────
// 수직 기둥 선 (회전 그룹 안)
// ──────────────────────────────────────────────────────────────
function StarPillars({ stars }: { stars: StarBody[] }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pts: number[] = [], col: number[] = [];
    stars.forEach((s) => {
      const yTop = s.age * AGE_SCALE;
      let r=1,gv=0.8,b=0.4;
      if (s.phase==="redGiant")  { r=1;   gv=0.4; b=0.1; }
      if (s.phase==="remnant")   { r=0.7; gv=0.85;b=1.0; }
      pts.push(s.x, 0, s.z,  s.x, yTop, s.z);
      col.push(r*0.55, gv*0.55, b*0.55,   r*0.08, gv*0.08, b*0.08);
    });
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute("color",    new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [stars]);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial vertexColors transparent opacity={0.4} depthWrite={false} />
    </lineSegments>
  );
}

// ──────────────────────────────────────────────────────────────
// 별 포인트 (회전 그룹 안) + 실시간 위로 이동
// ──────────────────────────────────────────────────────────────
function StarPoints({ stars, pollTimeRef }: { stars: StarBody[]; pollTimeRef: React.RefObject<number> }) {
  const matRef    = useRef<THREE.ShaderMaterial>(null);
  const clockRef  = useRef({ uTime: 0, uTimeDelta: 0 });

  const { positions, phases, masses, offsets, ages } = useMemo(() => {
    const n = stars.length;
    const pos = new Float32Array(n * 3), ph = new Float32Array(n),
          ma  = new Float32Array(n),     off= new Float32Array(n),
          ag  = new Float32Array(n);
    stars.forEach((s, i) => {
      // XZ 위치 저장, Y는 셰이더에서 aAge + uTimeDelta로 계산
      pos[i*3]=s.x; pos[i*3+1]=0; pos[i*3+2]=s.z;
      ph[i]  = s.phase==="mainSequence"?0:s.phase==="redGiant"?1:s.phase==="remnant"?2:3;
      ma[i]  = s.mass;
      ag[i]  = s.age;
      off[i] = ((s.x*13.7+s.z*7.3)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
    });
    return { positions:pos, phases:ph, masses:ma, offsets:off, ages:ag };
  }, [stars]);

  useFrame((_, dt) => {
    clockRef.current.uTime += dt;
    clockRef.current.uTimeDelta = (Date.now() - pollTimeRef.current) / 1000;
    if (matRef.current) {
      matRef.current.uniforms.uTime.value      = clockRef.current.uTime;
      matRef.current.uniforms.uTimeDelta.value = clockRef.current.uTimeDelta;
    }
  });

  if (!stars.length) return null;
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={positions} itemSize={3} count={stars.length} />
        <bufferAttribute attach="attributes-aPhase"   array={phases}    itemSize={1} count={stars.length} />
        <bufferAttribute attach="attributes-aMass"    array={masses}    itemSize={1} count={stars.length} />
        <bufferAttribute attach="attributes-aAge"     array={ages}      itemSize={1} count={stars.length} />
        <bufferAttribute attach="attributes-aOffset"  array={offsets}   itemSize={1} count={stars.length} />
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
  );
}

// ──────────────────────────────────────────────────────────────
// Camera: 화면 꽉 채우도록 frustum 설정
// ──────────────────────────────────────────────────────────────
function FillCamera({ stars, pollTimeRef }: { stars: StarBody[]; pollTimeRef: React.RefObject<number> }) {
  const { camera, size } = useThree();

  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    if (!cam.isOrthographicCamera) return;

    const aspect = size.width / size.height;
    // 기둥 반지름: 회전 시 최대 x = sqrt(x²+z²)
    const radii = stars.map(s => Math.sqrt(s.x*s.x + s.z*s.z));
    const colHalf = Math.max(COL_HALF, ...radii) * 1.05;

    // 시간 범위: 현재 max age + 여유
    const timeDelta = (Date.now() - pollTimeRef.current) / 1000;
    const maxAge = Math.max(60, ...stars.map(s => s.age)) + timeDelta + STRATA_STEP;
    const colHeight = maxAge * AGE_SCALE;

    // 화면 꽉 채우기: width 기준으로 맞추되, height도 커버
    const halfW = Math.max(colHalf, colHeight * 0.5 * aspect) * 1.02;
    const halfH = halfW / aspect;

    // 수직 중심: 기둥 중간 (now=0, top=colHeight)
    const midY = colHeight * 0.5;

    cam.left   = -halfW;
    cam.right  =  halfW;
    cam.bottom = midY - halfH;
    cam.top    = midY + halfH;
    cam.near   = 0.1;
    cam.far    = 1000;
    cam.position.set(0, midY, 200);
    cam.lookAt(0, midY, 0);
    cam.updateProjectionMatrix();
  }, [camera, size, stars, pollTimeRef]);

  return null;
}

// ──────────────────────────────────────────────────────────────
// Scene
// ──────────────────────────────────────────────────────────────
function Scene({ stars, pollTimeRef }: { stars: StarBody[]; pollTimeRef: React.RefObject<number> }) {
  const colRef = useRef<THREE.Group>(null);

  const maxAge = Math.max(60, ...stars.map(s => s.age));
  const radii  = stars.map(s => Math.sqrt(s.x*s.x + s.z*s.z));
  const halfW  = Math.max(COL_HALF, ...radii) * 1.1;

  useFrame((_, dt) => {
    if (colRef.current) colRef.current.rotation.y += ROT_SPEED * dt;
  });

  return (
    <>
      <FillCamera stars={stars} pollTimeRef={pollTimeRef} />

      {/* 수평 단층선 — 화면 가득 고정 가로선 */}
      <StratumLines halfW={halfW} maxAge={maxAge + STRATA_STEP * 2} />

      {/* 회전하는 기둥 */}
      <group ref={colRef}>
        <StarPillars stars={stars} />
        <StarPoints  stars={stars} pollTimeRef={pollTimeRef} />
      </group>

      <EffectComposer>
        <Bloom intensity={2.2} luminanceThreshold={0.03} luminanceSmoothing={0.85} radius={1.0} />
      </EffectComposer>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
export default function SideView() {
  const router      = useRouter();
  const [stars, setStars] = useState<StarBody[]>([]);
  const pollTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return;
        const all: StarBody[] = JSON.parse(raw);
        pollTimeRef.current = Date.now();
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
        gl={{ antialias: true, alpha: false }}
        style={{ width: "100%", height: "100%", display: "block", background: "#000" }}
      >
        <Scene stars={stars} pollTimeRef={pollTimeRef} />
      </Canvas>

      {stars.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-white/20 text-sm font-light tracking-wider">
            탐험을 시작하면 시공간 기둥이 형성됩니다
          </div>
        </div>
      )}

      <button
        className="absolute bottom-5 left-5 text-white/25 text-xs border border-white/10 px-3 py-1.5 rounded hover:text-white/50 hover:border-white/20 transition-colors"
        onClick={() => router.push("/")}
      >
        ←
      </button>
    </div>
  );
}

"use client";

/**
 * timespace/TimespaceView.tsx
 *
 * 시공간 블록 3D 뷰.
 *
 * - 별 색 = 실제 온도/위상 기반 (kelvinToRGB, 셰이더와 동일 공식)
 * - Pillar = 별이 존재한 시간만큼의 기둥 (위=현재 밝음, 아래=과거 어두움)
 * - 플레이어 = "지금" 평면(Y=nowY)에 glowing 마커로 표시
 * - localStorage 1s 폴링으로 mobile 탭과 실시간 싱크
 */

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { useRouter } from "next/navigation";
import { useSpacetimeStarsWithRef } from "@/components/spacetime/useSpacetimeStars";
import { PLANE_COLORS, type StarBody } from "@/components/spacetime/types";

// ──────────────────────────────────────────────────────────────
const AGE_SCALE   = 0.055;
const STRATA_STEP = 30;

// ── 별 실제 시각적 색상 (StarFieldSystem GLSL과 동일 공식) ──
function kelvinToRGB(K: number): [number, number, number] {
  const t = Math.max(10, Math.min(400, K / 100));
  const r = t <= 66 ? 1.0 : Math.max(0, Math.min(1, 329.6987 * Math.pow(t - 60, -0.1332) / 255));
  const g = t <= 66
    ? Math.max(0, Math.min(1, (99.4708 * Math.log(t) - 161.1195) / 255))
    : Math.max(0, Math.min(1, 288.1221 * Math.pow(t - 60, -0.0755) / 255));
  const b = t >= 66 ? 1.0 : t <= 19 ? 0.0
    : Math.max(0, Math.min(1, (138.5177 * Math.log(t - 10) - 305.0447) / 255));
  return [r, g, b];
}

function starActualColor(star: StarBody): [number, number, number] {
  switch (star.phase) {
    case "mainSequence": {
      const ms = Math.max(star.mass / 180, 0.01);
      const L  = Math.pow(ms, 3.5);
      const R  = Math.pow(ms, 0.7);
      const T  = 5778 * Math.pow(L / (R * R), 0.25);
      const [r, g, b] = kelvinToRGB(Math.min(T, 40000));
      // artistic saturation boost (matches GLSL)
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      return [
        Math.min(1, gray + (r - gray) * 2.2),
        Math.min(1, gray + (g - gray) * 2.2),
        Math.min(1, gray + (b - gray) * 2.2),
      ];
    }
    case "redGiant":  return [1.0,  0.42, 0.1];
    case "supernova": return [1.0,  0.85, 0.35];
    case "remnant":   return [0.75, 0.88, 1.0];
    case "protostar": return [1.0,  0.6,  0.2];
    case "nebula":    return [0.5,  0.3,  0.85];
    default:          return [0.9,  0.9,  0.9];
  }
}

// ──────────────────────────────────────────────────────────────
// 수평 격자면 (t 구간마다)
// ──────────────────────────────────────────────────────────────
function StratumGrid({ maxAge, extent }: { maxAge: number; extent: number }) {
  const elems = useMemo<JSX.Element[]>(() => {
    const count = Math.ceil(maxAge / STRATA_STEP) + 1;
    return Array.from({ length: count + 1 }, (_, i) => {
      const y = i * STRATA_STEP * AGE_SCALE;
      return (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}>
          <planeGeometry args={[extent * 2.2, extent * 2.2]} />
          <meshBasicMaterial
            color="#0a1233"
            transparent
            opacity={i === 0 ? 0.4 : 0.08}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      );
    });
  }, [maxAge, extent]);
  return <>{elems}</>;
}

// ──────────────────────────────────────────────────────────────
// T 축
// ──────────────────────────────────────────────────────────────
function TimeAxis({ height }: { height: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, height, 0], 3));
    return g;
  }, [height]);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#1133aa" transparent opacity={0.5} />
    </lineSegments>
  );
}

// ──────────────────────────────────────────────────────────────
// 별 + Pillar
// Pillar worldline: (x + cos(θ)·τ·DRIFT, τ·AGE_SCALE, z + sin(θ)·τ·DRIFT)
// θ 방향으로 기울어져서 서로 다른 관측자의 별들이 다른 방향의 기둥을 형성
// ──────────────────────────────────────────────────────────────
const DRIFT = 0.05; // 시간 1초당 XZ 이동량 (클수록 기울기 뚜렷)

const STAR_VS = /* glsl */`
  attribute float aAge;
  attribute float aCreatorCos;  // cos(creatorAngle) * DRIFT
  attribute float aCreatorSin;  // sin(creatorAngle) * DRIFT
  attribute vec3  aColor;
  uniform   float uTime;
  uniform   float uTimeDelta;
  varying   vec3  vColor;

  void main() {
    vColor = aColor;
    float tau = aAge + uTimeDelta;
    // θ 기울기: 시간이 흐를수록 cos(θ), sin(θ) 방향으로 XZ 이동
    float wx = position.x + aCreatorCos * tau;
    float wy = tau * ${AGE_SCALE.toFixed(4)};
    float wz = position.z + aCreatorSin * tau;
    float pulse = 0.82 + 0.18 * sin(uTime * 2.0 + position.x * 3.7 + position.z * 2.3);
    float brightness = dot(aColor, vec3(0.299, 0.587, 0.114));
    gl_PointSize = clamp((4.0 + brightness * 18.0) * pulse, 3.0, 40.0);
    gl_Position  = projectionMatrix * modelViewMatrix * vec4(wx, wy, wz, 1.0);
  }
`;
const STAR_FS = /* glsl */`
  precision highp float;
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv); if (d > 0.5) discard;
    float core = exp(-d*d*9.0);
    float halo = exp(-d*d*2.5) * 0.45;
    gl_FragColor = vec4(vColor, (core + halo));
  }
`;

function StarsAndPillars({
  stars,
  pollTimeRef,
}: {
  stars: StarBody[];
  pollTimeRef: React.RefObject<number>;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  // Star point geometry + θ tilt attributes
  const { pos, ages, colors, coss, sins } = useMemo(() => {
    const n = stars.length;
    const pos    = new Float32Array(n * 3);
    const ages   = new Float32Array(n);
    const colors = new Float32Array(n * 3);
    const coss   = new Float32Array(n);  // cos(θ) * DRIFT
    const sins   = new Float32Array(n);  // sin(θ) * DRIFT
    stars.forEach((s, i) => {
      pos[i*3]=s.x; pos[i*3+1]=0; pos[i*3+2]=s.z;
      ages[i]    = s.age;
      coss[i]    = Math.cos(s.creatorAngle ?? 0) * DRIFT;
      sins[i]    = Math.sin(s.creatorAngle ?? 0) * DRIFT;
      const [r,g,b] = starActualColor(s);
      colors[i*3]=r; colors[i*3+1]=g; colors[i*3+2]=b;
    });
    return { pos, ages, colors, coss, sins };
  }, [stars]);

  // Pillar geometry: θ-tilted worldline, dark bottom → bright top
  // bottom = (x, 0, z), top = (x + cos(θ)*age*DRIFT, age*scale, z + sin(θ)*age*DRIFT)
  const pillarGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pts: number[] = [];
    const col: number[] = [];
    stars.forEach((s) => {
      const [r,gv,b] = starActualColor(s);
      const θ    = s.creatorAngle ?? 0;
      const age  = s.age;
      const yTop = age * AGE_SCALE;
      const xTop = s.x + Math.cos(θ) * age * DRIFT;
      const zTop = s.z + Math.sin(θ) * age * DRIFT;

      // bottom: star's spatial birth position, very dark
      pts.push(s.x, 0, s.z);
      col.push(r * 0.04, gv * 0.04, b * 0.04);
      // top: tilted endpoint at current age, full color
      pts.push(xTop, yTop, zTop);
      col.push(r, gv, b);
    });
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute("color",    new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [stars]);

  useFrame((_, dt) => {
    if (!matRef.current) return;
    matRef.current.uniforms.uTime.value     += dt;
    matRef.current.uniforms.uTimeDelta.value = (Date.now() - pollTimeRef.current) / 1000;
  });

  if (!stars.length) return null;
  return (
    <>
      {/* Pillar: θ 방향으로 기울어진 worldline 기둥 */}
      <lineSegments geometry={pillarGeo}>
        <lineBasicMaterial vertexColors transparent opacity={0.9} depthWrite={false} />
      </lineSegments>

      {/* Star point — 실시간 uTimeDelta로 pillar 끝(top)에 위치 */}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position"     array={pos}    itemSize={3} count={stars.length}/>
          <bufferAttribute attach="attributes-aAge"         array={ages}   itemSize={1} count={stars.length}/>
          <bufferAttribute attach="attributes-aCreatorCos"  array={coss}   itemSize={1} count={stars.length}/>
          <bufferAttribute attach="attributes-aCreatorSin"  array={sins}   itemSize={1} count={stars.length}/>
          <bufferAttribute attach="attributes-aColor"       array={colors} itemSize={3} count={stars.length}/>
        </bufferGeometry>
        <shaderMaterial
          ref={matRef}
          vertexShader={STAR_VS}
          fragmentShader={STAR_FS}
          uniforms={{ uTime:{value:0}, uTimeDelta:{value:0} }}
          transparent depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// "지금" 슬라이스 + 플레이어 마커
// ──────────────────────────────────────────────────────────────
interface PlayerInfo {
  x: number; z: number;
  color: string;
  ts: number;
}

function NowSliceAndPlayer({
  stars,
  pollTimeRef,
  player,
}: {
  stars: StarBody[];
  pollTimeRef: React.RefObject<number>;
  player: PlayerInfo | null;
}) {
  const planeRef  = useRef<THREE.Mesh>(null);
  const markerRef = useRef<THREE.Mesh>(null);
  const labelRef  = useRef<THREE.Mesh>(null);
  const maxBaseAge = useMemo(() => Math.max(0, ...stars.map(s => s.age)), [stars]);

  useFrame(() => {
    const elapsed = (Date.now() - pollTimeRef.current) / 1000;
    const nowY    = (maxBaseAge + elapsed) * AGE_SCALE;

    if (planeRef.current)  planeRef.current.position.y  = nowY;
    if (markerRef.current) markerRef.current.position.y = nowY + 0.05;
    if (labelRef.current)  labelRef.current.position.y  = nowY + 0.05;
  });

  // Parse player color hex → rgb
  const playerRGB = useMemo((): [number, number, number] => {
    if (!player) return [1, 1, 1];
    const hex = player.color.replace("#", "");
    const n   = parseInt(hex, 16);
    return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
  }, [player]);

  return (
    <>
      {/* "지금" 투명 평면 */}
      <mesh ref={planeRef} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[60, 60]} />
        <meshBasicMaterial color="#2244ff" transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* 플레이어 마커 — player가 있을 때만 */}
      {player && (
        <mesh ref={markerRef} position={[player.x, 0, player.z]}>
          <sphereGeometry args={[0.35, 8, 8]} />
          <meshBasicMaterial color={player.color} transparent opacity={0.95} />
        </mesh>
      )}
      {player && (
        <mesh position={[player.x, 0, player.z]}>
          {/* 플레이어 아래 기둥 선 (아주 얇게) */}
        </mesh>
      )}
    </>
  );
}

// 플레이어 위치를 시간축 선으로 표시 (Y=0 → Y=nowY)
function PlayerPillar({
  player,
  stars,
  pollTimeRef,
}: {
  player: PlayerInfo | null;
  stars: StarBody[];
  pollTimeRef: React.RefObject<number>;
}) {
  const lineRef = useRef<THREE.LineSegments>(null);
  const maxBaseAge = useMemo(() => Math.max(0, ...stars.map(s => s.age)), [stars]);

  useFrame(() => {
    if (!lineRef.current || !player) return;
    const elapsed = (Date.now() - pollTimeRef.current) / 1000;
    const nowY    = (maxBaseAge + elapsed) * AGE_SCALE;
    const arr = (lineRef.current.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    // top vertex Y update
    arr[4] = nowY;
    (lineRef.current.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });

  if (!player) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([
    player.x, 0, player.z,
    player.x, 0.01, player.z,  // top Y will be updated by useFrame
  ], 3));
  const hex = player.color.replace("#", "");
  const n   = parseInt(hex, 16);
  const r   = (n >> 16) / 255;
  const gv  = ((n >> 8) & 0xff) / 255;
  const b   = (n & 0xff) / 255;
  geo.setAttribute("color", new THREE.Float32BufferAttribute([
    r*0.1, gv*0.1, b*0.1,
    r, gv, b,
  ], 3));

  return (
    <lineSegments ref={lineRef} geometry={geo}>
      <lineBasicMaterial vertexColors transparent opacity={0.7} depthWrite={false} />
    </lineSegments>
  );
}

// ──────────────────────────────────────────────────────────────
// Scene
// ──────────────────────────────────────────────────────────────
function Scene({
  stars,
  pollTimeRef,
  player,
}: {
  stars: StarBody[];
  pollTimeRef: React.RefObject<number>;
  player: PlayerInfo | null;
}) {
  const maxAge = Math.max(60, ...stars.map(s => s.age));
  const height = (maxAge + STRATA_STEP * 3) * AGE_SCALE;
  const extent = Math.max(20, ...stars.flatMap(s => [Math.abs(s.x), Math.abs(s.z)])) * 1.4;

  return (
    <>
      <color attach="background" args={["#000000"]} />

      <TimeAxis height={height} />
      <StratumGrid maxAge={maxAge + STRATA_STEP} extent={extent} />

      <StarsAndPillars stars={stars} pollTimeRef={pollTimeRef} />

      <NowSliceAndPlayer stars={stars} pollTimeRef={pollTimeRef} player={player} />
      <PlayerPillar      stars={stars} pollTimeRef={pollTimeRef} player={player} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.6}
        zoomSpeed={0.8}
        minDistance={3}
        maxDistance={300}
        target={[0, height * 0.4, 0]}
      />

      <EffectComposer>
        <Bloom intensity={2.8} luminanceThreshold={0.02} luminanceSmoothing={0.9} radius={1.2} />
      </EffectComposer>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// HUD
// ──────────────────────────────────────────────────────────────
function HUD({ stars, player }: { stars: StarBody[]; player: PlayerInfo | null }) {
  const router  = useRouter();
  const isStale = player ? Date.now() - player.ts > 5000 : true;

  return (
    <>
      <div className="absolute top-4 left-4 pointer-events-none select-none space-y-1">
        <div className="text-white/25 text-[10px] tracking-widest uppercase">Spacetime Block</div>
        <div className="text-white/15 text-[9px] font-mono">{stars.length} stars</div>
        <div className="text-[9px] font-mono mt-1 flex items-center gap-1.5">
          {player && !isStale ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: player.color }} />
              <span className="text-white/30">player active</span>
            </>
          ) : (
            <span className="text-white/12">no player</span>
          )}
        </div>
      </div>

      <div className="absolute top-4 right-4 pointer-events-none select-none text-[9px] text-white/15 font-mono text-right leading-relaxed">
        <div>Y ↑ = time</div>
        <div>XZ = space</div>
        <div>pillar = star lifetime</div>
        <div>color = phase/temp</div>
      </div>

      {stars.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-2">
          <div className="text-white/20 text-sm font-light tracking-widest">시공간이 비어있습니다</div>
          <div className="text-white/10 text-xs font-mono">/mobile 에서 별을 만들면 여기에 나타납니다</div>
        </div>
      )}

      <div className="absolute bottom-5 left-5 flex gap-2">
        <button
          className="text-white/20 text-xs border border-white/10 px-3 py-1.5 rounded hover:text-white/40 hover:border-white/20 transition-colors"
          onClick={() => router.push("/")}
        >←</button>
        <a
          href="/mobile"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/20 text-xs border border-white/10 px-3 py-1.5 rounded hover:text-white/40 hover:border-white/20 transition-colors"
        >mobile ↗</a>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
export default function TimespaceView() {
  const { stars, pollTimeRef } = useSpacetimeStarsWithRef({ pollMs: 1000, permanentOnly: false });
  const [player, setPlayer]   = useState<PlayerInfo | null>(null);

  // 플레이어 위치 폴링 (800ms)
  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem("anthropocene:player:v1");
        if (!raw) { setPlayer(null); return; }
        const p = JSON.parse(raw) as PlayerInfo;
        // 5초 이상 오래된 데이터 무시
        if (Date.now() - p.ts > 5000) { setPlayer(null); return; }
        setPlayer(p);
      } catch { setPlayer(null); }
    };
    load();
    const id = setInterval(load, 800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative h-screen w-full bg-black overflow-hidden">
      <Canvas
        camera={{ position: [25, 10, 25], fov: 45, near: 0.1, far: 2000 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: "#000" }}
      >
        <Scene stars={stars} pollTimeRef={pollTimeRef} player={player} />
      </Canvas>
      <HUD stars={stars} player={player} />
    </div>
  );
}

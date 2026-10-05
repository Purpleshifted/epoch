"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useRef, useState, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useControls, folder } from "leva";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { useRadialBlurEffect, RadialBlurDriver } from "./scene/RadialBlurEffect";
import { useSessionAngle } from "@/components/spacetime/legacy/useSessionAngle";

import { CmbSkybox }      from "./scene/CmbSkybox";
import { getWaveHeight }   from "./scene/WaveTerrain";
import { PlayerOrb }       from "./scene/PlayerOrb";
import { StarFieldSystem } from "./scene/StarFieldSystem";
import { useSolarWind }    from "@/lib/world/useSolarWind";

const FOG_COLOR = "#01020a";

// ─── 키보드 ────────────────────────────────────────────
function useKeys() {
  const k = useRef<Set<string>>(new Set());
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { e.preventDefault(); k.current.add(e.code); };
    const up = (e: KeyboardEvent) => k.current.delete(e.code);
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup",   up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
  }, []);
  return k;
}


// ─── 씬 컨트롤러 ──────────────────────────────────────
function SceneController({
  orbColor, solarWind, timeRef, playerPosRef, playerYRef,
  setLocked, speedRef,
  camDist, camHeight, camLerp, viscosity,
  waveParams, orbProps,
}: {
  orbColor: string;
  solarWind: ReturnType<typeof useSolarWind>;
  timeRef: React.MutableRefObject<number>;
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  playerYRef: React.MutableRefObject<number>;
  setLocked: (v: boolean) => void;
  speedRef: React.MutableRefObject<number>;
  camDist: number; camHeight: number; camLerp: number; viscosity: number;
  waveParams: { octaves: number; amplitudeScale: number; freqScale: number };
  orbProps: {
    count: number; orbRadius: number; pointSize: number;
    baseAlpha: number; wobbleScale: number; glowAmount: number;
    nucleusSize: number; nucleusAlpha: number;
  };
}) {
  const { camera, gl } = useThree();
  const keys   = useKeys();
  const player = useRef({ x: 0, z: 0, vx: 0, vz: 0, depth: 0 });
  const yaw    = useRef(Math.PI);
  const pitch  = useRef(0.45);
  const camPos = useRef(new THREE.Vector3(0, camHeight, camDist));
  const lookAt = useRef(new THREE.Vector3());
  const orbRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const c = gl.domElement;
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== c) return;
      yaw.current   -= e.movementX * 0.0025;
      pitch.current  = Math.max(0.05, Math.min(1.2, pitch.current + e.movementY * 0.002));
    };
    const onChange = () => setLocked(document.pointerLockElement === c);
    c.addEventListener("click", () => c.requestPointerLock());
    document.addEventListener("mousemove",        onMove);
    document.addEventListener("pointerlockchange", onChange);
    return () => {
      document.removeEventListener("mousemove",        onMove);
      document.removeEventListener("pointerlockchange", onChange);
    };
  }, [gl, setLocked]);

  useFrame((_, delta) => {
    timeRef.current += delta;
    const p  = player.current;
    const k  = keys.current;
    const y  = yaw.current;
    const dt = Math.min(delta, 0.05);

    const fwd  = k.has("KeyW") || k.has("ArrowUp")    ? 1 : 0;
    const bwd  = k.has("KeyS") || k.has("ArrowDown")  ? 1 : 0;
    const left = k.has("KeyA") || k.has("ArrowLeft")  ? 1 : 0;
    const rgt  = k.has("KeyD") || k.has("ArrowRight") ? 1 : 0;

    const tgtFwd    = (fwd - bwd * 0.4) * 7.0;
    const tgtStrafe = (rgt - left)      * 4.5;

    const fwdX = Math.sin(y), fwdZ = Math.cos(y);
    const strX = -Math.cos(y), strZ = Math.sin(y);
    const tvx  = fwdX * tgtFwd + strX * tgtStrafe;
    const tvz  = fwdZ * tgtFwd + strZ * tgtStrafe;

    const drag   = 2.0 + (1 - viscosity) * 13.0;
    const dampF  = 1.0 - Math.exp(-drag * dt);
    p.vx += (tvx - p.vx) * dampF;
    p.vz += (tvz - p.vz) * dampF;
    p.x  += p.vx * dt;
    p.z  += p.vz * dt;

    playerPosRef.current = { x: p.x, z: p.z };
    const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    speedRef.current = speed; // RadialBlur가 읽음
    p.depth = Math.min(1, p.depth + dt * (speed > 1 ? 0.003 : 0.001));

    const { octaves, amplitudeScale, freqScale } = waveParams;
    const orbY = getWaveHeight(p.x, p.z, timeRef.current, solarWind, octaves, amplitudeScale, freqScale) + 0.45;
    playerYRef.current = orbY;

    if (orbRef.current) {
      orbRef.current.position.set(p.x, orbY, p.z);
    }

    const hd = camDist * Math.cos(pitch.current);
    const vd = camDist * Math.sin(pitch.current);
    const desiredCam = new THREE.Vector3(
      p.x - Math.sin(y) * hd, orbY + vd + 0.4, p.z - Math.cos(y) * hd
    );
    camPos.current.lerp(desiredCam, camLerp);
    camera.position.copy(camPos.current);
    lookAt.current.lerp(new THREE.Vector3(p.x, orbY + 0.2, p.z), camLerp * 2);
    camera.lookAt(lookAt.current);
  });

  return (
    <group ref={orbRef}>
      <PlayerOrb
        position={[0,0,0]}
        color={orbColor}
        depth={player.current.depth}
        {...orbProps}
      />
    </group>
  );
}

// ─── 메인 씬 ──────────────────────────────────────────
export default function MobileScene() {
  const solarWind  = useSolarWind(60_000);
  const [locked, setLocked] = useState(false);
  const timeRef      = useRef(0);
  const playerPosRef = useRef({ x: 0, z: 0 });
  const playerYRef   = useRef(0.45);
  const speedRef    = useRef(0);
  const { effect: radialBlurEffect, effectRef: radialBlurEffectRef } = useRadialBlurEffect();

  // ── 세션 고유 관측 각도 (공통 시공간 로직에서 배정) ──────────────
  const sessionPlane = useSessionAngle();

  // ── 플레이어 위치를 localStorage에 브로드캐스트 → timespace 뷰에서 실시간 표시 ──
  useEffect(() => {
    const id = setInterval(() => {
      try {
        localStorage.setItem("anthropocene:player:v1", JSON.stringify({
          x: playerPosRef.current.x,
          z: playerPosRef.current.z,
          phi:   sessionPlane.phi,
          beta:  sessionPlane.beta,
          color: sessionPlane.color,
          ts: Date.now(),
        }));
      } catch {}
    }, 800);
    return () => { clearInterval(id); localStorage.removeItem("anthropocene:player:v1"); };
  }, [sessionPlane.phi, sessionPlane.beta, sessionPlane.color]);

  const {
    // ── Orb
    orbColor, orbCount, orbRadius, orbPointSize,
    orbBaseAlpha, orbWobble, orbGlow,
    orbNucleusSize, orbNucleusAlpha,
    // ── CMB
    cmbCount, cmbOpacity, cmbRadius, cmbRotSpeed,
    cmbBrightness, cmbContrast, cmbSizeMin, cmbSizeMax,
    cmbUsReal, cmbSaturation,
    // ── Stars (통합: 파티클 궤적 + 별 생애주기)
    starParticleOpacity, starSpawnRate, starLifetime,
    starSpread, starPointSize, starSpawnJitter,
    starAttractG, starClusterThreshold, starScale,
    // ── Camera
    camDist, camHeight, camLerp, fov,
    // ── Feel
    viscosity,
    // ── Post-processing
    fgBloomStr, fgBloomRadius, fgBloomThr,
    bgBloomStr, bgBloomRadius, bgBloomThr,
    radialStr, radialDecay, radialMaxSpeed,
    vignette,
    // ── Lighting
    ambientInt, stormLightScale,
    // ── World
    octaves, amplitudeScale, freqScale, fogNear, fogFar,
    // ── Debug
    botEnabled, botCount,
  } = useControls({

    "Orb (나)": folder({
      orbColor:       { value: "#ffffff", label: "색상" },
      orbCount:       { value: 260, min: 30, max: 600, step: 10,  label: "파티클 수" },
      orbRadius:      { value: 0.28, min: 0.05, max: 1.5, step: 0.01, label: "반지름" },
      orbPointSize:   { value: 1.8, min: 0.5, max: 8, step: 0.1,  label: "점 크기(px)" },
      orbBaseAlpha:   { value: 0.55, min: 0.05, max: 1, step: 0.01, label: "투명도" },
      orbWobble:      { value: 1.0, min: 0, max: 3, step: 0.05,   label: "흔들림" },
      orbGlow:        { value: 0.1, min: 0, max: 1, step: 0.05,   label: "글로우(0=하드)" },
      orbNucleusSize: { value: 0.18, min: 0.05, max: 0.8, step: 0.01, label: "핵 크기(반지름 비율)" },
      orbNucleusAlpha:{ value: 0.9, min: 0, max: 1, step: 0.01,   label: "핵 투명도" },
    }),

    // ── 통합 StarField ──────────────────────────────────────────────
    // 파티클 궤적 → 군집 감지(GPU readback) → 별 형성 → MainSeq 영속화
    "Stars (별 생애주기)": folder({
      "── 파티클 궤적": folder({
        starParticleOpacity: { value: 0.60, min: 0.01, max: 0.6,  step: 0.01, label: "밝기" },
        starSpawnRate:       { value: 78,   min: 1,    max: 200,  step: 1,    label: "초당 생성 수" },
        starLifetime:        { value: 0.85, min: 0.2,  max: 3,    step: 0.05, label: "수명 배율(×90s)" },
        starSpread:          { value: 2.45, min: 0.05, max: 3,    step: 0.05, label: "퍼짐 반경" },
        starPointSize:       { value: 0.3,  min: 0.1,  max: 5,    step: 0.1,  label: "점 크기 배율" },
        starSpawnJitter:     { value: 1.0,  min: 0,    max: 3,    step: 0.1,  label: "초기 속도 지터 (0=정지, 2+=고에너지)" },
      }),
      "── 중력 & 별 형성": folder({
        starAttractG:         { value: 0.80, min: 0,    max: 4,    step: 0.05, label: "중력 상수 G" },
        starClusterThreshold: { value: 20,   min: 5,    max: 100,  step: 5,    label: "군집 임계값 (Nebula 생성)" },
      }),
      "── 별 시각": folder({
        starScale: { value: 1.0, min: 0.1, max: 5, step: 0.1, label: "별 크기 배율" },
      }),
    }),

    "CMB (배경별)": folder({
      cmbUsReal:    { value: true, label: "실제 CMB 데이터" },
      cmbCount:     { value: 3500, min: 200, max: 10000, step: 100, label: "별 수" },
      cmbOpacity:   { value: 0.8, min: 0, max: 1, step: 0.01, label: "전체 투명도" },
      cmbRadius:    { value: 85, min: 40, max: 200, step: 5,   label: "반구 반경" },
      cmbRotSpeed:  { value: 0.001, min: 0, max: 0.05, step: 0.0005, label: "회전 속도" },
      cmbBrightness:{ value: 1.8, min: 0.1, max: 5, step: 0.05,  label: "밝기" },
      cmbContrast:  { value: 0.65, min: 0.1, max: 3, step: 0.05, label: "대비" },
      cmbSaturation:{ value: 0.9, min: 0, max: 3, step: 0.05,   label: "채도" },
      cmbSizeMin:   { value: 0.4, min: 0.1, max: 2, step: 0.05,  label: "크기 최소" },
      cmbSizeMax:   { value: 1.6, min: 0.2, max: 5, step: 0.05,  label: "크기 최대" },
    }, { collapsed: true }),

    "Camera": folder({
      camDist:   { value: 7,    min: 2, max: 20, step: 0.5   },
      camHeight: { value: 4.5,  min: 0.5, max: 12, step: 0.5 },
      camLerp:   { value: 0.07, min: 0.01, max: 0.3, step: 0.01, label: "부드러움" },
      fov:       { value: 60,   min: 30, max: 110, step: 1   },
    }, { collapsed: true }),

    "Feel": folder({
      viscosity: { value: 0.72, min: 0, max: 1, step: 0.01, label: "점성(0=즉각, 1=끈적)" },
    }),

    // ── Bloom: 나 + 흔적 + 화석 레이어 (SelectiveBloom)
    "Bloom: 나/흔적 레이어": folder({
      fgBloomStr:   { value: 0.8,  min: 0, max: 4,  step: 0.05, label: "강도" },
      fgBloomRadius:{ value: 0.6,  min: 0, max: 1,  step: 0.05, label: "반경" },
      fgBloomThr:   { value: 0.15, min: 0, max: 1,  step: 0.01, label: "임계값 (낮을수록 더 많이)" },
    }, { collapsed: false }),

    // ── Bloom: 배경 레이어 (CMB stars, 전역 ambient glow)
    "Bloom: 배경 레이어": folder({
      bgBloomStr:   { value: 0.25, min: 0, max: 2,  step: 0.05, label: "강도" },
      bgBloomRadius:{ value: 0.4,  min: 0, max: 1,  step: 0.05, label: "반경" },
      bgBloomThr:   { value: 0.55, min: 0, max: 1,  step: 0.01, label: "임계값 (높게 = 밝은 별만)" },
    }, { collapsed: false }),

    "Vignette": folder({
      vignette:   { value: 0.5,  min: 0, max: 1,  step: 0.01, label: "비녜트" },
    }, { collapsed: true }),

    // ── Radial Blur: 이동 속도 기반 방사형 블러 (warp drive 느낌)
    "Radial Blur (이동감)": folder({
      radialStr:      { value: 0.035, min: 0, max: 0.15, step: 0.005, label: "최대 강도" },
      radialDecay:    { value: 0.55,  min: 0, max: 1,    step: 0.05,  label: "샘플 감쇠" },
      radialMaxSpeed: { value: 8.0,   min: 1, max: 20,   step: 0.5,   label: "강도 포화 속도(m/s)" },
    }, { collapsed: false }),

    "Lighting": folder({
      ambientInt:      { value: 0.08, min: 0, max: 1, step: 0.01, label: "주변광" },
      stormLightScale: { value: 1.2, min: 0, max: 3,  step: 0.1,  label: "폭풍 조명 배율" },
    }, { collapsed: true }),

    "World": folder({
      octaves:        { value: 4,   min: 1, max: 7,   step: 1,    label: "파동 Octave" },
      amplitudeScale: { value: 1.0, min: 0.05, max: 4, step: 0.05, label: "진폭" },
      freqScale:      { value: 1.0, min: 0.1, max: 5,  step: 0.05, label: "주파수" },
      fogNear:        { value: 18,  min: 5, max: 80,  step: 1,    label: "안개 시작" },
      fogFar:         { value: 80,  min: 20, max: 200, step: 5,   label: "안개 끝" },
    }, { collapsed: true }),

    "Debug / 봇": folder({
      botEnabled: { value: false, label: "봇 활성화" },
      botCount:   { value: 5,   min: 1, max: 30, step: 1, label: "봇 수" },
    }, { collapsed: true }),
  });

  const waveParams = useMemo(
    () => ({ octaves, amplitudeScale, freqScale }),
    [octaves, amplitudeScale, freqScale]
  );

  const orbProps = useMemo(() => ({
    count:       orbCount,
    orbRadius,
    pointSize:   orbPointSize,
    baseAlpha:   orbBaseAlpha,
    wobbleScale: orbWobble,
    glowAmount:  orbGlow,
    nucleusSize: orbNucleusSize,
    nucleusAlpha:orbNucleusAlpha,
  }), [orbCount, orbRadius, orbPointSize, orbBaseAlpha, orbWobble, orbGlow, orbNucleusSize, orbNucleusAlpha]);

  return (
    <div className="w-full h-full" style={{ touchAction: "none" }}>
      <Canvas
        camera={{ position: [0, 4.5, 7], fov }}
        gl={{
          antialias: true, alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
        style={{ background: FOG_COLOR }}
      >
        <fog attach="fog" args={[FOG_COLOR, fogNear, fogFar]} />

        <ambientLight intensity={ambientInt} />
        <directionalLight position={[8, 15, 6]} intensity={0.4} color="#c8d8f0" />
        <pointLight
          position={[0, 6, 0]}
          intensity={0.2 + solarWind.stormLevel * stormLightScale}
          color={solarWind.stormLevel > 0.5 ? "#ff4422" : "#2255ee"}
          distance={60}
        />

        {/* ── 배경별 (CMB) ── */}
        <CmbSkybox
          particleCount={cmbCount}
          opacity={cmbOpacity}
          radius={cmbRadius}
          rotationSpeed={cmbRotSpeed}
          brightness={cmbBrightness}
          contrast={cmbContrast}
          sizeMin={cmbSizeMin}
          sizeMax={cmbSizeMax}
          useCmbData={cmbUsReal}
          haloIntensity={0.4}
          colorSaturation={cmbSaturation}
        />

        {/* ── 이동 흔적 (감쇠 기억) ── */}
        {/* ── 통합 별 생애주기 (파티클 궤적 + 별 형성) ── */}
        <StarFieldSystem
          playerPosRef={playerPosRef}
          playerYRef={playerYRef}
          particleOpacity={starParticleOpacity}
          spawnRate={starSpawnRate}
          lifetime={starLifetime}
          spread={starSpread}
          pointSize={starPointSize}
          spawnJitter={starSpawnJitter}
          attractG={starAttractG}
          clusterThreshold={starClusterThreshold}
          starScale={starScale}
          botPositions={botEnabled ? Array.from({ length: botCount }, (_, i) => ({
            x: Math.cos((i / botCount) * Math.PI * 2) * 8,
            z: Math.sin((i / botCount) * Math.PI * 2) * 8,
            // 각 봇: φ = 전방향 균등 분배, β = 속도 독립 배정 (0.15 ~ 0.85)
            phi:  (i / botCount) * Math.PI * 2,
            beta: 0.15 + (i / Math.max(botCount - 1, 1)) * 0.7,
          })) : undefined}
        />

        {/* ── 플레이어 + 카메라 ── */}
        <SceneController
          orbColor={orbColor}
          solarWind={solarWind}
          timeRef={timeRef}
          playerPosRef={playerPosRef}
          playerYRef={playerYRef}
          setLocked={setLocked}
          speedRef={speedRef}
          camDist={camDist}
          camHeight={camHeight}
          camLerp={camLerp}
          viscosity={viscosity}
          waveParams={waveParams}
          orbProps={orbProps}
        />

        {/* ── RadialBlur 드라이버 — 임시 비활성화 (에러 격리 테스트)
        <RadialBlurDriver
          effectRef={radialBlurEffectRef}
          speedRef={speedRef}
          maxStrength={radialStr}
          maxSpeed={radialMaxSpeed}
          decay={radialDecay}
        />
        */}

        {/* ── Post-processing ── */}
        <EffectComposer>
          <Bloom
            intensity={fgBloomStr}
            radius={fgBloomRadius}
            luminanceThreshold={fgBloomThr}
            luminanceSmoothing={0.8}
          />
          {/* RadialBlur — 임시 비활성화
          <primitive object={radialBlurEffect} />
          */}
          <Vignette eskil={false} offset={0.15} darkness={vignette} />
        </EffectComposer>

      </Canvas>

      {!locked && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-white/15 text-[11px] font-mono tracking-[0.35em]">click to enter</p>
        </div>
      )}

      <div className="absolute bottom-4 left-4 text-[9px] text-white/12 font-mono pointer-events-none select-none space-y-0.5">
        {locked && <div>WASD · mouse · ESC</div>}
        <div>
          {solarWind.isDataFresh ? "●" : "○"}{" "}
          {solarWind.protonSpeed.toFixed(0)} km/s · Kp {solarWind.kpIndex}
          {solarWind.stormLevel > 0.5 && " · STORM"}
        </div>
        {botEnabled && (
          <div className="text-yellow-400/40">BOT ×{botCount}</div>
        )}
      </div>
    </div>
  );
}

// ── 봇 시뮬레이터 ─────────────────────────────────────────────
// MobileScene 내부 useEffect로 botEnabled 시 가상 플레이어 이동 시뮬레이션
// (실제 구현은 SceneController의 playerPosRef를 직접 건드리지 않고
//  window dispatch로 synthetic WASD 이벤트 발생)

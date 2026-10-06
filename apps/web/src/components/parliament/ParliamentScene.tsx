"use client";
/**
 * ParliamentScene: the player view of the parliament-of-things build.
 *
 * Input is the same as the legacy view (WASD + pointer-lock mouse look); the role is picked in Leva
 * for interaction tests. Camera and movement are copied from the legacy MobileScene, which stays
 * untouched under /legacy.
 *
 * URL: ?demo=1 seeds a crowd of workers (lib/parliament/demo.ts) and puts this visitor after it.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Leva, button, useControls } from "leva";
import { EffectComposer, Vignette } from "@react-three/postprocessing";
import { PlayerCursor } from "@/components/mobile/scene/PlayerCursor";
import { RoleField } from "./RoleField";
import { useFoldControls } from "./foldControls";
import { OFFSET_WINDOW_SEC, clearWorld, seedParliamentDemoIfRequested, type RoleId } from "@/lib/parliament";

const FOG_COLOR = "#01020a";
const ORB_Y = 0.45;

const ROLE_OPTIONS: Record<string, RoleId> = {
  "회사원 (worker)": "worker",
  "전사 (warrior) · 효과 미구현": "warrior",
  "양치기 (shepherd) · 효과 미구현": "shepherd",
  "늑대 (wolf) · 효과 미구현": "wolf",
  "나무 (tree) · 효과 미구현": "tree",
};

function useKeys() {
  const k = useRef<Set<string>>(new Set());
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { e.preventDefault(); k.current.add(e.code); };
    const up = (e: KeyboardEvent) => k.current.delete(e.code);
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
  }, []);
  return k;
}

function Mover({
  playerPosRef, setLocked, camDist, camLerp, viscosity,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  setLocked: (v: boolean) => void;
  camDist: number; camLerp: number; viscosity: number;
}) {
  const { camera, gl } = useThree();
  const keys = useKeys();
  const player = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const yaw = useRef(Math.PI);
  const pitch = useRef(0.45);
  const camPos = useRef(new THREE.Vector3(0, 4.5, camDist));
  const lookAt = useRef(new THREE.Vector3());
  const group = useRef<THREE.Group>(null);

  useEffect(() => {
    const c = gl.domElement;
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== c) return;
      yaw.current -= e.movementX * 0.0025;
      pitch.current = Math.max(0.05, Math.min(1.2, pitch.current + e.movementY * 0.002));
    };
    const onChange = () => setLocked(document.pointerLockElement === c);
    const onClick = () => c.requestPointerLock();
    c.addEventListener("click", onClick);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("pointerlockchange", onChange);
    return () => {
      c.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onChange);
    };
  }, [gl, setLocked]);

  useFrame((_, delta) => {
    const p = player.current;
    const k = keys.current;
    const y = yaw.current;
    const dt = Math.min(delta, 0.05);
    const fwd = k.has("KeyW") || k.has("ArrowUp") ? 1 : 0;
    const bwd = k.has("KeyS") || k.has("ArrowDown") ? 1 : 0;
    const left = k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0;
    const rgt = k.has("KeyD") || k.has("ArrowRight") ? 1 : 0;
    const tgtFwd = (fwd - bwd * 0.4) * 7.0;
    const tgtStrafe = (rgt - left) * 4.5;
    const tvx = Math.sin(y) * tgtFwd + -Math.cos(y) * tgtStrafe;
    const tvz = Math.cos(y) * tgtFwd + Math.sin(y) * tgtStrafe;
    const dampF = 1.0 - Math.exp(-(2.0 + (1 - viscosity) * 13.0) * dt);
    p.vx += (tvx - p.vx) * dampF;
    p.vz += (tvz - p.vz) * dampF;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    playerPosRef.current = { x: p.x, z: p.z };

    group.current?.position.set(p.x, ORB_Y, p.z);
    const hd = camDist * Math.cos(pitch.current);
    const vd = camDist * Math.sin(pitch.current);
    camPos.current.lerp(new THREE.Vector3(p.x - Math.sin(y) * hd, ORB_Y + vd + 0.4, p.z - Math.cos(y) * hd), camLerp);
    camera.position.copy(camPos.current);
    lookAt.current.lerp(new THREE.Vector3(p.x, ORB_Y + 0.2, p.z), camLerp * 2);
    camera.lookAt(lookAt.current);
  });

  return (
    <group ref={group}>
      <PlayerCursor position={[0, -0.25, 0]} />
    </group>
  );
}

export default function ParliamentScene() {
  const [locked, setLocked] = useState(false);
  const [demo] = useState(() => seedParliamentDemoIfRequested());
  const hideChrome = demo || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ui") === "0");
  const playerPosRef = useRef({ x: 0, z: 0 });

  const { role, botEnabled, botCount, botRole } = useControls("Role (사물의 의회)", {
    role: { options: ROLE_OPTIONS, value: "worker" as RoleId, label: "내 역할" },
    botEnabled: { value: false, label: "봇 켜기 (원점 주위를 도는 방문자)" },
    botCount: { value: 6, min: 1, max: 30, step: 1, label: "봇 수" },
    botRole: { options: ROLE_OPTIONS, value: "worker" as RoleId, label: "봇 역할" },
    "clear world": button(() => {
      if (window.confirm("Empty the shared world and start a new epoch?")) {
        clearWorld();
        window.location.reload();
      }
    }),
  });
  const { offsetWindow, heightUnit } = useControls("Time & look", {
    offsetWindow: { value: OFFSET_WINDOW_SEC, min: 0, max: 600, step: 10, label: "배정 시각 편차 창 (s, 입장 시 1회)" },
    heightUnit: { value: 0.6, min: 0.1, max: 2, step: 0.05, label: "높이 1단 (units)" },
  });
  const { camDist, camLerp, fov, viscosity, fogNear, fogFar, vignette } = useControls("Camera & feel", {
    camDist: { value: 7, min: 2, max: 20, step: 0.5 },
    camLerp: { value: 0.07, min: 0.01, max: 0.3, step: 0.01, label: "부드러움" },
    fov: { value: 60, min: 30, max: 110, step: 1 },
    viscosity: { value: 0.72, min: 0, max: 1, step: 0.01, label: "점성(0=즉각, 1=끈적)" },
    fogNear: { value: 18, min: 5, max: 80, step: 1 },
    fogFar: { value: 80, min: 20, max: 200, step: 5 },
    vignette: { value: 0.25, min: 0, max: 1, step: 0.01 },
  }, { collapsed: true });
  const cfg = useFoldControls();

  return (
    <div className="w-full h-full" style={{ touchAction: "none" }}>
      <Leva hidden={hideChrome} />
      <Canvas
        camera={{ position: [0, 4.5, 7], fov }}
        dpr={0.75}
        gl={{ antialias: false, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, preserveDrawingBuffer: true }}
        style={{ background: FOG_COLOR, imageRendering: "pixelated" }}
      >
        <fog attach="fog" args={[FOG_COLOR, fogNear, fogFar]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[8, 15, 6]} intensity={0.9} color="#c8d8f0" />
        {/* the ground cells (1.2 units), barely visible */}
        <gridHelper args={[240, 200, "#161a2a", "#0c0f1a"]} position={[0, 0, 0]} />

        <RoleField
          playerPosRef={playerPosRef}
          role={role}
          botCount={botEnabled ? botCount : 0}
          botRole={botRole}
          cfg={cfg}
          offsetWindow={offsetWindow}
          heightUnit={heightUnit}
        />
        <Mover playerPosRef={playerPosRef} setLocked={setLocked} camDist={camDist} camLerp={camLerp} viscosity={viscosity} />

        <EffectComposer multisampling={0}>
          <Vignette eskil={false} offset={0.15} darkness={vignette} />
        </EffectComposer>
      </Canvas>

      {!locked && !hideChrome && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-white/15 text-[11px] font-mono tracking-[0.35em]">click to enter</p>
        </div>
      )}
      {!hideChrome && locked && (
        <div className="absolute bottom-4 left-4 text-[9px] text-white/12 font-mono pointer-events-none select-none">WASD · mouse · ESC</div>
      )}
    </div>
  );
}

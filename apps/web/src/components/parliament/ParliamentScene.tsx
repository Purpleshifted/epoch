"use client";
/**
 * ParliamentScene — the player view of the "parliament of things".
 * Pick a role in the Leva panel (demo build), walk (WASD + mouse look after a click), and the
 * role's trace appears in the ground. Only the worker has an effect so far.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Leva, folder, useControls } from "leva";
import { PlayerCursor } from "@/components/mobile/scene/PlayerCursor";
import { RoleField, type ParliamentDebug } from "./RoleField";
import { LEVA_THEME, useFoldControls, useNatureControls } from "./useWorld";
import { seedParliamentDemoIfRequested, ROLE_IMPLEMENTED, type RoleId } from "@/lib/parliament";
import { CELL_SIZE } from "@/lib/stratum/field";

const FOG_COLOR = "#01020a";
const ORB_Y = 0.45;

const ROLE_OPTIONS: Record<string, RoleId> = {
  "회사원 (worker)": "worker",
  "전사 (warrior) — 효과 미구현": "warrior",
  "양치기 (shepherd) — 효과 미구현": "shepherd",
  "늑대 (wolf) — 효과 미구현": "wolf",
  "나무 (tree) — 효과 미구현": "tree",
};

function useKeys() {
  const k = useRef<Set<string>>(new Set());
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      e.preventDefault();
      k.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => k.current.delete(e.code);
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
    };
  }, []);
  return k;
}

function Controller({
  playerPosRef,
  setLocked,
  camDist,
  camLerp,
  viscosity,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  setLocked: (v: boolean) => void;
  camDist: number;
  camLerp: number;
  viscosity: number;
}) {
  const { camera, gl } = useThree();
  const keys = useKeys();
  const player = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const yaw = useRef(Math.PI);
  const pitch = useRef(0.45);
  const camPos = useRef(new THREE.Vector3(0, 4.5, 7));
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
    const drag = 2.0 + (1 - viscosity) * 13.0;
    const damp = 1.0 - Math.exp(-drag * dt);
    p.vx += (tvx - p.vx) * damp;
    p.vz += (tvz - p.vz) * damp;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    playerPosRef.current = { x: p.x, z: p.z };
    group.current?.position.set(p.x, ORB_Y, p.z);

    const hd = camDist * Math.cos(pitch.current);
    const vd = camDist * Math.sin(pitch.current);
    const desired = new THREE.Vector3(p.x - Math.sin(y) * hd, ORB_Y + vd + 0.4, p.z - Math.cos(y) * hd);
    camPos.current.lerp(desired, camLerp);
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
  const [demo] = useState(() => seedParliamentDemoIfRequested());
  const hideChrome = demo || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ui") === "0");
  const [locked, setLocked] = useState(false);
  const playerPosRef = useRef({ x: 0, z: 0 });
  const [debug, setDebug] = useState<ParliamentDebug | null>(null);

  const { role, offsetWindow, botEnabled, botCount, botRole, botGroups, botSpread, botTimeSpread, pixelDpr, camDist, camLerp, viscosity, fogNear, fogFar } =
    useControls({
      "역할 (Role)": folder({
        role: { options: ROLE_OPTIONS, value: "worker" as RoleId, label: "내 역할" },
        offsetWindow: { value: 120, min: 0, max: 600, step: 5, label: "시각 배정 창 (s) — 새로고침 시 적용" },
      }),
      "Debug / 봇": folder({
        botEnabled: { value: false, label: "봇 활성화" },
        botCount: { value: 12, min: 1, max: 30, step: 1, label: "봇 수" },
        botRole: { options: ROLE_OPTIONS, value: "worker" as RoleId, label: "봇 역할" },
        botGroups: { value: 4, min: 1, max: 10, step: 1, label: "봇 무리 수 (무리당 3명 이상이어야 콘크리트)" },
        botSpread: { value: 14, min: 0, max: 60, step: 1, label: "무리 간 거리 (월드)" },
        botTimeSpread: { value: 60, min: 0, max: 600, step: 5, label: "봇 시각 폭 (s, 나 기준 ±절반에서 랜덤)" },
      }),
      "화면": folder({
        pixelDpr: { value: 1, min: 0.15, max: 1, step: 0.05, label: "해상도 (1 = 픽셀 아님, 작을수록 거칠게)" },
        camDist: { value: 7, min: 2, max: 20, step: 0.5 },
        camLerp: { value: 0.07, min: 0.01, max: 0.3, step: 0.01, label: "카메라 부드러움" },
        viscosity: { value: 0.72, min: 0, max: 1, step: 0.01, label: "점성" },
        fogNear: { value: 18, min: 5, max: 80, step: 1 },
        fogFar: { value: 80, min: 20, max: 200, step: 5 },
      }, { collapsed: true }),
    });
  const botFlock = useMemo(() => ({ groups: botGroups, spread: botSpread, timeSpread: botTimeSpread }), [botGroups, botSpread, botTimeSpread]);
  const cfg = useFoldControls();
  const { cfg: natureCfg, pointSize } = useNatureControls();

  useEffect(() => {
    if (hideChrome) return;
    const id = setInterval(() => {
      const d = (window as unknown as { __parliament?: ParliamentDebug }).__parliament;
      if (d) setDebug({ ...d });
    }, 500);
    return () => clearInterval(id);
  }, [hideChrome]);

  const grid = useMemo(() => 100 * CELL_SIZE, []);

  return (
    <div className="h-full w-full" style={{ touchAction: "none" }}>
      <Leva hidden={hideChrome} theme={LEVA_THEME} />
      <Canvas
        camera={{ position: [0, 4.5, 7], fov: 60 }}
        dpr={pixelDpr}
        gl={{ antialias: false, alpha: false, preserveDrawingBuffer: true }}
        style={{ background: FOG_COLOR, imageRendering: "pixelated" }}
      >
        <fog attach="fog" args={[FOG_COLOR, fogNear, fogFar]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[8, 15, 6]} intensity={0.9} color="#c8d8f0" />
        {/* the ground: faint cell lines (one cell = CELL_SIZE) */}
        <gridHelper args={[grid, 100, "#1a1d33", "#0d0f1c"]} position={[0, 0.001, 0]} />
        <RoleField
          playerPosRef={playerPosRef}
          role={role}
          cfg={cfg}
          natureCfg={natureCfg}
          pointSize={pointSize}
          offsetWindow={offsetWindow}
          botCount={botEnabled ? botCount : 0}
          botRole={botRole}
          botFlock={botFlock}
        />
        <Controller playerPosRef={playerPosRef} setLocked={setLocked} camDist={camDist} camLerp={camLerp} viscosity={viscosity} />
      </Canvas>

      {!locked && !hideChrome && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="font-mono text-[11px] tracking-[0.35em] text-white/15">click to enter</p>
        </div>
      )}
      {!hideChrome && (
        <div className="pointer-events-none absolute bottom-4 left-4 select-none space-y-0.5 font-mono text-[9px] text-white/25">
          {locked && <div>WASD · mouse · ESC</div>}
          {debug && (
            <div>
              {debug.role}
              {ROLE_IMPLEMENTED[debug.role] ? "" : " (no effect yet)"} · s={debug.s} (offset {debug.offset}) · events {debug.events} · slabs {debug.slabs} · paths {debug.paths}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

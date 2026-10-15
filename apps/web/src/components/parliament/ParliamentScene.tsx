"use client";
/**
 * ParliamentScene — the player view of the "parliament of things".
 * Pick a role in the Leva panel (demo build), walk (WASD + mouse look after a click), and the
 * role's trace appears in the ground. Only the worker has an effect so far.
 *
 * V2: a visitor's SESSION (useLifeSession, lib/parliament/session.ts): the first touch spins the role slot, the
 * lifespan runs, near its end the cursor blinks fast, the sound goes dull and the controls stop answering; at the
 * end the visitor is removed and the next one starts afresh. The HUD (SessionHud) reports it all in dry text.
 * Each role moves and looks its own way (lib/parliament/roleControls.ts): the worker walks, the street cat darts low,
 * the car drives (A/D steer), the tree is rooted and grows.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Leva, folder, useControls } from "leva";
import { PlayerCursor } from "@/components/mobile/scene/PlayerCursor";
import { RoleField, type ParliamentDebug } from "./RoleField";
import { LEVA_THEME, useFoldControls, useNatureControls } from "./useWorld";
import { useSound } from "./useSound";
import { useParliamentVersion } from "./version";
import { useLifeSession, type LifeSignal } from "./useLifeSession";
import { SessionHud } from "./SessionHud";
import {
  DEFAULT_LIFE,
  hindrance,
  seedParliamentDemoIfRequested,
  ROLE_CONTROLS,
  ROLE_IMPLEMENTED,
  camDistOf,
  stepBody,
  type Body,
  type Observation,
  type RoleControl,
  type RoleId,
  type Surface,
} from "@/lib/parliament";
import { CELL_SIZE } from "@/lib/stratum/field";

const FOG_COLOR = "#01020a";
const ORB_Y = 0.45;

/** Where the player is and how fast they move (world units, /s). */
export interface PlayerState {
  x: number;
  z: number;
  vx?: number;
  vz?: number;
}

const ROLE_OPTIONS: Record<string, RoleId> = {
  "회사원 (worker)": "worker",
  "전사 (warrior) — 효과 미구현": "warrior",
  "양치기 (shepherd) — 효과 미구현": "shepherd",
  "늑대 (wolf) — 효과 미구현": "wolf",
  "나무 (tree) — 효과 미구현": "tree",
};

/** V2: the session roles; "random" = drawn by the slot at every session. */
const V2_ROLE_OPTIONS: Record<string, RoleId | "random"> = {
  "랜덤 (슬롯)": "random",
  "회사원 (worker)": "worker",
  "길고양이 (street cat) — 효과 미구현": "cat",
  "자동차 (car) — 효과 미구현": "car",
  "나무 (tree) — 효과 미구현": "tree",
};
const V2_BOT_OPTIONS: Record<string, RoleId | "mixed"> = {
  "회사원 (worker)": "worker",
  "섞어서 (worker · cat · car · tree 차례로)": "mixed",
  "길고양이 (street cat)": "cat",
  "자동차 (car)": "car",
  "나무 (tree)": "tree",
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
  playerYawRef,
  setLocked,
  camDist,
  camLerp,
  viscosity,
  lifeRef,
  role = "worker",
  lifeSec = 0,
  getSurface,
}: {
  playerPosRef: React.MutableRefObject<PlayerState>;
  playerYawRef: React.MutableRefObject<number>;
  setLocked: (v: boolean) => void;
  camDist: number;
  camLerp: number;
  viscosity: number;
  /** V2: the session — the controls only work while it is live (not while the role is drawn, not after the end);
   *  near the end they answer worse and drop out. */
  lifeRef?: { readonly current: LifeSignal };
  /** V2: whose controls (lib/parliament/roleControls.ts); V1 always walks as the worker. */
  role?: RoleId;
  /** The lifespan (s): a tree's eye rises over it. */
  lifeSec?: number;
  /** The ground under the player (witness.ts): a car is fast on sealed ground, slow on open ground. */
  getSurface?: () => Surface | undefined;
}) {
  const { camera, gl } = useThree();
  const keys = useKeys();
  const player = useRef<Body>({ x: 0, z: 0, vx: 0, vz: 0, yaw: Math.PI });
  const yaw = useRef(Math.PI);
  const pitch = useRef(0.45);
  const camPos = useRef(new THREE.Vector3(0, 4.5, 7));
  const lookAt = useRef(new THREE.Vector3());
  const group = useRef<THREE.Group>(null);
  // the mouse handler reads the role's controls through this ref
  const ctrl = useRef<RoleControl>(ROLE_CONTROLS[role]);
  useEffect(() => {
    ctrl.current = ROLE_CONTROLS[role];
  }, [role]);

  useEffect(() => {
    const c = gl.domElement;
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== c) return;
      const L = lifeRef?.current;
      if (L && L.phase !== "live") return;
      const h = L ? hindrance(L.warn, performance.now() / 1000) : null;
      if (h?.dropped) return;
      const look = h?.look ?? 1;
      const r = ctrl.current.look;
      yaw.current -= e.movementX * 0.0025 * look * r.yaw;
      pitch.current = Math.max(r.pitchMin, Math.min(r.pitchMax, pitch.current + e.movementY * 0.002 * look * r.pitch));
    };
    const onChange = () => setLocked(document.pointerLockElement === c);
    const onClick = () => {
      if (lifeRef && lifeRef.current.phase !== "live") return;
      c.requestPointerLock();
    };
    c.addEventListener("click", onClick);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("pointerlockchange", onChange);
    return () => {
      c.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onChange);
    };
  }, [gl, setLocked, lifeRef]);

  useFrame((_, delta) => {
    const p = player.current;
    const k = keys.current;
    const dt = Math.min(delta, 0.05);
    const c = ROLE_CONTROLS[role];
    // V2: the input is dead unless the session is live; near the end of the lifespan it answers worse and drops out
    const L = lifeRef?.current;
    const h = L ? hindrance(L.warn, performance.now() / 1000) : null;
    const dead = (!!L && L.phase !== "live") || !!h?.dropped;
    const keysNow = {
      fwd: !dead && (k.has("KeyW") || k.has("ArrowUp")),
      back: !dead && (k.has("KeyS") || k.has("ArrowDown")),
      left: !dead && (k.has("KeyA") || k.has("ArrowLeft")),
      right: !dead && (k.has("KeyD") || k.has("ArrowRight")),
    };
    const drag = (2.0 + (1 - viscosity) * 13.0) * (h?.response ?? 1);
    // the role's body (a car steers its own heading with A/D, so the heading goes in and comes back out)
    p.yaw = yaw.current;
    stepBody(p, keysNow, c.motion, { dt, drag, gain: h?.gain ?? 1, surface: getSurface?.() });
    yaw.current = p.yaw;
    const y = p.yaw;
    pitch.current = Math.max(c.look.pitchMin, Math.min(c.look.pitchMax, pitch.current));
    playerPosRef.current = { x: p.x, z: p.z, vx: p.vx, vz: p.vz };
    playerYawRef.current = y;
    group.current?.position.set(p.x, ORB_Y, p.z);

    // the eye: low for a cat, high and far for a car; a tree's rises as it grows over the lifespan
    const dist = camDist * camDistOf(c.cam, L && lifeSec > 0 ? L.t / lifeSec : 0);
    const hd = dist * Math.cos(pitch.current);
    const vd = dist * Math.sin(pitch.current);
    const desired = new THREE.Vector3(p.x - Math.sin(y) * hd, ORB_Y + vd + c.cam.lift, p.z - Math.cos(y) * hd);
    camPos.current.lerp(desired, camLerp);
    camera.position.copy(camPos.current);
    lookAt.current.lerp(new THREE.Vector3(p.x, ORB_Y + 0.2, p.z), camLerp * 2);
    camera.lookAt(lookAt.current);
  });

  return (
    <group ref={group}>
      <PlayerCursor position={[0, -0.25, 0]} getWarn={lifeRef ? () => lifeRef.current.warn : undefined} />
    </group>
  );
}

export default function ParliamentScene() {
  const [demo] = useState(() => seedParliamentDemoIfRequested());
  const hideChrome = demo || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ui") === "0");
  const [locked, setLocked] = useState(false);
  const playerPosRef = useRef<PlayerState>({ x: 0, z: 0, vx: 0, vz: 0 });
  const playerYawRef = useRef(Math.PI);
  const [debug, setDebug] = useState<ParliamentDebug | null>(null);
  // V2: the headset sound (null in V1)
  const sound = useSound();
  const isV2 = useParliamentVersion() === "v2";
  const v2 = () => isV2;
  const witnessRef = useRef<Observation | null>(null);

  const { session: sessionOn, role: roleChoice, roleMotion, lifeSec, warnSec, endHoldSec, lifeRate, offsetWindow, botEnabled, botCount, botRole, botGroups, botSpread, botTimeSpread, pixelDpr, camDist, camLerp, viscosity, fogNear, fogFar } =
    useControls({
      "역할 (Role)": folder({
        session: { value: true, label: "세션 (슬롯 · 수명 · 퇴장)", render: v2 },
        role: isV2
          ? { options: V2_ROLE_OPTIONS, value: "random" as RoleId | "random", label: "배정 (랜덤 = 슬롯)" }
          : { options: ROLE_OPTIONS, value: "worker" as RoleId | "random", label: "내 역할" },
        roleMotion: { value: true, label: "역할별 조작 (끄면 모두 회사원처럼 걷기)", render: v2 },
        lifeSec: { value: DEFAULT_LIFE.lifeSec, min: 20, max: 900, step: 5, label: "수명 (s, 실제 시간)", render: v2 },
        warnSec: { value: DEFAULT_LIFE.warnSec, min: 0, max: 120, step: 1, label: "끝이 느껴지는 마지막 (s)", render: v2 },
        endHoldSec: { value: DEFAULT_LIFE.endHoldSec, min: 2, max: 60, step: 1, label: "퇴장 화면 최소 (s) → 그 뒤 스페이스로 다음 세션", render: v2 },
        lifeRate: { value: 1, min: 1, max: 30, step: 0.5, label: "수명 시계 배율 (테스트용, 1 = 실제)", render: v2 },
        offsetWindow: { value: 120, min: 0, max: 600, step: 5, label: "시각 배정 창 (s) — 새로고침 시 적용" },
      }),
      "Debug / 봇": folder({
        botEnabled: { value: false, label: "봇 활성화" },
        botCount: { value: 12, min: 1, max: 30, step: 1, label: "봇 수" },
        botRole: { options: isV2 ? V2_BOT_OPTIONS : ROLE_OPTIONS, value: "worker" as RoleId | "mixed", label: "봇 역할" },
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
  const lifeCfg = useMemo(() => ({ lifeSec, warnSec, endHoldSec, rate: lifeRate }), [lifeSec, warnSec, endHoldSec, lifeRate]);
  const withSession = isV2 && sessionOn;
  const session = useLifeSession(withSession, lifeCfg, roleChoice === "random" ? null : roleChoice);
  // the role the visitor leaves traces as (before the draw — IDLE — they leave nothing, see RoleField)
  const role: RoleId = session.role ?? "worker";
  // whose controls: V2 = the role's own (roleControls.ts), V1 = everyone walks as the worker
  const controlRole: RoleId = isV2 && roleMotion ? role : "worker";
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
          key={`field-${session.sessionNo}`}
          playerPosRef={playerPosRef}
          role={role}
          cfg={cfg}
          natureCfg={natureCfg}
          pointSize={pointSize}
          offsetWindow={offsetWindow}
          botCount={botEnabled ? botCount : 0}
          botRole={botRole}
          botFlock={botFlock}
          sound={sound}
          playerYawRef={playerYawRef}
          lifeRef={withSession ? session.lifeRef : undefined}
          witnessRef={withSession ? witnessRef : undefined}
        />
        <Controller
          key={`controller-${session.sessionNo}`}
          playerPosRef={playerPosRef}
          playerYawRef={playerYawRef}
          setLocked={setLocked}
          camDist={camDist}
          camLerp={camLerp}
          viscosity={viscosity}
          lifeRef={withSession ? session.lifeRef : undefined}
          role={controlRole}
          lifeSec={lifeSec}
          getSurface={() => witnessRef.current?.surface}
        />
      </Canvas>

      {withSession && !demo && <SessionHud key={session.sessionNo} session={session} witnessRef={witnessRef} locked={locked} lifeSec={lifeSec} hint={ROLE_CONTROLS[controlRole].hint} />}
      {!locked && !hideChrome && !withSession && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="font-mono text-[11px] tracking-[0.35em] text-white/15">click to enter</p>
        </div>
      )}
      {!hideChrome && (
        <div
          className={`pointer-events-none absolute ${withSession ? "left-4 top-4" : "bottom-4 left-4"} select-none space-y-0.5 font-mono text-[9px] text-white/25`}
        >
          {locked && <div>{isV2 ? `${ROLE_CONTROLS[controlRole].hint} · ESC` : "WASD · mouse · ESC"}</div>}
          {debug && (
            <div>
              {debug.role}
              {ROLE_IMPLEMENTED[debug.role] ? "" : " (no effect yet)"}
              {withSession ? ` · ${session.phase}` : ""} · s={debug.s} (offset {debug.offset}) · events {debug.events} · slabs {debug.slabs} · paths {debug.paths}
            </div>
          )}
          {debug?.sound && <div>♪ {debug.sound}</div>}
        </div>
      )}
    </div>
  );
}

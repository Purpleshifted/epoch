"use client";
/**
 * ParliamentScene — the player view of the "parliament of things".
 * Pick a role in the Leva panel (demo build), walk (WASD + mouse look after a click), and the
 * role's trace appears in the ground. Only the worker has an effect so far.
 *
 * V2: a visitor's SESSION (useLifeSession, lib/parliament/session.ts): the first touch spins the role slot, the
 * lifespan runs, near its end the cursor blinks fast, the sound goes dull and the controls stop answering; at the
 * end the visitor is removed and the next one starts afresh. The HUD (SessionHud) reports it all in dry text.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Leva, folder, useControls } from "leva";
import { PlayerCursor } from "@/components/mobile/scene/PlayerCursor";
import { RoleField, type ParliamentDebug } from "./RoleField";
import { LEVA_THEME, useFoldControls, useNatureControls } from "./useWorld";
import { useSound } from "./useSound";
import SoundButton from "./SoundButton";
import NoiseCraftHost from "./NoiseCraftHost";
import { usePerfMeter } from "./usePerfMeter";
import { useParliamentVersion } from "./version";
import { useLifeSession, type LifeSignal } from "./useLifeSession";
import { SessionHud } from "./SessionHud";
import { DEFAULT_LIFE, hindrance, seedParliamentDemoIfRequested, ROLE_IMPLEMENTED, wrapCoord, type Observation, type RoleId } from "@/lib/parliament";
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
      const L = lifeRef?.current;
      if (L && L.phase !== "live") return;
      const h = L ? hindrance(L.warn, performance.now() / 1000) : null;
      if (h?.dropped) return;
      const look = h?.look ?? 1;
      yaw.current -= e.movementX * 0.0025 * look;
      pitch.current = Math.max(0.05, Math.min(1.2, pitch.current + e.movementY * 0.002 * look));
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
    const y = yaw.current;
    const dt = Math.min(delta, 0.05);
    // V2: the input is dead unless the session is live; near the end of the lifespan it answers worse and drops out
    const L = lifeRef?.current;
    const h = L ? hindrance(L.warn, performance.now() / 1000) : null;
    const dead = (!!L && L.phase !== "live") || !!h?.dropped;
    const gain = h?.gain ?? 1;
    const fwd = !dead && (k.has("KeyW") || k.has("ArrowUp")) ? 1 : 0;
    const bwd = !dead && (k.has("KeyS") || k.has("ArrowDown")) ? 1 : 0;
    const left = !dead && (k.has("KeyA") || k.has("ArrowLeft")) ? 1 : 0;
    const rgt = !dead && (k.has("KeyD") || k.has("ArrowRight")) ? 1 : 0;
    const tgtFwd = (fwd - bwd * 0.4) * 7.0 * gain;
    const tgtStrafe = (rgt - left) * 4.5 * gain;
    const tvx = Math.sin(y) * tgtFwd + -Math.cos(y) * tgtStrafe;
    const tvz = Math.cos(y) * tgtFwd + Math.sin(y) * tgtStrafe;
    const drag = (2.0 + (1 - viscosity) * 13.0) * (h?.response ?? 1);
    const damp = 1.0 - Math.exp(-drag * dt);
    p.vx += (tvx - p.vx) * damp;
    p.vz += (tvz - p.vz) * damp;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    // the world is finite and wraps (world.ts): over the edge, in from the other side — the camera and the look-at
    // move by the same jump, so nothing is seen to happen (the ground is laid out around the player)
    const wx = wrapCoord(p.x);
    const wz = wrapCoord(p.z);
    if (wx !== p.x || wz !== p.z) {
      camPos.current.x += wx - p.x;
      camPos.current.z += wz - p.z;
      lookAt.current.x += wx - p.x;
      lookAt.current.z += wz - p.z;
      p.x = wx;
      p.z = wz;
    }
    playerPosRef.current = { x: p.x, z: p.z, vx: p.vx, vz: p.vz };
    playerYawRef.current = y;
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
      <PlayerCursor position={[0, -0.25, 0]} getWarn={lifeRef ? () => lifeRef.current.warn : undefined} />
    </group>
  );
}

/**
 * The faint cell grid, carried along under the player and snapped to whole cells (its lines stay the cells' lines):
 * the world wraps (world.ts), so a grid fixed at the origin would end somewhere.
 */
function FollowGrid({ playerPosRef, size }: { playerPosRef: React.MutableRefObject<PlayerState>; size: number }) {
  const ref = useRef<THREE.GridHelper>(null);
  useFrame(() => {
    const p = playerPosRef.current;
    ref.current?.position.set(Math.round(p.x / CELL_SIZE) * CELL_SIZE, 0.001, Math.round(p.z / CELL_SIZE) * CELL_SIZE);
  });
  return <gridHelper ref={ref} args={[size, 100, "#1a1d33", "#0d0f1c"]} />;
}

export default function ParliamentScene() {
  const [demo] = useState(() => seedParliamentDemoIfRequested());
  const hideChrome = demo || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ui") === "0");
  const [locked, setLocked] = useState(false);
  const playerPosRef = useRef<PlayerState>({ x: 0, z: 0, vx: 0, vz: 0 });
  const playerYawRef = useRef(Math.PI);
  const [debug, setDebug] = useState<ParliamentDebug | null>(null);
  // a kick for the Canvas's first measurement: in some embedded browser panes the ResizeObserver does not fire on the
  // first layout and the scene's children never mount until a resize (seen in the desktop app's built-in browser) —
  // once a second until the field reports its first fold, ten times at most
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      if ((window as unknown as { __parliament?: unknown }).__parliament || ++n > 10) {
        clearInterval(id);
        return;
      }
      window.dispatchEvent(new Event("resize"));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  const isV2 = useParliamentVersion() === "v2";
  const v2 = () => isV2;
  const witnessRef = useRef<Observation | null>(null);

  const { session: sessionOn, role: roleChoice, lifeSec, warnSec, endHoldSec, lifeRate, offsetWindow, botEnabled, botCount, botRole, botGroups, botSpread, botTimeSpread, pixelDpr, camDist, camLerp, viscosity, fogNear, fogFar } =
    useControls({
      "역할 (Role)": folder({
        session: { value: true, label: "세션 (슬롯 · 수명 · 퇴장)", render: v2 },
        // SOUND TESTS (v4 A2, the artist): the worker by default, so building together can be heard — back to
        // "random" (the slot) when this branch is integrated
        role: isV2
          ? { options: V2_ROLE_OPTIONS, value: "worker" as RoleId | "random", label: "배정 (랜덤 = 슬롯; 사운드 테스트 동안 회사원 고정)" }
          : { options: ROLE_OPTIONS, value: "worker" as RoleId | "random", label: "내 역할" },
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
  // V2: the headset sound (null in V1); with a session ESC releases the look, so it is not the mute key then
  const sound = useSound({ escMute: !withSession });
  // the frame rate on the screen (sound wiring: the lag the artist feels, measured where it happens)
  const perf = usePerfMeter(!hideChrome);
  // a mute never carries over to the next visitor (sound wiring)
  useEffect(() => {
    if (sound?.muted) sound.toggleMute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionNo]);
  const cfg = useFoldControls();
  const { cfg: natureCfg, pointSize, pathDots, pathLine } = useNatureControls();

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
        {/* the ground: faint cell lines (one cell = CELL_SIZE), carried along under the player */}
        <FollowGrid playerPosRef={playerPosRef} size={grid} />
        <Controller
          key={`controller-${session.sessionNo}`}
          playerPosRef={playerPosRef}
          playerYawRef={playerYawRef}
          setLocked={setLocked}
          camDist={camDist}
          camLerp={camLerp}
          viscosity={viscosity}
          lifeRef={withSession ? session.lifeRef : undefined}
        />
        <RoleField
          key={`field-${session.sessionNo}`}
          playerPosRef={playerPosRef}
          role={role}
          cfg={cfg}
          natureCfg={natureCfg}
          pointSize={pointSize}
          pathDots={pathDots}
          pathLine={pathLine}
          offsetWindow={offsetWindow}
          botCount={botEnabled ? botCount : 0}
          botRole={botRole}
          botFlock={botFlock}
          sound={sound}
          playerYawRef={playerYawRef}
          lifeRef={withSession ? session.lifeRef : undefined}
          witnessRef={withSession ? witnessRef : undefined}
        />
      </Canvas>

      {withSession && !demo && <SessionHud key={session.sessionNo} session={session} witnessRef={witnessRef} locked={locked} lifeSec={lifeSec} />}
      {/* sound wiring (v4 A2): the artist's NoiseCraft patch as a hidden instrument, playing while LIVE */}
      {sound && sound.params.instrument !== "webaudio" && <NoiseCraftHost sound={sound} live={!withSession || session.phase === "live"} />}
      {/* sound wiring: this window's ♪ switch — while LIVE only (the HUD owns the dark screens), top-right beside the HUD */}
      {sound && !hideChrome && (!withSession || session.phase === "live") && <SoundButton sound={sound} corner={withSession ? "top-right" : "bottom"} />}
      {!locked && !hideChrome && !withSession && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="font-mono text-[11px] tracking-[0.35em] text-white/15">click to enter</p>
        </div>
      )}
      {!hideChrome && (
        <div
          className={`pointer-events-none absolute ${withSession ? "left-4 top-4" : "bottom-4 left-4"} select-none space-y-0.5 font-mono text-[9px] text-white/25`}
        >
          {locked && <div>WASD · mouse · ESC</div>}
          {debug && (
            <div>
              {debug.role}
              {ROLE_IMPLEMENTED[debug.role] ? "" : " (no effect yet)"}
              {withSession ? ` · ${session.phase}` : ""} · s={debug.s} (offset {debug.offset}) · ({debug.x}, {debug.z}) · events {debug.events} · slabs {debug.slabs} · paths {debug.paths}
              {debug.fold ? ` · ${debug.fold}` : ""}
            </div>
          )}
          {debug?.sound && <div>♪ {debug.sound}</div>}
          {perf && (
            <div>
              ⏱ {perf.fps} fps · 가장 느린 프레임 {perf.p95Ms} ms · 50 ms 넘는 프레임 {perf.slowPerMin}/분{perf.heapMb ? ` · heap ${perf.heapMb} MB` : ""}
              {perf.spans.length ? ` · 최대(ms/분) ${perf.spans.map((s) => `${s.name} ${s.maxMs}`).join(" · ")}` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

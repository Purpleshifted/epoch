"use client";
/**
 * ParliamentScene — the player view of the "parliament of things".
 * Pick a role in the Leva panel (demo build), walk (WASD + mouse look after a click), and the
 * role's trace appears in the ground. Only the worker has an effect so far.
 *
 * On a phone: no keys, no pointer lock — a finger on the screen walks, dragging it turns (and tips the camera), letting
 * go stays; stopping living is a button (SessionHud); tap to go on. Tilt walking (useTilt) is an option in Leva.
 *
 * V2: a visitor's SESSION (useLifeSession, lib/parliament/session.ts + intake.ts): the title screen, the notices, a
 * consent with only yes, the headset, a choice of role the slot then ignores, the verdict; then the lifespan runs,
 * near its end the cursor blinks fast, the sound goes dull and the controls stop answering; at the end the visitor is
 * removed, the cause of death is written, and the next one starts afresh. The HUD (SessionHud) says it all in dry
 * text (lib/parliament/script.ts, Korean or English: ?lang= first, then the Leva knob).
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Leva, folder, useControls } from "leva";
import { PlayerCursor } from "@/components/mobile/scene/PlayerCursor";
import { RoleField, type ParliamentDebug } from "./RoleField";
import { LEVA_THEME, useFoldControls, useNatureControls } from "./useWorld";
import { savable } from "./levaSave";
import { useSound } from "./useSound";
import { useParliamentVersion } from "./version";
import { useLifeSession, type LifeSignal } from "./useLifeSession";
import { useTilt, type TiltState } from "./useTilt";
import { SessionHud } from "./SessionHud";
import {
  DEFAULT_LIFE,
  HINT_AFTER_SEC,
  HINT_PERIOD_SEC,
  HINT_SHOW_SEC,
  HOLD_SEC,
  NOTICE_LINE_SEC,
  SELF_NEAR_FACTOR,
  STOP_LAST_SEC,
  TILT_TURN_RATE,
  asLang,
  hindrance,
  seedParliamentDemoIfRequested,
  ROLE_IMPLEMENTED,
  wrapCoord,
  type Lang,
  type Observation,
  type RoleId,
} from "@/lib/parliament";
import { CELL_SIZE } from "@/lib/stratum/field";

const FOG_COLOR = "#01020a";
const ORB_Y = 0.45;
/** A phone: a horizontal drag of about 300 px is a half turn; a vertical one of 300 px runs the camera's whole pitch range. */
const TOUCH_TURN_RAD_PER_PX = Math.PI / 300;
const TOUCH_PITCH_RAD_PER_PX = 1.15 / 300;

/** V2, a phone: a finger on the screen walks (default), or the phone's tilt does (useTilt). */
const PHONE_MODE_OPTIONS: Record<string, "touch" | "tilt"> = {
  "누르기 (누르는 동안 걷기 · 끌어서 회전)": "touch",
  "기울임 (센서)": "tilt",
};

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
  tiltRef,
  coarse = false,
}: {
  playerPosRef: React.MutableRefObject<PlayerState>;
  playerYawRef: React.MutableRefObject<number>;
  setLocked: (v: boolean) => void;
  camDist: number;
  camLerp: number;
  viscosity: number;
  /** V2: the session — the controls only work while it is live (not while the role is drawn, not after the end);
   *  near the end they answer worse and drop out; while X is held to stop living they are dead. */
  lifeRef?: { readonly current: LifeSignal };
  /** A phone in tilt mode: its tilt (useTilt) walks and turns (inactive otherwise). */
  tiltRef?: React.MutableRefObject<TiltState>;
  /** A phone-like device: no pointer lock, no keys — a finger on the screen walks, dragging turns. */
  coarse?: boolean;
}) {
  const { camera, gl } = useThree();
  const keys = useKeys();
  const player = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const yaw = useRef(Math.PI);
  const pitch = useRef(0.45);
  const camPos = useRef(new THREE.Vector3(0, 4.5, 7));
  const lookAt = useRef(new THREE.Vector3());
  const group = useRef<THREE.Group>(null);
  /** A phone: a finger is on the screen (= walking). */
  const pressing = useRef(false);

  useEffect(() => {
    const c = gl.domElement;
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== c) return;
      const L = lifeRef?.current;
      if (L && L.phase !== "live") return;
      if (L && L.attempt > 0) return;
      const h = L ? hindrance(L.warn, performance.now() / 1000) : null;
      if (h?.dropped) return;
      const look = h?.look ?? 1;
      yaw.current -= e.movementX * 0.0025 * look;
      pitch.current = Math.max(0.05, Math.min(1.2, pitch.current + e.movementY * 0.002 * look));
    };
    const onChange = () => setLocked(document.pointerLockElement === c);
    const onClick = () => {
      if (coarse || typeof c.requestPointerLock !== "function") return;
      if (lifeRef && lifeRef.current.phase !== "live") return;
      c.requestPointerLock();
    };
    // a phone: while one finger is on the screen the visitor walks (pressing.current); dragging it turns — about
    // 300 px for a half turn — and tips the camera; letting go stays. (Stopping living is the HUD's button.)
    const touch = { id: -1, x: 0, y: 0 };
    const onTouchStart = (e: TouchEvent) => {
      if (!coarse) return;
      if (e.touches.length !== 1) {
        touch.id = -1;
        pressing.current = false;
        return;
      }
      const t = e.touches[0];
      touch.id = t.identifier;
      touch.x = t.clientX;
      touch.y = t.clientY;
      pressing.current = true;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!coarse || touch.id < 0) return;
      let t: Touch | null = null;
      for (let i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === touch.id) t = e.touches[i];
      if (!t) return;
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      touch.x = t.clientX;
      touch.y = t.clientY;
      const L = lifeRef?.current;
      if (L && (L.phase !== "live" || L.attempt > 0)) return;
      const h = L ? hindrance(L.warn, performance.now() / 1000) : null;
      if (h?.dropped) return;
      const look = h?.look ?? 1;
      yaw.current -= dx * TOUCH_TURN_RAD_PER_PX * look;
      pitch.current = Math.max(0.05, Math.min(1.2, pitch.current + dy * TOUCH_PITCH_RAD_PER_PX * look));
    };
    const onTouchEnd = () => {
      touch.id = -1;
      pressing.current = false;
    };
    c.addEventListener("click", onClick);
    c.addEventListener("touchstart", onTouchStart, { passive: true });
    c.addEventListener("touchmove", onTouchMove, { passive: true });
    c.addEventListener("touchend", onTouchEnd);
    c.addEventListener("touchcancel", onTouchEnd);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("pointerlockchange", onChange);
    return () => {
      c.removeEventListener("click", onClick);
      c.removeEventListener("touchstart", onTouchStart);
      c.removeEventListener("touchmove", onTouchMove);
      c.removeEventListener("touchend", onTouchEnd);
      c.removeEventListener("touchcancel", onTouchEnd);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onChange);
      pressing.current = false;
    };
  }, [gl, setLocked, lifeRef, coarse]);

  useFrame((_, delta) => {
    const p = player.current;
    const k = keys.current;
    const dt = Math.min(delta, 0.05);
    // V2: the input is dead unless the session is live; near the end of the lifespan it answers worse and drops out
    const L = lifeRef?.current;
    const h = L ? hindrance(L.warn, performance.now() / 1000) : null;
    // V2: and on a desktop nothing moves until the visitor has clicked the screen (pointer lock) — the banner says so
    const dead = (!!L && L.phase !== "live") || !!h?.dropped || (L?.attempt ?? 0) > 0 || (!!L && !coarse && document.pointerLockElement !== gl.domElement);
    const gain = h?.gain ?? 1;
    // a phone: the sideways tilt turns, the front-back tilt walks (lib/parliament/tilt.ts)
    const tl = tiltRef?.current;
    const tilt = !dead && coarse && tl?.active ? tl : null;
    if (tilt && tilt.turn !== 0) yaw.current -= tilt.turn * TILT_TURN_RATE * (h?.look ?? 1) * dt;
    const y = yaw.current;
    const tiltFwd = tilt ? (tilt.fwd >= 0 ? tilt.fwd : tilt.fwd * 0.4) : 0;
    const pressFwd = !dead && coarse && pressing.current ? 1 : 0;
    const fwd = !dead && (k.has("KeyW") || k.has("ArrowUp")) ? 1 : 0;
    const bwd = !dead && (k.has("KeyS") || k.has("ArrowDown")) ? 1 : 0;
    const left = !dead && (k.has("KeyA") || k.has("ArrowLeft")) ? 1 : 0;
    const rgt = !dead && (k.has("KeyD") || k.has("ArrowRight")) ? 1 : 0;
    const tgtFwd = Math.max(-1, Math.min(1, fwd - bwd * 0.4 + tiltFwd + pressFwd)) * 7.0 * gain;
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
  // the language the apparatus speaks: ?lang=ko|en on the exhibition URL wins over the Leva knob
  const [langParam] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("lang") : null));
  const [locked, setLocked] = useState(false);
  const playerPosRef = useRef<PlayerState>({ x: 0, z: 0, vx: 0, vz: 0 });
  const playerYawRef = useRef(Math.PI);
  const [debug, setDebug] = useState<ParliamentDebug | null>(null);
  // V2: the headset sound (null in V1)
  const sound = useSound();
  const isV2 = useParliamentVersion() === "v2";
  const v2 = () => isV2;
  const witnessRef = useRef<Observation | null>(null);

  const { session: sessionOn, role: roleChoice, lang: levaLang, phoneMode, helpLine, noticeLineSec, lifeSec, warnSec, endHoldSec, lifeRate, selfP, selfNearFactor, holdSec, hintAfterSec, hintPeriodSec, hintShowSec, stopLastSec, offsetWindow, botEnabled, botCount, botRole, botGroups, botSpread, botTimeSpread, pixelDpr, camDist, camLerp, viscosity, fogNear, fogFar } =
    useControls({
      // save / reload row (levaSave.ts): the saved values come back as the defaults on the next load
      "역할 (Role)": folder(
        savable("역할 (Role)", {
        session: { value: true, label: "세션 (슬롯 · 수명 · 퇴장)", render: v2 },
        role: isV2
          ? { options: V2_ROLE_OPTIONS, value: "random" as RoleId | "random", label: "배정 (랜덤 = 슬롯)" }
          : { options: ROLE_OPTIONS, value: "worker" as RoleId | "random", label: "내 역할" },
        lang: { options: { 한국어: "ko", English: "en" } as Record<string, Lang>, value: "ko" as Lang, label: "안내 언어 (?lang= 이 우선)", render: v2 },
        phoneMode: { options: PHONE_MODE_OPTIONS, value: "touch" as "touch" | "tilt", label: "폰 조작", render: v2 },
        helpLine: { value: false, label: "자살일 때 상담전화 한 줄", render: v2 },
        noticeLineSec: { value: NOTICE_LINE_SEC, min: 0.2, max: 3, step: 0.1, label: "안내 줄 간격 (s)", render: v2 },
        lifeSec: { value: DEFAULT_LIFE.lifeSec, min: 20, max: 900, step: 5, label: "수명 (s, 실제 시간)", render: v2 },
        warnSec: { value: DEFAULT_LIFE.warnSec, min: 0, max: 120, step: 1, label: "끝이 느껴지는 마지막 (s)", render: v2 },
        endHoldSec: { value: DEFAULT_LIFE.endHoldSec, min: 2, max: 60, step: 1, label: "퇴장 화면 최소 (s) → 그 뒤 스페이스로 다음 세션", render: v2 },
        lifeRate: { value: 1, min: 1, max: 30, step: 0.5, label: "수명 시계 배율 (테스트용, 1 = 실제)", render: v2 },
        "그만 살기 (회사원)": folder({
          selfP: { value: DEFAULT_LIFE.selfP ?? 0.35, min: 0, max: 1, step: 0.05, label: "성공 확률 (혼자일 때)", render: v2 },
          selfNearFactor: { value: SELF_NEAR_FACTOR, min: 0, max: 1, step: 0.05, label: "가까운 존재 1명당 ×", render: v2 },
          holdSec: { value: HOLD_SEC, min: 0.5, max: 5, step: 0.5, label: "X 누르는 시간 (s)", render: v2 },
          hintAfterSec: { value: HINT_AFTER_SEC, min: 0, max: 150, step: 5, label: "첫 안내 (s, 삶 시작 뒤)", render: v2 },
          hintPeriodSec: { value: HINT_PERIOD_SEC, min: 5, max: 120, step: 5, label: "안내 간격 (s)", render: v2 },
          hintShowSec: { value: HINT_SHOW_SEC, min: 1, max: 30, step: 1, label: "안내 표시 (s)", render: v2 },
          stopLastSec: { value: STOP_LAST_SEC, min: 0, max: 60, step: 5, label: "죽기 전 불가 (s)", render: v2 },
        }),
        offsetWindow: { value: 120, min: 0, max: 600, step: 5, label: "시각 배정 창 (s) — 새로고침 시 적용" },
        }),
      ),
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
  const lifeCfg = useMemo(
    () => ({ lifeSec, warnSec, endHoldSec, rate: lifeRate, noticeLineSec, selfP, selfNearFactor, holdSec, hintAfterSec, hintPeriodSec, hintShowSec, stopLastSec }),
    [lifeSec, warnSec, endHoldSec, lifeRate, noticeLineSec, selfP, selfNearFactor, holdSec, hintAfterSec, hintPeriodSec, hintShowSec, stopLastSec],
  );
  const withSession = isV2 && sessionOn;
  const lang: Lang = asLang(langParam, levaLang);
  const cfg = useFoldControls();
  // how many others are near right now (the record's NEAR radius = the fold's presence radius): company makes
  // stopping living less likely (intake.ts selfChance)
  const nearRadius = cfg.radius;
  const getNear = useCallback(() => witnessRef.current?.others.filter((o) => o.dist <= nearRadius).length ?? 0, [nearRadius]);
  const session = useLifeSession(withSession, lifeCfg, roleChoice === "random" ? null : roleChoice, lang, getNear);
  // a phone: a finger walks by default; its tilt walks instead in tilt mode (useTilt; nothing on the iMac)
  const { tiltRef, coarse } = useTilt(withSession, withSession ? session.lifeRef : undefined, phoneMode);
  // the role the visitor leaves traces as (before the draw — IDLE — they leave nothing, see RoleField)
  const role: RoleId = session.role ?? "worker";
  const { cfg: natureCfg, pointSize, pathLine } = useNatureControls();

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
          tiltRef={tiltRef}
          coarse={coarse}
        />
        <RoleField
          key={`field-${session.sessionNo}`}
          playerPosRef={playerPosRef}
          role={role}
          cfg={cfg}
          natureCfg={natureCfg}
          pointSize={pointSize}
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

      {withSession && !demo && (
        <SessionHud key={session.sessionNo} session={session} witnessRef={witnessRef} locked={locked} lifeSec={lifeSec} lang={lang} helpLine={helpLine} holdSec={holdSec} noticeLineSec={noticeLineSec} coarse={coarse} />
      )}
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
        </div>
      )}
    </div>
  );
}

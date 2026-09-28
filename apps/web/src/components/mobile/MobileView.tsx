"use client";

import { useEffect, useRef, useState } from "react";
import { useGameClient } from "@/lib/game/hooks";
import { renderScene } from "@/lib/game/renderer";
import {
  computePointerFromEvent,
  preventScrollOnTouch,
} from "@/lib/game/input";
import { addResizeListener } from "@/lib/game/window";
import CanvasSurface from "@/components/shared/CanvasSurface";
import {
  buildNoiseCraftParams,
  postNoiseCraftParams,
  resolveNoiseCraftEmbed,
} from "@/lib/audio/noiseCraft";
import type { NoiseCraftParam } from "@/lib/audio/noiseCraftCore";
import { generateDistancePanParams } from "@/lib/audio/streamMapping";
import {
  generateIndividualPattern,
  hashToneIndex,
  type IndividualPattern,
} from "@/lib/audio/individualSequencer";
import type { GameState, PlayerSnapshot } from "@/types/game";
import Hud from "./Hud";
import StatusBanner from "./StatusBanner";
import Controls from "./Controls";

const INTERPOLATION_LAG_MS = Number(
  process.env.NEXT_PUBLIC_INTERP_LAG_MS ?? 80
);
const DISABLE_INTERPOLATION =
  process.env.NEXT_PUBLIC_DISABLE_INTERPOLATION === "true" ||
  process.env.NEXT_PUBLIC_DISABLE_INTERP === "true";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
type AudioStatus =
  | "idle"
  | "ready"
  | "pending"
  | "playing"
  | "blocked"
  | "stopped";

const buildInterpolatedState = (state: GameState): GameState => {
  if (
    DISABLE_INTERPOLATION ||
    state.mode !== "personal" ||
    state.snapshotBuffer.length === 0
  ) {
    return state;
  }

  const target = Date.now() - INTERPOLATION_LAG_MS;
  const frames = state.snapshotBuffer;
  let older = frames[0];
  let newer = frames[frames.length - 1];

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    if (frame.timestamp <= target) {
      older = frame;
    }
    if (frame.timestamp >= target) {
      newer = frame;
      break;
    }
  }

  if (newer.timestamp < target) {
    older = newer;
  }

  let alpha = 0;
  if (newer !== older && newer.timestamp !== older.timestamp) {
    alpha = (target - older.timestamp) / (newer.timestamp - older.timestamp);
    alpha = Math.min(Math.max(alpha, 0), 1);
  }

  const playerIds = new Set<string>([
    ...older.order,
    ...newer.order,
    ...Object.keys(older.players),
    ...Object.keys(newer.players),
    ...Object.keys(state.players),
  ]);
  const interpolatedPlayers: Record<string, PlayerSnapshot> = {};

  playerIds.forEach((id) => {
    const from = older.players[id] ?? newer.players[id] ?? state.players[id];
    const to = newer.players[id] ?? older.players[id] ?? state.players[id];
    if (!from && !to) return;
    if (!from || !to) {
      const single = (from ?? to)!;
      interpolatedPlayers[id] = {
        ...single,
        lastUpdate: Date.now(),
      };
      return;
    }
    const cell = {
      ...from.cell,
      position: {
        x: lerp(from.cell.position.x, to.cell.position.x, alpha),
        y: lerp(from.cell.position.y, to.cell.position.y, alpha),
      },
      velocity: {
        x: lerp(from.cell.velocity.x, to.cell.velocity.x, alpha),
        y: lerp(from.cell.velocity.y, to.cell.velocity.y, alpha),
      },
    };
    interpolatedPlayers[id] = {
      ...from,
      cell,
      lastUpdate: Date.now(),
    };
  });

  const order = Array.from(playerIds).filter((id) => interpolatedPlayers[id]);

  let camera = state.camera;
  if (state.selfId && interpolatedPlayers[state.selfId]) {
    camera = {
      ...state.camera,
      position: {
        x: interpolatedPlayers[state.selfId].cell.position.x,
        y: interpolatedPlayers[state.selfId].cell.position.y,
      },
    };
  }

  return {
    ...state,
    players: interpolatedPlayers,
    playerOrder: order,
    camera,
  };
};

const MobileView = () => {
  const { state, dispatch, socket } = useGameClient("personal");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const latestState = useRef(state);
  const audioIframeRef = useRef<HTMLIFrameElement>(null);
  const [noiseCraftOrigin, setNoiseCraftOrigin] = useState<string | null>(null);
  const [noiseCraftSrc, setNoiseCraftSrc] = useState("about:blank");
  const [isProjectReady, setIsProjectReady] = useState(false);
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("idle");
  const [isDebugView, setIsDebugView] = useState(false);
  const lastSeqPatternRef = useRef<IndividualPattern | null>(null);
  const lastParamUpdateRef = useRef(0);
  const paramSmoothingRef = useRef<
    Map<string, { current: number; target: number }>
  >(new Map());

  useEffect(() => {
    latestState.current = state;
  }, [state]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const { src, origin } = resolveNoiseCraftEmbed();
    setNoiseCraftSrc(src);
    setNoiseCraftOrigin(origin);
    const path = window.location.pathname || "";
    setIsDebugView(path.startsWith("/mobile/debug"));
    setIsProjectReady(false);
    setAudioStatus("idle");
  }, []);

  // NoiseCraft 매핑 파라미터 전송 (모바일/디버그 공통)
  useEffect(() => {
    if (!noiseCraftOrigin) return;

    // test-workspace와 유사하게 파라미터 업데이트를 스로틀링
    const now = Date.now();
    const PARAM_UPDATE_INTERVAL_MS = 500;
    if (now - lastParamUpdateRef.current < PARAM_UPDATE_INTERVAL_MS) {
      return;
    }
    lastParamUpdateRef.current = now;

    // 개인 뷰용 거리/팬 → 3개 파라미터로 매핑
    const mappedParams = generateDistancePanParams(state);

    // 파라미터 스무딩(클릭/팝 노이즈 방지)
    // 더 강한 스무딩: 천천히 따라가도록 작은 값 사용
    const SMOOTHING_FACTOR = 0.02;
    const smoothingMap = paramSmoothingRef.current;
    const smooth = (nodeId: string, paramName: string, value: number) => {
      const key = `${nodeId}:${paramName}`;
      const existing = smoothingMap.get(key) || {
        current: value,
        target: value,
      };
      existing.target = value;
      const prev = existing.current;
      const diff = existing.target - prev;
      const next = prev + diff * SMOOTHING_FACTOR;
      existing.current = next;
      smoothingMap.set(key, existing);
      const changed = Math.abs(next - prev) > 1e-4;
      return { value: next, changed };
    };

    const combined: NoiseCraftParam[] = mappedParams
      .map((p): NoiseCraftParam | null => {
        const nodeId = String(p.nodeId);
        const paramName = p.paramName || "value";
        const { value, changed } = smooth(nodeId, paramName, p.value);
        if (!changed) return null;
        return {
          ...p,
          nodeId,
          paramName,
          value,
        };
      })
      .filter((p): p is NoiseCraftParam => p !== null);

    if (!combined.length) {
      return;
    }

    postNoiseCraftParams(audioIframeRef.current, noiseCraftOrigin, combined);
  }, [state, noiseCraftOrigin]);

  // MonoSeq 패턴 기반 화음 업데이트 (indiv_audio_map과 동일한 구조, 디버그 뷰 전용)
  useEffect(() => {
    if (!isDebugView) return;
    if (!noiseCraftOrigin) return;
    if (!audioIframeRef.current) return;
    const selfId = state.selfId;
    const selfPlayer = selfId ? state.players[selfId] : null;

    // self / neighbor 톤 결정 (ID 해시 기반 12톤)
    let selfTone: number | null = null;
    const neighborTones: number[] = [];

    if (selfId) {
      selfTone = hashToneIndex(selfId);
    }

    if (selfPlayer && selfId) {
      const { position: selfPos } = selfPlayer.cell;
      const entries = Object.entries(state.players).filter(
        ([id]) => id !== selfId
      );
      const neighbors = entries
        .map(([id, p]) => {
          const dx = p.cell.position.x - selfPos.x;
          const dy = p.cell.position.y - selfPos.y;
          const dist = Math.hypot(dx, dy);
          return { id, dist };
        })
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 2);

      neighbors.forEach(({ id }) => {
        neighborTones.push(hashToneIndex(id));
      });
    }

    const pattern = generateIndividualPattern(selfTone, neighborTones, {
      cluster: state.audio.cluster ?? null,
      isInCluster:
        !!state.audio.cluster &&
        !!state.audio.self?.clusterId &&
        state.audio.cluster.clusterId === state.audio.self.clusterId &&
        (state.audio.cluster.memberCount ?? 0) >= 3,
    });

    const last = lastSeqPatternRef.current;
    if (
      last &&
      last.bassRow === pattern.bassRow &&
      last.baritoneRow === pattern.baritoneRow &&
      last.tenorRow === pattern.tenorRow
    ) {
      return;
    }
    lastSeqPatternRef.current = pattern;

    const win = audioIframeRef.current.contentWindow;
    const targetOrigin =
      process.env.NODE_ENV === "development" ? "*" : noiseCraftOrigin || "*";

    const sendVoice = (nodeId: string, row: number | null) => {
      const rowIdx = row ?? 0;
      const value = row === null ? 0 : 1;
      const NUM_STEPS = 8;
      for (let stepIdx = 0; stepIdx < NUM_STEPS; stepIdx += 1) {
        win?.postMessage(
          {
            type: "noiseCraft:toggleCell",
            nodeId,
            patIdx: 0,
            stepIdx,
            rowIdx,
            value,
          },
          targetOrigin
        );
      }
    };

    // indiv_audio_map 기준 MonoSeq 노드 ID
    sendVoice("172", pattern.bassRow);
    sendVoice("176", pattern.baritoneRow);
    sendVoice("177", pattern.tenorRow);
  }, [
    state.audio,
    state.noiseSlots,
    state.players,
    state.selfId,
    noiseCraftOrigin,
    isDebugView,
  ]);

  useEffect(() => {
    if (!noiseCraftOrigin) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== noiseCraftOrigin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "noiseCraft:projectLoaded") {
        setIsProjectReady(true);
        setAudioStatus((prev) => (prev === "playing" ? prev : "ready"));
      } else if (
        data.type === "noiseCraft:audioState" &&
        typeof data.status === "string"
      ) {
        const status = data.status as AudioStatus;
        setAudioStatus((prev) => {
          if (status === "pending") return prev;
          if (status === "ready" && prev === "playing") return prev;
          return status;
        });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [noiseCraftOrigin]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let logicalWidth = window.innerWidth;
    let logicalHeight = window.innerHeight;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      logicalWidth = window.innerWidth;
      logicalHeight = window.innerHeight;
      canvas.width = Math.floor(logicalWidth * dpr);
      canvas.height = Math.floor(logicalHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const FRAME_INTERVAL_MS = 33; // ~30fps로 제한
    let lastTime = 0;

    const loop = (time: number) => {
      if (!lastTime) {
        lastTime = time;
      }
      const dt = time - lastTime;
      if (dt >= FRAME_INTERVAL_MS) {
        lastTime = time;
        const baseState = latestState.current;
        const renderState =
          baseState.mode === "personal"
            ? buildInterpolatedState(baseState)
            : baseState;
        renderScene({
          ctx,
          state: renderState,
          width: logicalWidth,
          height: logicalHeight,
        });
      }
      animationRef.current = requestAnimationFrame(loop);
    };

    animationRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", resize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updatePointer = (x: number, y: number) => {
      const rect = canvas.getBoundingClientRect();
      const pointer = {
        // 고해상도 캔버스에서도 입력 좌표는 CSS 크기 기준으로 정규화
        x: x - rect.left - rect.width / 2,
        y: y - rect.top - rect.height / 2,
      };
      // 컨트롤러: 포인터를 화면 중심 기준으로 정규화 → 원하는 속도 계산
      const nx = Math.max(-1, Math.min(1, pointer.x / (rect.width * 0.25)));
      const ny = Math.max(-1, Math.min(1, pointer.y / (rect.height * 0.25)));
      const CLIENT_MAX_SPEED = 320; // 서버 MAX_SPEED와 동일하게 유지
      const controlVelocity = {
        x: nx * CLIENT_MAX_SPEED,
        y: ny * CLIENT_MAX_SPEED,
      };
      dispatch({
        type: "SET_INPUT",
        input: {
          pointer,
          pointerActive: true,
          lastHeartbeat: Date.now(),
          controlVelocity,
        },
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      updatePointer(event.clientX, event.clientY);
    };

    const handlePointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      updatePointer(event.clientX, event.clientY);
    };

    const handlePointerUp = () => {
      dispatch({
        type: "SET_INPUT",
        input: { pointerActive: false, controlVelocity: { x: 0, y: 0 } },
      });
    };

    const handleTouchMove = (event: TouchEvent) => {
      preventScrollOnTouch(event);
      const pointer = computePointerFromEvent(event, canvas);
      if (!pointer) return;
      dispatch({ type: "SET_TARGET", target: pointer });
      dispatch({
        type: "SET_INPUT",
        input: {
          pointer,
          pointerActive: true,
          lastHeartbeat: Date.now(),
        },
      });
    };

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerUp);
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });

    return () => {
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerUp);
      canvas.removeEventListener("touchmove", handleTouchMove);
    };
  }, [dispatch]);

  useEffect(() => {
    if (!socket) return;
    if (typeof window === "undefined") return;

    const emitResize = () => {
      socket.emit("windowResized", {
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
      });
    };

    const remove = addResizeListener(emitResize, { immediate: true });
    return () => {
      remove?.();
    };
  }, [socket]);

  const shouldShowIframe = isDebugView ? true : isProjectReady;

  // NoiseCraft 파라미터 브리지: 실제 플레이어 속도 → 주파수 매핑
  useEffect(() => {
    if (!socket) return;
    if (!isDebugView) return;

    const MIN = 100; // Hz
    const MAX = 2000; // Hz
    const MAX_SPEED = 320; // 서버 최고 속도와 일치
    let raf: number | null = null;
    let lastSent = 0;

    const tick = () => {
      const now = performance.now();
      if (now - lastSent >= 33) {
        const s = latestState.current;
        const selfId = s.selfId;
        const self = selfId ? s.players[selfId] : undefined;
        const vx = self?.cell.velocity.x ?? 0;
        const vy = self?.cell.velocity.y ?? 0;
        const mag = Math.min(1, Math.hypot(vx, vy) / MAX_SPEED);
        const value = MIN + (MAX - MIN) * mag;
        socket.emit("param", {
          type: "setParam",
          nodeId: "0",
          paramName: "value",
          value,
        });
        lastSent = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [socket, isDebugView]);

  const handleStartAudio = () => {
    if (!audioIframeRef.current) return;
    setAudioStatus("pending");
    audioIframeRef.current.contentWindow?.postMessage(
      { type: "noiseCraft:play" },
      noiseCraftOrigin || "*"
    );
  };

  return (
    <div className="relative min-h-screen w-full bg-black">
      <CanvasSurface ref={canvasRef} />
      {/* <Hud state={state} /> */}
      {/* <StatusBanner state={state} /> */}
      {/* <Controls /> */}
      <div className="pointer-events-auto absolute bottom-4 left-4 flex h-auto w-[340px] flex-col gap-2 rounded-xl bg-black/80 p-3 text-xs text-white">
        <iframe
          ref={audioIframeRef}
          src={noiseCraftSrc}
          width={isDebugView ? 1800 : 220}
          height={isDebugView ? 500 : 56}
          allow="autoplay"
          title="NoiseCraft Personal"
          className={
            shouldShowIframe
              ? isDebugView
                ? "h-[500px] w-[1800px] opacity-100"
                : "h-[56px] w-[220px] opacity-100"
              : "h-0 w-0 opacity-0 pointer-events-none"
          }
          style={{ border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8 }}
        />
        {/* <button
          type="button"
          onClick={handleStartAudio}
          disabled={audioStatus === "pending" || audioStatus === "playing"}
          className="mt-2 w-full rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:bg-white/60"
        >
          {audioStatus === "pending"
            ? "시작 중…"
            : audioStatus === "playing"
            ? "재생 중"
            : "Start Audio"}
        </button> */}
        {/* <p className="text-white/50">Tap “Start Audio” inside panel.</p> */}
      </div>
    </div>
  );
};

export default MobileView;

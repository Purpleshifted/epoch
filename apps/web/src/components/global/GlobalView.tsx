"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGameClient } from "@/lib/game/hooks";
import { renderScene } from "@/lib/game/renderer";
import CanvasSurface from "@/components/shared/CanvasSurface";
import {
  buildNoiseCraftParams,
  postNoiseCraftParams,
  resolveNoiseCraftEmbed,
} from "@/lib/audio/noiseCraft";
import { analyzeClusters } from "@/lib/game/clusters";

type ProjectionMode = "plane" | "lines";

const TRANSITION_DURATION = 600;

const GlobalView = () => {
  const { state, players, dispatch } = useGameClient("global");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const latestState = useRef(state);
  const [projection, setProjection] = useState<ProjectionMode>("plane");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [noiseCraftOrigin, setNoiseCraftOrigin] = useState<string | null>(null);
  const [noiseCraftSrc, setNoiseCraftSrc] = useState("about:blank");
  const transitionRef = useRef<{
    from: ProjectionMode;
    to: ProjectionMode;
    start: number;
  } | null>(null);
  const { clusters: clusterSummaries, assignments: clusterAssignments } =
    useMemo(() => analyzeClusters(players), [players]);
  const significantClusters = useMemo(
    () => clusterSummaries.filter((cluster) => cluster.isMulti),
    [clusterSummaries]
  );

  useEffect(() => {
    latestState.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const overlayWidth = 256;
      const zoom = Math.min(
        (canvas.width - overlayWidth) / state.gameSize.width,
        canvas.height / state.gameSize.height
      );
      dispatch({
        type: "SET_CAMERA",
        camera: {
          position: {
            x: state.gameSize.width / 2,
            y: state.gameSize.height / 2,
          },
          zoom,
        },
      });
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = () => {
      let transition: {
        from: ProjectionMode;
        to: ProjectionMode;
        progress: number;
      } | null = null;
      const t = transitionRef.current;
      if (t) {
        const progress = Math.min(
          1,
          (performance.now() - t.start) / TRANSITION_DURATION
        );
        transition = { ...t, progress };
        if (progress >= 1) {
          transitionRef.current = null;
        }
      }

      renderScene({
        ctx,
        state: latestState.current,
        width: canvas.width,
        height: canvas.height,
        projection,
        transition,
      });
      animationRef.current = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      window.removeEventListener("resize", resize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [dispatch, state.gameSize.height, state.gameSize.width, projection]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const { src, origin } = resolveNoiseCraftEmbed();
    setNoiseCraftSrc(src);
    setNoiseCraftOrigin(origin);
    if (iframeRef.current) {
      iframeRef.current.src = src;
    }
  }, []);

  useEffect(() => {
    if (!noiseCraftOrigin) return;
    const params = buildNoiseCraftParams(
      state.audio,
      state.noiseSlots,
      "global"
    );
    postNoiseCraftParams(iframeRef.current, noiseCraftOrigin, params);
  }, [state.audio, noiseCraftOrigin]);

  const handleProjectionChange = (mode: ProjectionMode) => {
    if (mode === projection) return;
    transitionRef.current = {
      from: projection,
      to: mode,
      start: performance.now(),
    };
    setProjection(mode);
  };

  return (
    <div className="relative min-h-screen w-full bg-slate-950">
      <CanvasSurface ref={canvasRef} className="bg-black" />
      {/* NoiseCraft Embedded (Socket.IO 제어) */}
      <div className="pointer-events-auto absolute bottom-4 right-4 rounded-xl bg-black/60 p-2 text-xs text-white">
        <div className="mb-2 text-white/70">NoiseCraft</div>
        <iframe
          ref={iframeRef}
          src={noiseCraftSrc}
          width="420"
          height="120"
          style={{ border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8 }}
          allow="autoplay"
          title="NoiseCraft Embedded"
        ></iframe>
        <div className="mt-2 text-white/50">iframe 안에서 Start Audio 클릭</div>
      </div>
      <div className="pointer-events-auto absolute right-6 top-6 flex gap-2">
        <button
          type="button"
          onClick={() => handleProjectionChange("plane")}
          className={`rounded-full px-4 py-2 text-sm ${
            projection === "plane"
              ? "bg-white text-black"
              : "bg-white/10 text-white/70"
          }`}
        >
          Plane
        </button>
        <button
          type="button"
          onClick={() => handleProjectionChange("lines")}
          className={`rounded-full px-4 py-2 text-sm ${
            projection === "lines"
              ? "bg-white text-black"
              : "bg-white/10 text-white/70"
          }`}
        >
          Lines
        </button>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-6">
        <div className="pointer-events-auto w-full max-w-5xl rounded-2xl bg-black/70 p-5 text-white">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-white/70">
            <div>
              <p className="text-[10px] uppercase tracking-[0.45em] text-blue-300">
                Spectator
              </p>
              <p className="text-base font-semibold text-white">
                실시간 참여자
              </p>
            </div>
            <span>인원 {state.ui.population.toLocaleString()}</span>
          </div>
          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-[0.35em] text-emerald-300">
              Clusters
            </p>
            {significantClusters.length === 0 ? (
              <p className="mt-2 text-xs text-white/50">
                아직 근접한 클러스터가 없습니다.
              </p>
            ) : (
              <div className="mt-2 flex gap-3 overflow-x-auto pb-1 pr-2 text-xs text-white/80">
                {significantClusters.map((cluster) => (
                  <div
                    key={cluster.id}
                    className="min-w-[200px] rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <div className="flex items-center justify-between text-white">
                      <span className="font-medium">{cluster.label}</span>
                      <span className="text-[11px] text-white/60">
                        {cluster.memberCount}명
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-white/60">
                      중심 ({cluster.centroid.x.toFixed(0)},{" "}
                      {cluster.centroid.y.toFixed(0)})
                    </p>
                    <p className="mt-1 text-[11px] text-white/50">
                      참여자{" "}
                      {cluster.members
                        .map((member) => member.name || "익명")
                        .join(", ")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.35em] text-sky-300">
                Participants
              </p>
            </div>
            {players.length === 0 ? (
              <p className="mt-2 text-xs text-white/40">연결 대기 중...</p>
            ) : (
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1 pr-2 text-xs">
                {players.map((player) => {
                  const clusterInfo = clusterAssignments.get(player.id);
                  const clusterLabel = clusterInfo
                    ? `${clusterInfo.label}${
                        clusterInfo.isMulti
                          ? ` · ${clusterInfo.memberCount}명`
                          : ""
                      }`
                    : "단독";
                  return (
                    <div
                      key={player.id}
                      className="flex min-w-[180px] flex-col rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <span className="text-white">
                        {player.name || "익명"}
                      </span>
                      <span className="text-[11px] text-white/60">
                        {clusterLabel} · 좌표 (
                        {player.cell.position.x.toFixed(0)},{" "}
                        {player.cell.position.y.toFixed(0)})
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GlobalView;

/**
 * RECORDING THE HERO SHOT (the artist, 2026-11-28: "히어로샷에서 gif 녹화모드 가능한지 …"; of the three ways brought to
 * her — in real time, a timelapse of large stills, the same encoded in the browser — "아니다 실시간"): the dashed frame
 * recorded as it plays, at the screen's own pixels, into one video file.
 *
 *   - Each frame, right after the scene is drawn (r3f's after-effects: the same task, so the picture is still in the
 *     canvas whatever preserveDrawingBuffer says), the frame's part of the canvas is copied into a canvas of its own,
 *     and that canvas's stream takes exactly that frame (captureStream(0) + requestFrame): one video frame per frame
 *     drawn, at the time it was drawn. So the video is as smooth as the screen is — the mode's best render is heavy;
 *     the line on the frame says the frames a second while it records.
 *   - The browser's own encoder (MediaRecorder): H.264 in an MP4 where the browser has it, else WebM, at the bitrate of
 *     녹화 화질. The picture as drawn, capped at 4096 × 2304 worth of pixels (what an H.264 encoder takes).
 *   - The markers and the frame's dashes are not in the canvas: never recorded. While a PNG is saved (the canvas then
 *     stands on the frame alone) no frame is taken: the video jumps over it.
 *   - The same button stops it and the file downloads (hero-<date>-<w>x<h>.mp4); turning the mode off, or the GPU
 *     giving up, stops and saves it too. A new 사진 모양 is a new file.
 *
 * Outside HeroShot.tsx on purpose (another session edits it): the inputs join its 히어로샷 group (Leva merges a group's
 * inputs from several hooks, and the group's settings are those of the first — useHeroShot, called just before).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { addAfterEffect, useThree } from "@react-three/fiber";
import { button, useControls } from "leva";
import { heroRect } from "./HeroShot";

const GROUP = "히어로샷"; // (never saved, as the rest of the group)

/** What an H.264 encoder takes (level 5.1: 4096 × 2304); a larger frame is scaled down to it. */
const MAX_SIDE = 4096;
const MAX_PIXELS = 4096 * 2304;

/** H.264 in MP4 first (Chrome 126+), WebM where not. */
const TYPES = [
  "video/mp4;codecs=avc1.640033",
  "video/mp4;codecs=avc1.4d0033",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

// the line on the frame — outside React's state, so that its once-a-second change redraws only the line
let line = "";
const listeners = new Set<() => void>();
function say(s: string) {
  line = s;
  listeners.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

export interface HeroRecord {
  /** Recording now. */
  on: boolean;
  /** The bitrate, in Mbit/s. */
  mbps: number;
}

/** The recording's inputs in the 히어로샷 group, and whether it records (only while the mode is on). */
export function useHeroRecord(enabled: boolean, heroOn: boolean): HeroRecord {
  const [on, setOn] = useState(false);
  const toggle = useRef(() => {});
  const k = useControls(
    GROUP,
    {
      recMbps: {
        value: 40,
        min: 8,
        max: 120,
        step: 1,
        label: "녹화 화질 (Mbps · 40이면 1분에 약 300 MB)",
        render: (get: (path: string) => unknown) => get(`${GROUP}.on`) === true,
      },
      "녹화 시작 / 멈춤 (점선 안을 지금 화면 그대로 영상으로 · 멈추면 내려받음)": button(() => toggle.current()),
    },
    { order: 0.4, collapsed: false, render: () => enabled },
  );
  toggle.current = () => {
    if (!enabled) return;
    if (!heroOn) {
      say("녹화는 히어로샷 모드에서만 (모드를 켜고 다시)");
      return;
    }
    setOn((x) => !x);
  };
  // the mode off: the recording stops (and saves)
  useEffect(() => {
    if (!heroOn) setOn(false);
  }, [heroOn]);
  return { on: on && heroOn && enabled, mbps: k.recMbps as number };
}

/** The recording's line on the frame (HeroFrame's children). */
export function HeroRecordLine() {
  const s = useSyncExternalStore(subscribe, () => line, () => "");
  return s ? <div>{s}</div> : null;
}

/**
 * Inside the Canvas, mounted while it records: the recorder from mount to unmount (unmounting stops it and the file
 * downloads). `aspect` / `fill` are the frame's (HeroShot); `paused` while a PNG is being saved.
 */
export function HeroRecordTap({ aspect, fill, mbps, paused }: { aspect: number; fill: number; mbps: number; paused: boolean }) {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const live = useRef({ fill, paused, mbps });
  live.current = { fill, paused, mbps };
  useEffect(() => {
    const src = gl.domElement;
    // the frame's part of the canvas, in the canvas's pixels (it follows 점선 영역 크기 and the window)
    const region = () => {
      const { size } = get();
      const r = heroRect(size.width, size.height, aspect, live.current.fill);
      const k = src.width / Math.max(1, size.width);
      return { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k };
    };
    const r0 = region();
    const s = Math.min(1, MAX_SIDE / r0.w, MAX_SIDE / r0.h, Math.sqrt(MAX_PIXELS / Math.max(1, r0.w * r0.h)));
    // (even sides: H.264 takes no odd ones)
    const outW = Math.max(2, 2 * Math.round((r0.w * s) / 2));
    const outH = Math.max(2, 2 * Math.round((r0.h * s) / 2));
    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    // (in the page but unseen: a canvas left out of the document may give its stream no frames)
    Object.assign(out.style, { position: "fixed", left: "0", top: "0", width: "2px", height: "2px", opacity: "0", pointerEvents: "none" });
    document.body.appendChild(out);
    const ctx = out.getContext("2d", { alpha: false });
    const type = typeof MediaRecorder === "undefined" ? undefined : TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    if (!ctx || !type || typeof out.captureStream !== "function") {
      out.remove();
      say("녹화 못 함: 이 브라우저는 캔버스 녹화를 지원하지 않음 (크롬 최신판에서)");
      return;
    }
    const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
    const stream = out.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: Math.round(live.current.mbps * 1e6) });
    } catch (e) {
      track.stop();
      out.remove();
      say(`녹화 못 함: ${(e as Error).message}`);
      return;
    }
    const chunks: Blob[] = [];
    let bytes = 0;
    let frames = 0;
    const t0 = performance.now();
    let lastAt = t0;
    let lastFrames = 0;
    let stopped = false;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
        bytes += e.data.size;
      }
    };
    rec.onstop = () => {
      track.stop();
      out.remove();
      const sec = (performance.now() - t0) / 1000;
      const blob = new Blob(chunks, { type: type.split(";")[0] });
      if (!blob.size || frames === 0) {
        say("녹화 저장 안 함: 받은 프레임이 없음");
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `hero-${stamp()}-${outW}x${outH}.${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
      say(`녹화 저장함: ${clock(sec)} · ${frames} 프레임 · ${outW} × ${outH} · ${mb(blob.size)} (${ext.toUpperCase()})`);
    };
    rec.onerror = () => say("녹화 중 오류 — 멈추고 받은 데까지 저장");
    // (a slice a second: the file is not held as one piece until the end)
    rec.start(1000);
    say(`● 녹화 시작 · ${outW} × ${outH} · ${ext.toUpperCase()} · ${live.current.mbps} Mbps`);
    const off = addAfterEffect(() => {
      if (stopped || live.current.paused) return;
      const r = region();
      ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, outW, outH);
      track.requestFrame();
      frames++;
      const now = performance.now();
      if (now - lastAt >= 1000) {
        const fps = ((frames - lastFrames) * 1000) / (now - lastAt);
        lastAt = now;
        lastFrames = frames;
        say(`● 녹화 중 ${clock((now - t0) / 1000)} · ${fps.toFixed(0)} fps · ${outW} × ${outH} · ${mb(bytes)} — 같은 버튼을 다시 누르면 멈추고 내려받음`);
      }
    });
    const stop = () => {
      if (stopped) return;
      stopped = true;
      off();
      src.removeEventListener("webglcontextlost", stop);
      if (rec.state !== "inactive") rec.stop();
    };
    // the GPU gave up: what was recorded is saved
    src.addEventListener("webglcontextlost", stop);
    return stop;
  }, [gl, get, aspect]);
  return null;
}

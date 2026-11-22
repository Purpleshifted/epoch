"use client";
/**
 * RecPlayer — plays one recording: play / pause, a progress bar with the record's moments as dots (a tap goes
 * there), and the lines themselves (a tap goes there too). From the Worker first, then this device's own copy.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RECORDING_ID, fmtBytes, fmtRecClock, type RecordingMarker, type RecordingMeta } from "@/lib/sound/recorder";
import { getRecording } from "@/lib/sound/recordingStore";
import { recordingAudioUrl, recordingMetaUrl } from "@/lib/sound/recordingUpload";

/** What a marker without words of its own says. */
const KIND_TEXT: Record<string, string> = { name: "이름 — 멜로디", "life.begin": "삶이 시작됨", ended: "끝" };
const ENDED_BY: Record<string, string> = { lifespan: "수명이 다함", self: "스스로 그만 삶" };

function markerText(e: RecordingMarker): string {
  if (e.kind === "ended") return `${KIND_TEXT.ended} — ${ENDED_BY[e.text] ?? e.text}`;
  return e.text || KIND_TEXT[e.kind] || e.kind;
}

type Source = { src: string; meta: RecordingMeta | null; from: "server" | "local" };

/** The card shows its QR from the moment the life ends; the recording goes up once the reverb has rung out (2026-11-22).
 * A page opened before that looks again every WAIT_MS, for WAIT_TRIES times (about three minutes), then says so. */
const WAIT_MS = 4000;
const WAIT_TRIES = 45;

export default function RecPlayer({ id }: { id: string }) {
  const [source, setSource] = useState<Source | null>(null);
  const [state, setState] = useState<"loading" | "waiting" | "ready" | "missing">(() => (RECORDING_ID.test(id) ? "loading" : "missing"));
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    if (!RECORDING_ID.test(id)) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      for (let i = 0; i < WAIT_TRIES && !cancelled; i++) {
        try {
          const head = await fetch(recordingAudioUrl(id), { method: "HEAD", cache: "no-store" });
          if (head.ok) {
            const meta = await fetch(recordingMetaUrl(id), { cache: "no-store" })
              .then((r) => (r.ok ? (r.json() as Promise<RecordingMeta>) : null))
              .catch(() => null);
            if (!cancelled) {
              setSource({ src: recordingAudioUrl(id), meta, from: "server" });
              setState("ready");
            }
            return;
          }
        } catch {
          /* the Worker is not there (yet): this device's own copy */
        }
        const row = await getRecording(id);
        if (cancelled) return;
        if (row) {
          objectUrl = URL.createObjectURL(row.blob);
          setSource({ src: objectUrl, meta: row.meta, from: "local" });
          setState("ready");
          return;
        }
        // not up yet (the life's reverb is still ringing, or the upload is on its way): look again
        setState("waiting");
        await new Promise((r) => setTimeout(r, WAIT_MS));
      }
      if (!cancelled) setState("missing");
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  // a MediaRecorder file may not say how long it is (WebM: Infinity): the markers' file does
  const length = Number.isFinite(dur) && dur > 0 ? dur : (source?.meta?.seconds ?? 0);
  const events = source?.meta?.events ?? [];

  const seek = useCallback((to: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = Math.max(0, to);
    setT(a.currentTime);
    if (a.paused) void a.play().catch(() => {});
  }, []);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  };

  const onBar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!length) return;
    const r = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * length);
  };

  // the line being heard now: the last one at or before t
  let at = -1;
  for (let i = 0; i < events.length; i++) if (events[i].t <= t + 0.05) at = i;

  return (
    <main className="min-h-[100dvh] bg-black px-4 py-6 font-mono text-[14px] leading-[1.45] text-white">
      <div className="mx-auto w-full max-w-[34rem]">
        <div className="text-[#8c8c8c]">기록된 소리 · {id}</div>
        {state === "loading" && <div className="mt-8 text-[#8c8c8c]">불러오는 중…</div>}
        {state === "waiting" && <div className="mt-8 text-[#8c8c8c]">녹음이 올라오기를 기다리는 중… 삶의 잔향이 다 울리면 올라옵니다.</div>}
        {state === "missing" && <div className="mt-8">이 기록은 아직 없습니다.</div>}
        {state === "ready" && source && (
          <>
            <audio
              ref={audio}
              src={source.src}
              preload="metadata"
              playsInline
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
              onDurationChange={(e) => setDur(e.currentTarget.duration)}
            />
            <div className="mt-6 flex items-center gap-4">
              <button type="button" onClick={toggle} className="w-20 border border-white px-3 py-2 text-center active:bg-white active:text-black">
                {playing ? "멈춤" : "재생"}
              </button>
              <div className="tabular-nums">
                {fmtRecClock(t)} / {fmtRecClock(length)}
              </div>
            </div>
            <div className="relative mt-5 h-10 cursor-pointer touch-none select-none" onPointerDown={onBar}>
              <div className="absolute inset-x-0 top-1/2 h-px bg-[#555]" />
              <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 bg-white" style={{ width: `${length ? Math.min(100, (t / length) * 100) : 0}%` }} />
              {length > 0 &&
                events.map((e, i) => (
                  <div
                    key={i}
                    className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 ${e.level === 2 ? "h-4 w-[3px] bg-white" : e.level === 1 ? "h-3 w-[2px] bg-white" : "h-2 w-px bg-[#8c8c8c]"}`}
                    style={{ left: `${Math.min(100, (e.t / length) * 100)}%` }}
                  />
                ))}
            </div>
            <ol className="mt-4 border-t border-[#333]">
              {events.map((e, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => seek(e.t)}
                    className={`flex w-full gap-3 border-b border-[#222] py-1.5 text-left ${i === at ? "bg-white text-black" : (e.level ?? 0) >= 1 ? "text-white" : "text-[#8c8c8c]"}`}
                  >
                    <span className="shrink-0 tabular-nums">{fmtRecClock(e.t)}</span>
                    <span className="min-w-0">{markerText(e)}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="mt-4 text-[12px] text-[#666]">
              {source.meta ? `${new Date(source.meta.startedAt).toLocaleString("ko-KR")} · ${fmtBytes(source.meta.bytes)}` : ""}
              {source.from === "local" ? " · 이 기기에 보관된 사본" : ""}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

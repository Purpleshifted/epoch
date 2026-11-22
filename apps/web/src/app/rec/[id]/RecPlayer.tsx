"use client";
/**
 * RecPlayer — the page the specimen card's QR opens (the design canvas's "QR로 여는 페이지", mixed in 2026-11-22: the
 * artist, "재생 누르면 분기점 지나거나 클릭할 때만 아래 한 줄 ui로 계속 바뀌면서 정보 보여주고, 그 아래는 요약본(발굴노트)이랑
 * 웹포스터로 가는 링크"): the title and the day, the being's number and melody, the player — play / pause, a bar with
 * the record's moments as marks (a tap goes there) — and under it ONE line: the moment last passed while playing, or
 * the one tapped. Then the ways on: the 발굴노트 (/rec/<id>/note), the web poster, the gallery. From the Worker first,
 * then this device's own copy.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet, SheetFoot, SheetHead, SheetLinks, SHEET_WORDS, WEB_POSTER } from "@/components/parliament/RecSheet";
import { asLang, individualNo as individualNoOf } from "@/lib/parliament";
import { RECORDING_ID, fmtRecClock, type RecordingMarker, type RecordingMeta } from "@/lib/sound/recorder";
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
  /** The one line under the player: the moment last passed while playing, or the one tapped (-1: none yet). */
  const [shown, setShown] = useState(-1);
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
  const note = source?.meta?.note;
  const lang = asLang(typeof note?.lang === "string" ? note.lang : null);
  const W = SHEET_WORDS[lang];
  const startedAt = source?.meta?.startedAt ? Date.parse(source.meta.startedAt) : 0;

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

  // while playing, the line follows the moments as they are passed
  const onTime = (now: number) => {
    setT(now);
    if (!playing) return;
    let at = -1;
    for (let i = 0; i < events.length; i++) if (events[i].t <= now + 0.05) at = i;
    if (at !== shown && at >= 0) setShown(at);
  };

  const line = shown >= 0 && events[shown] ? events[shown] : null;

  return (
    <Sheet>
      <SheetHead lang={lang} me={RECORDING_ID.test(id) ? id : ""} at={startedAt} />
      {state === "loading" && <div className="text-[#6b6b66]">{W.loading}</div>}
      {state === "waiting" && <div className="text-[#6b6b66]">{W.waiting}</div>}
      {state === "missing" && <div>{W.missing}</div>}
      {state === "ready" && source && (
        <div className="flex flex-col gap-3">
          <audio
            ref={audio}
            src={source.src}
            preload="metadata"
            playsInline
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
            onDurationChange={(e) => setDur(e.currentTarget.duration)}
          />
          <div className="flex items-center gap-4 border-y border-[#111111] py-4">
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? W.pause : W.play}
              className="flex h-11 w-11 shrink-0 items-center justify-center border border-[#111111] bg-white outline-none active:bg-[#111111] active:text-white"
            >
              <svg viewBox="0 0 12 12" aria-hidden className="block h-3.5 w-3.5">
                {playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor" /> : <path d="M2 1l9 5-9 5z" fill="currentColor" />}
              </svg>
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span>{RECORDING_ID.test(id) ? W.who(id ? individualNoOf(id) : "") : ""}</span>
              <span className="text-[#6b6b66]">{W.listen}</span>
              {/* the bar, the record's moments as marks on it (the bigger the moment, the taller); a tap goes there */}
              <div className="relative h-6 cursor-pointer touch-none select-none" onPointerDown={onBar}>
                <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-[#d9d9d4]" />
                <div className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 bg-[#111111]" style={{ width: `${length ? Math.min(100, (t / length) * 100) : 0}%` }} />
                {length > 0 &&
                  events.map((e, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-label={`${fmtRecClock(e.t)} ${markerText(e)}`}
                      onPointerDown={(ev) => {
                        ev.stopPropagation();
                        setShown(i);
                        seek(e.t);
                      }}
                      className="absolute top-0 flex h-6 w-3 -translate-x-1/2 items-center justify-center outline-none"
                      style={{ left: `${Math.min(100, (e.t / length) * 100)}%` }}
                    >
                      <span className={`block ${i === shown ? "bg-[#111111]" : (e.level ?? 0) >= 1 ? "bg-[#111111]" : "bg-[#9a9a94]"} ${(e.level ?? 0) >= 2 ? "h-4 w-[3px]" : (e.level ?? 0) === 1 ? "h-3 w-[2px]" : "h-2 w-px"}`} />
                    </button>
                  ))}
              </div>
              <span className="text-[11px] tabular-nums text-[#6b6b66]">
                {fmtRecClock(t)} / {fmtRecClock(length)}
                {source.from === "local" ? ` · ${W.local}` : ""}
              </span>
            </div>
          </div>
          {/* the one line: the moment just passed, or tapped */}
          <div className="flex min-h-[1.5em] gap-3" aria-live="polite">
            {line && (
              <>
                <span className="shrink-0 tabular-nums text-[#6b6b66]">{fmtRecClock(line.t)}</span>
                <span className="min-w-0">{markerText(line)}</span>
              </>
            )}
          </div>
        </div>
      )}
      <SheetLinks
        links={[
          { href: `/rec/${encodeURIComponent(id)}/note`, label: W.note, sub: W.noteSub },
          { href: WEB_POSTER, label: W.poster, sub: W.posterSub, external: true },
          { href: "/exhibition/gallery", label: W.gallery, sub: W.gallerySub },
        ]}
      />
      <SheetFoot lang={lang} />
    </Sheet>
  );
}

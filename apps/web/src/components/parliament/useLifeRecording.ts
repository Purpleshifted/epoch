"use client";
/**
 * useLifeRecording — one life's sound, recorded as it was heard (the artist, 2026-11-21: a recording, not a replay),
 * kept here, sent up, and given an address the specimen card's QR can carry. docs/recording.md.
 *
 *   NAME   → the recorder starts on the engine's tap (engine.ts tapOutput: the limiter's output, the headset's mix,
 *            nothing else — no microphone) the moment the engine is running; the name's melody is the first thing on it
 *   LIVE   → a marker; from here the record's lines (SessionHud → lifeEvents.ts) become markers with the second they
 *            came up; the recordings still waiting from earlier lives are retried behind this one
 *   ENDED  → a marker with how the life ended; the recorder runs on until the afterlife's reverb has rung out
 *            (engine.afterlifeOver, or `죽음의 잔향` + 4 s if the engine never says), then stops
 *   stop   → the Blob goes into IndexedDB under the life's id FIRST (recordingStore.ts), then up to the Worker
 *            (recordingUpload.ts); `url` is set only once it is there — a QR to nothing is worse than none
 *   a visitor who walks away at the name screen (back to IDLE without living) leaves no recording; the next visitor
 *   arriving before the tail is out ends the previous recording where it is
 *
 * The state is also in a small store outside React (useLifeRecordingState) so the end screen's card — drawn by
 * another session — can read it wherever it sits, without a prop through SessionHud.
 */

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import type { LifeSession } from "./useLifeSession";
import type { SoundSetup } from "./useSound";
import type { Visitor } from "./RoleField";
import { onLifeEvent } from "./lifeEvents";
import { LifeRecorder, recStatusLine, recordingFormatHere, tidyMarkers, type RecordingMarker, type RecordingMeta } from "@/lib/sound/recorder";
import { markUploaded, putRecording } from "@/lib/sound/recordingStore";
import { recordingPageUrl, retryPendingUploads, uploadRecording } from "@/lib/sound/recordingUpload";

export type LifeRecordingPhase = "idle" | "recording" | "uploading" | "done" | "failed";

export interface LifeRecordingState {
  phase: LifeRecordingPhase;
  /** The life's id (the visitor's: RoleField `me`), empty when idle. */
  id: string;
  seconds: number;
  bytes: number;
  /** The page the card's QR points to (`/rec/<id>` on this app) — only once the upload is through. */
  url?: string;
  /** This machine's copy (an object URL) for a download on the end screen; there whether or not the upload went. */
  localUrl?: string;
  /** The download's file extension (m4a / webm). */
  ext?: string;
  /** The audio went up (false after a failed upload: kept here, retried behind the next life). */
  uploaded: boolean;
  /** Why it failed, or why the upload did not go. */
  note?: string;
  /** One line for the status: `REC 1:32 · 1.1 MB` (+ a note after the end). */
  line: string;
}

const IDLE: LifeRecordingState = { phase: "idle", id: "", seconds: 0, bytes: 0, uploaded: false, line: "" };

let current: LifeRecordingState = IDLE;
const subs = new Set<() => void>();
function publish(s: LifeRecordingState) {
  current = s;
  for (const fn of subs) fn();
}
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
const read = () => current;
const readServer = () => IDLE;

/** The recording's state from anywhere (the end screen's card): the same object the hook returns. */
export function useLifeRecordingState(): LifeRecordingState {
  return useSyncExternalStore(subscribe, read, readServer);
}

export interface LifeRecordingOptions {
  /** Leva `녹음`. */
  on: boolean;
  /** Leva `녹음 비트레이트` (kbps). */
  kbps: number;
}

const TICK_MS = 250;
/** How long past the end the recorder waits for the engine to say the tail is out before stopping anyway (s). */
const TAIL_GRACE_SEC = 4;

interface Run {
  id: string;
  sessionNo: number;
  rec: LifeRecorder;
  events: RecordingMarker[];
  startedAt: number;
  /** The life began (LIVE was seen). */
  lived: boolean;
  /** Wall ms the end was seen (0 = not yet). */
  endedAt: number;
  off: () => void;
}

let lastLocalUrl: string | null = null;

/** The recorder stopped: keep, upload, say so. Runs on after the hook has let go of the run. */
async function finish(r: Run, ext: string): Promise<void> {
  const seconds = r.rec.seconds;
  const base = { id: r.id, seconds: +seconds.toFixed(1), uploaded: false, ext };
  let blob: Blob;
  try {
    blob = await r.rec.stop();
  } catch (e) {
    publish({ ...IDLE, ...base, phase: "failed", note: `녹음 실패 (${(e as Error)?.message ?? e})`, line: recStatusLine(seconds, 0, "녹음 실패") });
    return;
  }
  const meta: RecordingMeta = {
    id: r.id,
    startedAt: new Date(r.startedAt).toISOString(),
    seconds: +seconds.toFixed(2),
    bytes: blob.size,
    mime: blob.type || r.rec.format.mime,
    events: tidyMarkers(r.events, seconds),
  };
  if (lastLocalUrl) URL.revokeObjectURL(lastLocalUrl);
  const localUrl = URL.createObjectURL(blob);
  lastLocalUrl = localUrl;
  const kept = await putRecording(r.id, blob, meta);
  publish({ ...base, phase: "uploading", bytes: blob.size, localUrl, line: recStatusLine(seconds, blob.size, "올리는 중") });
  try {
    await uploadRecording(r.id, blob, meta);
    if (kept) await markUploaded(r.id);
    const url = recordingPageUrl(r.id);
    publish({ ...base, phase: "done", bytes: blob.size, localUrl, url, uploaded: true, line: recStatusLine(seconds, blob.size, url.replace(/^https?:\/\//, "")) });
  } catch (e) {
    const why = (e as Error)?.message ?? String(e);
    publish({ ...base, phase: "done", bytes: blob.size, localUrl, note: `업로드 실패 (${why})${kept ? " · 로컬 보관, 다음 삶 때 재시도" : " · 보관 못 함"}`, line: recStatusLine(seconds, blob.size, kept ? `로컬 보관 · 업로드 실패 ${why}` : `업로드 실패 ${why}`) });
  }
}

/**
 * @param session  the life (null without one: nothing is recorded)
 * @param sound    the headset's engine and knobs (null in V1)
 * @param visitorRef  who this life's visitor is (its id is the recording's)
 */
export function useLifeRecording(session: LifeSession | null, sound: SoundSetup | null, visitorRef: RefObject<Visitor | null>, opts: LifeRecordingOptions): LifeRecordingState {
  const run = useRef<Run | null>(null);
  const live = useRef({ session, sound, opts });
  useEffect(() => {
    live.current = { session, sound, opts };
  }, [session, sound, opts]);
  /** The session a failure was reported for (so it is said once, not four times a second). */
  const failedFor = useRef(-1);

  useEffect(() => {
    let ticks = 0;
    const id = setInterval(() => {
      const { session: s, sound: snd, opts: o } = live.current;
      const r = run.current;
      const now = Date.now();
      if (!s || !snd) {
        if (r) discard(r);
        return;
      }
      if (r) {
        if (r.sessionNo !== s.sessionNo) {
          // the next visitor is here: what was recorded ends where it is
          if (r.lived) end(r);
          else discard(r);
          return;
        }
        if (!r.lived && s.phase !== "name" && s.phase !== "live" && s.phase !== "ended") {
          discard(r); // walked away at the name screen: nothing was lived, nothing is kept
          return;
        }
        if (s.phase === "live" && !r.lived) {
          r.lived = true;
          r.events.push({ t: (now - r.startedAt) / 1000, kind: "life.begin", text: "", level: 0 });
          void retryPendingUploads(r.id);
        } else if (s.phase === "ended" && !r.endedAt) {
          r.endedAt = now;
          r.events.push({ t: (now - r.startedAt) / 1000, kind: "ended", text: s.endedBy ?? "lifespan", level: 2 });
        } else if (s.phase === "ended" && r.endedAt) {
          const tailOut = snd.engine.afterlifeOver || now - r.endedAt > (Math.max(1, snd.params.afterlifeTail) + TAIL_GRACE_SEC) * 1000;
          if (tailOut) {
            end(r);
            return;
          }
        }
        if (++ticks % 4 === 0) publish({ ...current, seconds: r.rec.seconds, bytes: r.rec.bytes, line: recStatusLine(r.rec.seconds, r.rec.bytes) });
        return;
      }
      // nothing running: the name screen is where a recording begins
      if (s.phase !== "name" || !o.on) return;
      const v = visitorRef.current;
      if (!v || v.no !== s.sessionNo) return;
      if (!snd.engine.running) return; // the engine starts on a gesture; it comes
      if (failedFor.current === s.sessionNo) return;
      const format = recordingFormatHere();
      const stream = format ? snd.engine.tapOutput() : null;
      if (!format || !stream) {
        failedFor.current = s.sessionNo;
        publish({ ...IDLE, id: v.id, phase: "failed", note: format ? "엔진에 탭을 달 수 없음" : "이 브라우저는 녹음 형식이 없음 (MediaRecorder)", line: "REC 불가" });
        return;
      }
      try {
        const rec = new LifeRecorder(stream, format, { kbps: o.kbps });
        const events: RecordingMarker[] = [];
        const startedAt = rec.startedAt;
        events.push({ t: 0, kind: "name", text: "", level: 0 });
        const off = onLifeEvent((e) => events.push({ t: (Date.now() - startedAt) / 1000, kind: e.kind, text: e.text, level: e.level }));
        run.current = { id: v.id, sessionNo: s.sessionNo, rec, events, startedAt, lived: false, endedAt: 0, off };
        publish({ ...IDLE, id: v.id, phase: "recording", ext: format.ext, line: recStatusLine(0, 0) });
      } catch (e) {
        failedFor.current = s.sessionNo;
        publish({ ...IDLE, id: v.id, phase: "failed", note: `녹음 시작 실패 (${(e as Error)?.message ?? e})`, line: "REC 불가" });
      }
    }, TICK_MS);

    const end = (r: Run) => {
      run.current = null;
      r.off();
      void finish(r, r.rec.format.ext);
    };
    const discard = (r: Run) => {
      run.current = null;
      r.off();
      r.rec.stop().catch(() => {});
      publish(IDLE);
    };

    return () => {
      clearInterval(id);
      const r = run.current;
      if (r) (r.lived ? end : discard)(r);
    };
  }, [visitorRef]);

  return useLifeRecordingState();
}

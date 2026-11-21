/**
 * recorder.ts — the recording of one life's sound (the artist, 2026-11-21: a RECORDING, not a replay — small, and
 * what was heard that day stays as it was, whatever the engine becomes).
 *
 * What is recorded is the mix that went to the headset and nothing else: the engine's limiter is tapped with a
 * MediaStreamAudioDestinationNode (engine.ts tapOutput — a sink, no processing) and a MediaRecorder encodes that
 * stream off the main thread. The microphone is never opened. The choice of output device (setSinkId) does not
 * matter: the tap is on the node, so the exhibition's headset and a phone record the same way.
 *
 * Pure here: the format choice, the chunks, the Blob, the marker file's shape and the status line's numbers; the hook
 * (components/parliament/useLifeRecording.ts) decides WHEN by the life's phases. docs/recording.md.
 */

/** A moment in the recording: seconds from its start, what kind of line it was, the words. */
export interface RecordingMarker {
  t: number;
  kind: string;
  text: string;
  /** witness.ts LogLevel (0 fact · 1 notable · 2 important) where the line had one. */
  level?: number;
}

/** `/rec/<id>.json` — what goes up beside the audio. */
export interface RecordingMeta {
  id: string;
  /** ISO wall time the recording started (the name's first melody). */
  startedAt: string;
  /** Length of the audio (s). */
  seconds: number;
  bytes: number;
  mime: string;
  events: RecordingMarker[];
}

export interface RecordingFormat {
  mime: string;
  /** The file's extension for a download. */
  ext: string;
}

/**
 * The formats in the order they are tried. MP4/AAC first where the browser can make it: it plays on an iPhone's
 * Safari, which is where the card's QR is opened — WebM/Opus (Chrome's native) does not. At 64 kbps three minutes
 * are about 1.4 MB either way.
 */
export const FORMAT_PREFERENCE: readonly RecordingFormat[] = [
  { mime: "audio/mp4;codecs=mp4a.40.2", ext: "m4a" },
  { mime: "audio/mp4", ext: "m4a" },
  { mime: "audio/webm;codecs=opus", ext: "webm" },
  { mime: "audio/webm", ext: "webm" },
  { mime: "audio/ogg;codecs=opus", ext: "ogg" },
];

/** The first format `isSupported` accepts (MediaRecorder.isTypeSupported), or null when none is. */
export function pickRecordingFormat(isSupported: (mime: string) => boolean, prefer: readonly RecordingFormat[] = FORMAT_PREFERENCE): RecordingFormat | null {
  for (const f of prefer) {
    try {
      if (isSupported(f.mime)) return f;
    } catch {
      /* an older browser throws on an unknown type */
    }
  }
  return null;
}

/** The format this browser will record in (null = no MediaRecorder, or none of the formats). */
export function recordingFormatHere(): RecordingFormat | null {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return null;
  return pickRecordingFormat((m) => MediaRecorder.isTypeSupported(m));
}

/** The chunks into one Blob of the recorder's own type (the container is what the recorder said, not the chunks'). */
export function assembleRecording(chunks: readonly BlobPart[], mime: string): Blob {
  return new Blob([...chunks], { type: mime.split(";")[0] });
}

/** Markers past the audio's end are clamped; nothing before 0; sorted. */
export function tidyMarkers(events: readonly RecordingMarker[], seconds: number): RecordingMarker[] {
  return events
    .map((e) => ({ ...e, t: Math.max(0, Math.min(seconds > 0 ? seconds : e.t, +e.t.toFixed(2))) }))
    .sort((a, b) => a.t - b.t);
}

/** `1:32` */
export function fmtRecClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** `1.1 MB` / `412 KB` */
export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** The status line's one line: `REC 1:32 · 1.1 MB` (+ a note after the end). */
export function recStatusLine(seconds: number, bytes: number, note = ""): string {
  return `REC ${fmtRecClock(seconds)} · ${fmtBytes(bytes)}${note ? ` · ${note}` : ""}`;
}

/** Ids as the visitor's (RoleField `v_` + base36) and anything else short and plain; the Worker checks the same. */
export const RECORDING_ID = /^[a-z0-9_-]{3,40}$/;

export interface LifeRecorderOptions {
  /** Target bitrate (kbps). */
  kbps: number;
  /** How often a chunk arrives (ms): the byte count on the status line, and nothing lost if the tab dies. */
  timesliceMs?: number;
}

/**
 * One recording on one stream. `start()` once; `stop()` resolves with the Blob once the recorder has flushed.
 * `bytes` and `seconds` are live while it runs.
 */
export class LifeRecorder {
  readonly format: RecordingFormat;
  readonly startedAt: number;
  private rec: MediaRecorder;
  private chunks: BlobPart[] = [];
  private total = 0;
  private done: Promise<Blob>;
  private finish!: (b: Blob) => void;
  private fail!: (e: unknown) => void;
  private stopped = false;

  constructor(stream: MediaStream, format: RecordingFormat, opts: LifeRecorderOptions) {
    this.format = format;
    this.rec = new MediaRecorder(stream, { mimeType: format.mime, audioBitsPerSecond: Math.max(8, opts.kbps) * 1000 });
    this.done = new Promise<Blob>((res, rej) => {
      this.finish = res;
      this.fail = rej;
    });
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data);
        this.total += e.data.size;
      }
    };
    this.rec.onerror = (e) => this.fail((e as unknown as { error?: unknown }).error ?? new Error("recorder"));
    this.rec.onstop = () => this.finish(assembleRecording(this.chunks, format.mime));
    this.rec.start(opts.timesliceMs ?? 1000);
    this.startedAt = Date.now();
  }

  get bytes(): number {
    return this.total;
  }

  get seconds(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  get state(): RecordingState {
    return this.rec.state;
  }

  /** Ends the recording; the Blob once the last chunk is in. Safe to call twice. */
  stop(): Promise<Blob> {
    if (!this.stopped) {
      this.stopped = true;
      try {
        if (this.rec.state !== "inactive") this.rec.stop();
        else this.finish(assembleRecording(this.chunks, this.format.mime));
      } catch (e) {
        this.fail(e);
      }
    }
    return this.done;
  }
}

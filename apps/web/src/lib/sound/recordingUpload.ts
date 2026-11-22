/**
 * recordingUpload.ts — where a life's recording goes once it is kept here: the small Worker in relay/recordings
 * (Cloudflare R2 behind it): `PUT /rec/<id>` the audio, `PUT /rec/<id>.json` the markers; the card's QR opens
 * `/rec/<id>` on this app (app/rec/[id]), which plays from the Worker. docs/recording.md.
 *
 * Until the bucket exists (the artist approves it first) every upload fails and the recording stays local; the
 * next life retries what is waiting (retryPendingUploads).
 */

import { RECORDING_ID, type RecordingMeta } from "./recorder";
import { bumpTries, listPending, markUploaded } from "./recordingStore";

/** The Worker (relay/recordings/wrangler.toml); the same account's subdomain as the bot server. */
export const RECORDINGS_URL = (process.env.NEXT_PUBLIC_RECORDINGS ?? "https://anthropocene-recordings.anthropocene-hesse.workers.dev").replace(/\/$/, "");

/** The audio's address on the Worker. */
export const recordingAudioUrl = (id: string) => `${RECORDINGS_URL}/rec/${encodeURIComponent(id)}`;
/** The markers' address on the Worker. */
export const recordingMetaUrl = (id: string) => `${RECORDINGS_URL}/rec/${encodeURIComponent(id)}.json`;

/** The page the QR opens: this app's `/rec/<id>` (the visitor's phone, anywhere). */
export function recordingPageUrl(id: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/rec/${encodeURIComponent(id)}`;
}

/** The Worker's size cap (bytes): three minutes at 64 kbps are ~1.4 MB; 8 MB leaves room for long lives. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Audio first, then the markers (a page with audio and no markers still plays; the other way round it does not).
 * Resolves true when both are up; throws with a short reason otherwise. A part already there (409: an upload cut off
 * between the two, or one that went up from another try) counts as up — so a retry finishes what a cut-off upload
 * left half done (2026-11-22: a recording on the Worker without its markers could never get them).
 */
export async function uploadRecording(id: string, blob: Blob, meta: RecordingMeta, signal?: AbortSignal): Promise<true> {
  if (!RECORDING_ID.test(id)) throw new Error("id");
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error("too large");
  if (blob.size === 0) throw new Error("empty");
  const a = await fetch(recordingAudioUrl(id), { method: "PUT", body: blob, headers: { "Content-Type": blob.type || meta.mime.split(";")[0] }, signal });
  if (!a.ok && a.status !== 409) throw new Error(`audio ${a.status}`);
  const m = await fetch(recordingMetaUrl(id), { method: "PUT", body: JSON.stringify(meta), headers: { "Content-Type": "application/json" }, signal });
  if (!m.ok && m.status !== 409) throw new Error(`meta ${m.status}`);
  return true;
}

let retrying = false;

/**
 * Behind a new life: the recordings still waiting here go up one at a time (at most `max`), `skip` left alone (the
 * life whose upload is running right now). Never twice at once; never throws.
 */
export async function retryPendingUploads(skip = "", max = 3): Promise<number> {
  if (retrying) return 0;
  retrying = true;
  let sent = 0;
  try {
    const rows = await listPending(max + 1);
    for (const row of rows) {
      if (row.id === skip || sent >= max) continue;
      try {
        await uploadRecording(row.id, row.blob, row.meta);
        await markUploaded(row.id);
        sent++;
      } catch {
        await bumpTries(row.id);
      }
    }
  } finally {
    retrying = false;
  }
  return sent;
}

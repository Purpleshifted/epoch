/**
 * recordingStore.ts — the life's recording kept on THIS machine first (IndexedDB), by the life's id, the moment the
 * recorder stops: an upload that fails loses nothing, and the next life retries what is still waiting (the
 * exhibition's machine is pressed again within seconds — the retry runs behind the next visitor). docs/recording.md.
 *
 * Nothing here throws: a browser without IndexedDB (or a private window that refuses it) gets null / false back.
 */

import type { RecordingMeta } from "./recorder";

const DB = "anthropocene-recordings";
const STORE = "recordings";
const VERSION = 1;

export interface StoredRecording {
  id: string;
  blob: Blob;
  meta: RecordingMeta;
  /** Wall ms the recording was stored. */
  storedAt: number;
  /** Wall ms the upload succeeded (0 = still waiting). */
  uploadedAt: number;
  /** Upload attempts so far. */
  tries: number;
  /** The visitor posted or printed the card: this one goes up (and is retried until it does). Otherwise discarded. */
  wanted?: boolean;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      if (typeof indexedDB === "undefined") return res(null);
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: "id" });
          s.createIndex("uploadedAt", "uploadedAt");
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
      req.onblocked = () => res(null);
    } catch {
      res(null);
    }
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((res) => {
        if (!db) return res(null);
        try {
          const t = db.transaction(STORE, mode);
          const req = run(t.objectStore(STORE));
          let out: T | null = null;
          if (req) req.onsuccess = () => (out = req.result);
          t.oncomplete = () => {
            db.close();
            res(out);
          };
          t.onerror = () => {
            db.close();
            res(null);
          };
          t.onabort = () => {
            db.close();
            res(null);
          };
        } catch {
          db.close();
          res(null);
        }
      }),
  );
}

/** Store (or replace) a recording. False when the browser keeps nothing. */
export async function putRecording(id: string, blob: Blob, meta: RecordingMeta): Promise<boolean> {
  const row: StoredRecording = { id, blob, meta, storedAt: Date.now(), uploadedAt: 0, tries: 0 };
  const r = await tx<IDBValidKey>("readwrite", (s) => s.put(row));
  return r !== null;
}

export function getRecording(id: string): Promise<StoredRecording | null> {
  return tx<StoredRecording | undefined>("readonly", (s) => s.get(id)).then((r) => r ?? null);
}

/** The upload went through: remembered, so it is not sent again (the audio stays here as a copy). */
export async function markUploaded(id: string): Promise<void> {
  const row = await getRecording(id);
  if (!row) return;
  await tx("readwrite", (s) => s.put({ ...row, uploadedAt: Date.now() }));
}

/** The visitor posted or printed the card: keep this one and send it. */
export async function markWanted(id: string): Promise<void> {
  const row = await getRecording(id);
  if (!row || row.wanted) return;
  await tx("readwrite", (s) => s.put({ ...row, wanted: true }));
}

/**
 * Every recording nobody asked for (not posted, not printed) is thrown away, and every posted one already on the
 * server (its copy here is no longer needed) — except `keep` (the life now). What was posted but not yet sent stays.
 */
export async function discardUnwanted(keep = ""): Promise<number> {
  const rows = await listRecordings();
  let n = 0;
  for (const r of rows) {
    if (r.id === keep || (r.wanted && !r.uploadedAt)) continue;
    await deleteRecording(r.id);
    n++;
  }
  return n;
}

export async function bumpTries(id: string): Promise<void> {
  const row = await getRecording(id);
  if (!row) return;
  await tx("readwrite", (s) => s.put({ ...row, tries: row.tries + 1 }));
}

/** Recordings asked for (posted / printed) and not yet uploaded, oldest first, at most `limit`. */
export function listPending(limit = 5): Promise<StoredRecording[]> {
  return tx<StoredRecording[]>("readonly", (s) => s.index("uploadedAt").getAll(IDBKeyRange.only(0))).then((r) =>
    (r ?? []).filter((x) => x.wanted).sort((a, b) => a.storedAt - b.storedAt).slice(0, limit),
  );
}

export async function deleteRecording(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

/** Every recording kept here, newest first (the lab's list; nothing in the piece reads this). */
export function listRecordings(): Promise<StoredRecording[]> {
  return tx<StoredRecording[]>("readonly", (s) => s.getAll()).then((r) => (r ?? []).sort((a, b) => b.storedAt - a.storedAt));
}

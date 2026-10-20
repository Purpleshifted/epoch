/**
 * parliament/bakeStore.ts
 *
 * THE PAST ON DISK: the baked chunks of the 3D timespace (spaceModel.ts) kept in IndexedDB, per world epoch, so a
 * reload (or a GPU reset that forces one) does not lose the layers below the history window. What is stored is the
 * chunk's MATERIAL — its parts with their wear basis, the slice of vegetation history, the drawn boxes, the
 * vegetation points — never its mesh: the mesh is built again on load with the current look (the rebake path), and
 * the material keeps ageing until the chunk is a fossil. Works in a Web Worker (IndexedDB is available there) and
 * degrades to nothing where it is not (tests, SSR).
 */

import type { Box, WearBasis } from "./seeds";
import type { NatureHistory } from "./natureHistory";
import type { FuseTube } from "./fuse";

/** An external part of a baked chunk, with what its decay is read from later (a steel part's wear basis and box). */
export type BakedTube = FuseTube & { basis?: WearBasis | null; box?: Box };

const DB = "parliament.baked";
const STORE = "chunks";
const VERSION = 1;

/** One baked chunk as stored (structured-cloneable; typed arrays included). */
export interface BakedRecord {
  key: string;
  epoch: string;
  c0: number;
  c1: number;
  final: boolean;
  t0: number;
  parts: Box[];
  basis: (WearBasis | null)[];
  decay: number[];
  standing: boolean[];
  tubes: BakedTube[];
  history: NatureHistory | null;
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  unit: number;
  sediment: { tNow: number; secPerUnit: number; timeScale: number; tauYears: number; graceSlots: number };
  boxes: Box[];
  shade: Float32Array;
  nature: { pos: Float32Array; col: Float32Array } | null;
}

export const bakedKey = (epoch: string, c0: number): string => `${epoch}:${c0}`;

export function hasBakeStore(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" }).createIndex("epoch", "epoch", { unique: false });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Writes (or replaces) one chunk. Fire-and-forget safe: errors are swallowed. */
export async function saveBaked(rec: BakedRecord): Promise<void> {
  if (!hasBakeStore()) return;
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec);
    await done(tx);
  } catch {
    /* storage unavailable or full: the past lives on in memory only */
  }
}

/** Every chunk stored for the epoch. */
export async function loadBaked(epoch: string): Promise<BakedRecord[]> {
  if (!hasBakeStore()) return [];
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).index("epoch").getAll(epoch);
    return await new Promise<BakedRecord[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as BakedRecord[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Forgets every chunk of the epoch (the world was cleared). */
export async function clearBaked(epoch: string): Promise<void> {
  if (!hasBakeStore()) return;
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readwrite");
    const idx = tx.objectStore(STORE).index("epoch");
    const req = idx.openKeyCursor(epoch);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      tx.objectStore(STORE).delete(cur.primaryKey);
      cur.continue();
    };
    await done(tx);
  } catch {
    /* nothing to clear */
  }
}

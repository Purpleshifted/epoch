"use client";
/**
 * DepositField — what the visitors leave behind, and what they wear down.
 *
 * Replaces StarFieldSystem (GPGPU particle trails, N-body gravity, star lifecycle,
 * merging). There is no physics here: a visitor scatters items that they do not
 * choose (catalogue v2: JRC beach litter + electronics + anthropogenic organics,
 * then shifted by what survives around them), and the fate of each item is decided
 * by lib/stratum (material persistence, burial by later deposits, fossilisation).
 *
 * The ground also holds a natural stock (leaves, feathers, shells …). Visitors do not
 * scatter it; walking and scattering wear it down (lib/stratum/natural.ts).
 *
 * Rendering: 16-colour pixel sprites from the shared atlas (components/ground); an item
 * without a sprite falls back to a flat palette square.
 *
 * Cost model (see docs/performance.md): records live in an incremental per-cell
 * GroundStore; only the cells near the visitor are resolved, twice a second; a freshly
 * scattered item is drawn immediately without waiting for the next resolve; the
 * localStorage mirror (a stand-in for the server) is written every few seconds and
 * only read when another tab says it changed.
 *
 * Multi-user (for now): every browser tab is a visitor; records are shared through
 * localStorage and merged by id. A server replaces this later.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  GroundStore,
  LS_DEPOSITS_KEY,
  LS_EPOCH_KEY,
  LS_STEPS_KEY,
  aliveShare,
  cellKey,
  localSurvivors,
  makeDeposit,
  naturalItemsAround,
  resolveNaturalIn,
  INHERITANCE_ENABLED,
  drawItem,
  type DepositRecord,
  type NaturalItem,
  type ResolvedDeposit,
  type Stage,
  type StepRecord,
} from "@/lib/stratum";
import { spriteCell } from "@/components/ground/atlas";
import { PointBuffer, makePixelMaterial } from "@/components/ground/pixelPoints";

const MAX_RECORDS = 3000;
const MAX_STEPS = 20000;      // dropping old crossings would let the natural stock grow back, so keep many (~1 MB)
const MAX_NATURAL = 1800;     // natural items drawn at once (around the visitor)
const NATURAL_RADIUS = 16;    // world units around the visitor in which the natural stock is drawn
const VIEW_RADIUS = 24;       // world units around the visitor in which scattered items are resolved and drawn
const GHOST_SEC = 3;          // a displaced natural item stays visible (dithered) this long, whatever its material
const NATURAL_SIZE = 0.72;    // natural items are drawn a little smaller than scattered ones
const DROP_DIST = 1.0;        // scatter one item per this much distance walked...
const DROP_IDLE = 1.5;        // ...or after this many seconds standing still
const DROP_MIN_GAP = 0.2;     // never faster than this (s)
const DWELL_SEC = 1.0;        // lingering in one cell: one more trampling pass per this many seconds
const RESOLVE_EVERY = 0.5;    // s between fate recomputations
const WRITE_EVERY = 3.0;      // s between localStorage writes (only when something changed)

const GROUND_Y = 0.02; // flat ground: every sprite rests here

function loadArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw) as T[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
const loadRecords = () => loadArray<DepositRecord>(LS_DEPOSITS_KEY).filter((r) => typeof r.item === "string");
const loadSteps = () => loadArray<StepRecord>(LS_STEPS_KEY);

function getEpochMs(): number {
  try {
    const raw = localStorage.getItem(LS_EPOCH_KEY);
    if (raw) return Number(raw);
    const now = Date.now();
    localStorage.setItem(LS_EPOCH_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

/** Every page load is a new visitor: a reload hands out a new life (sessionStorage would survive it). */
function getVisitorId(): string {
  return "v_" + Math.random().toString(36).slice(2, 8);
}

export function DepositField({
  playerPosRef,
  pointSize = 0.32,
  botCount = 0,
  poolK = 20,
  poolRadius = 4,
  naturalWear = 3,
}: {
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  pointSize?: number;
  /** Debug visitors that wander on their own, each scattering from its own draw. */
  botCount?: number;
  /** Prior pseudo-count: how many "imaginary" items of the catalogue prior the ground is weighed against. 0 = only the ground. */
  poolK?: number;
  /** Radius (world units) of the ground a visitor inherits from. */
  poolRadius?: number;
  /** Multiplies the wear on the natural stock. 1 = calibrated reference (needs a crowd); higher = a small crowd wears the ground down visibly. */
  naturalWear?: number;
}) {
  const lastResolved = useRef<ResolvedDeposit[]>([]);
  const records = useRef<Map<string, DepositRecord>>(new Map());
  const steps = useRef<Map<string, StepRecord>>(new Map());
  const store = useRef(new GroundStore());
  const lastCell = useRef(new Map<string, string>());
  const lastStepT = useRef(new Map<string, number>());
  const dirty = useRef(false);
  const stepsDirty = useRef(false);
  const epochMs = useRef(0);
  const visitor = useRef("v_anon");
  const seq = useRef(0);
  const drawn = useRef(0);
  const naturalWindow = useRef<{ cell: string; items: NaturalItem[] } | null>(null);

  // per-source drop state: key -> { x, z, t of last drop, last moved time }
  const drops = useRef(new Map<string, { x: number; z: number; last: number; moved: number }>());
  const resolveTimer = useRef(0);
  const writeTimer = useRef(0);
  const clock = useRef(0);

  const cap = MAX_RECORDS + MAX_NATURAL;
  const buf = useMemo(() => new PointBuffer(cap), [cap]);
  const geometry = buf.geometry;

  const material = useMemo(() => makePixelMaterial({ size: pointSize, snap: 1 }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const uniforms = material.uniforms;
  uniforms.uSize.value = pointSize;

  const addRecord = (r: DepositRecord): boolean => {
    if (records.current.has(r.id)) return false;
    records.current.set(r.id, r);
    store.current.addDeposit(r);
    return true;
  };
  const addStepRecord = (s: StepRecord): boolean => {
    if (steps.current.has(s.id)) return false;
    steps.current.set(s.id, s);
    store.current.addStep(s);
    return true;
  };

  useEffect(() => {
    epochMs.current = getEpochMs();
    visitor.current = getVisitorId();
    // SESSION VIEW: every load starts on an empty ground (a new lifespan). Stored history is
    // not read here (Top/Side show it); this tab only appends its own records to the storage.
    // other tabs announce their writes; we never poll localStorage
    const onStorage = (e: StorageEvent) => {
      if ((e.key === LS_DEPOSITS_KEY || e.key === LS_STEPS_KEY) && e.newValue === null) {
        // the shared ground was emptied from a Top/Side view: start over with it, otherwise this
        // tab would write its old records straight back
        records.current.clear();
        steps.current.clear();
        store.current.clear();
        lastCell.current.clear();
        lastStepT.current.clear();
        drops.current.clear();
        lastResolved.current = [];
        naturalWindow.current = null;
        dirty.current = false;
        stepsDirty.current = false;
        epochMs.current = getEpochMs();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      geometry.dispose();
      material.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, material]);

  const nowSec = () => (Date.now() - epochMs.current) / 1000;

  /** Write one point into the buffer at index `n`. `cell` < 0: flat placeholder square. */
  const writePoint = (
    n: number,
    x: number,
    y: number,
    z: number,
    material: DepositRecord["material"],
    stage: Stage,
    size: number,
    cell = -1,
    natural = false,
  ) => buf.set(n, x, y, z, cell, material, stage, size, natural);

  /** Scatter one item from `src` at (x,z). The item is drawn, not chosen. */
  const scatter = (src: string, owner: string, x: number, y: number, z: number, t: number) => {
    const id = `${owner}_${Math.floor(t * 1000)}_${seq.current++}`;
    // Inheritance: the draw leans toward what has survived around this spot.
    // Inheritance is OFF (INHERITANCE_ENABLED in sample.ts): the draw is the catalogue prior.
    const survivors = INHERITANCE_ENABLED
      ? localSurvivors(lastResolved.current, x, z, poolRadius)
      : new Map<string, number>();
    const item = drawItem(Math.random(), survivors, poolK);
    const rec = makeDeposit({ id, u: 0, item, x, y, z, t, owner });
    addRecord(rec);
    dirty.current = true;
    // draw it now; the next resolve rewrites the whole buffer anyway
    if (drawn.current < cap) {
      writePoint(drawn.current++, x, y, z, rec.material, "fresh", 1, spriteCell(rec.item, rec.variant));
      geometry.setDrawRange(0, drawn.current);
    }
    void src;
  };

  /**
   * A source entered a new ground cell: one "crossing", which wears the natural stock down.
   * Lingering in the same cell adds one more pass every DWELL_SEC, so staying longer wears the
   * ground faster (modelling assumption: wear scales with passes, and standing still counts as
   * repeated passes; Cole 1995 relates impact to the number of passes, the dwell rule is ours).
   */
  const trackStep = (src: string, owner: string, x: number, z: number, t: number) => {
    const c = cellKey(x, z);
    if (lastCell.current.get(src) === c) {
      const last = lastStepT.current.get(src) ?? t;
      if (t - last < DWELL_SEC) return;
    } else {
      lastCell.current.set(src, c);
    }
    lastStepT.current.set(src, t);
    const id = `${owner}_${Math.floor(t * 1000)}_${c}`;
    addStepRecord({ id, c, t, o: owner });
    stepsDirty.current = true;
  };

  const maybeDrop = (src: string, owner: string, x: number, z: number, y: number, t: number) => {
    let s = drops.current.get(src);
    if (!s) {
      s = { x, z, last: t, moved: t };
      drops.current.set(src, s);
      return;
    }
    const d = Math.hypot(x - s.x, z - s.z);
    if (d > 0.02) s.moved = t;
    const sinceLast = t - s.last;
    if (sinceLast < DROP_MIN_GAP) return;
    if (d >= DROP_DIST || sinceLast >= DROP_IDLE) {
      scatter(src, owner, x, y, z, t);
      s.x = x;
      s.z = z;
      s.last = t;
    }
  };

  /** Keep memory and storage bounded: drop the oldest records and rebuild the store (rare). */
  const trim = () => {
    let rebuilt = false;
    if (records.current.size > MAX_RECORDS * 1.15) {
      const sorted = [...records.current.values()].sort((a, b) => a.t - b.t);
      for (const r of sorted.slice(0, sorted.length - MAX_RECORDS)) records.current.delete(r.id);
      rebuilt = true;
    }
    if (steps.current.size > MAX_STEPS * 1.15) {
      const sorted = [...steps.current.values()].sort((a, b) => a.t - b.t);
      for (const s of sorted.slice(0, sorted.length - MAX_STEPS)) steps.current.delete(s.id);
      rebuilt = true;
    }
    if (rebuilt) {
      const fresh = new GroundStore();
      for (const r of records.current.values()) fresh.addDeposit(r);
      for (const s of steps.current.values()) fresh.addStep(s);
      store.current = fresh;
    }
  };

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    clock.current += dt;
    const t = nowSec();

    // ── 1. scatter and walk: the visitor, then any debug bots ─────
    const py = GROUND_Y;
    const me = playerPosRef.current;
    trackStep("me", visitor.current, me.x, me.z, t);
    maybeDrop("me", visitor.current, me.x, me.z, py, t);
    for (let i = 0; i < botCount; i++) {
      const R = 3 + (i % 5) * 2.4;
      const w = (0.18 + 0.05 * (i % 4)) * (i % 2 ? 1 : -1);
      const a = clock.current * w + i * 2.399963;
      const bx = Math.cos(a) * R;
      const bz = Math.sin(a) * R;
      trackStep(`bot${i}`, `bot${i}`, bx, bz, t);
      maybeDrop(`bot${i}`, `bot${i}`, bx, bz, py, t);
    }

    // ── 2. mirror to localStorage (stand-in for the server), throttled ──
    writeTimer.current += dt;
    if (writeTimer.current >= WRITE_EVERY) {
      writeTimer.current = 0;
      if (dirty.current || stepsDirty.current) trim();
      // This tab only SHOWS its own session, but it appends to the shared storage (merge by id),
      // so Top/Side keep the history of every earlier session.
      if (dirty.current) {
        dirty.current = false;
        try {
          const merged = new Map<string, DepositRecord>();
          for (const r of loadRecords()) merged.set(r.id, r);
          for (const r of records.current.values()) merged.set(r.id, r);
          const all = [...merged.values()].sort((a, b) => a.t - b.t);
          localStorage.setItem(LS_DEPOSITS_KEY, JSON.stringify(all.slice(-MAX_RECORDS)));
        } catch { /* quota */ }
      }
      if (stepsDirty.current) {
        stepsDirty.current = false;
        try {
          const merged = new Map<string, StepRecord>();
          for (const s of loadSteps()) merged.set(s.id, s);
          for (const s of steps.current.values()) merged.set(s.id, s);
          const all = [...merged.values()].sort((a, b) => a.t - b.t);
          localStorage.setItem(LS_STEPS_KEY, JSON.stringify(all.slice(-MAX_STEPS)));
        } catch { /* quota */ }
      }
    }

    // ── 3. resolve the cells near the visitor, fill buffers ───────
    resolveTimer.current += dt;
    if (resolveTimer.current < RESOLVE_EVERY) return;
    resolveTimer.current = 0;

    // point sizes are in drawing-buffer pixels (the buffer may be much smaller than the screen)
    uniforms.uCamConst.value =
      state.gl.domElement.height / (2 * Math.tan(((state.camera as THREE.PerspectiveCamera).fov * Math.PI) / 360));

    const resolved = store.current.resolveNear(me.x, me.z, VIEW_RADIUS, t);
    lastResolved.current = resolved;
    let n = 0;
    for (const { rec, fate } of resolved) {
      if (fate.stage === "vanished" || n >= MAX_RECORDS) continue;
      writePoint(n++, rec.x, rec.y, rec.z, rec.material, fate.stage, 1, spriteCell(rec.item, rec.variant));
    }

    // natural stock around the visitor (the window is recomputed only when the visitor changes cell)
    const mc = cellKey(me.x, me.z);
    let win = naturalWindow.current;
    if (!win || win.cell !== mc) {
      win = { cell: mc, items: naturalItemsAround(me.x, me.z, NATURAL_RADIUS) };
      naturalWindow.current = win;
    }
    const natural = resolveNaturalIn(win.items, store.current, t, undefined, naturalWear);
    let nat = 0;
    for (const r of natural) {
      if (nat >= MAX_NATURAL) break;
      const it = r.item;
      const cell = spriteCell(it.def.id, it.variant);
      if (r.alive) writePoint(n++, it.x, py, it.z, it.def.material, "fresh", NATURAL_SIZE, cell, true);
      else if (r.fate && r.fate.stage !== "vanished") writePoint(n++, it.x, py, it.z, it.def.material, r.fate.stage, NATURAL_SIZE, cell, true);
      else if (r.displacedAt != null && t - r.displacedAt < GHOST_SEC) writePoint(n++, it.x, py, it.z, it.def.material, "fragmented", NATURAL_SIZE, cell, true);
      else continue;
      nat++;
    }
    drawn.current = n;
    geometry.setDrawRange(0, n);

    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __natural?: unknown }).__natural = {
        flora: +aliveShare(natural, "flora").toFixed(3),
        fauna: +aliveShare(natural, "fauna").toFixed(3),
        items: natural.length,
        deposits: store.current.depositCount,
        steps: store.current.stepCount,
      };
    }
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

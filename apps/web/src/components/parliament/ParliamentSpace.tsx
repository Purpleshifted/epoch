"use client";
/**
 * ParliamentSpace — the global timespace in 3D, before any styling.
 *
 *   x, z  the ground      y  TIME (exhibition seconds / secPerUnit · unit), later = higher
 *
 * What is drawn is exactly the output of the seed pipeline (lib/parliament/seeds.ts):
 *   folded world (without wear: this view is history) → seeds (where/when ≥ minVisitors gathered)
 *   → recipe → parts (plinth, basement, piles, masses, slabs, columns), only in the time slots in which somebody
 *   was around (columns may cross empty time).
 * One InstancedMesh per part kind (a material each); screen-space AO (N8AO) does most of the reading of the masses.
 * Time is linear (y = t / secPerUnit · unit). The camera is focused on the PLAYER's present time (the latest
 * presence of the most recently opened /mobile tab), so the boxes are in view however old the epoch is.
 * Untextured on purpose, for now: textures, natural matter and other roles come later, through the same seeds.
 * URL: ?demo=1 seeds a demo crowd · ?ui=0 hides the panel.
 */

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Hud, OrbitControls } from "@react-three/drei";
import { EffectComposer, N8AO } from "@react-three/postprocessing";
import { Leva, button, useControls } from "leva";
import * as THREE from "three";
import {
  DEFAULT_BOXES,
  DEFAULT_FOLD,
  LS_PARLIAMENT_ME_KEY,
  PART_KINDS,
  RECIPES,
  STEEL,
  clearWorld,
  foldWorld,
  generateBoxes,
  halfHeight,
  latestOf,
  latestS,
  loadEvents,
  seedParliamentDemoIfRequested,
  seedsFromSnapshot,
  withoutWear,
  type BoxConfig,
  type Recipe,
  type EventLog,
  type FoldConfig,
  type PEvent,
  type PartKind,
  type PartsCache,
  type RoleId,
} from "@/lib/parliament";
import { useFoldControls, useWorld } from "./useWorld";

const PAPER = "#e9ebee";
/** Instance capacity per part kind. */
const CAPACITY: Record<PartKind, number> = { mass: 200000, slab: 6000, drip: 60000, column: 16000, beam: 12000, brace: 12000, plinth: 2000, basement: 2000, pile: 10000 };
/** Base colour per part kind (instance tone multiplies it). */
const KIND_COLOR: Record<PartKind, string> = {
  mass: "#f4f4f2",
  slab: "#fbfbfa",
  drip: "#ecece9",
  column: "#6f747b",
  beam: "#6f747b",
  brace: "#6f747b",
  plinth: "#b8bbbf",
  basement: "#9fa3a8",
  pile: "#7f848a",
};
/** Boxes that get edge lines at most (slat bundles make the part count large). */
const EDGE_CAP = 40000;
const DEG = Math.PI / 180;
const RC = RECIPES.concrete;
const pair = (v: [number, number], f = 1): [number, number] => [v[0] * f, v[1] * f];

const NO_COUNTS = Object.fromEntries(PART_KINDS.map((k) => [k, 0])) as Record<PartKind, number>;
/** A focus change larger than this (world units on the time axis) is a jump, not a drift. */
const FOLLOW_SNAP = 40;

interface Stats {
  seeds: number;
  boxes: number;
  kinds: Record<PartKind, number>;
  t: number;
  top: number;
  /** Time the camera is focused on: the player's present (or the latest event when there is no player). */
  focusS: number;
  focusIsMe: boolean;
}

interface Orbit {
  target: { y: number };
  object: { position: { y: number } };
  update: () => void;
}

const EDGE: [number, number][] = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function SpaceBoxes({
  log,
  fold,
  boxCfg,
  showEdges,
  follow,
  controls,
  onStats,
}: {
  log: EventLog;
  fold: FoldConfig;
  boxCfg: BoxConfig;
  showEdges: boolean;
  follow: boolean;
  controls: React.MutableRefObject<Orbit | null>;
  onStats: (s: Stats) => void;
}) {
  const meshes = useRef<Partial<Record<PartKind, THREE.InstancedMesh | null>>>({});
  const edges = useRef<THREE.LineSegments>(null);
  const axis = useRef<THREE.LineSegments>(null);
  const timer = useRef(10);
  const sig = useRef("");
  const focusY = useRef<number | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const corner = useMemo(() => new THREE.Vector3(), []);
  // a seed's parts are reused while it has not changed (see generateBoxes)
  const partsCache = useMemo<PartsCache>(() => new Map(), []);
  const key = useMemo(() => JSON.stringify([fold, boxCfg]), [fold, boxCfg]);

  const snapped = useRef(false);
  const topOf = useRef(0);
  const boxCount = useRef(0);
  const kindCount = useRef(NO_COUNTS);
  const statSig = useRef("");
  /** hand the overlay new numbers only when they changed (whole seconds), not on every 0.5 s pass */
  const report = (st: Stats) => {
    const k = `${st.seeds}:${st.boxes}:${Math.round(st.t)}:${st.top.toFixed(1)}:${Math.round(st.focusS)}:${st.focusIsMe}`;
    if (k === statSig.current) return;
    statSig.current = k;
    onStats(st);
  };

  useFrame((state, dt) => {
    // follow the player's present: the view moves along the time axis, keeping the viewer's own orbit.
    // The first focus (and any jump further than FOLLOW_SNAP) is immediate, so an old epoch is never out of view.
    const c = controls.current;
    if (c && focusY.current !== null && (follow || !snapped.current)) {
      const want = Math.max(0, focusY.current);
      const far = Math.abs(want - c.target.y) > FOLLOW_SNAP;
      const d = !snapped.current || far ? want - c.target.y : (want - c.target.y) * Math.min(1, dt * 1.5);
      snapped.current = true;
      if (Math.abs(d) > 1e-5) {
        c.target.y += d;
        state.camera.position.y += d;
        c.update();
      }
    }

    timer.current += dt;
    if (timer.current < 0.5) return;
    timer.current = 0;
    if (PART_KINDS.some((k) => !meshes.current[k])) return;

    const events = log.all();
    const t = latestS(events);
    const meS = latestOf(events, typeof window === "undefined" ? null : window.localStorage.getItem(LS_PARLIAMENT_ME_KEY));
    const focusS = meS ?? t;
    focusY.current = events.length ? (focusS / boxCfg.secPerUnit) * boxCfg.unit : null;
    // history view: fold without wear, or slabs whose footprint had decayed by `t` would drop out
    const seeds = seedsFromSnapshot(foldWorld(events, t, withoutWear(fold)));
    let acc = 0;
    for (const s of seeds) acc += s.t1 + s.mass * 100 + s.id % 97;
    const next = `${seeds.length}:${Math.round(acc)}:${key}`;
    if (next === sig.current) {
      report({ seeds: seeds.length, boxes: boxCount.current, kinds: kindCount.current, t, top: topOf.current, focusS, focusIsMe: meS !== null });
      return;
    }
    sig.current = next;

    const list = generateBoxes(seeds, boxCfg, partsCache);
    let minX = Infinity, minZ = Infinity, top = 0;
    const counts = { ...NO_COUNTS };
    // edges for the box-shaped kinds (piles are cylinders and get none)
    const lines: number[] = [];
    for (const b of list) {
      const kind = b.kind;
      if (counts[kind] >= CAPACITY[kind]) continue;
      const mesh = meshes.current[kind]!;
      const i = counts[kind]++;
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, b.yaw ?? 0, b.tilt ?? 0, "YZX");
      dummy.scale.set(b.sx, b.sy, b.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.setScalar(0.86 + 0.14 * b.tone);
      mesh.setColorAt(i, col);
      minX = Math.min(minX, b.x - b.sx / 2);
      minZ = Math.min(minZ, b.z - b.sz / 2);
      top = Math.max(top, b.y + halfHeight(b));
      if (kind === "pile" || lines.length >= EDGE_CAP * 72) continue;
      for (let e = 0; e < 12; e++) {
        for (let k = 0; k < 2; k++) {
          const v = EDGE[e][k];
          corner.set((v & 1) - 0.5, ((v >> 2) & 1) - 0.5, ((v >> 1) & 1) - 0.5).applyMatrix4(dummy.matrix);
          lines.push(corner.x, corner.y, corner.z);
        }
      }
    }
    for (const kind of PART_KINDS) {
      const mesh = meshes.current[kind]!;
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    const eg = edges.current;
    if (eg) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(lines), 3));
      eg.geometry.dispose();
      eg.geometry = g;
    }

    // the time axis: a vertical line beside the boxes, a tick per slot, a long tick per 10 slots
    // (at most the latest 2000 slots get ticks: with an old epoch the present is thousands of slots up)
    const ax = axis.current;
    if (ax) {
      const x0 = Number.isFinite(minX) ? minX - 2 : -3;
      const z0 = Number.isFinite(minZ) ? minZ - 2 : -3;
      const yTop = Math.max(top, (t / boxCfg.secPerUnit) * boxCfg.unit) + boxCfg.unit;
      const slots = Math.ceil(yTop / boxCfg.unit);
      const p: number[] = [x0, 0, z0, x0, yTop, z0];
      for (let k = Math.max(0, slots - 2000); k <= slots; k++) {
        const len = k % 10 === 0 ? 1.4 : 0.5;
        p.push(x0, k * boxCfg.unit, z0, x0 + len, k * boxCfg.unit, z0);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(p), 3));
      ax.geometry.dispose();
      ax.geometry = g;
    }

    topOf.current = top;
    boxCount.current = list.length;
    kindCount.current = counts;
    report({ seeds: seeds.length, boxes: list.length, kinds: counts, t, top, focusS, focusIsMe: meS !== null });
  });

  return (
    <>
      {PART_KINDS.map((kind) => (
        <instancedMesh
          key={kind}
          ref={(m) => {
            meshes.current[kind] = m;
          }}
          args={[undefined, undefined, CAPACITY[kind]]}
          frustumCulled={false}
        >
          {kind === "pile" ? <cylinderGeometry args={[0.5, 0.5, 1, 10]} /> : <boxGeometry args={[1, 1, 1]} />}
          <meshStandardMaterial color={KIND_COLOR[kind]} roughness={kind === "pile" || STEEL.has(kind) ? 0.7 : 1} metalness={0} />
        </instancedMesh>
      ))}
      <lineSegments ref={edges} frustumCulled={false} visible={showEdges}>
        <bufferGeometry />
        <lineBasicMaterial color="#15181c" />
      </lineSegments>
      <lineSegments ref={axis} frustumCulled={false}>
        <bufferGeometry />
        <lineBasicMaterial color="#6a7078" />
      </lineSegments>
    </>
  );
}

interface Mark {
  id: string;
  kind: "me" | "bot" | "visitor";
  role: RoleId;
  x: number;
  z: number;
  s: number;
  /** No newer sample for `holdSec` (only "me" is still drawn then, dimmed). */
  stale: boolean;
}

/** What the overlay says about "me": the id this browser's player tab wrote, and how long it has been silent. */
interface MeStatus {
  id: string | null;
  /** Seconds since its newest sample arrived; null = it has left no presence yet. */
  silentSec: number | null;
}

const MARK_COLOR = { me: "#ff4d00", bot: "#2a62ff", visitor: "#111111" } as const;

/**
 * Live markers: the latest presence sample of each owner, as a sphere at (x, time, z) with a thin line down to
 * the ground. "me" is the player tab on this browser (id written to localStorage by RoleField). An owner stays
 * visible while its newest sample keeps advancing; `holdSec` of silence hides it — except "me", which is always
 * drawn at its latest presence (dimmed while silent), so the player can always be found.
 */
function Markers({
  log,
  secPerUnit,
  unit,
  holdSec,
  onActive,
  onMe,
}: {
  log: EventLog;
  secPerUnit: number;
  unit: number;
  holdSec: number;
  onActive: (n: number) => void;
  onMe: (m: MeStatus) => void;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const seen = useRef(new Map<string, { s: number; at: number }>());
  const timer = useRef(10);
  const sig = useRef("");
  const meSig = useRef("");

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < 0.25) return;
    timer.current = 0;
    const events = log.all();
    const latest = new Map<string, PEvent>();
    for (const e of events) {
      if (e.k !== "p") continue;
      const p = latest.get(e.o);
      if (!p || e.s >= p.s) latest.set(e.o, e);
    }
    const now = performance.now();
    const firstScan = seen.current.size === 0;
    const me = typeof window === "undefined" ? null : window.localStorage.getItem(LS_PARLIAMENT_ME_KEY);
    const out: Mark[] = [];
    for (const [id, e] of latest) {
      const prev = seen.current.get(id);
      // owners that were already stored when this view opened count as stale until they send a newer sample
      if (!prev || e.s > prev.s) seen.current.set(id, { s: e.s, at: firstScan && !prev ? -1e12 : now });
      const at = seen.current.get(id)!.at;
      const stale = now - at > holdSec * 1000;
      if (stale && id !== me) continue;
      out.push({ id, kind: id === me ? "me" : id.startsWith("bot") ? "bot" : "visitor", role: e.r, x: e.x, z: e.z, s: e.s, stale });
    }
    const meAt = me ? seen.current.get(me)?.at : undefined;
    const meStatus: MeStatus = { id: me, silentSec: meAt === undefined ? null : meAt < 0 ? Infinity : Math.floor((now - meAt) / 1000) };
    const ms = `${meStatus.id}:${meStatus.silentSec}`;
    if (ms !== meSig.current) {
      meSig.current = ms;
      onMe(meStatus);
    }
    out.sort((a, b) => (a.id < b.id ? -1 : 1));
    const next = out.map((m) => `${m.id}:${m.s}:${m.x.toFixed(2)}:${m.z.toFixed(2)}:${m.stale}`).join("|");
    if (next === sig.current) return;
    sig.current = next;
    setMarks(out);
    onActive(out.filter((m) => !m.stale).length);
  });

  return (
    <>
      {marks.map((m) => {
        const y = (m.s / secPerUnit) * unit;
        const color = MARK_COLOR[m.kind];
        const big = m.kind === "me" ? 0.5 : 0.32;
        return (
          <group key={m.id}>
            <mesh position={[m.x, y, m.z]}>
              <sphereGeometry args={[big, 16, 12]} />
              <meshBasicMaterial color={color} depthTest={false} transparent opacity={m.stale ? 0.4 : 0.95} />
            </mesh>
            <mesh position={[m.x, y / 2, m.z]}>
              <cylinderGeometry args={[0.03, 0.03, Math.max(y, 0.001), 6]} />
              <meshBasicMaterial color={color} transparent opacity={0.5} />
            </mesh>
            <mesh position={[m.x, 0.02, m.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.35, 0.5, 24]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} />
            </mesh>
            <Html position={[m.x, y + big + 0.25, m.z]} center style={{ pointerEvents: "none" }}>
              <div className="whitespace-nowrap font-mono text-[10px] leading-3" style={{ color }}>
                {m.kind === "me" ? (m.stale ? "me (silent)" : "me") : m.kind === "bot" ? m.id : "visitor"} · {m.role}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

export default function ParliamentSpace() {
  const [demo] = useState(() => seedParliamentDemoIfRequested());
  const log = useWorld(undefined, 1000);
  const fold = useFoldControls();
  const params = useMemo(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)), []);
  const hideUi = demo || params.get("ui") === "0";
  const controls = useRef<Orbit | null>(null);
  const [stats, setStats] = useState<Stats>({ seeds: 0, boxes: 0, kinds: NO_COUNTS, t: 0, top: 0, focusS: 0, focusIsMe: false });
  const [active, setActive] = useState(0);
  const [meStatus, setMeStatus] = useState<MeStatus>({ id: null, silentSec: null });
  const topRef = useRef(0);
  const focusRef = useRef(0);

  /** move orbit target and camera together along y (the time axis), keeping the viewer's own angle/distance */
  const jump = (y: number) => {
    const o = controls.current;
    if (!o) return;
    const d = y - o.target.y;
    o.target.y += d;
    o.object.position.y += d;
    o.update();
  };

  const c = useControls("3D 시공간 (박스 생성 확인)", {
    secPerUnit: { value: DEFAULT_BOXES.secPerUnit, min: 2, max: 600, step: 1, label: "한 단 = 몇 초 (시간축)" },
    unit: { value: DEFAULT_BOXES.unit, min: 0.2, max: 4, step: 0.1, label: "한 단의 높이 (월드 단위)" },
    width: { value: DEFAULT_BOXES.width, min: 0.3, max: 3, step: 0.05, label: "부품 폭 배율" },
    density: { value: DEFAULT_BOXES.density, min: 0.2, max: 4, step: 0.1, label: "단당 매스 수 배율" },
    emptyGapSec: { value: DEFAULT_FOLD.emptyGapSec, min: 1, max: 600, step: 1, label: "빈 시간으로 볼 공백 (s)" },
    showEdges: { value: false, label: "모서리 선" },
    follow: { value: true, label: "플레이어 시간대 따라가기" },
    toMe: button(() => jump(focusRef.current)),
    toGround: button(() => jump(0)),
    toLatest: button(() => jump(Math.max(0, topRef.current - 6))),
    markers: { value: true, label: "실시간 마커 (나/봇/방문자)" },
    markerHold: { value: 6, min: 2, max: 60, step: 1, label: "마커 유지 (갱신 끊긴 뒤 초)" },
    reload: button(() => log.addMany(loadEvents())),
    "clear world": button(() => {
      if (window.confirm("Empty the shared world (all events) and start a new epoch? Open player tabs follow.")) {
        clearWorld();
        log.clear();
      }
    }),
  });
  const ao = useControls("AO (N8AO)", {
    enabled: { value: true, label: "켜기" },
    aoRadius: { value: 2.5, min: 0.1, max: 12, step: 0.1, label: "반경 (월드)" },
    distanceFalloff: { value: 1, min: 0.05, max: 4, step: 0.05, label: "거리 감쇠" },
    intensity: { value: 3, min: 0, max: 12, step: 0.1, label: "세기" },
    quality: { options: ["performance", "low", "medium", "high", "ultra"] as const, value: "medium" as const, label: "품질" },
    halfRes: { value: false, label: "절반 해상도" },
  });
  const steel = useControls("철골 (steel)", {
    beamChance: { value: RC.beam.chance, min: 0, max: 1, step: 0.01, label: "가로보: 슬롯당 확률" },
    beamLength: { value: RC.beam.length, min: 0.3, max: 12, step: 0.1, label: "가로보: 길이 (칸)" },
    beamWidth: { value: RC.beam.width, min: 0.01, max: 0.5, step: 0.01, label: "가로보: 굵기 (칸)" },
    beamOnGrid: { value: RC.beam.onGrid, min: 0, max: 1, step: 0.05, label: "가로보: 격자 정렬 비율" },
    beamSkew: { value: Math.round(RC.beam.skew / DEG), min: 0, max: 45, step: 1, label: "가로보: 최대 기울기 (°)" },
    braceChance: { value: RC.brace.chance, min: 0, max: 1, step: 0.01, label: "사선: 슬롯당 확률" },
    braceLength: { value: RC.brace.length, min: 0.2, max: 8, step: 0.1, label: "사선: 길이 (단)" },
    braceTilt: { value: pair(RC.brace.tilt, 1 / DEG).map(Math.round) as [number, number], min: 0, max: 89, step: 1, label: "사선: 수직에서 기울기 (°)" },
    braceWidth: { value: RC.brace.width, min: 0.01, max: 0.5, step: 0.01, label: "사선: 굵기 (칸)" },
    columnCount: { value: RC.column.count, min: 0, max: 8, step: 1, label: "기둥: 슬래브당 개수" },
    columnWidth: { value: RC.column.width, min: 0.01, max: 0.5, step: 0.01, label: "기둥: 굵기 (칸)" },
  });
  const slat = useControls("막대 묶음 / 드립", {
    enabled: { value: RC.slat.enabled, label: "큰 매스를 막대 묶음으로" },
    minFootprint: { value: RC.slat.minFootprint, min: 0.2, max: 4, step: 0.05, label: "묶음이 되는 최소 크기 (칸)" },
    width: { value: RC.slat.width, min: 0.03, max: 1, step: 0.01, label: "막대 굵기 (칸)" },
    density: { value: RC.slat.density, min: 0.1, max: 1, step: 0.05, label: "막대 채움 비율" },
    maxPerMass: { value: RC.slat.maxPerMass, min: 4, max: 200, step: 1, label: "매스당 최대 막대 수" },
    vertical: { value: RC.slat.vertical, min: 0, max: 1, step: 0.05, label: "세로(매달린) 묶음 비율" },
    shortest: { value: RC.slat.shortest, min: 0.05, max: 1, step: 0.05, label: "매달린 막대 최소 길이 (매스 높이 대비)" },
    dripPerArea: { value: RC.drip.perArea, min: 0, max: 6, step: 0.1, label: "드립: 칸²당 개수" },
    dripMax: { value: RC.drip.max, min: 0, max: 60, step: 1, label: "드립: 부품당 최대" },
    dripLength: { value: RC.drip.length, min: 0.02, max: 6, step: 0.01, label: "드립: 길이 (단)" },
    dripAlpha: { value: RC.drip.alpha, min: 0.3, max: 4, step: 0.05, label: "드립: 길이 분포 (작을수록 긴 것 많음)" },
    dripWidth: { value: RC.drip.width, min: 0.01, max: 0.4, step: 0.01, label: "드립: 굵기 (칸)" },
  });
  const found = useControls("기초", {
    plinthFootprint: { value: RC.plinth.footprint, min: 0.3, max: 8, step: 0.1, label: "기단: 크기 (칸)" },
    plinthThick: { value: RC.plinth.thick, min: 0.02, max: 2, step: 0.01, label: "기단: 두께 (단)" },
    basementDepth: { value: RC.basement.depth, min: 0.01, max: 6, step: 0.05, label: "베이스먼트: 깊이 (단)" },
    basementFootprint: { value: RC.basement.footprint, min: 0.1, max: 1, step: 0.05, label: "베이스먼트: 크기 (기단 대비)" },
    pileCount: { value: RC.pile.count, min: 0, max: 10, step: 1, label: "말뚝: 개수" },
    pileDepth: { value: RC.pile.depth, min: 0.05, max: 8, step: 0.05, label: "말뚝: 길이 (단)" },
    pileWidth: { value: RC.pile.width, min: 0.01, max: 0.4, step: 0.01, label: "말뚝: 굵기 (칸)" },
  });
  const recipe = useMemo<Recipe>(
    () => ({
      ...RC,
      plinth: { footprint: found.plinthFootprint, thick: found.plinthThick },
      basement: { depth: found.basementDepth, footprint: found.basementFootprint },
      pile: { count: found.pileCount, depth: found.pileDepth, width: found.pileWidth },
      slat: { enabled: slat.enabled, minFootprint: slat.minFootprint, width: slat.width, density: slat.density, maxPerMass: slat.maxPerMass, vertical: slat.vertical, shortest: slat.shortest },
      drip: { perArea: slat.dripPerArea, max: slat.dripMax, length: slat.dripLength, alpha: slat.dripAlpha, width: slat.dripWidth },
      beam: { ...RC.beam, chance: steel.beamChance, length: steel.beamLength, width: steel.beamWidth, onGrid: steel.beamOnGrid, skew: steel.beamSkew * DEG },
      brace: { ...RC.brace, chance: steel.braceChance, length: steel.braceLength, tilt: pair(steel.braceTilt, DEG), width: steel.braceWidth },
      column: { ...RC.column, count: steel.columnCount, width: steel.columnWidth },
    }),
    [steel, slat, found],
  );
  const boxCfg = useMemo<BoxConfig>(
    () => ({ ...DEFAULT_BOXES, secPerUnit: c.secPerUnit, unit: c.unit, width: c.width, density: c.density, recipe }),
    [c.secPerUnit, c.unit, c.width, c.density, recipe],
  );
  // heights on the time axis, read by the "toLatest" / "toMe" buttons
  topRef.current = Math.max(stats.top, (stats.t / c.secPerUnit) * c.unit);
  focusRef.current = (stats.focusS / c.secPerUnit) * c.unit;
  const spaceFold = useMemo(() => ({ ...fold, emptyGapSec: c.emptyGapSec }), [fold, c.emptyGapSec]);

  return (
    <div className="relative h-full w-full" style={{ background: PAPER }}>
      <Leva hidden={hideUi} />
      <Canvas dpr={[1, 2]} camera={{ position: [16, 12, 22], fov: 40, near: 0.1, far: 800 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={[PAPER]} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[14, 30, 10]} intensity={1.3} />
        <directionalLight position={[-18, 10, -12]} intensity={0.35} />
        <gridHelper args={[80, 80, "#9aa0a8", "#d3d6db"]} position={[0, -0.01, 0]} />
        <SpaceBoxes log={log} fold={spaceFold} boxCfg={boxCfg} showEdges={c.showEdges} follow={c.follow} controls={controls} onStats={setStats} />
        <OrbitControls ref={controls as never} makeDefault enableDamping dampingFactor={0.12} target={[0, 4, 0]} maxPolarAngle={Math.PI * 0.499} />
        {ao.enabled && (
          <EffectComposer>
            <N8AO aoRadius={ao.aoRadius} distanceFalloff={ao.distanceFalloff} intensity={ao.intensity} quality={ao.quality} halfRes={ao.halfRes} color="black" />
          </EffectComposer>
        )}
        {/* markers are an overlay: their own scene, drawn after the parts (and after AO) on a cleared depth buffer, so
            "me" is never buried inside the masses or darkened by AO. Priority 1 also renders the main scene (AO off);
            with AO on, the composer (priority 1) does that and the overlay follows at 2. */}
        {c.markers && (
          <Hud key={ao.enabled ? "after-ao" : "plain"} renderPriority={ao.enabled ? 2 : 1}>
            <Markers log={log} secPerUnit={c.secPerUnit} unit={c.unit} holdSec={c.markerHold} onActive={setActive} onMe={setMeStatus} />
          </Hud>
        )}
      </Canvas>
      <div className="pointer-events-none absolute bottom-3 left-3 select-none font-mono text-[10px] leading-4 text-black/45">
        <div>
          seeds {stats.seeds} · parts {stats.boxes} · t {Math.round(stats.t)} s · top {stats.top.toFixed(1)} · focus{" "}
          {stats.focusIsMe ? "me" : "latest"} @ {Math.round(stats.focusS)} s
        </div>
        <div>{PART_KINDS.map((k) => `${k} ${stats.kinds[k]}`).join(" · ")}</div>
        <div>x, z = ground · y = time (1 step = {boxCfg.secPerUnit} s) · concrete needs ≥ {fold.minVisitors} visitors</div>
        {c.markers && (
          <div>
            live now {active} (<span style={{ color: MARK_COLOR.me }}>me</span> · <span style={{ color: MARK_COLOR.bot }}>bot</span> ·{" "}
            <span style={{ color: MARK_COLOR.visitor }}>visitor</span>)
          </div>
        )}
        {c.markers && (
          <div style={{ color: MARK_COLOR.me }}>
            {meStatus.id === null
              ? "me: none in this browser (open /mobile in this browser)"
              : meStatus.silentSec === null
                ? `me ${meStatus.id}: no presence yet`
                : meStatus.silentSec === Infinity
                  ? `me ${meStatus.id}: silent since this view opened (is its /mobile tab still open?)`
                  : `me ${meStatus.id}: last sample ${meStatus.silentSec} s ago`}
          </div>
        )}
      </div>
    </div>
  );
}

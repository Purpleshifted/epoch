"use client";
/**
 * ParliamentSpace — the global timespace in 3D, before any styling.
 *
 *   x, z  the ground      y  TIME (exhibition seconds / secPerUnit · unit), later = higher
 *
 * What is drawn is exactly the output of the seed pipeline (lib/parliament/seeds.ts):
 *   folded world → seeds (where/when ≥ minVisitors gathered) → recipe → boxes of different sizes.
 * Plain grey boxes with edges on purpose: this view exists to check that generation is right. Textures,
 * natural matter and other roles come later, through the same seeds.
 * URL: ?demo=1 seeds a demo crowd · ?ui=0 hides the panel.
 */

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Leva, button, useControls } from "leva";
import * as THREE from "three";
import {
  DEFAULT_BOXES,
  LS_PARLIAMENT_ME_KEY,
  clearWorld,
  foldWorld,
  generateBoxes,
  latestS,
  loadEvents,
  seedParliamentDemoIfRequested,
  seedsFromSnapshot,
  type BoxConfig,
  type EventLog,
  type FoldConfig,
  type PEvent,
  type RoleId,
} from "@/lib/parliament";
import { useFoldControls, useWorld } from "./useWorld";

const PAPER = "#e9ebee";
const MAX_BOXES = 30000;

interface Stats {
  seeds: number;
  boxes: number;
  t: number;
  top: number;
}

interface Orbit {
  target: { y: number };
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
  const boxes = useRef<THREE.InstancedMesh>(null);
  const edges = useRef<THREE.LineSegments>(null);
  const axis = useRef<THREE.LineSegments>(null);
  const timer = useRef(10);
  const sig = useRef("");
  const topY = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const key = useMemo(() => JSON.stringify([fold, boxCfg]), [fold, boxCfg]);

  useFrame((state, dt) => {
    // follow the present: the view drifts up with the time axis, keeping the viewer's own orbit
    const c = controls.current;
    if (follow && c) {
      const want = Math.max(0, topY.current - 6);
      const d = (want - c.target.y) * Math.min(1, dt * 1.5);
      if (Math.abs(d) > 1e-5) {
        c.target.y += d;
        state.camera.position.y += d;
        c.update();
      }
    }

    timer.current += dt;
    if (timer.current < 0.5) return;
    timer.current = 0;
    const mesh = boxes.current;
    if (!mesh) return;

    const events = log.all();
    const t = latestS(events);
    const seeds = seedsFromSnapshot(foldWorld(events, t, fold));
    let acc = 0;
    for (const s of seeds) acc += s.t1 + s.mass * 100 + s.id % 97;
    const next = `${seeds.length}:${Math.round(acc)}:${key}`;
    if (next === sig.current) return;
    sig.current = next;

    const list = generateBoxes(seeds, boxCfg);
    const n = Math.min(list.length, MAX_BOXES);
    let minX = Infinity, minZ = Infinity, top = 0;
    const lines = new Float32Array(n * 24 * 3);
    for (let i = 0; i < n; i++) {
      const b = list[i];
      dummy.position.set(b.x, b.y, b.z);
      dummy.scale.set(b.sx, b.sy, b.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.setScalar(0.66 + 0.22 * b.tone);
      mesh.setColorAt(i, col);
      minX = Math.min(minX, b.x - b.sx / 2);
      minZ = Math.min(minZ, b.z - b.sz / 2);
      top = Math.max(top, b.y + b.sy / 2);
      for (let e = 0; e < 12; e++) {
        for (let k = 0; k < 2; k++) {
          const v = EDGE[e][k];
          const o = i * 72 + e * 6 + k * 3;
          lines[o] = b.x + ((v & 1) - 0.5) * b.sx;
          lines[o + 1] = b.y + (((v >> 2) & 1) - 0.5) * b.sy;
          lines[o + 2] = b.z + (((v >> 1) & 1) - 0.5) * b.sz;
        }
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const eg = edges.current;
    if (eg) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(lines, 3));
      eg.geometry.dispose();
      eg.geometry = g;
    }

    // the time axis: a vertical line beside the boxes, a tick per slot, a long tick per 10 slots
    const ax = axis.current;
    if (ax) {
      const x0 = Number.isFinite(minX) ? minX - 2 : -3;
      const z0 = Number.isFinite(minZ) ? minZ - 2 : -3;
      const yTop = Math.max(top, (t / boxCfg.secPerUnit) * boxCfg.unit) + boxCfg.unit;
      const slots = Math.min(2000, Math.ceil(yTop / boxCfg.unit));
      const p: number[] = [x0, 0, z0, x0, yTop, z0];
      for (let k = 0; k <= slots; k++) {
        const len = k % 10 === 0 ? 1.4 : 0.5;
        p.push(x0, k * boxCfg.unit, z0, x0 + len, k * boxCfg.unit, z0);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(p), 3));
      ax.geometry.dispose();
      ax.geometry = g;
    }

    topY.current = Math.max(top, (t / boxCfg.secPerUnit) * boxCfg.unit);
    onStats({ seeds: seeds.length, boxes: list.length, t, top });
  });

  return (
    <>
      <instancedMesh ref={boxes} args={[undefined, undefined, MAX_BOXES]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={1} metalness={0} />
      </instancedMesh>
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
}

const MARK_COLOR = { me: "#ff4d00", bot: "#2a62ff", visitor: "#111111" } as const;

/**
 * Live markers: the latest presence sample of each owner, as a sphere at (x, time, z) with a thin line down to
 * the ground. "me" is the player tab on this browser (id written to localStorage by RoleField). An owner stays
 * visible while its newest sample keeps advancing; `holdSec` of silence hides it.
 */
function Markers({
  log,
  secPerUnit,
  unit,
  holdSec,
  onActive,
}: {
  log: EventLog;
  secPerUnit: number;
  unit: number;
  holdSec: number;
  onActive: (n: number) => void;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const seen = useRef(new Map<string, { s: number; at: number }>());
  const timer = useRef(10);
  const sig = useRef("");

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
      if (now - at > holdSec * 1000) continue;
      out.push({ id, kind: id === me ? "me" : id.startsWith("bot") ? "bot" : "visitor", role: e.r, x: e.x, z: e.z, s: e.s });
    }
    out.sort((a, b) => (a.id < b.id ? -1 : 1));
    const next = out.map((m) => `${m.id}:${m.s}:${m.x.toFixed(2)}:${m.z.toFixed(2)}`).join("|");
    if (next === sig.current) return;
    sig.current = next;
    setMarks(out);
    onActive(new Set(out.map((m) => m.id)).size);
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
              <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
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
                {m.kind === "me" ? "me" : m.kind === "bot" ? m.id : "visitor"} · {m.role}
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
  const [stats, setStats] = useState<Stats>({ seeds: 0, boxes: 0, t: 0, top: 0 });
  const [active, setActive] = useState(0);

  const c = useControls("3D 시공간 (박스 생성 확인)", {
    secPerUnit: { value: DEFAULT_BOXES.secPerUnit, min: 2, max: 600, step: 1, label: "한 단 = 몇 초 (시간축)" },
    unit: { value: DEFAULT_BOXES.unit, min: 0.2, max: 4, step: 0.1, label: "한 단의 높이 (월드 단위)" },
    width: { value: DEFAULT_BOXES.width, min: 0.3, max: 3, step: 0.05, label: "박스 폭 배율" },
    density: { value: DEFAULT_BOXES.density, min: 0.2, max: 4, step: 0.1, label: "단당 박스 수 배율" },
    showEdges: { value: true, label: "모서리 선" },
    follow: { value: true, label: "시간축 따라가기 (최신으로)" },
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
  const boxCfg = useMemo<BoxConfig>(
    () => ({ ...DEFAULT_BOXES, secPerUnit: c.secPerUnit, unit: c.unit, width: c.width, density: c.density }),
    [c.secPerUnit, c.unit, c.width, c.density],
  );

  return (
    <div className="relative h-full w-full" style={{ background: PAPER }}>
      <Leva hidden={hideUi} />
      <Canvas dpr={[1, 2]} camera={{ position: [16, 12, 22], fov: 40, near: 0.1, far: 800 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={[PAPER]} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[14, 30, 10]} intensity={1.3} />
        <directionalLight position={[-18, 10, -12]} intensity={0.35} />
        <gridHelper args={[80, 80, "#9aa0a8", "#d3d6db"]} position={[0, -0.01, 0]} />
        <SpaceBoxes log={log} fold={fold} boxCfg={boxCfg} showEdges={c.showEdges} follow={c.follow} controls={controls} onStats={setStats} />
        {c.markers && <Markers log={log} secPerUnit={c.secPerUnit} unit={c.unit} holdSec={c.markerHold} onActive={setActive} />}
        <OrbitControls ref={controls as never} makeDefault enableDamping dampingFactor={0.12} target={[0, 4, 0]} maxPolarAngle={Math.PI * 0.499} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-3 left-3 select-none font-mono text-[10px] leading-4 text-black/45">
        <div>
          seeds {stats.seeds} · boxes {stats.boxes} · t {Math.round(stats.t)} s · top {stats.top.toFixed(1)}
        </div>
        <div>x, z = ground · y = time (1 step = {boxCfg.secPerUnit} s) · concrete needs ≥ {fold.minVisitors} visitors</div>
        {c.markers && (
          <div>
            live now {active} (<span style={{ color: MARK_COLOR.me }}>me</span> · <span style={{ color: MARK_COLOR.bot }}>bot</span> ·{" "}
            <span style={{ color: MARK_COLOR.visitor }}>visitor</span>)
          </div>
        )}
      </div>
    </div>
  );
}

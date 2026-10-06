"use client";
/**
 * ParliamentGlobal — the shared ground seen from outside a life: Top (from above, FUTURE) and
 * Side (from the front, PRESENT by default).
 *
 * The fold of the whole log is taken at (latest event + horizonYears). Top defaults to a far
 * future where exposed slabs have worn away and only outlines of where people crowded remain;
 * Side defaults to horizon 0, i.e. what stood before the wear: the "skyline" of the architecture.
 * Concrete (slabs and desire paths) is drawn in one of three materials, switchable in Leva.
 * URL: ?demo=1 seeds a demo crowd · ?ui=0 hides the panel · ?at=<years> sets the horizon.
 */

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Leva, button, useControls } from "leva";
import * as THREE from "three";
import {
  clearWorld,
  foldWorld,
  horizonSeconds,
  latestS,
  seedParliamentDemoIfRequested,
  loadEvents,
  type EventLog,
  type FoldConfig,
  type Snapshot,
} from "@/lib/parliament";
import { ArchitectureLayer } from "./Architecture";
import { FilterMesh } from "./FilterMesh";
import { useArchControls, useFoldControls, useWorld } from "./useWorld";

const BG = "#05060a";

export type GlobalMode = "top" | "side";

interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

/** Frame the bulk of the events (2nd..98th percentile) so a few far wanderers do not shrink everything. */
function boundsOf(log: EventLog): Bounds | null {
  const ev = log.all();
  if (ev.length === 0) return null;
  const xs = ev.map((e) => e.x).sort((a, b) => a - b);
  const zs = ev.map((e) => e.z).sort((a, b) => a - b);
  const lo = Math.floor(ev.length * 0.02);
  const hi = Math.min(ev.length - 1, Math.ceil(ev.length * 0.98));
  const pad = 4;
  return { minX: xs[lo] - pad, maxX: xs[hi] + pad, minZ: zs[lo] - pad, maxZ: zs[hi] + pad };
}

function Surface({
  log,
  mode,
  horizonYears,
  cfg,
  heightUnit,
  snapRef,
}: {
  log: EventLog;
  mode: GlobalMode;
  horizonYears: number;
  cfg: FoldConfig;
  heightUnit: number;
  snapRef: React.MutableRefObject<Snapshot | null>;
}) {
  const { camera, size } = useThree();
  const timer = useRef(10);
  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < 0.5) return;
    timer.current = 0;
    const b = boundsOf(log);
    if (!b) {
      snapRef.current = null;
      return;
    }
    const cam = camera as THREE.OrthographicCamera;
    const events = log.all();
    snapRef.current = foldWorld(events, horizonSeconds(latestS(events), horizonYears), cfg);

    const spanX = Math.max(8, b.maxX - b.minX);
    const cx = (b.minX + b.maxX) / 2;
    if (mode === "top") {
      const spanZ = Math.max(8, b.maxZ - b.minZ);
      const cz = (b.minZ + b.maxZ) / 2;
      cam.zoom = Math.min(size.width / spanX, size.height / spanZ) * 0.96;
      cam.position.set(cx, 50, cz);
      cam.up.set(0, 0, -1);
      cam.lookAt(cx, 0, cz);
    } else {
      // front view: x across, y up; frame the tallest thing that may exist
      const spanY = Math.max(4, cfg.maxHeight * heightUnit + 2);
      cam.zoom = Math.min(size.width / spanX, size.height / spanY) * 0.96;
      const cy = spanY / 2 - 0.8;
      cam.position.set(cx, cy, 80);
      cam.up.set(0, 1, 0);
      cam.lookAt(cx, cy, 0);
    }
    cam.updateProjectionMatrix();
  });
  return null;
}

export default function ParliamentGlobal({ mode }: { mode: GlobalMode }) {
  const [demo] = useState(() => seedParliamentDemoIfRequested());
  const log = useWorld();
  const cfg = useFoldControls();
  const arch = useArchControls(mode === "top" ? 0.2 : 1.0);
  const snapRef = useRef<Snapshot | null>(null);
  const params = useMemo(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)), []);
  const hideUi = demo || params.get("ui") === "0";

  const c = useControls(mode === "top" ? "Top view (미래)" : "Side view (단면)", {
    horizonYears: {
      value: Number(params.get("at") ?? (mode === "top" ? 3000 : 0)),
      min: 0,
      max: 100000,
      step: 10,
      label: "미래 (마지막 사건 이후 년)",
    },
    reload: button(() => log.addMany(loadEvents())),
    "clear world": button(() => {
      if (window.confirm("Empty the shared world (all events) and start a new epoch? Open player tabs follow.")) {
        clearWorld();
        log.clear();
      }
    }),
  });

  const lit = mode === "side" && arch.style === "block";

  return (
    <div className="relative h-full w-full" style={{ background: BG }}>
      <Leva hidden={hideUi} />
      <Canvas
        orthographic
        dpr={1}
        camera={{ position: [0, 50, 0], zoom: 20, near: 0.1, far: 300 }}
        gl={{ antialias: mode === "side", preserveDrawingBuffer: true }}
      >
        <color attach="background" args={[BG]} />
        {lit && (
          <>
            <ambientLight intensity={0.55} />
            <directionalLight position={[10, 25, 30]} intensity={1.1} />
          </>
        )}
        <Surface log={log} mode={mode} horizonYears={c.horizonYears} cfg={cfg} heightUnit={arch.heightUnit} snapRef={snapRef} />
        <ArchitectureLayer
          getSnapshot={() => snapRef.current}
          heightUnit={arch.heightUnit}
          style={arch.style}
          showPaths={arch.showPaths}
          every={0.5}
          unlit={!lit}
        />
        <FilterMesh getSnapshot={() => snapRef.current} unlit every={0.5} />
        {mode === "side" && (
          // the ground line
          <mesh position={[0, -0.03, 0]}>
            <boxGeometry args={[400, 0.06, 0.2]} />
            <meshBasicMaterial color="#555555" />
          </mesh>
        )}
      </Canvas>
    </div>
  );
}

"use client";
/**
 * ParliamentTop — the ground seen from straight above, in the FUTURE.
 *
 * Shows the fold of the whole log at (latest event + horizonYears): exposed slabs have worn
 * away and what is left is the outline of where people crowded. With the horizon at 0 it is
 * the present surface. URL: ?demo=1 seeds a demo crowd · ?ui=0 hides the panel.
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
import { StructureMesh } from "./StructureMesh";
import { useFoldControls, useWorld } from "./useWorld";

const BG = "#05060a";

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

function Surface({ log, horizonYears, cfg, snapRef }: { log: EventLog; horizonYears: number; cfg: FoldConfig; snapRef: React.MutableRefObject<Snapshot | null> }) {
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
    const spanX = Math.max(8, b.maxX - b.minX);
    const spanZ = Math.max(8, b.maxZ - b.minZ);
    const zoom = Math.min(size.width / spanX, size.height / spanZ) * 0.96;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    cam.zoom = zoom;
    cam.position.set(cx, 50, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    cam.updateProjectionMatrix();
    const events = log.all();
    snapRef.current = foldWorld(events, horizonSeconds(latestS(events), horizonYears), cfg);
  });
  return null;
}

export default function ParliamentTop() {
  const [demo] = useState(() => seedParliamentDemoIfRequested());
  const log = useWorld();
  const cfg = useFoldControls();
  const snapRef = useRef<Snapshot | null>(null);
  const params = useMemo(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)), []);
  const hideUi = demo || params.get("ui") === "0";

  const c = useControls("Top view (미래)", {
    horizonYears: { value: Number(params.get("at") ?? 3000), min: 0, max: 100000, step: 10, label: "미래 (마지막 사건 이후 년)" },
    reload: button(() => log.addMany(loadEvents())),
    "clear world": button(() => {
      if (window.confirm("Empty the shared world (all events) and start a new epoch? Open player tabs follow.")) {
        clearWorld();
        log.clear();
      }
    }),
  });

  return (
    <div className="relative h-full w-full" style={{ background: BG, imageRendering: "pixelated" }}>
      <Leva hidden={hideUi} />
      <Canvas
        orthographic
        dpr={1}
        camera={{ position: [0, 50, 0], zoom: 20, near: 0.1, far: 200 }}
        gl={{ antialias: false, preserveDrawingBuffer: true }}
        style={{ imageRendering: "pixelated" }}
      >
        <color attach="background" args={[BG]} />
        <Surface log={log} horizonYears={c.horizonYears} cfg={cfg} snapRef={snapRef} />
        <StructureMesh getSnapshot={() => snapRef.current} unlit every={0.5} heightUnit={0.2} />
      </Canvas>
    </div>
  );
}

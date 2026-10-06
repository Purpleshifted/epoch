"use client";
/**
 * ParliamentTop: the ground from straight above, in a FUTURE: `horizonYears` model years after the
 * latest event. The exposed slabs have worn away by then; what a worker crowd leaves is the
 * outline of the foundation (dark grey). Unlit flat palette colours, no text.
 *
 * URL: ?demo=1 seeds the worker crowd · ?at=<years> horizon · ?ui=0 hides the panel
 */

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Leva, button, useControls } from "leva";
import * as THREE from "three";
import { foldWorld, horizonSeconds, latestS, seedParliamentDemoIfRequested, type FoldConfig, type Snapshot } from "@/lib/parliament";
import { StructureMesh } from "./StructureMesh";
import { useFoldControls } from "./foldControls";
import { useWorld } from "./useWorld";

const BG = "#05060a";

function TopScene({ world, horizonYears, cfg }: { world: ReturnType<typeof useWorld>; horizonYears: number; cfg: FoldConfig }) {
  const { gl, camera, size } = useThree();
  const snap = useRef<Snapshot | null>(null);
  const timer = useRef(10);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const hRef = useRef(horizonYears);
  hRef.current = horizonYears;

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < 0.5) return;
    timer.current = 0;
    const events = world.log.all();
    if (events.length === 0) { snap.current = { slabs: [], filters: [] }; return; }

    const sView = horizonSeconds(latestS(events), hRef.current);
    snap.current = foldWorld(events, sView, cfgRef.current);

    // frame the bulk of the events (2nd..98th percentile) so a few far wanderers do not shrink everything
    const xs = events.map((e) => e.x).sort((a, b) => a - b);
    const zs = events.map((e) => e.z).sort((a, b) => a - b);
    const lo = Math.floor(events.length * 0.02);
    const hi = Math.min(events.length - 1, Math.ceil(events.length * 0.98));
    const pad = 4;
    const minX = xs[lo] - pad, maxX = xs[hi] + pad, minZ = zs[lo] - pad, maxZ = zs[hi] + pad;
    const cam = camera as THREE.OrthographicCamera;
    const zoom = Math.min(size.width / (maxX - minX), size.height / (maxZ - minZ)) * 0.96;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    cam.zoom = zoom;
    cam.position.set(cx, 50, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    cam.updateProjectionMatrix();
    void gl;
  });

  return <StructureMesh getSnapshot={() => snap.current} heightUnit={0.05} unlit />;
}

export default function ParliamentTop() {
  const [demo] = useState(() => seedParliamentDemoIfRequested());
  const world = useWorld();
  const params = useMemo(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)), []);
  const hideUi = params.get("ui") === "0";

  const c = useControls("Top view (미래)", {
    horizonYears: { value: Number(params.get("at") ?? 3000), min: 0, max: 1_000_000, step: 10, label: "미래 (latest event + model years)" },
    reload: button(() => world.reload()),
    "clear world": button(() => {
      if (window.confirm("Empty the shared world and start a new epoch? Open player tabs keep their own copy until reloaded.")) world.clear();
    }),
  });
  const cfg = useFoldControls();

  void demo;
  return (
    <div className="relative h-full w-full" style={{ background: BG, imageRendering: "pixelated" }}>
      <Leva hidden={hideUi} />
      <Canvas orthographic dpr={1} camera={{ position: [0, 50, 0], zoom: 20, near: 0.1, far: 200 }} gl={{ antialias: false, preserveDrawingBuffer: true }} style={{ imageRendering: "pixelated" }}>
        <color attach="background" args={[BG]} />
        <TopScene world={world} horizonYears={c.horizonYears} cfg={cfg} />
      </Canvas>
    </div>
  );
}

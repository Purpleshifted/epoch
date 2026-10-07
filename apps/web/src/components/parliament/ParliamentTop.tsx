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
import { ArchitectureLayer, type ArchStyle } from "./Architecture";
import { FilterMesh } from "./FilterMesh";
import { useArchControls, useFoldControls, useWorld } from "./useWorld";

const BG = "#05060a";
const PAPER = "#e9ebee";

export type GlobalMode = "top" | "side";

/** Fixed window onto the ground (centre + width in world units); set by hand in Leva, never from the data. */
interface ViewWindow {
  cx: number;
  cz: number;
  span: number;
}

function Surface({
  log,
  mode,
  horizonYears,
  cfg,
  heightUnit,
  view,
  snapRef,
}: {
  log: EventLog;
  mode: GlobalMode;
  horizonYears: number;
  cfg: FoldConfig;
  heightUnit: number;
  view: ViewWindow;
  snapRef: React.MutableRefObject<Snapshot | null>;
}) {
  const { camera, size } = useThree();
  const timer = useRef(10);
  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < 0.5) return;
    timer.current = 0;
    const cam = camera as THREE.OrthographicCamera;
    const events = log.all();
    snapRef.current = foldWorld(events, horizonSeconds(latestS(events), horizonYears), cfg);

    const { cx, cz, span } = view;
    if (mode === "top") {
      cam.zoom = Math.min(size.width, size.height) / span;
      cam.position.set(cx, 50, cz);
      cam.up.set(0, 0, -1);
      cam.lookAt(cx, 0, cz);
    } else {
      // front view: x across, y up; the vertical window is set by the height settings, not by the data
      const spanY = Math.max(4, cfg.maxHeight * heightUnit + 2);
      cam.zoom = Math.min(size.width / span, size.height / spanY);
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
  const arch = useArchControls(mode === "top" ? 0.2 : 1.0, "photo");
  const snapRef = useRef<Snapshot | null>(null);
  const params = useMemo(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)), []);
  const hideUi = demo || params.get("ui") === "0";

  const c = useControls(mode === "top" ? "Top view (미래)" : "Side view (단면)", {
    horizonYears: {
      value: Number(params.get("at") ?? (mode === "top" ? 300 : 0)),
      min: 0,
      max: 100000,
      step: 10,
      label: "미래 (마지막 사건 이후 년)",
    },
    viewCx: { value: 0, min: -60, max: 60, step: 0.5, label: "화면 중심 x (고정, 자동 맞춤 없음)" },
    viewCz: { value: 0, min: -60, max: 60, step: 0.5, label: "화면 중심 z (Top)" },
    viewSpan: { value: 30, min: 6, max: 120, step: 1, label: "화면 폭 (월드 단위)" },
    reload: button(() => log.addMany(loadEvents())),
    "clear world": button(() => {
      if (window.confirm("Empty the shared world (all events) and start a new epoch? Open player tabs follow.")) {
        clearWorld();
        log.clear();
      }
    }),
  });

  // The collage reads as a front elevation on Side and as a plan (flat fragments + hard shadows) on Top.
  const style: ArchStyle = arch.style;
  const paper = style === "shards" || style === "photo";
  const bg = paper ? PAPER : BG;
  const lit = mode === "side" && style === "block";

  return (
    <div className="relative h-full w-full" style={{ background: bg }}>
      <Leva hidden={hideUi} />
      <Canvas
        orthographic
        dpr={1}
        camera={{ position: [0, 50, 0], zoom: 20, near: 0.1, far: 300 }}
        gl={{ antialias: mode === "side", preserveDrawingBuffer: true }}
      >
        <color attach="background" args={[bg]} />
        {lit && (
          <>
            <ambientLight intensity={0.55} />
            <directionalLight position={[10, 25, 30]} intensity={1.1} />
          </>
        )}
        <Surface log={log} mode={mode} horizonYears={c.horizonYears} cfg={cfg} heightUnit={arch.heightUnit} view={{ cx: c.viewCx, cz: c.viewCz, span: c.viewSpan }} snapRef={snapRef} />
        <ArchitectureLayer
          getSnapshot={() => snapRef.current}
          heightUnit={arch.heightUnit}
          style={style}
          showPaths={arch.showPaths}
          every={0.5}
          unlit={!lit}
          shards={arch.shards}
          collage={arch.collage}
          view={mode}
        />
        <FilterMesh getSnapshot={() => snapRef.current} unlit every={0.5} />
        {mode === "side" && (
          // the ground line
          <mesh position={[0, -0.03, 0]}>
            <boxGeometry args={[400, 0.06, 0.2]} />
            <meshBasicMaterial color={paper ? "#15181c" : "#555555"} />
          </mesh>
        )}
      </Canvas>
    </div>
  );
}

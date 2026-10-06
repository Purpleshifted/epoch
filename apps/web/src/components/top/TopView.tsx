"use client";
/**
 * TopView: the ground seen from straight above, as a 16-colour pixel map. No text.
 *
 * It draws the shared ground resolved at "now + Δ", where Δ is chosen so that something
 * scattered right now would be `years` simulated years old. With years = 0 it is the
 * present surface; with years = 10 000 only what lasts is left, and the natural stock that
 * visitors wore away stays gone. This is the "future top view" of the advisor's feedback.
 *
 * URL: ?demo=1 seeds a replayed crowd (lib/stratum/demo.ts) · ?at=<years> · ?ui=0 hides the panel
 *      ?wear=<n> natural wear (same knob as the mobile scene, default 3)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Leva, button, useControls } from "leva";
import * as THREE from "three";
import {
  CELL_SIZE,
  naturalItemsAround,
  resolveNaturalIn,
  secondsForYears,
  seedDemoIfRequested,
  type NaturalItem,
} from "@/lib/stratum";
import { spriteCell, variantAt } from "@/components/ground/atlas";
import { PointBuffer, makePixelMaterial } from "@/components/ground/pixelPoints";
import { useGround, type GroundHandle } from "@/components/ground/useGround";

const MAX_DEP = 8000;
const MAX_NAT = 5000;
const BG = "#05060a";

interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

/** Frame the bulk of the data (2nd..98th percentile), so a few far wanderers do not shrink everything. */
function boundsOf(ground: GroundHandle): Bounds | null {
  const deps = ground.store.allDeposits();
  if (deps.length === 0) return null;
  const xs = deps.map((d) => d.x).sort((a, b) => a - b);
  const zs = deps.map((d) => d.z).sort((a, b) => a - b);
  const lo = Math.floor(deps.length * 0.02);
  const hi = Math.min(deps.length - 1, Math.ceil(deps.length * 0.98));
  const pad = 2;
  return { minX: xs[lo] - pad, maxX: xs[hi] + pad, minZ: zs[lo] - pad, maxZ: zs[hi] + pad };
}

function Surface({ ground, years, itemSize, wear, showNatural }: {
  ground: GroundHandle; years: number; itemSize: number; wear: number; showNatural: boolean;
}) {
  const { gl, camera, size } = useThree();
  const buf = useMemo(() => new PointBuffer(MAX_DEP + MAX_NAT), []);
  const material = useMemo(() => makePixelMaterial({ ortho: true, size: itemSize, snap: 6 }), [itemSize]);
  const bounds = useRef<Bounds | null>(null);
  const natural = useRef<{ key: string; items: NaturalItem[] }>({ key: "", items: [] });
  const timer = useRef(10);

  useEffect(() => () => { buf.dispose(); material.dispose(); }, [buf, material]);

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < 0.5) return;
    timer.current = 0;

    const cam = camera as THREE.OrthographicCamera;
    const b = boundsOf(ground);
    if (!b) { buf.draw(0); return; }

    // the camera always frames the data; the natural-stock window is re-derived when the bounds change
    const bk = `${b.minX.toFixed(0)}|${b.maxX.toFixed(0)}|${b.minZ.toFixed(0)}|${b.maxZ.toFixed(0)}`;
    bounds.current = b;

    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;
    const zoom = Math.min(size.width / spanX, size.height / spanZ) * 0.96;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    cam.zoom = zoom;
    cam.position.set(cx, 50, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    cam.updateProjectionMatrix();
    material.uniforms.uPxPerUnit.value = zoom * gl.getPixelRatio();

    const now = ground.now() + secondsForYears(years);
    let n = 0;

    // natural stock first (underneath), then deposits oldest -> newest
    if (showNatural) {
      const nk = `${bk}`;
      if (natural.current.key !== nk) {
        const r = Math.hypot(spanX, spanZ) / 2 + CELL_SIZE;
        natural.current = { key: nk, items: naturalItemsAround(cx, cz, r).filter((it) => it.x >= b.minX && it.x <= b.maxX && it.z >= b.minZ && it.z <= b.maxZ) };
      }
      const res = resolveNaturalIn(natural.current.items, ground.store, now, undefined, wear);
      let k = 0;
      for (const r of res) {
        if (k >= MAX_NAT) break;
        const it = r.item;
        const cell = spriteCell(it.def.id, it.variant);
        if (r.alive) buf.set(n++, it.x, 0, it.z, cell, it.def.material, "fresh", 0.8, true);
        else if (r.fate && r.fate.stage !== "vanished") buf.set(n++, it.x, 0, it.z, cell, it.def.material, r.fate.stage, 0.8, true);
        else continue;
        k++;
      }
    }

    const dep = ground.store.resolveAll(now).filter((r) => r.fate.stage !== "vanished");
    dep.sort((a, c) => a.rec.t - c.rec.t);
    let d = 0;
    for (const { rec, fate } of dep) {
      if (d >= MAX_DEP) break;
      buf.set(n++, rec.x, 0, rec.z, spriteCell(rec.item, rec.variant), rec.material, fate.stage, 1);
      d++;
    }
    buf.draw(n);
  });

  return <points geometry={buf.geometry} material={material} frustumCulled={false} renderOrder={1} />;
}

export default function TopView() {
  const [demo] = useState(() => seedDemoIfRequested());
  const ground = useGround();
  const params = useMemo(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)), []);
  const hideUi = params.get("ui") === "0";

  const c = useControls("Top view", {
    years: { value: Number(params.get("at") ?? 0), min: 0, max: 1_000_000, step: 1, label: "future (years)" },
    itemSize: { value: 1.3, min: 0.3, max: 2.5, step: 0.05 },
    wear: { value: Number(params.get("wear") ?? 3), min: 0, max: 20, step: 0.5, label: "natural wear" },
    showNatural: { value: true, label: "natural stock" },
    reload: button(() => ground.reload()),
    "clear storage": button(() => {
      if (window.confirm("Empty the shared ground (deposits + crossings) and start a new epoch? Open mobile tabs follow.")) ground.clear();
    }),
  });

  void demo;
  return (
    <div className="relative h-full w-full" style={{ background: BG, imageRendering: "pixelated" }}>
      <Leva hidden={hideUi} collapsed={!hideUi && false} />
      <Canvas
        orthographic
        dpr={1}
        camera={{ position: [0, 50, 0], zoom: 20, near: 0.1, far: 200 }}
        gl={{ antialias: false, preserveDrawingBuffer: true }}
        style={{ imageRendering: "pixelated" }}
      >
        <color attach="background" args={[BG]} />
        <Surface ground={ground} years={c.years} itemSize={c.itemSize} wear={c.wear} showNatural={c.showNatural} />
      </Canvas>
    </div>
  );
}

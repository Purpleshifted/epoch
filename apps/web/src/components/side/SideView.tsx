"use client";
/**
 * SideView: a cross-section of the ground. No text.
 *
 * x is the world x of each item; the vertical axis is depth = log10(1 + simulated age in
 * years), so the newest scatter lies on top and older items sink. Thin lines mark decades
 * of years (1, 10, 100 … 1 000 000 y) and alternate dark bands separate them. Buried items
 * are dim, fossils are outlined, vanished items are gone (same look as the other views).
 *
 * URL: ?demo=1 · ?at=<years> (look from the future) · ?ui=0 hides the panel
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Leva, button, useControls } from "leva";
import * as THREE from "three";
import { depthOfYears, geoYears, secondsForYears, seedDemoIfRequested } from "@/lib/stratum";
import { spriteCell } from "@/components/ground/atlas";
import { PointBuffer, makePixelMaterial } from "@/components/ground/pixelPoints";
import { useGround, type GroundHandle } from "@/components/ground/useGround";

const MAX = 8000;
const BG = "#05060a";
const BAND = "#090c18";
const LINE = "#555555";
const DECADES = [0, 1, 2, 3, 4, 5, 6]; // 10^k years
const BOUNDARY = DECADES.map((k) => depthOfYears(Math.pow(10, k)));

function Strata({ group }: { group: React.RefObject<THREE.Group | null> }) {
  const bands = useMemo(
    () =>
      BOUNDARY.map((d, i) => {
        const top = i === 0 ? 0 : BOUNDARY[i - 1];
        return { top, h: d - top, odd: i % 2 === 1 };
      }),
    [],
  );
  const lines = useMemo(() => {
    const pts: number[] = [];
    for (const d of BOUNDARY) pts.push(-2000, -d, -1, 2000, -d, -1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <group ref={group}>
      {bands.map((b, i) => (
        <mesh key={i} position={[0, -(b.top + b.h / 2), -2]} renderOrder={-2}>
          <planeGeometry args={[4000, b.h]} />
          <meshBasicMaterial color={b.odd ? BAND : BG} toneMapped={false} depthTest={false} />
        </mesh>
      ))}
      <lineSegments geometry={lines} renderOrder={-1}>
        <lineBasicMaterial color={LINE} toneMapped={false} depthTest={false} />
      </lineSegments>
    </group>
  );
}

function Section({ ground, years, itemSize }: { ground: GroundHandle; years: number; itemSize: number }) {
  const { gl, camera, size } = useThree();
  const buf = useMemo(() => new PointBuffer(MAX), []);
  const material = useMemo(() => makePixelMaterial({ ortho: true, size: itemSize, snap: 6 }), [itemSize]);
  const strata = useRef<THREE.Group>(null);
  const timer = useRef(10);

  useEffect(() => () => { buf.dispose(); material.dispose(); }, [buf, material]);

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < 0.5) return;
    timer.current = 0;

    const deps = ground.store.allDeposits();
    if (deps.length === 0) { buf.draw(0); return; }
    let minX = Infinity, maxX = -Infinity;
    for (const d of deps) { if (d.x < minX) minX = d.x; if (d.x > maxX) maxX = d.x; }
    minX -= 2; maxX += 2;

    const now = ground.now() + secondsForYears(years);
    const res = ground.store.resolveAll(now).filter((r) => r.fate.stage !== "vanished");
    let maxD = 0;
    const depth = new Float32Array(res.length);
    for (let i = 0; i < res.length; i++) {
      const dd = depthOfYears(geoYears(now - res[i].rec.t));
      depth[i] = dd;
      if (dd > maxD) maxD = dd;
    }
    maxD = Math.max(maxD + 0.35, 3);

    const cam = camera as THREE.OrthographicCamera;
    const zoom = (size.width / (maxX - minX)) * 0.97;
    const visH = size.height / zoom;
    const yScale = (visH * 0.96) / maxD;
    cam.zoom = zoom;
    cam.position.set((minX + maxX) / 2, -(maxD * yScale) / 2, 20);
    cam.up.set(0, 1, 0);
    cam.lookAt((minX + maxX) / 2, -(maxD * yScale) / 2, 0);
    cam.updateProjectionMatrix();
    if (strata.current) strata.current.scale.y = yScale;
    material.uniforms.uPxPerUnit.value = zoom * gl.getPixelRatio();

    // oldest first so the newest sits on top
    const order = Array.from(res.keys()).sort((a, b) => depth[b] - depth[a]);
    let n = 0;
    for (const i of order) {
      if (n >= MAX) break;
      const { rec, fate } = res[i];
      buf.set(n++, rec.x, -depth[i] * yScale, 0, spriteCell(rec.item, rec.variant), rec.material, fate.stage, 1);
    }
    buf.draw(n);
  });

  return (
    <>
      <Strata group={strata} />
      <points geometry={buf.geometry} material={material} frustumCulled={false} renderOrder={1} />
    </>
  );
}

export default function SideView() {
  const [demo] = useState(() => seedDemoIfRequested());
  const ground = useGround();
  const params = useMemo(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)), []);
  const hideUi = params.get("ui") === "0";
  const c = useControls("Side view", {
    years: { value: Number(params.get("at") ?? 0), min: 0, max: 1_000_000, step: 1, label: "future (years)" },
    itemSize: { value: 0.7, min: 0.3, max: 2, step: 0.05 },
    reload: button(() => ground.reload()),
    "clear storage": button(() => {
      if (window.confirm("Empty the shared ground (deposits + crossings) and start a new epoch? Open mobile tabs follow.")) ground.clear();
    }),
  });
  void demo;
  return (
    <div className="relative h-full w-full" style={{ background: BG }}>
      <Leva hidden={hideUi} />
      <Canvas
        orthographic
        dpr={1}
        camera={{ position: [0, 0, 20], zoom: 20, near: 0.1, far: 100 }}
        gl={{ antialias: false, preserveDrawingBuffer: true }}
        style={{ imageRendering: "pixelated" }}
      >
        <color attach="background" args={[BG]} />
        <Section ground={ground} years={c.years} itemSize={c.itemSize} />
      </Canvas>
    </div>
  );
}

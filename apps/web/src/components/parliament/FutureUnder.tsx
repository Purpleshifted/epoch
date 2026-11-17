/**
 * WHAT IS LEFT UNDER THE GROUND of the layer above the column (stage 1 of the order of 2026-11-17; the artist: "1단계
 * 진행"). The layer is what is found after the people are gone (FutureVillage.tsx, lib/parliament/futureVillage.ts),
 * and of a settlement it is what lies under the ground that is kept best: shallow buried things — sewers, pipes,
 * foundations — are out of erosion's reach, far likelier to be preserved than anything standing on the surface
 * (Zalasiewicz, Waters & Williams 2014; the cuts of foundations and drains are themselves part of the deposit:
 * Edgeworth et al. 2015 — docs/future-village-literature.md T5, T4).
 *
 * Two things, each with its knob (a folder of its own, 미래 마을 층 — 땅 아래, saved like every other group):
 *  - THE BUILDINGS GO FROM THE TOP DOWN, AND THEIR FOOTINGS STAY: asked of the worker with the layer's other knobs
 *    (`futureUnder.cfg`, merged into SpaceRequest.future by the wall; the rule is SpaceModel.computeFuture's);
 *  - THE PIPES LAID UNDER THE COLUMN ARE DRAWN UNDER THE LAYER'S GROUND, every run of them, as the column draws its
 *    own: tubes, in a grey.
 *
 * A file of its own, beside FutureVillage.tsx: it reads that layer's place from its knobs instead of being drawn
 * inside it.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { levaStore, useControls } from "leva";
import * as THREE from "three";
import { futureLink } from "./FutureVillage";
import { savable } from "./levaSave";

/** What the wall's ticker adds to the layer's knobs when it asks for the layer (FutureConfig.under). */
export const futureUnder: { cfg: { under: boolean } | null } = { cfg: null };

const GROUP = "미래 마을 층 — 땅 아래";
/** The layer's own folder (FutureVillage.tsx): where it stands is read from there. */
const LAYER = "미래 마을 층";
const CAP = 6000;

const knob = (path: string): unknown => {
  try {
    return levaStore.get(path);
  } catch {
    return undefined;
  }
};

export function FutureUnder({ unit, top }: { unit: number; top: THREE.IUniform<number> }) {
  const k = useControls(
    GROUP,
    savable(GROUP, {
      under: { value: true, label: "땅 위가 먼저 사라지고 땅 아래가 남음 (위에서부터 몸체 → 바닥판 → 보 → 기둥 · 기단은 거의 남고 지하실과 말뚝은 남음 · 끄면 기둥의 침식 순서)" },
      pipes: { value: true, label: "묻힌 관을 그림 (층의 땅 아래 · 놓였던 것 전부)" },
      depth: { value: 1, min: 0, max: 6, step: 0.25, label: "관의 깊이 (단 · 층의 땅에서 아래로)" },
      radius: { value: 0.08, min: 0.02, max: 0.4, step: 0.01, label: "관의 굵기 (월드, 반지름)" },
      color: { value: "#7c7f84", label: "관의 색 (무채색)" },
    }),
    { collapsed: true },
  );
  futureUnder.cfg = useMemo(() => ({ under: k.under }), [k.under]);
  useEffect(
    () => () => {
      futureUnder.cfg = null;
    },
    [],
  );

  const mesh = useRef<THREE.InstancedMesh>(null);
  const drawn = useRef("");
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), d: new THREE.Vector3() }), []);

  useFrame(() => {
    const im = mesh.current;
    if (!im) return;
    const r = futureLink.result;
    const on = !!r && k.pipes && knob(`${LAYER}.on`) !== false;
    im.visible = on;
    if (!on || !r) return;
    // WHERE THE LAYER'S GROUND IS — as FutureVillage places it: above the window's top (or above the slot it was read
    // from), the gap apart; the pipes lie `depth` slots under it
    const gap = Number(knob(`${LAYER}.gap`) ?? 8);
    const base = (knob(`${LAYER}.anchor`) === "built" ? r.k + 1 : top.value) + Math.max(0, Number.isFinite(gap) ? gap : 8);
    im.position.y = (base - k.depth) * unit;
    const sig = `${futureLink.version}:${k.radius}`;
    if (sig === drawn.current) return;
    drawn.current = sig;
    // (a result of a worker started before this was written has no pipes: nothing is drawn)
    const runs = r.pipes ?? new Float32Array(0);
    const n = Math.min(CAP, Math.floor(runs.length / 4));
    const { m, p, q, s, up, d } = tmp;
    for (let i = 0; i < n; i++) {
      const ax = runs[i * 4], az = runs[i * 4 + 1], bx = runs[i * 4 + 2], bz = runs[i * 4 + 3];
      const len = Math.hypot(bx - ax, bz - az);
      p.set((ax + bx) / 2, 0, (az + bz) / 2);
      if (len > 1e-4) q.setFromUnitVectors(up, d.set((bx - ax) / len, 0, (bz - az) / len));
      else q.identity();
      s.set(k.radius, Math.max(1e-4, len), k.radius);
      im.setMatrixAt(i, m.compose(p, q, s));
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={(im) => {
        mesh.current = im;
        if (im && !drawn.current) im.count = 0;
      }}
      args={[undefined, undefined, CAP]}
      frustumCulled={false}
    >
      <cylinderGeometry args={[1, 1, 1, 8]} />
      <meshStandardMaterial color={k.color} roughness={0.9} metalness={0} />
    </instancedMesh>
  );
}

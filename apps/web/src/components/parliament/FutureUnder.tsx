/**
 * WHAT IS LEFT UNDER THE GROUND of the layer above the column (stage 1 of the order of 2026-11-17; the artist: "1단계
 * 진행"). The layer is what is found after the people are gone (FutureVillage.tsx, lib/parliament/futureVillage.ts),
 * and of a settlement it is what lies under the ground that is kept best: shallow buried things — sewers, pipes,
 * foundations — are out of erosion's reach, far likelier to be preserved than anything standing on the surface
 * (Zalasiewicz, Waters & Williams 2014; the cuts of foundations and drains are themselves part of the deposit:
 * Edgeworth et al. 2015 — docs/future-village-literature.md T5, T4).
 *
 * And (stage 2, the same day: "2단계 진행") WHAT A PLACE'S WHOLE OCCUPATION LEAVES IN THE GROUND: a mound where it was
 * built for long or again and again, dark earth where it was only lightly built (futureVillage.ts `deposit`).
 *
 * Each with its knob (a folder of its own, 미래 마을 층 — 땅 아래, saved like every other group):
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
import { CELL_SIZE } from "@/lib/stratum/field";
import { futureLink } from "./FutureVillage";
import { savable } from "./levaSave";

/** What the wall's ticker adds to the layer's knobs when it asks for the layer (FutureConfig.under). */
export const futureUnder: { cfg: { under: boolean; moundAt: number; fate?: boolean; succession?: boolean } | null } = { cfg: null };

const GROUP = "미래 마을 층 — 땅 아래";
/** The layer's own folder (FutureVillage.tsx): where it stands is read from there. */
const LAYER = "미래 마을 층";
const CAP = 6000;
/** The most mounds, and the most patches of dark earth, that are drawn (the world is 160 × 160 ground cells). */
const DEP_CAP = 12000;

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
      // THE DEPOSIT (stage 2; the artist, 2026-11-17: "2단계 진행")
      mound: { value: true, label: "오래 · 거듭 지어진 자리에 잔해 둔덕 (덩어리에 남아 있는 전부에서 셈 · 오래일수록 두껍고 넓음)" },
      moundAt: { value: 12, min: 2, max: 60, step: 1, label: "둔덕이 생기는 기준 (그 칸이 지어져 있던 단 수 · 다시 지어질 때마다 절반씩 더 침)" },
      moundMax: { value: 0.6, min: 0.05, max: 3, step: 0.05, label: "둔덕의 가장 두꺼운 높이 (단)" },
      moundColor: { value: "#5b5e63", label: "둔덕의 색 (무채색)" },
      stain: { value: true, label: "가볍게 스친 자리에 어두운 흙 한 겹 (기준에 못 미치고 건물이 거의 남지 않은 칸)" },
      stainColor: { value: "#17181a", label: "어두운 흙의 색 (무채색)" },
      // LIVED IN TO THE END, OR LEFT BEFORE IT (stage 3; the artist, 2026-11-17: "3단계 진행")
      fate: { value: true, label: "끝까지 서 있던 건물은 빠진 자재가 제 발치에 쓰러져 남고 · 끝나기 전에 버려진 건물은 몸체 · 바닥판 · 보가 뜯겨 나가 기둥과 기초만 (오래전에 버려졌을수록 많이)" },
      // THE ORDER IN WHICH THE PLANTS TAKE IT (stage 4; the artist, 2026-11-17: "4단계 진행")
      succession: { value: true, label: "식생이 차지하는 순서: 풀 → 덤불 → 나무 (층이 삭을수록 · 먼저 버려진 자리 · 물가 · 관 위에서 빨리, 지붕 위에서는 늦게 · 오래 걸은 길과 관을 따라 덤불 · 나무 옆의 길은 뿌리에 갈라짐)" },
    }),
    { collapsed: true },
  );
  futureUnder.cfg = useMemo(() => ({ under: k.under, moundAt: k.moundAt, fate: k.fate, succession: k.succession }), [k.under, k.moundAt, k.fate, k.succession]);
  useEffect(
    () => () => {
      futureUnder.cfg = null;
    },
    [],
  );

  const mesh = useRef<THREE.InstancedMesh>(null);
  const drawn = useRef("");
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), d: new THREE.Vector3() }), []);

  const mounds = useRef<THREE.InstancedMesh>(null);
  const stains = useRef<THREE.InstancedMesh>(null);
  const drawnDep = useRef("");
  const tone = useMemo(() => ({ a: new THREE.Color(), b: new THREE.Color(), c: new THREE.Color() }), []);

  useFrame(() => {
    const r = futureLink.result;
    const layerOn = !!r && knob(`${LAYER}.on`) !== false;
    // WHERE THE LAYER'S GROUND IS — as FutureVillage places it: above the window's top (or above the slot it was read
    // from), the gap apart
    const gap = Number(knob(`${LAYER}.gap`) ?? 8);
    const base = ((knob(`${LAYER}.anchor`) === "built" && r ? r.k + 1 : top.value) + Math.max(0, Number.isFinite(gap) ? gap : 8)) * unit;

    // THE DEPOSIT (stage 2): on the layer's ground a mound where a place was built for long or again and again — a
    // low heap, the higher and wider the longer — and a patch of dark earth where one was only lightly built
    const mm = mounds.current, sm = stains.current;
    if (mm) mm.visible = layerOn && k.mound;
    if (sm) sm.visible = layerOn && k.stain;
    if (mm && sm && r && layerOn) {
      mm.position.y = base;
      sm.position.y = base + 0.012;
      const sig = `${futureLink.version}:${k.moundMax}:${k.stainColor}:${unit}`;
      if (sig !== drawnDep.current) {
        drawnDep.current = sig;
        const { m, p, q, s } = tmp;
        q.identity();
        const ms = r.mounds ?? new Float32Array(0), ss = r.stains ?? new Float32Array(0);
        const nm = Math.min(DEP_CAP, Math.floor(ms.length / 4)), ns = Math.min(DEP_CAP, Math.floor(ss.length / 4));
        for (let i = 0; i < nm; i++) {
          // (score 1 = it has only just become a mound … 4 and more = as thick as a mound gets)
          const f = Math.min(1, (ms[i * 4 + 2] - 1) / 3), rnd = ms[i * 4 + 3];
          const rad = CELL_SIZE * (0.7 + 0.35 * rnd + 0.35 * f);
          p.set(ms[i * 4] + (rnd - 0.5) * CELL_SIZE * 0.4, 0, ms[i * 4 + 1] + (((rnd * 7.31) % 1) - 0.5) * CELL_SIZE * 0.4);
          s.set(rad, Math.max(0.01, k.moundMax * unit * (0.3 + 0.7 * f) * (0.8 + 0.4 * rnd)), rad);
          mm.setMatrixAt(i, m.compose(p, q, s));
        }
        mm.count = nm;
        mm.instanceMatrix.needsUpdate = true;
        // (the darker the longer the place was built; the lightest is the layer's own ground)
        tone.a.set("#2a2d31");
        tone.b.set(k.stainColor);
        for (let i = 0; i < ns; i++) {
          const t = Math.max(0, Math.min(1, ss[i * 4 + 2])), rnd = ss[i * 4 + 3];
          const rad = CELL_SIZE * (0.55 + 0.5 * rnd) * (0.6 + 0.4 * t);
          p.set(ss[i * 4] + (rnd - 0.5) * CELL_SIZE * 0.5, 0, ss[i * 4 + 1] + (((rnd * 5.17) % 1) - 0.5) * CELL_SIZE * 0.5);
          s.set(rad, 0.01, rad);
          sm.setMatrixAt(i, m.compose(p, q, s));
          sm.setColorAt(i, tone.c.copy(tone.a).lerp(tone.b, 0.35 + 0.65 * t));
        }
        sm.count = ns;
        sm.instanceMatrix.needsUpdate = true;
        if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
      }
    }

    const im = mesh.current;
    if (!im) return;
    const on = layerOn && k.pipes;
    im.visible = on;
    if (!on || !r) return;
    // (the pipes lie `depth` slots under the layer's ground)
    im.position.y = base - k.depth * unit;
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
    <>
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
      {/* the mounds: low domes on the layer's ground (a unit half-sphere, scaled a mound) */}
      <instancedMesh
        ref={(im) => {
          mounds.current = im;
          if (im && !drawnDep.current) im.count = 0;
        }}
        args={[undefined, undefined, DEP_CAP]}
        frustumCulled={false}
        receiveShadow
      >
        <sphereGeometry args={[1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={k.moundColor} roughness={1} metalness={0} />
      </instancedMesh>
      {/* the dark earth: flat discs just over the layer's ground, each with its own darkness */}
      <instancedMesh
        ref={(im) => {
          stains.current = im;
          if (im && !im.instanceColor) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DEP_CAP * 3).fill(1), 3);
          if (im && !drawnDep.current) im.count = 0;
        }}
        args={[undefined, undefined, DEP_CAP]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[1, 1, 1, 14]} />
        <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} />
      </instancedMesh>
    </>
  );
}

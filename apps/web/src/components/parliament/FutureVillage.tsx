/**
 * THE INFERRED VILLAGE, DRAWN (lib/parliament/futureVillage.ts; the artist, 2026-11-16): a layer of what will be
 * found after the people are gone ("인류가 멸망한 후 남겨져서 발견될 모습")
 * — two or three slots, in 3D, standing on a ground of its own — APART FROM THE COLUMN, above its top ("꼭대기는
 * 지금 기둥에서 분리된 형태여야 해"). It is worked out in the wall's worker with the parts (SpaceRequest.future) and
 * comes back through `futureLink`; here it is only drawn: the buildings as the parts the column's own generator made
 * of them (one instanced mesh a kind, in the column's greys), lines for the paths and the water (the pools' rims
 * among them), clouds of points for the plants, a plate for its ground. It stands above where the building has come
 * to, a gap apart, and follows that as it rises. Nothing of it is fused, eroded or kept.
 *
 * Its knobs are a folder of their own (미래 마을 층), saved like every other group.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three";
import { PART_KINDS, WORLD_SIZE, type PartKind } from "@/lib/parliament";
import { DEFAULT_FUTURE, type FutureConfig, type FutureResult } from "@/lib/parliament/futureVillage";
import { savable } from "./levaSave";

/** Between the wall's ticker (which asks for it with these knobs) and its answer (which is drawn here). */
export const futureLink: { cfg: FutureConfig | null; result: FutureResult | null; version: number } = { cfg: null, result: null, version: 0 };

const GROUP = "미래 마을 층";
/** The most parts of one kind that are drawn (the worker sends no more: SpaceModel.computeFuture). */
const KIND_CAP = 12000;

const setLines = (m: THREE.LineSegments | null, flat: Float32Array, y: number) => {
  if (!m) return;
  const pos = new Float32Array((flat.length / 4) * 6);
  for (let i = 0, o = 0; i + 3 < flat.length; i += 4) {
    pos[o++] = flat[i];
    pos[o++] = y;
    pos[o++] = flat[i + 1];
    pos[o++] = flat[i + 2];
    pos[o++] = y;
    pos[o++] = flat[i + 3];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  m.geometry.dispose();
  m.geometry = g;
};

export function FutureVillage({ unit, top, kindColor }: { unit: number; top: THREE.IUniform<number>; kindColor: Record<PartKind, string> }) {
  const k = useControls(
    GROUP,
    savable(GROUP, {
      on: { value: DEFAULT_FUTURE.on, label: "켜기 (기둥 위에 떨어져 떠 있는 층 — 인류가 사라진 뒤 남겨져 발견될 모습)" },
      ruin: { value: 0.5, min: 0, max: 1, step: 0.05, label: "얼마나 삭았나 (0 = 서 있던 그대로 … 1 = 가장 오래 선 것의 기초만)" },
      anchor: { options: { "창의 꼭대기 위 (고정 — 기둥 상승을 멈추면 움직이지 않음)": "window", "지어진 꼭대기 위 (건물이 올라오면 따라감)": "built" }, value: "window" as "window" | "built", label: "층의 자리" },
      gap: { value: 8, min: 0, max: 40, step: 1, label: "그 자리와의 간격 (단 · 0 = 붙음)" },
      band: { value: DEFAULT_FUTURE.band, min: 4, max: 40, step: 2, label: "변화를 읽는 범위 (가장 최근에 지어진 몇 단 · 앞 절반과 뒤 절반을 비교)" },
      gain: { value: DEFAULT_FUTURE.gain, min: 0, max: 3, step: 0.1, label: "최근 변화를 얼마나 더 밀고 가나 (성장 규칙에만 쓰임)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.edge`) },
      maxH: { value: DEFAULT_FUTURE.maxH, min: 1, max: 4, step: 1, label: "가장 높은 건물 (단)" },
      persist: { value: true, label: "오래 선 것일수록 많이 남음 (오래 걸은 길 = 남는 뼈대 · 갓 지은 것 · 먼저 버려진 것은 기초만 · 갓 걸은 길은 풀에 덮임)" },
      edge: { value: DEFAULT_FUTURE.edge, label: "마을이 가장자리에서 자람 (성장 규칙 — '남겨진 모습'에는 맞지 않아 기본 끔)" },
      margin: { value: DEFAULT_FUTURE.margin, min: 1, max: 8, step: 1, label: "식생이 나는 범위 (다녀간 곳에서 몇 칸 밖까지)" },
      vegPer: { value: DEFAULT_FUTURE.vegPer, min: 0, max: 10, step: 0.5, label: "식생 구름의 짙기 (점 수)" },
      opacity: { value: 1, min: 0.1, max: 1, step: 0.05, label: "건물의 불투명도 (옅을수록 '아직 아닌 것')" },
      ground: { value: true, label: "제 땅을 그림 (기둥에서 떨어진 판 · 처음부터 땅 전체 크기)" },
      vegSize: { value: 0.12, min: 0.02, max: 1, step: 0.01, label: "식생 점 크기 (월드)" },
      vegColorA: { value: "#5f7a3a", label: "식생 색 1 (자연색)" },
      vegColorB: { value: "#a9b56a", label: "식생 색 2 (자연색)" },
    }),
    { collapsed: true },
  );
  // (the ticker reads the knobs from here: SpaceRequest.future)
  futureLink.cfg = useMemo<FutureConfig>(() => ({ on: k.on, band: k.band, gain: k.gain, maxH: k.maxH, edge: k.edge, margin: k.margin, vegPer: k.vegPer, persist: k.persist, ruin: k.ruin }), [k.ruin, k.persist, k.on, k.band, k.gain, k.maxH, k.edge, k.margin, k.vegPer]);
  useEffect(
    () => () => {
      futureLink.cfg = null;
    },
    [],
  );

  const group = useRef<THREE.Group>(null);
  const meshes = useRef<Partial<Record<PartKind, THREE.InstancedMesh | null>>>({});
  const roads = useRef<THREE.LineSegments>(null);
  const roadsOld = useRef<THREE.LineSegments>(null);
  const water = useRef<THREE.LineSegments>(null);
  const veg = useRef<THREE.Points>(null);
  const ground = useRef<THREE.Mesh>(null);
  const seen = useRef(-1);
  /** The slot the layer is drawn above, following the slot it was made for softly. */
  const shownK = useRef<number | null>(null);
  const tint = useMemo(() => new THREE.Color(), []);
  const colA = useMemo(() => new THREE.Color(), []);
  const colB = useMemo(() => new THREE.Color(), []);
  const colors = useRef({ a: "", b: "" });

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const r = futureLink.result;
    // WHERE IT STANDS (the artist, 2026-11-17: "미래 층을 고정시켜"): above THE WINDOW'S TOP, the gap apart — a place
    // that does not move while the column's rise is stopped (rise.ts), whatever is built below it. (Or, as before:
    // above where the building has come to, following that softly.) Its parts are made at their own slots (above
    // FutureResult.k); the whole is moved so that their foot is at that place.
    const madeFor = r && r.ground.length ? r.k : null;
    if (madeFor === null) shownK.current = null;
    else if (shownK.current === null || Math.abs(madeFor - shownK.current) > 30) shownK.current = madeFor;
    else shownK.current += (madeFor - shownK.current) * 0.05;
    const foot = madeFor === null ? 0 : (madeFor + 1) * unit;
    const base = (k.anchor === "built" && shownK.current !== null ? shownK.current + 1 : top.value) + Math.max(0, k.gap);
    g.position.y = base * unit - foot;
    // ITS GROUND IS THE WHOLE GROUND OF THE WORLD, FROM THE START ("마을 땅을 보여주는 땅 크기가 처음부터 큰 게 맞는 것 같고") — not
    // the square round what happens to be built so far, which grew as the village did
    const plate = ground.current;
    if (plate) {
      plate.position.set(0, foot - 0.06, 0);
      plate.scale.set(WORLD_SIZE, 0.1, WORLD_SIZE);
    }
    const recolour = colors.current.a !== k.vegColorA || colors.current.b !== k.vegColorB;
    if (seen.current === futureLink.version && !recolour) return;
    seen.current = futureLink.version;
    colors.current = { a: k.vegColorA, b: k.vegColorB };
    if (!r) return;
    const y0 = (r.k + 1) * unit;
    for (const kind of PART_KINDS) {
      const im = meshes.current[kind];
      if (!im) continue;
      const m = r.parts[kind], t = r.tones[kind];
      const n = m ? Math.min(KIND_CAP, m.length / 16) : 0;
      if (m && n) (im.instanceMatrix.array as Float32Array).set(m.subarray(0, n * 16));
      tint.set(kindColor[kind]);
      for (let i = 0; i < n; i++) {
        // (the column's own shading of a part by its tone)
        const v = 0.86 + 0.14 * (t ? t[i] : 0.5);
        im.setColorAt(i, colA.setRGB(tint.r * v, tint.g * v, tint.b * v));
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    setLines(roads.current, r.roads, y0 + 0.03);
    setLines(roadsOld.current, r.roadsOld ?? new Float32Array(0), y0 + 0.04);
    setLines(water.current, r.water, y0 + 0.05);
    if (veg.current) {
      const n = r.veg.length / 4;
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      colA.set(k.vegColorA);
      colB.set(k.vegColorB);
      const ar = colA.r, ag = colA.g, ab = colA.b;
      for (let i = 0; i < n; i++) {
        pos[i * 3] = r.veg[i * 4];
        pos[i * 3 + 1] = y0 + r.veg[i * 4 + 1] * unit + 0.04;
        pos[i * 3 + 2] = r.veg[i * 4 + 2];
        const sh = r.veg[i * 4 + 3];
        col[i * 3] = ar + (colB.r - ar) * sh;
        col[i * 3 + 1] = ag + (colB.g - ag) * sh;
        col[i * 3 + 2] = ab + (colB.b - ab) * sh;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      veg.current.geometry.dispose();
      veg.current.geometry = geo;
    }
  });

  return (
    <group ref={group} visible={k.on}>
      {PART_KINDS.map((kind) => (
        <instancedMesh
          key={kind}
          ref={(m) => {
            meshes.current[kind] = m;
            if (m && !m.instanceColor) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(KIND_CAP * 3), 3);
            if (m && seen.current < 0) m.count = 0;
          }}
          args={[undefined, undefined, KIND_CAP]}
          frustumCulled={false}
          castShadow
          receiveShadow
        >
          {kind === "pile" ? <cylinderGeometry args={[0.5, 0.5, 1, 10]} /> : <boxGeometry args={[1, 1, 1]} />}
          <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} transparent={k.opacity < 1} opacity={k.opacity} depthWrite={k.opacity >= 0.99} />
        </instancedMesh>
      ))}
      {/* the paths: what has only just been walked, faint — and the frame (walked for half the band on end), bright */}
      <lineSegments ref={roads} frustumCulled={false}>
        <bufferGeometry />
        <lineBasicMaterial color="#7d8187" />
      </lineSegments>
      <lineSegments ref={roadsOld} frustumCulled={false}>
        <bufferGeometry />
        <lineBasicMaterial color="#e6e7e9" />
      </lineSegments>
      <lineSegments ref={water} frustumCulled={false}>
        <bufferGeometry />
        <lineBasicMaterial color="#6f757c" />
      </lineSegments>
      <points ref={veg} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={k.vegSize} sizeAttenuation />
      </points>
      <mesh ref={ground} visible={k.ground} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#2a2d31" roughness={1} metalness={0} transparent opacity={0.5} depthWrite={false} />
      </mesh>
    </group>
  );
}

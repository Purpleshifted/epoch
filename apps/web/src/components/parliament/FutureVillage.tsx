/**
 * THE INFERRED VILLAGE, DRAWN (lib/parliament/futureVillage.ts; the artist, 2026-11-16): a layer of what is to come
 * — two or three slots, in 3D, standing on a ground of its own — APART FROM THE COLUMN, above its top ("꼭대기는
 * 지금 기둥에서 분리된 형태여야 해"). It is worked out in the wall's worker with the parts (SpaceRequest.future) and
 * comes back through `futureLink`; here it is only drawn: boxes for the buildings, lines for the paths and the
 * water (the pools' rims among them), points for the plants, a plate for its ground. It follows the window's top as
 * that rises, a gap above it. Nothing of it is fused, eroded or kept.
 *
 * Its knobs are a folder of their own (미래 마을 층), saved like every other group.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three";
import { DEFAULT_FUTURE, type FutureConfig, type FutureResult } from "@/lib/parliament/futureVillage";
import { savable } from "./levaSave";

/** Between the wall's ticker (which asks for it with these knobs) and its answer (which is drawn here). */
export const futureLink: { cfg: FutureConfig | null; result: FutureResult | null; version: number } = { cfg: null, result: null, version: 0 };

const GROUP = "미래 마을 층";
const BOX_CAP = 20000;

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

export function FutureVillage({ unit, top }: { unit: number; top: THREE.IUniform<number> }) {
  const k = useControls(
    GROUP,
    savable(GROUP, {
      on: { value: DEFAULT_FUTURE.on, label: "켜기 (꼭대기 위에 떠 있는, 추론된 마을)" },
      gap: { value: 8, min: 0, max: 40, step: 1, label: "기둥 꼭대기와의 간격 (단 · 0 = 붙음)" },
      band: { value: DEFAULT_FUTURE.band, min: 4, max: 40, step: 2, label: "변화를 읽는 범위 (꼭대기의 최근 몇 단 · 앞 절반과 뒤 절반을 비교)" },
      gain: { value: DEFAULT_FUTURE.gain, min: 0, max: 3, step: 0.1, label: "최근 변화를 얼마나 더 밀고 가나 (0 = 지금 그대로)" },
      maxH: { value: DEFAULT_FUTURE.maxH, min: 1, max: 4, step: 1, label: "가장 높은 건물 (단)" },
      edge: { value: DEFAULT_FUTURE.edge, label: "마을이 가장자리에서 자람 (자라는 칸 옆의 빈 칸에 낮은 건물)" },
      margin: { value: DEFAULT_FUTURE.margin, min: 1, max: 8, step: 1, label: "식생이 나는 범위 (다녀간 곳에서 몇 칸 밖까지)" },
      vegPer: { value: DEFAULT_FUTURE.vegPer, min: 0, max: 10, step: 0.5, label: "빈 칸 하나의 식생 점 수 (물가는 두 배)" },
      opacity: { value: 0.55, min: 0.1, max: 1, step: 0.05, label: "건물의 불투명도 (옅을수록 '아직 아닌 것')" },
      ground: { value: true, label: "제 땅을 그림 (기둥에서 떨어진 판)" },
      vegSize: { value: 0.12, min: 0.02, max: 1, step: 0.01, label: "식생 점 크기 (월드)" },
      vegColor: { value: "#8a9c52", label: "식생 색 (자연색)" },
    }),
    { collapsed: true },
  );
  // (the ticker reads the knobs from here: SpaceRequest.future)
  futureLink.cfg = useMemo<FutureConfig>(() => ({ on: k.on, band: k.band, gain: k.gain, maxH: k.maxH, edge: k.edge, margin: k.margin, vegPer: k.vegPer }), [k.on, k.band, k.gain, k.maxH, k.edge, k.margin, k.vegPer]);
  useEffect(
    () => () => {
      futureLink.cfg = null;
    },
    [],
  );

  const group = useRef<THREE.Group>(null);
  const boxes = useRef<THREE.InstancedMesh>(null);
  const roads = useRef<THREE.LineSegments>(null);
  const water = useRef<THREE.LineSegments>(null);
  const veg = useRef<THREE.Points>(null);
  const ground = useRef<THREE.Mesh>(null);
  const seen = useRef(-1);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tint = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    // it rides above the window's top, the gap apart (the top: the same number the fossil's shader reads)
    g.position.y = (top.value + Math.max(0, k.gap)) * unit;
    if (seen.current === futureLink.version) return;
    seen.current = futureLink.version;
    const r = futureLink.result;
    const im = boxes.current;
    if (!r || !im) return;
    const n = Math.min(BOX_CAP, r.boxes.length / 7);
    for (let i = 0; i < n; i++) {
      const o = i * 7, h = r.boxes[o + 4] * unit;
      dummy.position.set(r.boxes[o], h / 2, r.boxes[o + 1]);
      dummy.scale.set(r.boxes[o + 2], h, r.boxes[o + 3]);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      // (grey, a human trace; what the village grew into, a little lighter)
      const v = 0.5 + 0.22 * r.boxes[o + 5] + 0.12 * r.boxes[o + 6];
      im.setColorAt(i, tint.setRGB(v, v, v));
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    setLines(roads.current, r.roads, 0.03);
    setLines(water.current, r.water, 0.05);
    if (veg.current) {
      const pos = new Float32Array(r.veg.length);
      for (let i = 0; i + 2 < r.veg.length; i += 3) {
        pos[i] = r.veg[i];
        pos[i + 1] = r.veg[i + 1] * unit + 0.04;
        pos[i + 2] = r.veg[i + 2];
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      veg.current.geometry.dispose();
      veg.current.geometry = geo;
    }
    const gm = ground.current;
    if (gm) {
      if (r.ground.length === 4) {
        gm.position.set((r.ground[0] + r.ground[2]) / 2, -0.06, (r.ground[1] + r.ground[3]) / 2);
        gm.scale.set(r.ground[2] - r.ground[0], 0.1, r.ground[3] - r.ground[1]);
      } else gm.scale.set(0, 0, 0);
    }
  });

  return (
    <group ref={group} visible={k.on}>
      <instancedMesh ref={boxes} args={[undefined, undefined, BOX_CAP]} frustumCulled={false} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} transparent={k.opacity < 1} opacity={k.opacity} depthWrite={k.opacity >= 0.99} />
      </instancedMesh>
      <lineSegments ref={roads} frustumCulled={false}>
        <bufferGeometry />
        <lineBasicMaterial color="#b9bcc0" />
      </lineSegments>
      <lineSegments ref={water} frustumCulled={false}>
        <bufferGeometry />
        <lineBasicMaterial color="#6f757c" />
      </lineSegments>
      <points ref={veg} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial color={k.vegColor} size={k.vegSize} sizeAttenuation />
      </points>
      <mesh ref={ground} visible={k.ground} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#2a2d31" roughness={1} metalness={0} transparent opacity={0.5} depthWrite={false} />
      </mesh>
    </group>
  );
}

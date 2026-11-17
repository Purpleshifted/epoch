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
import type { FutureConfig } from "@/lib/parliament/futureVillage";
import { CELL_SIZE } from "@/lib/stratum/field";
import { futureLink } from "./FutureVillage";
import { savable } from "./levaSave";

/** What the wall's ticker adds to the layer's knobs when it asks for the layer (FutureConfig.under). */
type UnderConfig = Pick<FutureConfig, "under" | "moundAt" | "fate" | "succession" | "soil" | "tree" | "trees">;
/** (two folders write it: this layer's — `base` — and the trees of the column of the present — `trees`) */
const under: { base: UnderConfig | null; trees: FutureConfig["trees"] | null } = { base: null, trees: null };
export const futureUnder: { cfg: UnderConfig | null } = {
  get cfg() {
    return under.base ? (under.trees ? { ...under.base, trees: under.trees } : under.base) : null;
  },
  set cfg(v) {
    under.base = v;
  },
};

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
      // THE GROUND REMEMBERS WHAT IT WAS USED FOR (stage 5; the artist, 2026-11-17: "5단계 진행")
      soil: { value: true, label: "오래 쓰인 땅에는 다른 식생 (오래 · 거듭 지어졌던 자리일수록 그 몫이 크고 짙음 · 건물이 사라진 옛 자리에도 남)" },
      soilColorA: { value: "#3c6e58", label: "다른 식생의 색 1 (자연색 · 어두운 쪽)" },
      soilColorB: { value: "#86b59a", label: "다른 식생의 색 2 (자연색 · 밝은 쪽)" },
      // HOW A TREE LOOKS (the artist, 2026-11-17: "나무 비주얼이랑 사이즈 조절하는 옵션 추가하고(레바)") — FutureConfig.tree
      treeShape: { options: { "둥근 공": "ball", "원뿔 (침엽수 — 줄기 중간부터 뾰족하게)": "cone", "우산 (넓고 납작한 갓)": "umbrella", "기둥 (좁고 긺)": "column" }, value: "ball" as "ball" | "cone" | "umbrella" | "column", label: "나무 — 수관의 모양" },
      treeHeight: { value: 1, min: 0.2, max: 5, step: 0.1, label: "나무 — 키 (줄기 높이의 배수)" },
      treeCrown: { value: 1, min: 0.2, max: 5, step: 0.1, label: "나무 — 수관의 너비 (배수)" },
      treeStem: { value: 1, min: 0, max: 6, step: 0.1, label: "나무 — 줄기의 굵기 (배수)" },
      treeStemShare: { value: 0.1, min: 0, max: 0.6, step: 0.02, label: "나무 — 줄기에 쓰는 점의 몫" },
      treeDense: { value: 1, min: 0.2, max: 4, step: 0.1, label: "나무 — 짙기 (점 수의 배수 · 점의 크기는 미래 마을 층 › 식생 점 크기)" },
      treeAt: { value: 1.05, min: 0.6, max: 1.8, step: 0.05, label: "나무 — 서는 문턱 (낮을수록 일찍 · 많이 · 0.6 = 덤불 없이 바로 나무)" },
      // (the artist, the same day: "나무 모양이나 사이즈 지터도 옵션 넣어줘")
      treeSizeJitter: { value: 1, min: 0, max: 3, step: 0.1, label: "나무 — 크기의 지터 (0 = 모든 나무가 같은 키 · 너비 · 1 = 지금까지처럼 · 클수록 들쭉날쭉)" },
      treeShapeMix: { value: 0, min: 0, max: 1, step: 0.05, label: "나무 — 모양 섞기 (이 몫의 나무는 네 모양 중 제각각 다른 것)" },
      treeShapeJitter: { value: 0, min: 0, max: 1.5, step: 0.05, label: "나무 — 모양의 지터 (수관이 나무마다 더 길쭉하거나 납작함)" },
    }),
    { collapsed: true },
  );
  futureUnder.cfg = useMemo(
    () => ({ under: k.under, moundAt: k.moundAt, fate: k.fate, succession: k.succession, soil: k.soil, tree: { at: k.treeAt, height: k.treeHeight, crown: k.treeCrown, stem: k.treeStem, stemShare: k.treeStemShare, dense: k.treeDense, shape: k.treeShape as NonNullable<FutureConfig["tree"]>["shape"], sizeJitter: k.treeSizeJitter, shapeMix: k.treeShapeMix, shapeJitter: k.treeShapeJitter } }),
    [k.under, k.moundAt, k.fate, k.succession, k.soil, k.treeAt, k.treeHeight, k.treeCrown, k.treeStem, k.treeStemShare, k.treeDense, k.treeShape, k.treeSizeJitter, k.treeShapeMix, k.treeShapeJitter],
  );
  // THE OTHER PLANTS (stage 5): the points of FutureResult.vegOld, as FutureVillage draws the layer's plants — the
  // same size, at the same heights — in the two colours of this folder
  const other = useRef<THREE.Points>(null);
  const drawnOther = useRef("");
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

    const op = other.current;
    if (op) {
      op.visible = layerOn && k.soil;
      if (r && layerOn) {
        op.position.y = base + 0.04;
        const size = Number(knob(`${LAYER}.vegSize`) ?? 0.12);
        const mat = op.material as THREE.PointsMaterial;
        if (Number.isFinite(size) && mat.size !== size) mat.size = size;
        const sig = `${futureLink.version}:${k.soilColorA}:${k.soilColorB}:${unit}`;
        if (sig !== drawnOther.current) {
          drawnOther.current = sig;
          const v = r.vegOld ?? new Float32Array(0);
          const np = Math.floor(v.length / 4);
          const pos = new Float32Array(np * 3), col = new Float32Array(np * 3);
          tone.a.set(k.soilColorA);
          tone.b.set(k.soilColorB);
          for (let i = 0; i < np; i++) {
            pos[i * 3] = v[i * 4];
            pos[i * 3 + 1] = v[i * 4 + 1] * unit;
            pos[i * 3 + 2] = v[i * 4 + 2];
            const sh = v[i * 4 + 3];
            col[i * 3] = tone.a.r + (tone.b.r - tone.a.r) * sh;
            col[i * 3 + 1] = tone.a.g + (tone.b.g - tone.a.g) * sh;
            col[i * 3 + 2] = tone.a.b + (tone.b.b - tone.a.b) * sh;
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
          op.geometry.dispose();
          op.geometry = geo;
        }
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
      {/* the other plants, of ground that was built on for long (stage 5) */}
      <points ref={other} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={0.12} sizeAttenuation />
      </points>
      <ColumnTrees unit={unit} />
    </>
  );
}

const TREES = "현재 덩어리의 나무 (시험)";
const STEM_CAP = 6000;
const CROWN_CAP = 60000;
/** A number 0 … 1 of a stem's own, by two numbers. */
const rnd = (a: number, b: number): number => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * THE TREES OF THE COLUMN OF THE PRESENT — a trial (the artist, 2026-11-17: "1·2부터 넣어 봐"; docs/world-review
 * §29-13 ideas 1 and 2; SpaceModel.presentTrees works the lives out). In the column the vertical is time, so a tree
 * is drawn as ITS LIFE: a stem from the slot it began in up to the slot it ended in, a point at its foot and THE
 * THICKER THE OLDER it was at each height — its cross-section grows as a power of its age (Pretzsch et al. 2017:
 * 나무 N5), so a level cut through the column shows every tree's age as its width — and round it a cloud of points
 * as wide as the stem is thick there (the crown follows the stem: McPherson et al. 2016, N4). Most stems are short
 * and thin, a few long and thick (the chances of ending: Hilbert et al. 2019, N2). In colours of nature, so a stem
 * is not taken for a column of a building. They come with the answer of the layer above the column (FutureResult
 * .trees), so they are there only while that layer is on. A folder of its own.
 */
function ColumnTrees({ unit }: { unit: number }) {
  const k = useControls(
    TREES,
    savable(TREES, {
      on: { value: true, label: "켜기 (기둥 안의 나무 = 선 단에서 죽은 단까지 오르는 줄기 · 살수록 굵음 · 미래 마을 층이 켜져 있어야 나옴)" },
      density: { value: 0.04, min: 0, max: 0.3, step: 0.005, label: "나무가 서는 땅 칸의 몫 (지어진 곳 둘레 여섯 칸 안에서)" },
      slotsPerYear: { value: 1, min: 0.2, max: 6, step: 0.1, label: "나무의 1년 = 몇 단 (모든 숫자가 여기에 달림)" },
      young: { value: 0.07, min: 0, max: 0.5, step: 0.01, label: "처음 5년 동안 한 해에 죽을 확률 (문헌: 약 0.07)" },
      old: { value: 0.03, min: 0, max: 0.3, step: 0.005, label: "그 뒤 한 해에 죽을 확률 (문헌: 약 0.03)" },
      regrow: { value: 0.1, min: 0, max: 1, step: 0.01, label: "빈 자리에 한 해에 새 나무가 설 확률" },
      radius: { value: 0.05, min: 0.005, max: 0.4, step: 0.005, label: "한 살 줄기의 굵기 (월드, 반지름)" },
      power: { value: 0.5, min: 0.1, max: 1.2, step: 0.05, label: "나이에 따라 굵어지는 정도 (반지름 = 굵기 × 나이^이 값 · 0.5 = 단면적이 나이에 비례)" },
      radiusJitter: { value: 0.4, min: 0, max: 1, step: 0.05, label: "굵기의 지터 (나무마다 굵고 가는 정도)" },
      stemColor: { value: "#6b5a3e", label: "줄기의 색 (자연색)" },
      crown: { value: true, label: "줄기 둘레에 수관의 구름 (점)" },
      crownWidth: { value: 6, min: 1, max: 30, step: 0.5, label: "수관의 폭 (그 높이의 줄기 굵기의 몇 배)" },
      crownPts: { value: 3, min: 0, max: 20, step: 0.5, label: "수관의 짙기 (산 단 하나에 점 몇 개)" },
      crownJitter: { value: 0.5, min: 0, max: 1, step: 0.05, label: "수관의 지터 (나무마다 폭이 다른 정도)" },
      crownSize: { value: 0.1, min: 0.02, max: 0.6, step: 0.01, label: "수관 점의 크기 (월드)" },
      crownColorA: { value: "#4f7a3a", label: "수관의 색 1 (자연색)" },
      crownColorB: { value: "#9fb86a", label: "수관의 색 2 (자연색)" },
    }),
    { collapsed: true },
  );
  under.trees = useMemo(() => ({ on: k.on, density: k.density, slotsPerYear: k.slotsPerYear, young: k.young, old: k.old, regrow: k.regrow }), [k.on, k.density, k.slotsPerYear, k.young, k.old, k.regrow]);
  useEffect(
    () => () => {
      under.trees = null;
    },
    [],
  );
  // THE STEM'S SHAPE: a body of revolution, a point at its foot (the slot it began in) and as wide as 1 at its top —
  // its radius at the share t of its life is t^power; an instance is scaled to its life and to its radius at the end
  const stemGeo = useMemo(() => {
    const p = Math.max(0.05, k.power), N = 10;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= N; i++) pts.push(new THREE.Vector2(Math.pow(i / N, p), i / N));
    return new THREE.LatheGeometry(pts, 7);
  }, [k.power]);
  useEffect(() => () => stemGeo.dispose(), [stemGeo]);
  const stems = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.Points>(null);
  const drawn = useRef("");
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), a: new THREE.Color(), b: new THREE.Color() }), []);

  useFrame(() => {
    const im = stems.current, pt = crowns.current;
    if (!im || !pt) return;
    const r = futureLink.result;
    const t = k.on ? r?.trees : undefined;
    im.visible = !!t;
    pt.visible = !!t && k.crown;
    if (!t) return;
    const sig = `${futureLink.version}:${unit}:${k.slotsPerYear}:${k.radius}:${k.power}:${k.radiusJitter}:${k.crown}:${k.crownWidth}:${k.crownPts}:${k.crownJitter}:${k.crownColorA}:${k.crownColorB}`;
    if (sig === drawn.current) return;
    drawn.current = sig;
    const n = Math.min(STEM_CAP, Math.floor(t.length / 5));
    const { m, p, q, s, a, b } = tmp;
    q.identity();
    const spy = Math.max(0.1, k.slotsPerYear), pw = Math.max(0.05, k.power);
    const pos: number[] = [], col: number[] = [];
    a.set(k.crownColorA);
    b.set(k.crownColorB);
    // (the points are shared out so that the whole stays under the cap)
    let lives = 0;
    for (let i = 0; i < n; i++) lives += Math.max(0, t[i * 5 + 3] - t[i * 5 + 2]);
    const per = k.crown ? Math.min(k.crownPts, CROWN_CAP / Math.max(1, lives)) : 0;
    for (let i = 0; i < n; i++) {
      const x = t[i * 5], z = t[i * 5 + 1], k0 = t[i * 5 + 2], life = Math.max(0.05, t[i * 5 + 3] - k0), own = t[i * 5 + 4];
      // (its radius at the end of its life: the knob's × its age in years ^ power, thicker or thinner by its own number)
      const R = k.radius * Math.pow(life / spy, pw) * Math.max(0.2, 1 + (own - 0.5) * 2 * k.radiusJitter * 0.7);
      p.set(x, k0 * unit, z);
      s.set(R, life * unit, R);
      im.setMatrixAt(i, m.compose(p, q, s));
      const wide = k.crownWidth * Math.max(0.2, 1 + (rnd(own * 91, i) - 0.5) * 2 * k.crownJitter * 0.8);
      const np = Math.round(life * per);
      for (let j = 0; j < np; j++) {
        const u = rnd(i + own, j), th = rnd(j, i + 7 * own) * Math.PI * 2;
        // (at the share u of its life: the stem is R·u^power thick there, and the cloud that many times as wide)
        const rr = R * Math.pow(u, pw) * wide * Math.sqrt(rnd(i * 3 + j, own)) + R * Math.pow(u, pw);
        pos.push(x + Math.cos(th) * rr, (k0 + u * life) * unit, z + Math.sin(th) * rr);
        const sh = rnd(j * 5 + i, own * 13);
        col.push(a.r + (b.r - a.r) * sh, a.g + (b.g - a.g) * sh, a.b + (b.b - a.b) * sh);
      }
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
    pt.geometry.dispose();
    pt.geometry = geo;
  });

  return (
    <>
      <instancedMesh
        ref={(im) => {
          stems.current = im;
          if (im && !drawn.current) im.count = 0;
        }}
        args={[undefined, undefined, STEM_CAP]}
        geometry={stemGeo}
        frustumCulled={false}
      >
        <meshStandardMaterial color={k.stemColor} roughness={1} metalness={0} side={THREE.DoubleSide} />
      </instancedMesh>
      <points ref={crowns} frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={k.crownSize} sizeAttenuation />
      </points>
    </>
  );
}

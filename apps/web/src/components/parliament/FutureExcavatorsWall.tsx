"use client";
/**
 * FutureExcavatorsWall — THE FUTURE'S ARCHAEOLOGISTS ON THE WALL, AND THE LIGHT WHERE THEY MEET SOMEONE (the artist,
 * 2026-11-22: "글로벌에서도 그런 연결이 발생하는 경우 빛 기둥같은 거 어울리는 비주얼로 보여주고").
 *
 * The same archaeologists as every phone sees (lib/parliament/excavators.ts: a pure function of the world's epoch and
 * clock) walk the future layer's ground above the column — a thin white stroke each, standing on it. When one of them
 * crosses where a visitor stands (on the ground, whatever the visitor's time — the visitors' samples come from the bot
 * server like everyone's), a pillar of light rises from the visitor's point in the column (their time) to the future's
 * ground, holds and fades: the present and what will be found of it, joined for a moment.
 *
 * Its knobs: 미래의 발굴자 (벽). The defaults are the personal view's (7 archaeologists, a disc of 44, a meeting at 4).
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { levaStore, useControls } from "leva";
import { botGround, currentEpochKey, worldNow, wrapDist, type EventLog } from "@/lib/parliament";
import { excavatorsAt, type Excavator } from "@/lib/parliament/excavators";
import { futureOnly } from "@/lib/parliament/futureOnly";
import { savable } from "./levaSave";

const GROUP = "미래의 발굴자 (벽)";

/** THE WALKERS NOW, for whoever on the wall asks whether the future is with someone (ParliamentSpace MeMark's thread —
 *  docs/me-future-link.md): this frame's list (empty while this is off) and the reach of a meeting. Read only. */
export const wallExcavators: { list: Excavator[]; meetR: number } = { list: [], meetR: 4 };
/** A visitor whose meeting is drawn by someone else (MeMark's thread, for "me"): no pillar of light for it here. */
export const wallMeetSkip: { id: string | null } = { id: null };
const MAX_EX = 40;
const MAX_PILLARS = 16;

const knob = (path: string): unknown => {
  try {
    return levaStore.get(path);
  } catch {
    return undefined;
  }
};

/** A pillar's light: brightest at its middle line, soft to its edges, fading at both ends; `uA` its life (0 … 1). */
const PILLAR_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const PILLAR_FRAG = `
uniform float uA;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float ends = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
  float a = uA * pow(across, 2.5) * ends;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, a);
}`;

export function FutureExcavatorsWall({ log, unit, top, secPerUnit }: { log: EventLog; unit: number; top: THREE.IUniform<number>; secPerUnit: number }) {
  const k = useControls(
    GROUP,
    savable(GROUP, {
      on: { value: true, label: "켜기 (빛기둥은 미래 층이 꺼져 있어도 섬)" },
      // (6: the personal view's saved number — bot (future) · 미래 발굴자, the lab's 관찰자 수 — so the wall's walkers are the
      // phones' own and a meeting here is one there; was 7)
      count: { value: 6, min: 1, max: 30, step: 1, label: "발굴자 수 (개인뷰와 같아야 같은 이들)" },
      roam: { value: 44, min: 10, max: 96, step: 1, label: "도는 땅의 반경 (월드)" },
      legSec: { value: 24, min: 6, max: 120, step: 1, label: "한 곳에서 다음 곳까지 (s)" },
      meetR: { value: 4, min: 1, max: 15, step: 0.5, label: "마주치는 거리 (월드)" },
      marker: { value: true, label: "발굴자를 미래 층 위에 그림 (흰 획 · 미래 층이 켜져 있을 때)" },
      pillarSec: { value: 6, min: 1, max: 30, step: 0.5, label: "빛기둥이 서 있는 시간 (s)" },
      pillarWidth: { value: 0.9, min: 0.1, max: 4, step: 0.05, label: "빛기둥의 폭 (월드)" },
      pillarColor: { value: "#f2f4f7", label: "빛기둥의 색" },
    }),
    { collapsed: true },
  );
  // the archaeologists: an instanced thin box each (a white stroke standing on the layer's ground)
  const strokes = useRef<THREE.InstancedMesh>(null);
  const strokeGeo = useMemo(() => new THREE.BoxGeometry(0.08, 1, 0.08), []);
  const strokeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false }), []);
  // the pillars: a pool of camera-facing quads (two crossed planes), each its own material
  const pillarGeo = useMemo(() => {
    const a = new THREE.PlaneGeometry(1, 1), b = new THREE.PlaneGeometry(1, 1);
    b.rotateY(Math.PI / 2);
    const pos = [...(a.getAttribute("position").array as Float32Array), ...(b.getAttribute("position").array as Float32Array)];
    const uv = [...(a.getAttribute("uv").array as Float32Array), ...(b.getAttribute("uv").array as Float32Array)];
    const idx = [...(a.getIndex()!.array as Uint16Array), ...[...(b.getIndex()!.array as Uint16Array)].map((i) => i + 4)];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    a.dispose();
    b.dispose();
    return g;
  }, []);
  const pillars = useMemo(
    () =>
      Array.from({ length: MAX_PILLARS }, () => {
        const mat = new THREE.ShaderMaterial({ vertexShader: PILLAR_VERT, fragmentShader: PILLAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uA: { value: 0 }, uColor: { value: new THREE.Color("#f2f4f7") } } });
        const mesh = new THREE.Mesh(pillarGeo, mat);
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 5;
        return { mesh, mat, t0: -1, x: 0, z: 0, y0: 0 };
      }),
    [pillarGeo],
  );
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    const g = group.current;
    if (g) for (const p of pillars) g.add(p.mesh);
    return () => {
      for (const p of pillars) {
        p.mesh.removeFromParent();
        p.mat.dispose();
      }
      pillarGeo.dispose();
      strokeGeo.dispose();
      strokeMat.dispose();
    };
  }, [pillars, pillarGeo, strokeGeo, strokeMat]);
  // the visitors (not bots): each one's latest sample, and when it came here
  const people = useRef(new Map<string, { x: number; z: number; s: number; at: number }>());
  const fed = useRef({ n: 0, drops: -1 });
  const cool = useRef(new Map<string, number>());
  const newestS = useRef(0);
  const m4 = useMemo(() => new THREE.Matrix4(), []);

  useFrame(() => {
    const g = group.current;
    // (the layer itself is off on the wall by default — the artist, 2026-11-20 — and a meeting is a sign whether it is
    // drawn or not: the pillars always; the archaeologists' strokes only where the layer is drawn)
    const layerOn = knob("미래 마을 층.on") === true || futureOnly();
    if (g) g.visible = k.on;
    wallExcavators.list = [];
    wallExcavators.meetR = k.meetR;
    if (!k.on) return;
    const epoch = Number(currentEpochKey());
    if (!(epoch > 0)) return;
    const sec = (worldNow() - epoch) / 1000;
    const exs = excavatorsAt(epoch, sec, { count: k.count, roam: k.roam, legSec: k.legSec, stand: 0.35 });
    wallExcavators.list = exs;
    // THE FUTURE'S GROUND: where FutureVillage stands it — above the window's top, the layer's gap apart
    // (the window's top: the fusion's uniform where it is filled, else the bots' window — botGround.window — as the
    // wall's readout reads it)
    const gap = Number(knob("미래 마을 층.gap") ?? 8);
    const win = botGround.window?.();
    const topSlot = Math.max(top.value, win ? win.top / Math.max(1, secPerUnit) : 0);
    // (…and never under what is written: the newest sample's slot — on a wall whose block height is not set, the layer's
    // place would be under the column)
    const gapS = Math.max(0, Number.isFinite(gap) ? gap : 8);
    const groundY = Math.max(topSlot, newestS.current / Math.max(1, secPerUnit)) * unit + gapS * unit;
    const st = strokes.current;
    if (st) {
      st.visible = k.marker && layerOn;
      const n = Math.min(MAX_EX, exs.length);
      for (let i = 0; i < n; i++) {
        m4.makeScale(1, 1.6 * unit, 1).setPosition(exs[i].x, groundY + 0.8 * unit, exs[i].z);
        st.setMatrixAt(i, m4);
      }
      st.count = n;
      st.instanceMatrix.needsUpdate = true;
    }
    // the visitors' samples since the last frame
    const all = log.all();
    if (fed.current.drops !== log.drops) {
      fed.current = { n: 0, drops: log.drops };
      newestS.current = 0;
    }
    const now = performance.now();
    for (let i = fed.current.n; i < all.length; i++) {
      const e = all[i];
      if (e.s > newestS.current) newestS.current = e.s;
      if (e.k !== "p" || e.o.startsWith("bot")) continue;
      const prev = people.current.get(e.o);
      if (!prev || e.s >= prev.s) people.current.set(e.o, { x: e.x, z: e.z, s: e.s, at: fed.current.n === 0 && i < all.length - 400 ? -1e12 : now });
    }
    fed.current.n = all.length;
    // A MEETING: a visitor heard from in the last few seconds, an archaeologist within reach — a pillar (once a while
    // per pair)
    for (const [o, p] of people.current) {
      if (now - p.at > 4000 || o === wallMeetSkip.id) continue;
      for (const ex of exs) {
        if (wrapDist(ex.x, ex.z, p.x, p.z) > k.meetR) continue;
        const key = `${o}:${ex.i}`;
        if ((cool.current.get(key) ?? -Infinity) > now) continue;
        cool.current.set(key, now + 20000);
        const free = pillars.find((q) => q.t0 < 0) ?? pillars.reduce((a, b) => (a.t0 < b.t0 ? a : b));
        Object.assign(free, { t0: now, x: p.x, z: p.z, y0: (p.s / Math.max(1, secPerUnit)) * unit });
      }
    }
    // the pillars: rise in half a second, stand, fade over the last two
    const life = Math.max(1, k.pillarSec) * 1000;
    for (const q of pillars) {
      if (q.t0 < 0) continue;
      const t = now - q.t0;
      if (t > life) {
        q.t0 = -1;
        q.mesh.visible = false;
        continue;
      }
      const a = Math.min(1, t / 500) * Math.min(1, (life - t) / 2000);
      const y1 = Math.max(q.y0 + 1, groundY);
      q.mesh.visible = true;
      q.mesh.position.set(q.x, (q.y0 + y1) / 2, q.z);
      q.mesh.scale.set(k.pillarWidth, y1 - q.y0, k.pillarWidth);
      q.mat.uniforms.uA.value = 0.85 * a;
      (q.mat.uniforms.uColor.value as THREE.Color).set(k.pillarColor);
    }
    (window as unknown as { __futureWall?: unknown }).__futureWall = { excavators: exs.length, people: people.current.size, pillars: pillars.filter((q) => q.t0 >= 0).length, groundY: Math.round(groundY * 10) / 10 };
  });

  return (
    <group ref={group}>
      <instancedMesh ref={strokes} args={[strokeGeo, strokeMat, MAX_EX]} frustumCulled={false} />
    </group>
  );
}

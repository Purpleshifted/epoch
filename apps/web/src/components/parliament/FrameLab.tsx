"use client";
/**
 * FrameLab — HOW A PERSON'S FRAMES ARE LAID OUT (the artist, 2026-11-23: "나와의 상대 각도 고려해서 프레임이 움직임에 따라
 * 늘어져서 옆에서 보면 동세 덩어리로 보이도록 … 랩에 아예 다른 슬랏을 추가해서 거기는 아무런 요소도 없이, 순수하게 사람
 * 프레임을 어떻게 늘어놓을 건지 결정하게"). A lab page of its own (/lab/mobile/frames): white space, no ground, no scan —
 * only people cut out of video (spritePeople's sheet) walking, and the frames they leave.
 *
 * Each walker leaves copies of their frame behind them (at a time spacing, or at each sample — "슉"), fading. A card
 * stands in one of three ways (facing the eye / along the path / across it). Each card may be STRETCHED towards the copy
 * before it by how much of the move between them lies across the eye's view — the relative angle: seen from behind the
 * copies pile into one figure, seen from the side they run together into a mass of the movement. The stretched part is
 * a streak of the silhouette's own colours (the body's middle pulled sideways, like a long exposure's drag), or the
 * frame itself widened. Cards may show only a vertical slit of their frame (slit-scan laid out in space).
 *
 * Camera: drag to orbit; the knobs' buttons put it at the side, behind, in front, above, or at eye level among them.
 *
 * Seen from the side, frames standing square to the path leave the space between them empty; frames IN BETWEEN fill it
 * (a count of them, or one per frame time of the clip). A band along the path carrying the body's height profile was
 * tried and dropped (2026-11-23).
 * Each clip keeps its own set: the distance a frame carries the body and how long a frame is held, what state it is for
 * (standing, moving, moving fast, talking, or unused), and how it looks (height, width, ink, feet, colour, reversed, start,
 * playback speed, a ping-pong loop).
 * A DISTANCE HIERARCHY: near, middle and far from the eye (blended at their borders) — each tier scales the afterimages,
 * the ink, the blur and the flowing colour; far off a card may face the eye and a profile clip walks across, turned so
 * the clip's walker faces the way the person goes on the screen.
 * Front shots only, square to the way they go — a silhouette's front and back are one (the artist, 2026-11-23).
 * Inside the silhouettes a colour may flow (a three-colour gradient that waves along the height, through space, or with
 * a copy's age), from one of five colour combinations (one for all, or each walker their own). Old copies blur with
 * their age; the body now stays sharp. What is fainter than a threshold is not drawn, and a frame's own border is always
 * empty (a faint box round a frame).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { button, folder, useControls } from "leva";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { savable, savedValue } from "./levaSave";
import { LAB_GROUP } from "./mobileLab";
import { loadSpriteList, loadSpriteSheet, type SpriteIndex } from "./spritePeople";
import {
  MAX_CARDS,
  PALETTE_DEFAULTS,
  STATE_KEYS,
  STATE_NAMES,
  TAU,
  TRAIL_DEFAULTS,
  drawFrames,
  frac,
  hexLin,
  keepSecOf,
  makeMaterial,
  makeSideMaterial,
  prepareWalkers,
  setBlend,
  stateOfWalker,
  type ClipSet,
  type ClipState,
  type Facing,
  type Grad,
  type Look,
  type Path,
  type StateKey,
  type Trail,
  type Walker,
} from "./framePeople";

function onPath(w: Walker, L: Look, i: number, n: number): { x: number; z: number; h: number } {
  const lane = (i - (n - 1) / 2) * L.spread;
  if (L.path === "across") {
    const span = 16;
    const s = ((((w.s * w.dir) % span) + span) % span) - span / 2;
    return { x: s, z: -L.dist + lane, h: w.dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
  }
  if (L.path === "toward") {
    const span = 16;
    const s = ((((w.s * w.dir) % span) + span) % span) - span / 2;
    return { x: lane, z: -L.dist + s, h: w.dir > 0 ? 0 : Math.PI };
  }
  if (L.path === "circle") {
    const r = Math.max(1, L.dist + lane);
    const a = (w.s / r) * w.dir + (i / Math.max(1, n)) * TAU;
    return { x: Math.sin(a) * r, z: Math.cos(a) * r - 0, h: a + (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2) };
  }
  return { x: w.x, z: w.z, h: w.h };
}

function Scene({ L, viewRef, readoutRef }: { L: Look; viewRef: React.MutableRefObject<string | null>; readoutRef: React.RefObject<HTMLDivElement | null> }) {
  const meter = useRef({ at: 0, frames: 0, fps: 0 });
  const { camera, gl } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const geom = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    for (const name of ["iA", "iB", "iC", "iD", "iE", "iF", "iG"]) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARDS * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, []);
  const mat = useMemo(() => makeMaterial(), []);
  const sideMat = useMemo(() => makeSideMaterial(mat), [mat]);
  useEffect(() => () => sideMat.dispose(), [sideMat]);
  useEffect(() => () => geom.dispose(), [geom]);
  useEffect(() => () => mat.dispose(), [mat]);
  const idx = useRef<SpriteIndex | null>(null);
  useEffect(() => {
    let live = true;
    // (the study loads every clip: it is where they are chosen)
    loadSpriteSheet(gl).then(({ index, texture }) => {
      if (!live) return;
      idx.current = index;
      mat.uniforms.uSheet.value = texture;
      mat.uniforms.uCols.value = index.sheet.cols;
      mat.uniforms.uPer.value = index.per;
      mat.uniforms.uAtlasRows.value = index.atlasRows;
      mat.uniforms.uAspect.value = index.sheet.cellW / index.sheet.cellH;
    });
    return () => {
      live = false;
    };
  }, [mat]);
  useEffect(() => {
    setBlend(mat, L.multiply);
    setBlend(sideMat, L.multiply);
  }, [mat, L.multiply]);
  const walkers = useRef<Walker[]>([]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const now = state.clock.elapsedTime;
    // the camera's places (the knobs' buttons)
    if (viewRef.current) {
      const v = viewRef.current;
      viewRef.current = null;
      const d = Math.max(4, L.dist + 6);
      const at: Record<string, [number, number, number]> = { side: [d, 1.5, -L.dist], back: [0, 1.6, -L.dist + d * (L.path === "toward" ? -1 : 1)], front: [0, 1.6, -L.dist - d], top: [0.01, d * 1.6, -L.dist], eye: [0, 1.6, 0] };
      const p = at[v] ?? at.side;
      camera.position.set(...p);
      const target = v === "eye" ? new THREE.Vector3(0, 1.4, -L.dist) : new THREE.Vector3(0, 0.9, -L.dist);
      controls.current?.target.copy(target);
      camera.lookAt(target);
      controls.current?.update();
    }
    // the walkers: as many as asked, kept between changes
    const W = walkers.current;
    while (W.length < L.count) {
      const i = W.length;
      const hash = frac(Math.sin(i * 91.7 + 3.1) * 43758.5);
      W.push({ hash, x: (hash - 0.5) * 8, z: -L.dist + (frac(hash * 7.3) - 0.5) * 8, h: hash * TAU, ph: hash, s: hash * 16, dir: i % 2 ? -1 : 1, gx: 0, gz: 0, hist: [], stamps: [], lastHist: -1, lastSample: -1, home: 0, standing: false, speed: 1.3, gap: 0.04, cycle: 0.64 });
    }
    W.length = Math.min(W.length, L.count);
    prepareWalkers(W, L, idx.current?.sheet.cols ?? 16, (w) => ({
      standing: frac(w.hash * 5.1) < L.standShare,
      // each person their own speed: between the least and the most, more of them slow
      speed: L.speedMin + Math.max(0, L.speedMax - L.speedMin) * Math.pow(frac(w.hash * 11.3), Math.max(0.2, L.speedSkew)),
    }));
    const stateOf = (w: Walker) => stateOfWalker(L, w);
    const keepSec = keepSecOf(L);
    W.forEach((w, i) => {
      // move
      w.s += w.speed * dt;
      if (L.path === "scatter") {
        // the scattered crowd: round the eye from near to far, each walking straight its own way; gone far, back somewhere
        const far = Math.hypot(w.x, w.z) > 45;
        if (w.gx === 0 || far) {
          const r1 = frac(Math.sin((now + 1) * 7.13 + i * 3.7) * 9187.3), r2 = frac(Math.sin((now + 2) * 5.31 + i * 1.9) * 7151.1);
          const a = r1 * TAU, rr = 3 + 37 * Math.sqrt(r2);
          w.x = Math.sin(a) * rr;
          w.z = Math.cos(a) * rr;
          w.h = frac(r1 * 13.7 + r2 * 5.1) * TAU;
          w.gx = 1;
          w.hist.length = 0;
          w.stamps.length = 0;
        }
        w.x += Math.sin(w.h) * w.speed * dt;
        w.z += Math.cos(w.h) * w.speed * dt;
      } else if (L.path === "wander") {
        const dx = w.gx - w.x, dz = w.gz - w.z;
        if (Math.hypot(dx, dz) < 0.4 || (w.gx === 0 && w.gz === 0)) {
          const a = frac(Math.sin(now * 13.1 + i * 7.7) * 9187.3) * TAU, r = 2 + frac(Math.sin(now * 3.3 + i) * 517.1) * Math.max(2, L.dist);
          w.gx = Math.sin(a) * r;
          w.gz = -L.dist + Math.cos(a) * r * 0.6;
        }
        const want = Math.atan2(w.gx - w.x, w.gz - w.z);
        let d = want - w.h;
        d = ((((d + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
        w.h += Math.max(-1.5 * dt, Math.min(1.5 * dt, d));
        w.x += Math.sin(w.h) * w.speed * dt;
        w.z += Math.cos(w.h) * w.speed * dt;
      } else {
        const p = onPath(w, L, i, L.count);
        const jump = Math.hypot(p.x - w.x, p.z - w.z) > 3;
        w.x = p.x;
        w.z = p.z;
        w.h = p.h;
        if (jump) {
          w.hist.length = 0;
          w.stamps.length = 0;
        }
      }
      // the frames run at their own rate (× the clip's own tempo), apart from how fast the body travels — the artist finds
      // each clip's best match of the two ("이동속도랑 프레임 속도 내가 조절할 수 있도록 … 클립별 베스트 매치")
      w.ph = (w.ph + dt / Math.max(1e-3, w.cycle)) % 1;
      if (now - w.lastHist >= 1 / 30) {
        w.lastHist = now;
        w.hist.push({ t: now, x: w.x, z: w.z, h: w.h, ph: w.ph });
      }
      const keep = now - keepSec - 0.5;
      let drop = 0;
      while (drop < w.hist.length && w.hist[drop].t < keep) drop++;
      if (drop) w.hist.splice(0, drop);
      if ((L.stamp || L.standMode) && now - w.lastSample >= L.sampleSec) {
        w.lastSample = now;
        w.stamps.unshift({ t: now, x: w.x, z: w.z, h: w.h, ph: w.ph });
      }
      while (w.stamps.length && now - w.stamps[w.stamps.length - 1].t > L.trails[stateOf(w)].life + L.sampleSec) w.stamps.pop();
    });
    const n = drawFrames(geom, mat, L, idx.current, W, camera.position, now);
    // (a readout for the console, like __street)
    (window as unknown as { __frames?: unknown }).__frames = { cards: n, walkers: W.length, sheet: idx.current ? idx.current.sheet.rows.length : 0, thick: L.thick, fill: L.thickFill };
    // the readout on screen, twice a second: cards (and with the thickness, twice that drawn), people, frames a second
    const M = meter.current;
    M.frames++;
    if (now - M.at >= 0.5) {
      M.fps = M.frames / Math.max(1e-3, now - M.at);
      M.at = now;
      M.frames = 0;
      const el = readoutRef.current;
      const thickOn = (L.thick > 0 || L.thickFill) && L.thickInk > 0;
      if (el) el.textContent = `카드 ${n}${thickOn ? ` (+두께 ${n})` : ""} · 사람 ${W.length} · 한 사람당 ${W.length ? Math.round(n / W.length) : 0} · ${M.fps.toFixed(0)} fps${n > 500 ? " · 폰에선 무거움 (500장 넘음)" : ""}`;
    }
  });

  return (
    <>
      <OrbitControls ref={controls} makeDefault target={[0, 0.9, -L.dist]} enableDamping dampingFactor={0.12} />
      <mesh geometry={geom} material={mat} frustumCulled={false} />
      {(L.thick > 0 || L.thickFill) && L.thickInk > 0 && <mesh geometry={geom} material={sideMat} frustumCulled={false} />}
      {L.floor && <gridHelper args={[40, 40, "#e4e4e4", "#efefef"]} position={[0, 0, -L.dist]} />}
    </>
  );
}

const STATES: Record<string, ClipState> = { "이동 중 (걷기)": "walk", "경보 (빠른 걸음)": "brisk", "뛰기": "run", "서 있을 때 (머무름)": "stand", "소통 중 (말 걸기 · 응답)": "talk", "미지정": "none" };
const PATHS: Record<string, Path> = { "흩어진 군중 — 가까이부터 멀리까지 (나를 둘러)": "scatter", "가로지름 (옆으로 지나감)": "across", "원 (나를 둘러 돔)": "circle", "다가옴 · 멀어짐": "toward", "흩어진 산책": "wander" };
// (the artist, 2026-11-23: "본인 진행방향대로 프레임이 서야지, 지금은 나랑 무조건 정면인데" — the default stands each frame as the
// clip was shot: square to the way they walk; seen from the side the frames stand in a row along the path)
const FACINGS: Record<string, Facing> = { "진행 방향대로 (걷는 방향에 수직 — 영상이 찍힌 그대로)": "across", "진행 방향을 따라 (옆에서 정면)": "along", "나를 향함 (빌보드)": "eye" };

export default function FrameLab() {
  const G = LAB_GROUP.frames;
  const viewRef = useRef<string | null>("side");
  const readoutRef = useRef<HTMLDivElement | null>(null);
  // THE CLIPS' OWN SETS (the artist, 2026-11-23: "영상마다 골라서 이동거리랑 프레임 간격 세트로 저장"): for each clip of the
  // sheet, how far a frame carries the body (m) and how long a frame is held (s) — speed = distance / interval. Saved with
  // the group, a pair of knobs a clip (keys by the clip's name, so a clip keeps its set when others are added)
  const [clips, setClips] = useState<{ id: string; strideSec: number; loop: number; lum: number; side: boolean; walking: boolean; fill: number; faces: number }[]>([]);
  useEffect(() => {
    loadSpriteList()
      .then((sheet) =>
        setClips(sheet.rows.map((r) => ({ id: r.id, strideSec: r.strideSec, loop: (r as { loop?: number }).loop ?? 1, lum: (r as { lum?: number }).lum ?? 0, side: r.view === "side", walking: (r as { walking?: boolean }).walking ?? true, fill: (r as { fill?: number }).fill ?? 1, faces: (r as { faces?: number }).faces ?? 0 }))),
      )
      .catch(() => undefined);
  }, []);
  const ck = (id: string) => id.replace(/[^A-Za-z0-9]/g, "_");
  const [names, setNames] = useState<string[]>([]);
  // ── THE PANEL, MADE EASIER (the artist, 2026-11-23: "전반적으로 지금 레바 쓰기가 너무 힘듦"): one clip, one state, one
  // colour combination shown at a time (a picker over each; every value is kept and saved as before), the folders in the
  // order they are used, the rare ones folded. Keys unchanged: the saved values stay.
  const OLD_CLIP_ROOT = `${G}.클립 — 이동거리 · 프레임 간격`;
  const clipRoot = `${G}.클립`;
  const clipSchema = useMemo(() => {
    // (the artist's own name for a clip when she gave one — "레바로 파일 이름도 지정하게": the file keeps its name, so
    // its saved set stays; the name is what the pickers show)
    const opts = Object.fromEntries(clips.map((c, i) => [`${i + 1} · ${names[i] || c.id}`, i + 1]));
    const s: Record<string, unknown> = {
      clipPick: { options: { "상태로 자동 (사람마다 그 상태의 클립)": 0, ...opts }, value: 0, label: "사람들이 쓰는 클립" },
      clipEdit: { options: opts, value: 1, label: "▶ 편집할 클립" },
    };
    clips.forEach((c, i) => {
      // (defaults: what looked natural with the man's clip — 3.9 m/s with the frames at 3 × the clip's own tempo)
      const gap = c.strideSec / 16 / 3;
      const k = ck(c.id);
      const name = `${i + 1} · ${c.id}`;
      const shown = (get: (path: string) => unknown) => Number(get(`${clipRoot}.clipEdit`)) === i + 1;
      s[name] = folder(
        {
          // (walking in profile is not used by default: front shots only; a clip whose legs do not walk starts as standing)
          [`cn_${k}`]: { value: "", label: `이름 (파일: ${c.id})` },
          [`ct_${k}`]: { options: STATES, value: (c.side ? "none" : c.walking ? "walk" : "stand") as ClipState, label: "언제 쓰나 (미지정 = 안 씀)" },
          [`ch_${k}`]: { value: 1.72, min: 0.8, max: 2.3, step: 0.01, label: "키 (m)" },
          [`cp_${k}`]: { value: 1, min: 0.05, max: 4, step: 0.01, label: "재생 빠르기 ×" },
          [`cb_${k}`]: { value: false, label: "왕복 재생 (a → 거꾸로 → a)" },
          // (the distance only for a moving clip: standing or talking, the frames' time and the playback speed say it all)
          [`cd_${k}`]: {
            value: +(3.9 * gap).toFixed(3),
            min: 0.001,
            max: 0.4,
            step: 0.001,
            label: "걸음: 영상 한 장에 가는 거리 (m)",
            render: (get: (path: string) => unknown) => ["walk", "brisk", "run"].includes(String(get(`${clipRoot}.${name}.ct_${k}`))),
          },
          [`cg_${k}`]: { value: +gap.toFixed(3), min: 0.005, max: 0.5, step: 0.001, label: "영상 한 장이 머무는 시간 (s)" },
          [`ci_${k}`]: { value: 1, min: 0, max: 1.5, step: 0.05, label: "진하기 ×" },
          // (the silhouette painted one colour: a white matte is invisible on white paper — dark by default for those)
          [`ca_${k}`]: { value: c.lum > 0.7 ? 1 : 0, min: 0, max: 1, step: 0.05, label: "실루엣 색 바꾸기 — 세기 (0 = 영상 색)" },
          [`cc_${k}`]: { value: "#141414", label: "실루엣 색 바꾸기 — 색" },
          "세부": folder(
            {
              [`cw_${k}`]: { value: 1, min: 0.5, max: 1.8, step: 0.01, label: "폭 ×" },
              [`cy_${k}`]: { value: 0, min: -0.4, max: 0.4, step: 0.005, label: "발 높이 보정 (m)" },
              [`cf_${k}`]: { value: false, label: "좌우 뒤집기" },
              [`cr_${k}`]: { value: false, label: "거꾸로 재생" },
              [`co_${k}`]: { value: 0, min: 0, max: 1, step: 0.01, label: "시작 위상 (0 … 1)" },
              [`cs_${k}`]: { value: c.side, label: "멀리서 옆모습으로 쓰기" },
              [`cf2_${k}`]: { options: { "자동 (시트에서 판별)": 0, "오른쪽": 1, "왼쪽": -1 }, value: 0, label: "옆모습이 향하는 쪽" },
            },
            { collapsed: true },
          ),
        },
        { render: shown },
      );
    });
    return s;
  }, [clips, names]);
  const cs = useControls(clipRoot, savable(clipRoot, clipSchema, [OLD_CLIP_ROOT]) as Parameters<typeof useControls>[1], { collapsed: false, order: 2 }, [clips.length, names.join("\u0001")]) as unknown as Record<string, number>;
  const nameKey = clips.map((cl) => String((cs as unknown as Record<string, unknown>)[`cn_${ck(cl.id)}`] ?? "").trim()).join("\u0001");
  useEffect(() => setNames(nameKey.split("\u0001")), [nameKey]);
  const pick = Number(cs.clipPick ?? 0);
  const sets: ClipSet[] = clips.map((cl) => {
    const k = ck(cl.id);
    const raw = cs as unknown as Record<string, unknown>;
    return {
      id: cl.id,
      state: (raw[`ct_${k}`] as ClipState) ?? "walk",
      flip: !!raw[`cf_${k}`],
      dist: Number(raw[`cd_${k}`] ?? 0.15),
      gap: Number(raw[`cg_${k}`] ?? 0.04),
      height: Number(raw[`ch_${k}`] ?? 1.72),
      width: Number(raw[`cw_${k}`] ?? 1),
      ink: Number(raw[`ci_${k}`] ?? 1),
      lift: Number(raw[`cy_${k}`] ?? 0),
      tint: hexLin(String(raw[`cc_${k}`] ?? "#141414")),
      tintAmt: Number(raw[`ca_${k}`] ?? 0),
      reverse: !!raw[`cr_${k}`],
      play: Number(raw[`cp_${k}`] ?? 1),
      pingpong: !!raw[`cb_${k}`],
      fill: cl.fill,
      farSide: !!raw[`cs_${k}`],
      profile: cl.side || !!raw[`cs_${k}`],
      faces: Number(raw[`cf2_${k}`] ?? 0) || cl.faces || 1,
      stride: cl.strideSec,
      offset: Number(raw[`co_${k}`] ?? 0),
    };
  });
  // where each state's colour flow starts: the old shared (moving) knobs and the still ones' set, as they were saved
  const gradStart = useMemo(() => {
    const old = (key: string, dflt: number) => {
      const v = Number(savedValue(G, key));
      return Number.isFinite(v) ? v : dflt;
    };
    const moving: Grad = { amt: old("flGradAmt", 0.8), pick: old("flGradPick", 1), dir: old("flGradDir", 0), scale: old("flGradScale", 1), speed: old("flGradSpeed", 1), warp: old("flGradWarp", 0.6) };
    const gsPick = old("flGsPick", -1);
    const still: Grad = { ...moving, amt: old("flGsAmt", 0.8), pick: gsPick >= 0 ? gsPick : moving.pick, scale: Math.min(6, moving.scale * old("flGsScale", 1)), speed: Math.min(6, moving.speed * old("flGsSpeed", 1)) };
    return { walk: moving, brisk: moving, run: moving, stand: still, talk: still } as Record<StateKey, Grad>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const TRAIL_F = "잔상 — 상태별";
  const COLOUR_F = "안쪽 색 출렁임";
  const c = useControls(
    G,
    savable(G, {
      "보기": folder(
        {
          "옆에서": button(() => {
            viewRef.current = "side";
          }),
          "뒤에서": button(() => {
            viewRef.current = "back";
          }),
          "앞에서": button(() => {
            viewRef.current = "front";
          }),
          "위에서": button(() => {
            viewRef.current = "top";
          }),
          "눈높이 (나)": button(() => {
            viewRef.current = "eye";
          }),
          flFloor: { value: false, label: "바닥 격자" },
        },
        { order: 0 },
      ),
      "사람": folder(
        {
          flPath: { options: PATHS, value: "across" as Path, label: "길" },
          flCount: { value: 3, min: 1, max: 24, step: 1, label: "사람 수" },
          flStand: { value: 0, min: 0, max: 1, step: 0.05, label: "서 있는 사람의 몫" },
          flSpeedMode: { options: { "클립 세트대로 (클립 맞추기)": 0, "사람마다 빠르기 — 그 빠르기에 맞춘 클립": 1 }, value: 0, label: "빠르기" },
          flSpeedMin: { value: 0.5, min: 0.05, max: 3, step: 0.05, label: "가장 느린 사람 (m/s)", render: (get) => Number(get(`${G}.사람.flSpeedMode`)) === 1 },
          flSpeedMax: { value: 2.6, min: 0.3, max: 8, step: 0.05, label: "가장 빠른 사람 (m/s)", render: (get) => Number(get(`${G}.사람.flSpeedMode`)) === 1 },
          flSpeedSkew: { value: 1.8, min: 0.3, max: 4, step: 0.05, label: "느린 쪽으로 몰림 (1 = 고르게)", render: (get) => Number(get(`${G}.사람.flSpeedMode`)) === 1 },
          flBriskFrom: { value: 1.55, min: 0.3, max: 8, step: 0.05, label: "경보 문턱 (m/s)", render: (get) => Number(get(`${G}.사람.flSpeedMode`)) === 1 && !get(`${G}.사람.flPickBySpeed`) },
          flRunFrom: { value: 2.5, min: 0.3, max: 8, step: 0.05, label: "뛰기 문턱 (m/s)", render: (get) => Number(get(`${G}.사람.flSpeedMode`)) === 1 && !get(`${G}.사람.flPickBySpeed`) },
          flPickBySpeed: { value: false, label: "클립을 빠르기에 맞춰 고르기 (끄면 한 사람 = 한 클립)", render: (get) => Number(get(`${G}.사람.flSpeedMode`)) === 1 },
          flSpeedTol: { value: 0.25, min: 0.02, max: 1, step: 0.01, label: "클립 빠르기와 맞는 폭 (±, 0.25 = ±25%)", render: (get) => Number(get(`${G}.사람.flSpeedMode`)) === 1 && !!get(`${G}.사람.flPickBySpeed`) },
          flSpread: { value: 1.6, min: 0, max: 6, step: 0.1, label: "사람 사이 간격 (m)" },
          flDist: { value: 6, min: 1, max: 20, step: 0.5, label: "나와의 거리 (m)" },
        },
        { order: 1 },
      ),
      // (the clips' sets say how a body WALKS; this folder only says when copies of it are left behind)
      "잔상 남기기": folder(
        {
          flStandMode: { value: true, label: "도착마다 그 자리에 섰다 사라짐 (원본 속도)" },
          flStandCarry: { value: true, label: "도착 사이엔 지금 몸이 그 속도·방향으로 걸어감", render: (get) => !!get(`${G}.잔상 남기기.flStandMode`) },
          flStamp: { value: true, label: "표본마다 슉 (끄면 이어 걷고 일정 시간마다)", render: (get) => !get(`${G}.잔상 남기기.flStandMode`) },
          flSample: { value: 0.5, min: 0.1, max: 2, step: 0.05, label: "위치가 도착하는 간격 (s · 실제 봇은 1초)", render: (get) => !!get(`${G}.잔상 남기기.flStamp`) || !!get(`${G}.잔상 남기기.flStandMode`) },
          flDash: { value: 0.12, min: 0.02, max: 0.5, step: 0.01, label: "쓸려 가는 시간 (s)", render: (get) => !!get(`${G}.잔상 남기기.flStamp`) && !get(`${G}.잔상 남기기.flStandMode`) },
          flFall: { value: 1.3, min: 0.3, max: 4, step: 0.05, label: "옅어지는 곡선" },
          flInk: { value: 1, min: 0.1, max: 1, step: 0.05, label: "지금 몸의 진하기" },
          // (the artist, 2026-11-23: "사이 프레임은 박자보단 개수가 낫다")
          flBetween: { options: { "개수로": 2, "클립 박자대로 (영상 한 장마다 한 판)": 3, "없음": 0 }, value: 2, label: "잔상 사이 프레임" },
        },
        { order: 3, collapsed: true },
      ),
      // the afterimages by state — one state shown at a time (standing ones blow away by default)
      [TRAIL_F]: folder(
        {
          trEdit: { options: Object.fromEntries((Object.keys(TRAIL_DEFAULTS) as StateKey[]).map((st) => [STATE_NAMES[st], st])), value: "walk", label: "▶ 편집할 상태" },
          ...Object.fromEntries(
            (Object.keys(TRAIL_DEFAULTS) as StateKey[]).map((st) => {
              const d = TRAIL_DEFAULTS[st];
              const k = (n: string) => `t_${st}_${n}`;
              return [
                `잔상 · ${STATE_NAMES[st]}`,
                folder(
                  {
                    [k("life")]: { value: d.life, min: 0.1, max: 10, step: 0.1, label: "남는 시간 (s)" },
                    [k("ink")]: { value: d.ink, min: 0, max: 1, step: 0.05, label: "진하기" },
                    [k("betweenN")]: { value: d.betweenN, min: 0, max: 30, step: 1, label: "사이 프레임 수" },
                    [k("betweenInk")]: { value: d.betweenInk, min: 0, max: 1, step: 0.05, label: "사이 프레임 진하기 ×" },
                    [k("rise")]: { value: d.rise, min: -2, max: 3, step: 0.01, label: "나이 들며: 떠오름 (m)" },
                    [k("scatter")]: { value: d.scatter, min: 0, max: 4, step: 0.01, label: "나이 들며: 흩어짐 (m)" },
                    [k("blur")]: { value: d.blur, min: 0, max: 0.4, step: 0.005, label: "나이 들며: 흐려짐" },
                    [k("desat")]: { value: d.desat, min: 0, max: 1, step: 0.05, label: "나이 들며: 색이 바램" },
                    "세부": folder(
                      {
                        [k("scale")]: { value: d.scale, min: 0.3, max: 2.5, step: 0.01, label: "나이 들며: 크기 ×" },
                        [k("turn")]: { value: d.turn, min: -180, max: 180, step: 1, label: "나이 들며: 돌아감 (°)" },
                        [k("copies")]: { value: d.copies, min: 0, max: 60, step: 1, label: "일정 시간마다: 잔상 수" },
                        [k("gap")]: { value: d.gap, min: 0.02, max: 1.5, step: 0.01, label: "일정 시간마다: 사이 시간 (s)" },
                      },
                      { collapsed: true },
                    ),
                  },
                  { render: (get) => get(`${G}.${TRAIL_F}.trEdit`) === st },
                ),
              ];
            }),
          ),
        },
        { order: 4 },
      ),
      "늘어놓기 · 테두리": folder(
        {
          flFacing: { options: FACINGS, value: "across" as Facing, label: "프레임이 서는 방향" },
          flYaw: { value: 0, min: -90, max: 90, step: 1, label: "판 기울기 (°)" },
          // (seen from the side, cards standing to their way are knife edges: this turns them towards me just enough)
          flSideFade: { value: 0.35, min: 0, max: 1, step: 0.01, label: "옆으로 설 때 옅어짐 (0 = 끔 · 클수록 일찍)" },
          flMinAng: { value: 0, min: 0, max: 90, step: 1, label: "옆에서 볼 때 판이 나를 향하는 최소 각도 (°, 0 = 없음 · 90 = 늘 나를 향함)" },
          flEdge: { value: 0.15, min: 0, max: 0.95, step: 0.01, label: "테두리 지우기 — 알파 문턱" },
          flEdgeW: { value: 0.15, min: 0.005, max: 0.8, step: 0.005, label: "테두리 단단함 (작을수록 칼같이)" },
          flCon: { value: 1, min: 0.2, max: 4, step: 0.05, label: "색 대비 ×" },
          flBright: { value: 0, min: -0.6, max: 0.6, step: 0.01, label: "밝기 ±" },
          flMultiply: { value: true, label: "곱하기로 겹침" },
          // (the artist, 2026-11-23: "프레임 자체에 두께를 좀 둘 수 있나? 아니면 블러가 앞뒤 공간으로도")
          // (+ "공간에서 드래그해서 부피 생기도록 … 띠랑 합친다거나": the band is back as this face's drag)
          "두께 · 끌기 (옆에서 본 빈 공간 메우기)": folder({
            flThick: { value: 0, min: 0, max: 1.5, step: 0.01, label: "두께 (m, 0 = 없음)" },
            flThickFill: { value: false, label: "앞 잔상까지 끌기" },
            flDragKind: { options: { "실루엣 + 끌린 줄 (카드엔 몸, 사이엔 줄)": 2, "끌린 줄만": 1 }, value: 2, label: "보이는 것" },
            flDragLen: { value: 1.5, min: 0.1, max: 8, step: 0.1, label: "줄이 이어지는 길이 (프레임 폭)", render: (get) => Number(get(`${G}.늘어놓기 · 테두리.두께 · 끌기 (옆에서 본 빈 공간 메우기).flDragKind`)) > 0 },
            flThickInk: { value: 0.6, min: 0, max: 1, step: 0.05, label: "진하기" },
          }),
          "늘어짐 · 슬릿 (나를 향하거나 진행 방향을 따라 설 때)": folder(
            {
              flStretch: { value: 1, min: 0, max: 1.5, step: 0.05, label: "늘어짐 (앞 잔상까지, 가로지르는 만큼)" },
              flKind: { options: { "번짐 — 몸 가운데가 옆으로 끌림": 0, "프레임이 넓어짐": 1 }, value: 0, label: "늘어나는 방식" },
              flSoft: { value: 0.8, min: 0.05, max: 4, step: 0.05, label: "번짐 길이 (프레임 폭)" },
              flSlit: { value: 1, min: 0.05, max: 1, step: 0.01, label: "슬릿 — 가운데 몫만 (1 = 전체)" },
            },
            { collapsed: true },
          ),
        },
        { order: 5, collapsed: true },
      ),
      [COLOUR_F]: folder(
        {
          // BY STATE, EVERY KNOB (the artist, 2026-11-23: "안쪽 색 번짐 모드별로 다 조절 가능하게") — one state shown at a
          // time; each starts from what the old shared knobs (moving) and the still ones' set were saved at
          grEdit: { options: Object.fromEntries(STATE_KEYS.map((st) => [STATE_NAMES[st], st])), value: "walk", label: "▶ 편집할 상태" },
          ...Object.fromEntries(
            STATE_KEYS.map((st) => {
              const d = gradStart[st];
              const k = (n: string) => `g_${st}_${n}`;
              return [
                `색 · ${STATE_NAMES[st]}`,
                folder(
                  {
                    [k("amt")]: { value: d.amt, min: 0, max: 1, step: 0.05, label: "세기 (0 = 원래 색)" },
                    [k("pick")]: { options: { "사람마다 다르게": 0, "조합 1": 1, "조합 2": 2, "조합 3": 3, "조합 4": 4, "조합 5": 5 }, value: d.pick, label: "쓰는 색 조합" },
                    [k("dir")]: { options: { "높이를 따라": 0, "공간을 따라 (걸으며 바뀜)": 1, "잔상의 나이를 따라": 2 }, value: d.dir, label: "흐르는 방향" },
                    [k("scale")]: { value: d.scale, min: 0.1, max: 6, step: 0.05, label: "물결 크기" },
                    [k("speed")]: { value: d.speed, min: 0, max: 6, step: 0.05, label: "속도" },
                    [k("warp")]: { value: d.warp, min: 0, max: 3, step: 0.05, label: "일렁임" },
                  },
                  { render: (get) => get(`${G}.${COLOUR_F}.grEdit`) === st },
                ),
              ];
            }),
          ),
          palEdit: { options: { "조합 1": 1, "조합 2": 2, "조합 3": 3, "조합 4": 4, "조합 5": 5 }, value: 1, label: "▶ 편집할 조합" },
          ...Object.fromEntries(
            PALETTE_DEFAULTS.map((d, i) => [
              `조합 ${i + 1}`,
              folder(Object.fromEntries(d.map((hex, j) => [`flP${i + 1}${"abc"[j]}`, { value: hex, label: `색 ${j + 1}` }])), { render: (get) => Number(get(`${G}.${COLOUR_F}.palEdit`)) === i + 1 }),
            ]),
          ),
        },
        { order: 6, collapsed: true },
      ),
      "거리 위계 — 가까이 · 중간 · 멀리": folder(
        {
          flR1: { value: 6, min: 1, max: 30, step: 0.5, label: "가까이 → 중간 (m)" },
          flR2: { value: 15, min: 2, max: 60, step: 0.5, label: "중간 → 멀리 (m)" },
          flBand: { value: 3, min: 0.2, max: 10, step: 0.1, label: "섞이는 폭 (m)" },
          flFarEye: { value: true, label: "멀리: 판이 나를 향함" },
          // (the artist, 2026-11-23: "그냥 옆모습으로 바뀌는 걸 없애는 게 나을지도?" — off by default: front shots only, fading
          // as they turn edge-on — "늘어놓기 · 테두리 › 옆으로 설 때 옅어짐")
          flUseSide: { value: false, label: "옆모습 클립 쓰기 (끄면 정면만)" },
          flFarSide: { value: true, label: "멀리: 가로지르면 옆모습", render: (get) => !!get(`${G}.거리 위계 — 가까이 · 중간 · 멀리.flUseSide`) },
          // (the artist, 2026-11-23: "가만히 있는 건 가까이 있는 거 아니면 굳이 프레임 재생 안 해도")
          flStillNear: { value: true, label: "서 있기·소통: 프레임 재생은 가까이에서만" },
          // (the artist, 2026-11-23: "사람이 나를 통과해서 지나갈 때 fps 가 순간적으로 확 떨어지는데")
          flNearCut: { value: 0.8, min: 0, max: 4, step: 0.05, label: "나를 통과할 때: 사라지는 거리 (m)" },
          flNearBand: { value: 0.8, min: 0.05, max: 4, step: 0.05, label: "나를 통과할 때: 옅어지는 폭 (m)" },
          // (the artist, 2026-11-23: "3번하자" — someone crossing right beside me walks in profile too)
          flSideNear: { value: true, label: "가로지를 때는 가까이도 옆모습", render: (get) => !!get(`${G}.거리 위계 — 가까이 · 중간 · 멀리.flUseSide`) },
          flSideCross: { value: 0.8, min: 0.4, max: 0.98, step: 0.01, label: "옆모습으로 바뀌는 가로지름 (1 = 정확히 옆)", render: (get) => !!get(`${G}.거리 위계 — 가까이 · 중간 · 멀리.flUseSide`) },
          "가까이": folder(
            {
              flNTrail: { value: 1, min: 0, max: 2, step: 0.05, label: "잔상 ×" },
              flNBetMax: { value: 12, min: 0, max: 40, step: 1, label: "사이 프레임 최대" },
              flNInk: { value: 1, min: 0, max: 1.5, step: 0.05, label: "진하기 ×" },
              flNBlur: { value: 0, min: 0, max: 0.4, step: 0.005, label: "흐림 +" },
              flNGrad: { value: 1, min: 0, max: 1, step: 0.05, label: "색 출렁임 ×" },
            },
            { collapsed: true },
          ),
          "중간": folder(
            {
              flMTrail: { value: 0.5, min: 0, max: 2, step: 0.05, label: "잔상 ×" },
              flMBetMax: { value: 6, min: 0, max: 40, step: 1, label: "사이 프레임 최대" },
              flMInk: { value: 0.85, min: 0, max: 1.5, step: 0.05, label: "진하기 ×" },
              flMBlur: { value: 0.04, min: 0, max: 0.4, step: 0.005, label: "흐림 +" },
              flMGrad: { value: 0.7, min: 0, max: 1, step: 0.05, label: "색 출렁임 ×" },
            },
            { collapsed: true },
          ),
          "멀리": folder(
            {
              flFTrail: { value: 0.15, min: 0, max: 2, step: 0.05, label: "잔상 ×" },
              flFBetMax: { value: 2, min: 0, max: 40, step: 1, label: "사이 프레임 최대" },
              flFInk: { value: 0.6, min: 0, max: 1.5, step: 0.05, label: "진하기 ×" },
              flFBlur: { value: 0.12, min: 0, max: 0.4, step: 0.005, label: "흐림 +" },
              flFGrad: { value: 0.3, min: 0, max: 1, step: 0.05, label: "색 출렁임 ×" },
            },
            { collapsed: true },
          ),
        },
        { order: 7, collapsed: true },
      ),
    }),
    { collapsed: false },
  ) as unknown as Record<string, unknown>;
  const L: Look = {
    count: Number(c.flCount),
    path: c.flPath as Path,
    spread: Number(c.flSpread),
    dist: Number(c.flDist),
    clips: sets,
    row: pick,
    standShare: Number(c.flStand),
    tier: {
      r1: Number(c.flR1),
      r2: Number(c.flR2),
      band: Number(c.flBand),
      farEye: !!c.flFarEye,
      stillNear: c.flStillNear !== false,
      useSide: !!c.flUseSide,
      sideNear: !!c.flUseSide && c.flSideNear !== false,
      sideCross: Number(c.flSideCross ?? 0.8),
      farSide: !!c.flUseSide && !!c.flFarSide,
      trail: [Number(c.flNTrail), Number(c.flMTrail), Number(c.flFTrail)],
      betweenMax: [Number(c.flNBetMax ?? 12), Number(c.flMBetMax ?? 6), Number(c.flFBetMax ?? 2)],
      ink: [Number(c.flNInk), Number(c.flMInk), Number(c.flFInk)],
      blur: [Number(c.flNBlur), Number(c.flMBlur), Number(c.flFBlur)],
      grad: [Number(c.flNGrad), Number(c.flMGrad), Number(c.flFGrad)],
    },
    speedMode: Number(c.flSpeedMode),
    speedMin: Number(c.flSpeedMin ?? 0.5),
    speedMax: Number(c.flSpeedMax ?? 2.6),
    speedSkew: Number(c.flSpeedSkew ?? 1.8),
    speedTol: Number(c.flSpeedTol ?? 0.25),
    pickBySpeed: !!c.flPickBySpeed,
    briskFrom: Number(c.flBriskFrom ?? 1.55),
    runFrom: Number(c.flRunFrom ?? 2.5),
    nearCut: Number(c.flNearCut ?? 0.8),
    nearBand: Number(c.flNearBand ?? 0.8),
    yaw: (Number(c.flYaw) * Math.PI) / 180,
    between: Number(c.flBetween),
    trails: Object.fromEntries(
      (Object.keys(TRAIL_DEFAULTS) as StateKey[]).map((st) => {
        const d = TRAIL_DEFAULTS[st];
        const g = (n: keyof Trail) => Number(c[`t_${st}_${n}`] ?? d[n]);
        return [st, { life: g("life"), ink: g("ink"), copies: g("copies"), gap: g("gap"), betweenN: g("betweenN"), betweenInk: g("betweenInk"), scale: g("scale"), rise: g("rise"), scatter: g("scatter"), turn: (g("turn") * Math.PI) / 180, desat: g("desat"), blur: g("blur") }];
      }),
    ) as Record<StateKey, Trail>,
    pals: PALETTE_DEFAULTS.flatMap((d, i) => d.map((hex, j) => String(c[`flP${i + 1}${"abc"[j]}`] ?? hex))),
    grads: Object.fromEntries(
      STATE_KEYS.map((st) => {
        const d = gradStart[st];
        const g = (k: keyof Grad) => Number(c[`g_${st}_${k}`] ?? d[k]);
        return [st, { amt: g("amt"), pick: g("pick"), dir: g("dir"), scale: g("scale"), speed: g("speed"), warp: g("warp") }];
      }),
    ) as Record<StateKey, Grad>,
    thick: Number(c.flThick ?? 0),
    thickFill: !!c.flThickFill,
    thickInk: Number(c.flThickInk ?? 0.6),
    minAng: Number(c.flMinAng ?? 0),
    sideFade: Number(c.flSideFade ?? 0.35),
    dragKind: Number(c.flDragKind ?? 2),
    dragLen: Number(c.flDragLen ?? 1.5),
    edgeTh: Number(c.flEdge),
    edgeW: Number(c.flEdgeW),
    con: Number(c.flCon),
    bright: Number(c.flBright),
    stamp: !!c.flStamp,
    standMode: c.flStandMode !== false,
    standCarry: c.flStandCarry !== false,
    sampleSec: Number(c.flSample),
    dashSec: Number(c.flDash),
    fall: Number(c.flFall),
    ink: Number(c.flInk),
    facing: c.flFacing as Facing,
    stretch: Number(c.flStretch),
    stretchKind: Number(c.flKind),
    streakSoft: Number(c.flSoft),
    slit: Number(c.flSlit),
    multiply: !!c.flMultiply,
    floor: !!c.flFloor,
  };
  return (
    <div className="absolute inset-0 bg-white">
      {/* (how many cards are drawn and how fast — the phone's budget is ~300–500 cards, 2026-11-23) */}
      <div ref={readoutRef} className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-white" />
      <Canvas camera={{ position: [10, 1.5, -6], fov: 45, near: 0.05, far: 400 }} dpr={[1, 2]} gl={{ antialias: true }} onCreated={({ gl }) => gl.setClearColor("#ffffff", 1)}>
        <Scene L={L} viewRef={viewRef} readoutRef={readoutRef} />
      </Canvas>
    </div>
  );
}

"use client";
/**
 * LandscapeShot — the rehearsal wall's picture with nothing on it but the landscape, at a size the screen does not have
 * (the artist, 2026-11-03). Leva and the readout are page elements, so they are not in it; neither are the markers' names,
 * so those are drawn in by hand. The canvas is enlarged for the length of one task and nothing is painted in between, so
 * the screen does not change. Marked parts (`userData.shot`) and markers are hidden for that task only.
 */

import { useEffect, useState, type RefObject } from "react";
import { advance, useThree, type RootState } from "@react-three/fiber";
import type { DepthOfFieldEffect, EffectComposer as Composer } from "postprocessing";
import * as THREE from "three";
import { GLYPH_COLS, GLYPH_ROWS, type GlyphDot } from "@/lib/parliament";
import { matte } from "@/lib/parliament/shotMatte";
import { GRAIN_CELL } from "./SlowGrain";

export const SHOT_VEGETATION = { shot: "vegetation" };
export const SHOT_SEEDS = { shot: "seeds" };
/**
 * The smallest a point is drawn, in the buffer's pixels. A GPU draws nothing smaller than one, and most of the vegetation
 * is smaller than that on the screen, so one pixel is its look there: a picture keeps it as large as one of the screen's,
 * or at 8K the points would cover a fifth of what they cover on the screen.
 */
export const POINT_MIN = { value: 1 };

export interface ShotMark {
  kind: "me" | "bot" | "visitor";
  body: THREE.Object3D | null;
  name: THREE.Object3D | null;
  color: string;
  opacity: number;
  dots: readonly GlyphDot[];
  /** One step of the name, in the screen's pixels; 0 = no name. */
  cell: number;
}

export interface ShotChoice {
  background: boolean;
  vegetation: boolean;
  seeds: boolean;
  bots: boolean;
  visitors: boolean;
  longSide: number;
}

export type TakeShot = (what: ShotChoice) => HTMLCanvasElement;

/** MSAA stays only while pixels × samples fit this: at 8K it alone would take gigabytes, and matters little at that size. */
const MSAA_BUDGET = 40e6;
const MATTE_ROWS = 512;
/** 8K is as far as a canvas goes: Chrome gives about 33.5 million pixels at most, 7680 × 4320 in a 16:9 window. */
const LONG_SIDES = [
  { px: 3840, label: "4K" },
  { px: 7680, label: "8K" },
];

function copyOf(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext("2d", { willReadFrequently: true })!.drawImage(source, 0, 0);
  return copy;
}

function matteOf(black: HTMLCanvasElement, white: HTMLCanvasElement): void {
  const onBlack = black.getContext("2d", { willReadFrequently: true })!;
  const onWhite = white.getContext("2d", { willReadFrequently: true })!;
  for (let y = 0; y < black.height; y += MATTE_ROWS) {
    const rows = Math.min(MATTE_ROWS, black.height - y);
    const part = onBlack.getImageData(0, y, black.width, rows);
    matte(part.data, onWhite.getImageData(0, y, black.width, rows).data);
    onBlack.putImageData(part, 0, y);
  }
}

/** The names over the markers, where drei's Html put them on the screen and as large for the picture as they are for it. */
function drawNames(picture: HTMLCanvasElement, marks: readonly ShotMark[], camera: THREE.Camera, scale: number): void {
  const ctx = picture.getContext("2d")!;
  const at = new THREE.Vector3();
  for (const m of marks) {
    if (!m.name || m.cell <= 0) continue;
    m.name.getWorldPosition(at).project(camera);
    if (at.z > 1) continue;
    const cell = m.cell * scale;
    const gap = m.cell > 2 ? scale : 0;
    const left = (at.x * 0.5 + 0.5) * picture.width - (GLYPH_COLS * cell) / 2;
    const top = (-at.y * 0.5 + 0.5) * picture.height - (GLYPH_ROWS * cell) / 2;
    ctx.fillStyle = m.color;
    ctx.globalAlpha = m.opacity;
    for (const d of m.dots) ctx.fillRect(left + d.col * cell, top + d.row * cell, d.len * cell - gap, cell - gap);
  }
  ctx.globalAlpha = 1;
}

const BOKEH_PASSES = ["bokehNearBasePass", "bokehNearFillPass", "bokehFarBasePass", "bokehFarFillPass"] as const;

/** How far the focus blur reaches, in the buffer's pixels. `bokehScale` would also change how strongly it mixes in, which the picture keeps. */
function setBlurReach(dof: DepthOfFieldEffect, reach: number): void {
  const passes = dof as unknown as Record<(typeof BOKEH_PASSES)[number], { fullscreenMaterial: { scale: number } }>;
  for (const p of BOKEH_PASSES) passes[p].fullscreenMaterial.scale = reach;
}

function takeShot(state: RootState, composer: Composer | null, dof: DepthOfFieldEffect | null, marks: readonly ShotMark[], what: ShotChoice): HTMLCanvasElement {
  const { gl, scene, camera } = state;
  const canvas = gl.domElement;
  const context = gl.getContext();
  const size = gl.getSize(new THREE.Vector2());
  const limit = Math.min(gl.capabilities.maxTextureSize, context.getParameter(context.MAX_RENDERBUFFER_SIZE) as number);
  let scale = (Math.min(what.longSide, limit) + 0.5) / Math.max(size.x, size.y);

  const pixelRatio = gl.getPixelRatio();
  const samples = composer?.multisampling ?? 0;
  const edgeBlur = dof?.blurPass.blurMaterial.scale ?? 1;
  const background = scene.background;
  const hidden: THREE.Object3D[] = [];
  const hide = (o: THREE.Object3D) => {
    if (!o.visible) return;
    o.visible = false;
    hidden.push(o);
  };
  scene.traverse((o) => {
    if ((o.userData.shot === SHOT_VEGETATION.shot && !what.vegetation) || (o.userData.shot === SHOT_SEEDS.shot && !what.seeds)) hide(o);
  });
  const shown = marks.filter((m) => (m.kind === "bot" ? what.bots : what.visitors));
  for (const m of marks) if (m.body && !shown.includes(m)) hide(m.body);

  try {
    gl.setPixelRatio(scale);
    // a browser may give less than was asked for
    if (context.drawingBufferWidth !== canvas.width) {
      scale *= context.drawingBufferWidth / canvas.width;
      gl.setPixelRatio(scale);
    }
    // the grain and the focus blur are counted in pixels: at 8K they would all but vanish, so they stay as large in the
    // picture as on the screen
    const larger = canvas.width / (size.x * pixelRatio);
    GRAIN_CELL.value = larger;
    POINT_MIN.value = larger;
    if (dof) {
      setBlurReach(dof, dof.bokehScale * larger);
      dof.blurPass.blurMaterial.scale = edgeBlur * larger;
    }
    if (composer) {
      let fit = samples;
      while (fit > 0 && canvas.width * canvas.height * fit > MSAA_BUDGET) fit = fit > 2 ? fit / 2 : 0;
      composer.multisampling = fit;
      composer.setSize(size.x, size.y);
    }
    if (!what.background) scene.background = new THREE.Color(0x000000);
    // one ordinary frame, so that all that follows the canvas's size reads the new one
    advance(performance.now(), false, state);
    const picture = copyOf(canvas);
    if (what.background && background instanceof THREE.Color) {
      // on the screen whatever the canvas leaves see-through shows this colour from the page behind it
      const ctx = picture.getContext("2d")!;
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = `#${background.getHexString()}`;
      ctx.fillRect(0, 0, picture.width, picture.height);
      ctx.globalCompositeOperation = "source-over";
    }
    if (!what.background) {
      // again without the frame's own updates: time must not move between the two
      scene.background = new THREE.Color(0xffffff);
      const autoClear = gl.autoClear;
      gl.autoClear = true;
      if (composer) composer.render(0);
      else gl.render(scene, camera);
      let hud = shown.find((m) => m.body)?.body ?? null;
      while (hud?.parent) hud = hud.parent;
      if (hud) {
        gl.autoClear = false;
        gl.clearDepth();
        gl.render(hud, camera);
      }
      gl.autoClear = autoClear;
      matteOf(picture, copyOf(canvas));
    }
    if (context.isContextLost() || context.getError() === context.OUT_OF_MEMORY) throw new Error("out of graphics memory");
    drawNames(picture, shown, camera, scale);
    return picture;
  } finally {
    scene.background = background;
    for (const o of hidden) o.visible = true;
    gl.setPixelRatio(pixelRatio);
    GRAIN_CELL.value = 1;
    POINT_MIN.value = 1;
    if (dof) {
      setBlurReach(dof, dof.bokehScale);
      dof.blurPass.blurMaterial.scale = edgeBlur;
    }
    if (composer) {
      composer.multisampling = samples;
      composer.setSize(size.x, size.y);
    }
  }
}

/** Inside the Canvas: gives the panel a way to take the shot. */
export function ShotRig({
  take,
  composer,
  dof,
  marks,
}: {
  take: RefObject<TakeShot | null>;
  composer: RefObject<Composer | null>;
  dof: RefObject<DepthOfFieldEffect | null>;
  marks: RefObject<(() => readonly ShotMark[]) | null>;
}) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    take.current = (what) => takeShot(get(), composer.current, dof.current, marks.current?.() ?? [], what);
    return () => {
      take.current = null;
    };
  }, [get, take, composer, dof, marks]);
  return null;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function shotName(picture: HTMLCanvasElement, what: ShotChoice): string {
  const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `anthropocene-${local}-${picture.width}x${picture.height}${what.background ? "" : "-transparent"}.png`;
}

const TOGGLES = [
  { key: "background", label: "배경" },
  { key: "vegetation", label: "식생" },
  { key: "seeds", label: "홀씨" },
  { key: "bots", label: "봇" },
  { key: "visitors", label: "사람" },
] as const;

/** Beside the Canvas, on the rehearsal wall only. */
export function ShotPanel({ take, className = "" }: { take: RefObject<TakeShot | null>; className?: string }) {
  const [what, setWhat] = useState<ShotChoice>({ background: true, vegetation: true, seeds: true, bots: true, visitors: true, longSide: 7680 });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const shoot = () => {
    setBusy(true);
    setNote("찍는 중…");
    // a frame for the note to show: the shot holds the page for a moment
    requestAnimationFrame(() =>
      setTimeout(() => {
        const failed = () => {
          setNote("실패: 그래픽 메모리가 모자랍니다. 해상도를 낮춰 주세요");
          setBusy(false);
        };
        try {
          const picture = take.current?.(what);
          if (!picture) {
            setNote("화면이 아직 준비되지 않았습니다");
            setBusy(false);
            return;
          }
          picture.toBlob((blob) => {
            if (!blob) return failed();
            download(blob, shotName(picture, what));
            setNote(`저장함: ${picture.width} × ${picture.height}`);
            setBusy(false);
          }, "image/png");
        } catch (e) {
          console.error(e);
          failed();
        }
      }),
    );
  };

  return (
    <div className={`absolute left-3 top-3 flex select-none flex-col items-start gap-1 font-mono text-[10px] leading-4 ${className}`}>
      <div className="flex items-center gap-2">
        {TOGGLES.map(({ key, label }) => (
          <label key={key} className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={what[key]} onChange={(e) => setWhat({ ...what, [key]: e.target.checked })} />
            {label}
          </label>
        ))}
        <select value={what.longSide} onChange={(e) => setWhat({ ...what, longSide: Number(e.target.value) })} className="border border-current bg-transparent">
          {LONG_SIDES.map(({ px, label }) => (
            <option key={px} value={px}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <button type="button" disabled={busy} onClick={shoot} className="cursor-pointer border border-current px-2 disabled:cursor-wait disabled:opacity-50">
        UI·Leva 없는 고해상도 스크린샷 찍기
      </button>
      {note && <div>{note}</div>}
    </div>
  );
}

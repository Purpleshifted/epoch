/**
 * THE HERO SHOT (the artist, 2026-11-18: "글로벌에 히어로샷 렌더용 마커 가리기, 렌더성능최대 모드 적용한 버튼 만들어줘. 각도랑
 * 거리는 내가 조절할 테니 해상도나 이미지 사이즈도 최대로 하고(아니면 영역 설정할 수 있게 점선으로 ui 띄워주거나)"): a mode for
 * composing a still on the global view —
 *   - no markers and no readout text; the camera is left to the hand (nothing follows the building);
 *   - every render knob left on 자동 at its best (useRenderOptions `hero`): pixel ratio 2, shadows with a 4096 map, AO at
 *     its highest quality and full resolution, MSAA 8, the refraction at full size, every vegetation point, the full
 *     detail at any distance (a knob set to 끔 by hand stays off: it is part of the look);
 *   - a dashed frame for the picture's shape (the rest of the screen dimmed), and a button that draws the frame's
 *     picture once at a large size and saves it as a PNG.
 *
 * HOW THE PICTURE IS DRAWN (three tries on 2026-11-18). First the whole canvas at the shot's pixel ratio, the frame
 * cut out — a 6144 px shot of a 9 : 16 frame on a landscape screen made some 40 M pixels with the composer's buffers
 * on top, and Chrome froze ("파일이 커서 크롬이 갑자기 먹통되는 건가"). Then only the frame, the canvas moved onto it
 * and the camera zoomed — but three.js sizes its points by the canvas's height, not by the camera's zoom, so the plant
 * points came out smaller than on the screen. NOW: the whole canvas again, at a ratio that keeps it under 16 M pixels
 * (the frame's picture is as large as that allows); what the post-processing measures in PIXELS — the depth of
 * field's blur, the grain — is scaled by the shot's ratio over the screen's (2), so the green
 * blur of the plants and the grain read as on the screen ("렌더샷에 이펙트랑 피사계심도 반영이 안 돼", "식생 점에 심도
 * 들어가서 초록색으로 번진 느낌이 좋은건데"); and the edges are smoothed by FOUR renders, each moved by a quarter
 * pixel, averaged ("픽셀 계단이 좀 심하게 보임") — so the composer's MSAA can stay low (memory).
 *
 * NEVER SAVED: the group has no save row, so a reload always comes back without it — the exhibition wall reads the
 * saved values and must never open in this mode. Only where the panel is shown (not on the wall, ui=0).
 */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { button, useControls } from "leva";

const GROUP = "히어로샷"; // (never saved: see above)

/** A region of the canvas, in CSS pixels from its top left. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A shot being saved: the pixel ratio the whole canvas is drawn at, the composer's MSAA, the frame (the region kept),
 *  the canvas's height, the expected size. */
export interface Shot {
  /** The shot's ratio and MSAA apply (always, now: the canvas stays where it is). */
  armed: boolean;
  dpr: number;
  msaa: number;
  rect: Rect;
  fullH: number;
  outW: number;
  outH: number;
}

const ASPECTS: Record<string, number> = {
  "화면 전체": 0,
  "16 : 9 가로": 16 / 9,
  "9 : 16 세로": 9 / 16,
  "3 : 2 가로": 3 / 2,
  "2 : 3 세로": 2 / 3,
  "4 : 5 세로": 4 / 5,
  "1 : 1": 1,
  "A 판형 세로 (1 : √2)": 1 / Math.SQRT2,
  "A 판형 가로 (√2 : 1)": Math.SQRT2,
};

const LONGS: Record<string, number> = {
  "화면 그대로 × 2": 0,
  "긴 변 3072": 3072,
  "긴 변 4096 (권장)": 4096,
  "긴 변 6144 (무거움 · 1600만 픽셀에서 멈춤)": 6144,
};

/** The largest side the canvas is drawn at, and the most pixels of the WHOLE canvas (8 GB of memory shared with the
 *  GPU: the context's MSAA buffer and the composer's are several of these each). */
const MAX_SIDE = 8192;
const MAX_PIXELS = 16e6;

/** The frame: the largest region of the given shape inside the canvas, times `fill`, centred. 0 = the whole canvas. */
export function heroRect(W: number, H: number, aspect: number, fill: number): Rect {
  if (!(aspect > 0) || W <= 0 || H <= 0) return { x: 0, y: 0, w: W, h: H };
  let w = W * fill;
  let h = w / aspect;
  if (h > H * fill) {
    h = H * fill;
    w = h * aspect;
  }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/** How a shot of `rect` (in a canvas of W × H CSS px) is drawn so that its long side is `long` px (0 = the screen × 2):
 *  the whole canvas is drawn at the ratio, so the ratio is capped by the whole canvas's pixels. */
export function shotSize(W: number, H: number, rect: Rect, long: number): Shot {
  const w = Math.max(1, rect.w), h = Math.max(1, rect.h);
  W = Math.max(1, W);
  H = Math.max(1, H);
  let dpr = long > 0 ? long / Math.max(w, h) : 2;
  dpr = Math.max(1, Math.min(dpr, MAX_SIDE / W, MAX_SIDE / H, Math.sqrt(MAX_PIXELS / (W * H))));
  // (the four shifted renders smooth the edges: the composer's MSAA only has to help, and costs memory)
  const msaa = W * H * dpr * dpr <= 6e6 ? 4 : 2;
  return { armed: true, dpr, msaa, rect, fullH: H, outW: Math.round(w * dpr), outH: Math.round(h * dpr) };
}

/** The four quarter-pixel shifts the picture is averaged over (a 2 × 2 grid inside one pixel). */
const JITTER: [number, number][] = [
  [-0.25, -0.25],
  [0.25, -0.25],
  [-0.25, 0.25],
  [0.25, 0.25],
];

export interface HeroShot {
  /** The mode is on (or a shot is being saved). */
  on: boolean;
  aspect: number;
  fill: number;
  long: number;
  /** The shot being saved, or null. */
  shot: Shot | null;
  /** What the last save did (shown on the frame). */
  status: string;
  /** Called by HeroCapture when the picture is out (or failed). */
  done: (status: string) => void;
  /** Called by HeroCapture once the canvas stands on the frame (the shot's ratio may be applied). */
  arm: () => void;
  /** What the post-processing measures in pixels is scaled by (the shot's ratio over the screen's 2; 1 otherwise). */
  fx: number;
}

/** The 히어로샷 Leva group and the mode's state. `box` is the element the canvas fills. */
export function useHeroShot(enabled: boolean, box: RefObject<HTMLElement | null>): HeroShot {
  const [shot, setShot] = useState<Shot | null>(null);
  const [status, setStatus] = useState("");
  const take = useRef(() => {});
  const k = useControls(
    GROUP,
    {
      on: { value: false, label: "히어로샷 모드 (마커 · 글 숨김 · 카메라 따라가기 끔 · 렌더 최고 품질 — 무거움 · 저장되지 않음)" },
      aspect: { options: ASPECTS, value: 0, label: "사진 모양 (점선 영역)" },
      fill: { value: 0.92, min: 0.3, max: 1, step: 0.01, label: "점선 영역 크기 (화면에 들어가는 가장 큰 것 대비)", render: (get: (path: string) => unknown) => (get(`${GROUP}.aspect`) as number) > 0 },
      long: { options: LONGS, value: 4096, label: "저장 크기 (점선 영역만 이 크기로 그림)" },
      "PNG로 저장 (점선 안을 큰 해상도로 한 번 그려 내려받음)": button(() => take.current()),
    },
    { order: 0.4, collapsed: false, render: () => enabled },
  );
  take.current = () => {
    const el = box.current;
    if (!enabled || !el || shot) return;
    const W = el.clientWidth, H = el.clientHeight;
    const s = shotSize(W, H, heroRect(W, H, k.aspect as number, k.fill as number), k.long as number);
    setStatus(`저장 중… ${s.outW} × ${s.outH} (몇 초 걸림)`);
    setShot(s);
  };
  return {
    on: enabled && (k.on || shot !== null),
    aspect: k.aspect as number,
    fill: k.fill as number,
    long: k.long as number,
    shot,
    status,
    done: (st: string) => {
      setStatus(st);
      setShot(null);
    },
    arm: () => setShot((x) => (x && !x.armed ? { ...x, armed: true } : x)),
    fx: shot ? shot.dpr / 2 : 1,
  };
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/**
 * Inside the Canvas, mounted only while a shot is being saved: waits until the canvas is drawn at the shot's ratio (and
 * a few frames more, for the passes made anew at that size), then draws the picture four times, each moved by a quarter
 * pixel (the camera's view offset), and averages the frame's region of the four into the picture it downloads. Each
 * copy is taken in the same frame, right after the picture is drawn. The offset goes back when it unmounts.
 */
export function HeroCapture({ shot, composerOn, onDone }: { shot: Shot; composerOn: boolean; onDone: (status: string) => void; onArm?: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const frames = useRef(0);
  const done = useRef(false);
  /** The next of the four renders to be copied (-1: not started). */
  const sample = useRef(-1);
  const acc = useRef<{ out: HTMLCanvasElement; ctx: CanvasRenderingContext2D; x: number; y: number; w: number; h: number } | null>(null);
  const cam = camera as typeof camera & { setViewOffset?: (fw: number, fh: number, x: number, y: number, w: number, h: number) => void; clearViewOffset?: () => void };
  useEffect(() => () => cam.clearViewOffset?.(), [cam]);
  // (a priority above the composer's: this runs after it has drawn; with no composer nothing else draws, so this does)
  useFrame(() => {
    if (done.current) return;
    if (!composerOn) gl.render(scene, camera);
    const c = gl.domElement;
    frames.current++;
    const ready = Math.abs(c.width - Math.round(size.width * shot.dpr)) <= 2;
    if (sample.current < 0) {
      if (frames.current < 4 || (!ready && frames.current < 30)) return;
      if (!ready) {
        done.current = true;
        onDone("저장 안 함: 화면이 그 해상도로 바뀌지 않음 (저장 크기를 줄여 보기)");
        return;
      }
      try {
        const sx = c.width / Math.max(1, size.width), sy = c.height / Math.max(1, size.height);
        const r = shot.rect;
        const x = Math.round(r.x * sx), y = Math.round(r.y * sy);
        const w = Math.max(1, Math.min(c.width - x, Math.round(r.w * sx))), h = Math.max(1, Math.min(c.height - y, Math.round(r.h * sy)));
        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        const ctx = out.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        acc.current = { out, ctx, x, y, w, h };
      } catch (e) {
        done.current = true;
        onDone(`저장 실패: ${String(e).slice(0, 120)}`);
        return;
      }
      // the first shift, for the next frame's picture
      sample.current = 0;
      cam.setViewOffset?.(c.width, c.height, JITTER[0][0], JITTER[0][1], c.width, c.height);
      return;
    }
    const a = acc.current;
    if (!a) return;
    // this frame's picture was drawn with shift `sample`: averaged in (the n-th at weight 1/n)
    a.ctx.globalAlpha = 1 / (sample.current + 1);
    a.ctx.drawImage(c, a.x, a.y, a.w, a.h, 0, 0, a.w, a.h);
    sample.current++;
    if (sample.current < JITTER.length) {
      const [jx, jy] = JITTER[sample.current];
      cam.setViewOffset?.(c.width, c.height, jx, jy, c.width, c.height);
      return;
    }
    cam.clearViewOffset?.();
    done.current = true;
    const { out, w, h } = a;
    out.toBlob((b) => {
      if (!b) {
        onDone("저장 실패: 이미지를 만들지 못함 (크기를 줄여 보기)");
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(b);
      link.download = `hero-${stamp()}-${w}x${h}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 5000);
      onDone(`저장함: ${w} × ${h} px`);
    }, "image/png");
  }, 100);
  return null;
}

/** Over the canvas while the mode is on: the dashed frame (the rest dimmed) and a line saying what will be saved. */
export function HeroFrame({ hero, children }: { hero: HeroShot; children?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [wh, setWh] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWh([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    setWh([el.clientWidth, el.clientHeight]);
    return () => ro.disconnect();
  }, [hero.on]);
  if (!hero.on) return null;
  const [W, H] = wh;
  const r = heroRect(W, H, hero.aspect, hero.fill);
  const s = shotSize(W, H, r, hero.long);
  const whole = !(hero.aspect > 0);
  return (
    <div ref={root} className="pointer-events-none absolute inset-0 overflow-hidden select-none">
      <div
        style={{
          position: "absolute",
          left: r.x,
          top: r.y,
          width: r.w,
          height: r.h,
          border: "1px dashed rgba(255,255,255,0.75)",
          boxShadow: whole ? undefined : "0 0 0 100vmax rgba(0,0,0,0.38)",
          visibility: hero.shot ? "hidden" : "visible",
        }}
      />
      <div className="absolute font-mono text-[10px] leading-4 text-white/80" style={{ left: r.x + 6, top: Math.max(4, r.y + 4) }}>
        <div>
          히어로샷 · 저장하면 {s.outW} × {s.outH} px{hero.status ? ` · ${hero.status}` : ""}
        </div>
        {children}
      </div>
    </div>
  );
}

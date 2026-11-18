/**
 * THE HERO SHOT (the artist, 2026-11-18: "글로벌에 히어로샷 렌더용 마커 가리기, 렌더성능최대 모드 적용한 버튼 만들어줘. 각도랑
 * 거리는 내가 조절할 테니 해상도나 이미지 사이즈도 최대로 하고(아니면 영역 설정할 수 있게 점선으로 ui 띄워주거나)"): a mode for
 * composing a still on the global view —
 *   - no markers and no readout text; the camera is left to the hand (nothing follows the building);
 *   - every render knob left on 자동 at its best (useRenderOptions `hero`): pixel ratio 2, shadows with a 4096 map, AO at
 *     its highest quality and full resolution, MSAA 8, the refraction at full size, every vegetation point, the full
 *     detail at any distance (a knob set to 끔 by hand stays off: it is part of the look);
 *   - a dashed frame for the picture's shape (the rest of the screen dimmed), and a button that draws the frame's
 *     picture once at a large size (the pixel ratio raised for a few frames) and saves it as a PNG.
 *
 * NEVER SAVED: the group has no save row, so a reload always comes back without it — the exhibition wall reads the
 * saved values and must never open in this mode. Only where the panel is shown (not on the wall, ui=0).
 */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { button, useControls } from "leva";

const GROUP = "히어로샷";

/** A region of the canvas, in CSS pixels from its top left. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A shot being saved: the pixel ratio the canvas is drawn at, the composer's MSAA, the region kept, the expected size. */
export interface Shot {
  dpr: number;
  msaa: number;
  rect: Rect;
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
  "긴 변 4096": 4096,
  "긴 변 6144": 6144,
  "긴 변 8192 (무거움 — 멈추면 6144로)": 8192,
};

/** The largest side a canvas is drawn at, and the most pixels (8 GB of shared memory: the composer's buffers are several of these). */
const MAX_SIDE = 16384;
const MAX_PIXELS = 48e6;

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

/** How a shot of `rect` (in a canvas of W × H CSS px) is drawn so that its long side is `long` px (0 = the screen × 2). */
export function shotSize(W: number, H: number, rect: Rect, long: number): Shot {
  let dpr = long > 0 ? long / Math.max(1, rect.w, rect.h) : 2;
  dpr = Math.min(dpr, MAX_SIDE / Math.max(1, W), MAX_SIDE / Math.max(1, H), Math.sqrt(MAX_PIXELS / Math.max(1, W * H)));
  dpr = Math.max(1, dpr);
  const px = W * H * dpr * dpr;
  // (MSAA on top of a canvas drawn this large is memory more than it is smoothness: the large ratio already smooths)
  const msaa = px <= 6e6 ? 8 : px <= 16e6 ? 4 : 0;
  return { dpr, msaa, rect, outW: Math.round(rect.w * dpr), outH: Math.round(rect.h * dpr) };
}

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
      long: { options: LONGS, value: 6144, label: "저장 크기" },
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
  };
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/**
 * Inside the Canvas, mounted only while a shot is being saved: waits until the canvas is drawn at the shot's pixel
 * ratio (and a few frames more, for the passes made anew at that size), then — in the same frame, right after the
 * picture is drawn — copies the frame's region out and downloads it.
 */
export function HeroCapture({ shot, composerOn, onDone }: { shot: Shot; composerOn: boolean; onDone: (status: string) => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const frames = useRef(0);
  const done = useRef(false);
  // (a priority above the composer's: this runs after it has drawn; with no composer nothing else draws, so this does)
  useFrame(() => {
    if (done.current) return;
    if (!composerOn) gl.render(scene, camera);
    const c = gl.domElement;
    frames.current++;
    const ready = Math.abs(c.width - Math.round(size.width * shot.dpr)) <= 2;
    if (frames.current < 6 || (!ready && frames.current < 120)) return;
    done.current = true;
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
      ctx.drawImage(c, x, y, w, h, 0, 0, w, h);
      out.toBlob((b) => {
        if (!b) {
          onDone("저장 실패: 이미지를 만들지 못함 (크기를 줄여 보기)");
          return;
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = `hero-${stamp()}-${w}x${h}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        onDone(`저장함: ${w} × ${h} px${ready ? "" : " (해상도가 다 올라가지 않음)"}`);
      }, "image/png");
    } catch (e) {
      onDone(`저장 실패: ${String(e).slice(0, 120)}`);
    }
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

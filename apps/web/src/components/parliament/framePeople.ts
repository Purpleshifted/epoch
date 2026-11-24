/**
 * framePeople — THE PEOPLE AS STANDING FRAMES, SHARED (the artist, 2026-11-23: "이제 슬슬 봇 랩에 연결해보자"). What the
 * frames study (/lab/mobile/frames, FrameLab.tsx) decided — each clip's set and state, the afterimages by state, the
 * distance hierarchy, the colour flowing inside, frames standing where each arrival came and fading — drawn the same way
 * for its made-up walkers and for the bots of the personal view (PointPeople, mode "frames"). Lengths in the Look are
 * metres; `unit` turns them into the scene's units (1 in the study; 1 / the personal view's scale there).
 */

import * as THREE from "three";
import { ATLAS_GLSL, type SpriteIndex } from "./spritePeople";

export const MAX_CARDS = 4096;
export const TAU = Math.PI * 2;

export type Path = "across" | "circle" | "toward" | "wander" | "scatter";
/** What a clip is for in the interaction (the artist, 2026-11-23: "서있을 때, 이동중일 때, 소통중일 때 등등 인터랙션 로직별
 *  케이스따라") — standing, moving, moving fast, talking (asking / answering), or not decided yet. */
export type ClipState = "none" | "stand" | "walk" | "brisk" | "run" | "talk";
/** A clip's own set (the artist, 2026-11-23: front shots only, stood square to the way they go — a silhouette's front and
 *  back are the same, so no view): what it is for, mirrored, how a body walks in it, and how it looks — height, width,
 *  ink, foot level, a colour laid over it, played backwards, where its loop starts. */
export interface ClipSet {
  id: string;
  state: ClipState;
  flip: boolean;
  dist: number;
  gap: number;
  height: number;
  width: number;
  ink: number;
  lift: number;
  tint: [number, number, number];
  tintAmt: number;
  reverse: boolean;
  offset: number;
  /** Playback speed × (every state — for standing and talking clips the only one), and a ping-pong loop (a → back → a). */
  play: number;
  pingpong: boolean;
  /** The body's share of its frame's height (a wide pose made the window taller): the card is enlarged by its inverse. */
  fill: number;
  /** Seen far off walking across: this profile clip is used (the distance hierarchy's far tier). */
  farSide: boolean;
  /** Which way the profile clip's walker faces in the picture: +1 right, -1 left. */
  faces: number;
  /** The clip's own stride (s): its 16 frames over this long are the original video's pace. */
  stride: number;
  /** Where in its loop (0 … 1) both feet are first down — two steps a loop, the next half a loop on. */
  ds0: number;
  /** A clip seen in profile (found so by the sheet, or used as one far off): it has a way it walks on screen. */
  profile: boolean;
}
export type Facing = "eye" | "along" | "across";
/** The colour flowing inside a state's bodies: how much (0 … 1), which combination (0 = each walker their own, 1 … 5),
 *  along what (0 height · 1 space · 2 a copy's age), the size of a wave, its speed, how much it wavers. */
export interface Grad {
  amt: number;
  pick: number;
  dir: number;
  scale: number;
  speed: number;
  warp: number;
}
/** A walker's state for its afterimages: walking, walking briskly, running, standing, talking. */
export type StateKey = "walk" | "brisk" | "run" | "stand" | "talk";
/** How a state's afterimages are left and age: how long they stay (s), their ink, how many and how far apart in time
 *  (when copies are left by time, not by samples), the frames between two of them (count, ink ×), and with their age —
 *  size ×, rise (m), scatter (m), turn (rad), colour faded, blur (a share of the frame's width). */
export interface Trail {
  life: number;
  ink: number;
  copies: number;
  gap: number;
  betweenN: number;
  betweenInk: number;
  scale: number;
  rise: number;
  scatter: number;
  turn: number;
  desat: number;
  blur: number;
}

export interface Look {
  count: number;
  path: Path;
  spread: number;
  dist: number;
  /** The clips' sets (a row of the sheet each), the fixed clip (0 = by state and view), the share of people standing. */
  clips: ClipSet[];
  row: number;
  standShare: number;
  /** THE DISTANCE HIERARCHY (the artist, 2026-11-23: "한 번 잘 위계화 해봐"): near / middle / far by the distance from the eye,
   *  blended over `band` m at r1 and r2 — each tier multiplies the afterimages, the ink, adds blur and scales the flowing
   *  colour; far off, cards may face the eye and profile clips walk across. */
  tier: { r1: number; r2: number; band: number; farEye: boolean; farSide: boolean; stillNear: boolean; useSide: boolean; sideNear: boolean; sideCross: number; trail: [number, number, number]; betweenMax: [number, number, number]; ink: [number, number, number]; blur: [number, number, number]; grad: [number, number, number] };
  /** How fast people go: 0 by the clips' sets, 1 each their own speed — spread from speedMin to speedMax, crowded towards
   *  the slow end by speedSkew — and the clip whose matched speed is nearest (within ±speedTol). */
  speedMode: number;
  speedMin: number;
  speedMax: number;
  speedSkew: number;
  speedTol: number;
  /** Clips by the state thresholds — a person keeps one clip of their state, its build and height (the artist,
   *  2026-11-23: "봇 속도별로 조절하니까 … 어색하다. 체격이랑 이런 거 다 나눠놨어서") — or, as an option, by speed. */
  pickBySpeed: boolean;
  briskFrom: number;
  runFrom: number;
  /** Passing through me: nobody is drawn nearer than nearCut (m), fading in over nearBand — a body filling the whole
   *  screen, its afterimages and blur over every pixel, dropped the frame rate ("나를 통과해서 지나갈 때 fps 가 … 확"). */
  nearCut: number;
  nearBand: number;
  /** Every clip one height and width (heightBase m), each person their own height by a random factor within ±heightVar
   *  (the artist, 2026-11-23: "키랑 폭 통일해서 속도 맞춰서 골라도 안 이상하게" — "봇마다 키는 랜덤지정해서 그 배율에는
   *  따르게"). */
  unify: boolean;
  heightBase: number;
  heightVar: number;
  /** The legs' tempo from a walking person's stride — longer the faster they go — not from each clip's distance a frame
   *  ("잔걸음 너무 어색해서 미쳐버릴것 같아": a short distance a frame at walking speed made quick little steps). */
  gait: boolean;
  /** People as the poster's pixel pictogram drawn live (no clips), its cell, and its stride's share of a person's — short
   *  quick steps read as the pictogram's own ("빨리 토도도도 걸어가도 안 징그럽잖아"). */
  pix: boolean;
  pixCell: number;
  pixStride: number;
  /** White pictograms on a black ground (the artist, 2026-11-24: "예전 검정배경에 흰 픽셀로"), or black on white. */
  pixWhite: boolean;
  /** The card turned from its walking direction (rad); what fills between two copies (0 none · 2 a count of frames · 3 one per frame time). */
  yaw: number;
  between: number;
  /** The afterimages by the walker's state (the artist, 2026-11-23: "서있을 때 잔상 날리는 거랑 처리하는 것도 따로 모드별로"). */
  trails: Record<StateKey, Trail>;
  /** Five combinations of three colours (15 "#rrggbb"). */
  pals: string[];
  /** The colour flowing inside, by the walker's state (the artist, 2026-11-23: "안쪽 색 번짐 모드별로 다 조절"). Talking:
   *  later tied to the melody of someone speaking to me ("소통은 나중에 말 거는 멜로디랑도 연동하고 싶음") — not yet. */
  grads: Record<StateKey, Grad>;
  /** The frames' thickness (m), reaching back to the copy before or not, its ink and its fading towards the ends. */
  thick: number;
  thickFill: boolean;
  thickInk: number;
  /** The least angle (°) a card standing to its way keeps to my line of sight (0 = none: it may stand edge-on). */
  minAng: number;
  /** How a card standing to its way fades as it turns edge-on (0 = it does not; 0.35 ≈ gone within ~20° of side-on). */
  sideFade: number;
  /** What the face along the way shows (0 the silhouette squeezed · 1 streaks · 2 silhouette at the card, streaks
   *  beyond) and how far the streaks carry (card widths). */
  dragKind: number;
  dragLen: number;
  edgeTh: number;
  /** The cut's softness above the threshold; the colour's contrast and brightness. */
  edgeW: number;
  con: number;
  bright: number;
  /** The side fill between frames (0 … 1). */
  stamp: boolean;
  /** A frame at each arrival, standing where it came and fading — the clip playing at the original video's pace, nothing
   *  moving between (the artist, 2026-11-23: "프레임은 원본 비디오에 맞게 하고 … 디바운싱으로 들어오는 상태에 맞게 순간순간
   *  거기서 속도/방향에 따라 프레임이 섰다 사라지게 … 성능에도 그게 맞고 … 마감 구려지는 것도 막을"). */
  standMode: boolean;
  /** …and the body now walks on from the latest arrival at the pace and way the last two gave, until the next (the
   *  artist, 2026-11-23: "생각보다 너무 정신사나운데 — 다음위치 들어오기 전까진 그 속도랑 방향대로 움직이고 있어야 하나").
   *  The bot server writes a place a second, so a relay pulled harder would bring nothing new. */
  standCarry: boolean;
  /** 2: one arrival span behind, the body walks from each arrival to the next in a whole number of steps — the distance
   *  over its step length — landing with both feet down at each ("1초 사이에 몇걸음인지 어림해서 그 사이를 움직이는
   *  프레임으로"); 1: on from the latest arrival, no delay. */
  carryKind: number;
  sampleSec: number;
  dashSec: number;
  fall: number;
  ink: number;
  facing: Facing;
  stretch: number;
  stretchKind: number; // 0 streak · 1 widen the frame
  streakSoft: number;
  slit: number;
  multiply: boolean;
  floor: boolean;
}

export interface Stamp {
  t: number;
  x: number;
  z: number;
  h: number;
  ph: number;
  /** Its phase set by the steps from the arrival before (both feet down at each arrival). */
  pa?: boolean;
}

export interface Walker {
  hash: number;
  x: number;
  z: number;
  h: number;
  ph: number;
  // the path's own parameter (distance along it, or an angle)
  s: number;
  dir: number;
  // wander: the point it walks to
  gx: number;
  gz: number;
  hist: Stamp[];
  stamps: Stamp[];
  lastHist: number;
  lastSample: number;
  // its clip (a row of the sheet), standing or not, its pace (m/s) and how long a frame is held (s)
  home: number;
  standing: boolean;
  speed: number;
  gap: number;
  // seconds a phase cycle takes (the clip's frames once — twice for a ping-pong loop)
  cycle: number;
  // walking across my view now (in profile), kept a little past the threshold
  sideNow?: boolean;
}

export const VERT = /* glsl */ `
uniform float uCols;
uniform float uRows;
uniform float uMinAng;     // the least angle (rad) a card standing to its way keeps to my line of sight
uniform float uSideFade;   // a card standing to its way fades as it turns edge-on to me (the width of the fade; 0 = none)
uniform float uThick;      // the frame's thickness (m), and whether it reaches back to the copy before
uniform float uThickFill;
#ifdef SIDE
flat varying vec2 vLoHi;
#endif
uniform float uAspect;
uniform float uFacing;     // 0 eye · 1 along the path · 2 across it
uniform float uStretch;
uniform float uSlit;
attribute vec4 iA;         // x, z, height, alpha
attribute vec4 iB;         // row, frame, mirror, heading
attribute vec4 iC;         // previous copy x, z, has one (0/1), lift (m)
attribute vec4 iD;         // colour faded (0 … 1), the clip's colour laid over (0 … 1), age (0 … 1), colour combination
attribute vec4 iE;         // the clip's colour (linear rgb), width ×
attribute vec4 iG;         // the flowing colour of the card's state: along what, wave size, speed, waver
attribute vec4 iF;         // blur at this card's age and distance (a share of the frame's width), the flowing colour ×, faces the eye (1), 0
varying vec2 vUv;          // the frame's own u (may run outside 0 … 1 on the stretched side), v
varying float vAlpha;
varying float vSide;       // the trailing side (−1 left, +1 right) in the card's own u
flat varying float vRow;
flat varying float vFrame;
flat varying float vMirror;
flat varying float vDesat;
flat varying vec4 vTint;
varying vec3 vWorld;
flat varying float vAge;
flat varying float vPal;
flat varying float vBlur;
flat varying float vGradK;
flat varying vec4 vGrad;
void main() {
  vec3 feet = vec3(iA.x, 0.0, iA.y);
  vec3 right;
  // (far off a card may face the eye whatever the knob says — the distance hierarchy)
  // (2: a profile clip, along its own way whatever the knob)
  float fac = iF.z > 1.5 ? 1.0 : iF.z > 0.5 ? 0.0 : uFacing;
  if (fac < 0.5) {
    vec3 toEye = cameraPosition - feet;
    toEye.y = 0.0;
    vec3 f = normalize(toEye + vec3(1e-5, 0.0, 0.0));
    right = vec3(f.z, 0.0, -f.x);
  } else {
    vec3 fwd = vec3(sin(iB.w), 0.0, cos(iB.w));
    right = fac < 1.5 ? fwd : vec3(fwd.z, 0.0, -fwd.x);
    // NEVER EDGE-ON TO ME (the artist, 2026-11-23, on the dragged faces: "아니 이게 맞나"): a card standing to its way
    // turns towards the eye just enough that it is never flatter than the angle to my line of sight — seen from the side
    // the frames overlap in a row, a chronophotograph, instead of knife edges (the same way round: the picture never flips)
    if (uMinAng > 0.0) {
      vec3 toE = cameraPosition - feet;
      toE.y = 0.0;
      vec3 fe = normalize(toE + vec3(1e-5, 0.0, 0.0));
      vec3 re = vec3(fe.z, 0.0, -fe.x);
      if (dot(re, right) < 0.0) re = -re;
      float ang = acos(clamp(dot(right, re), -1.0, 1.0));
      float maxAng = 1.5707963 - uMinAng;
      if (ang > maxAng) {
        vec3 perp = right - re * dot(right, re);
        float pl = length(perp);
        perp = pl > 1e-5 ? perp / pl : vec3(-re.z, 0.0, re.x);
        right = re * cos(maxAng) + perp * sin(maxAng);
      }
    }
  }
  float h = iA.z;
  float w = h * uAspect * (iE.w > 0.0 ? iE.w : 1.0);
#ifdef SIDE
  // THE FRAME'S THICKNESS (the artist, 2026-11-23: "프레임 자체에 두께를 좀 둘 수 있나? … 옆에 빈공간이 보이는 경우"): a
  // second card square to this one, along its normal — seen from the side it shows the frame's silhouette squeezed into
  // the thickness, so the frames read as a mass, not slices; it may reach back to the copy before (the gap filled)
  vec3 nrm = vec3(-right.z, 0.0, right.x);
  float back = (uThickFill > 0.5 && iC.z > 0.5) ? dot(vec3(iC.x, 0.0, iC.y) - feet, nrm) : 0.0;
  float lo = min(-0.5 * uThick, back), hi = max(0.5 * uThick, back);
  float sx = position.x < 0.0 ? lo : hi;
  vec3 p = feet + nrm * sx + vec3(0.0, position.y * h + iC.w, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  // (u: card widths from the card along its normal; the face's two ends, the same way)
  vUv = vec2(sx / max(w, 1e-4), position.y);
  vLoHi = vec2(lo, hi) / max(w, 1e-4);
  vSide = 1.0;
#else
  // the move to the copy before, across the card (in card widths): the stretch reaches towards it
  float e = 0.0;
  // (only a card facing the eye or along the path stretches; a stretch under 6 % of its width is none — a card standing
  // square to its path got a sliver of the body's middle at its sides from tiny offsets: the lines the artist saw)
  if (iC.z > 0.5 && fac < 1.5) e = dot(vec3(iC.x, 0.0, iC.y) - feet, right) / max(w, 1e-4) * uStretch;
  if (abs(e) < 0.06) e = 0.0;
  float slitHalf = 0.5 * uSlit;
  float xl = min(-slitHalf, e), xr = max(slitHalf, e);
  float x = position.x < 0.0 ? xl : xr;
  vec3 p = feet + right * x * w + vec3(0.0, position.y * h + iC.w, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vUv = vec2(x, position.y);
  vSide = e >= 0.0 ? 1.0 : -1.0;
#endif
  vAlpha = iA.w;
#ifndef SIDE
  // PAPER-THIN, IT GOES AS IT TURNS AWAY (the artist, 2026-11-23: "그냥 옆모습으로 바뀌는 걸 없애는 게 나을지도? 작품 의의
  // 생각해보면… 어차피 중간에 없어지도록 하는 거면"): a front shot standing to its way, seen more and more side-on, fades out
  // instead of thinning to a knife edge
  if (fac > 0.5 && uSideFade > 0.0) {
    vec3 te = cameraPosition - feet;
    te.y = 0.0;
    vec3 nrm2 = vec3(-right.z, 0.0, right.x);
    float k = abs(dot(nrm2, normalize(te + vec3(1e-5, 0.0, 0.0))));
    vAlpha *= smoothstep(0.0, uSideFade, k);
  }
#endif
  // (the frame's row and column, and the mirror: flat, the same over the card)
  vRow = iB.x;
  vFrame = floor(mod(iB.y, uCols));
  vMirror = iB.z;
  vDesat = iD.x;
  vTint = vec4(iE.rgb, iD.y);
  vWorld = p;
  vAge = iD.z;
  vPal = iD.w;
  vBlur = iF.x;
  vGradK = iF.y;
  vGrad = iG;
}`;

export const FRAG = /* glsl */ `
uniform sampler2D uSheet;
uniform float uCols;
uniform float uPer;
uniform float uAtlasRows;
${ATLAS_GLSL}
uniform float uSlit;
uniform float uStretchKind;
uniform float uStreakSoft;
uniform float uMultiply;
flat varying float vBlur; // this card's blur (its state's, at its age)
flat varying float vGradK;
flat varying vec4 vGrad;  // the flowing colour of the card's state (along what, wave size, speed, waver)
varying vec2 vUv;
varying float vAlpha;
varying float vSide;
flat varying float vRow;
flat varying float vFrame;
flat varying float vMirror;
flat varying float vDesat;
flat varying vec4 vTint;
varying vec3 vWorld;
flat varying float vAge;
flat varying float vPal;
uniform float uEdgeTh;    // the alpha below which nothing is drawn (a faint box round a frame — the artist, 2026-11-23)
uniform float uEdgeW;     // how soft the cut is (the width of the ramp above the threshold; small = a hard edge — 2026-11-23)
uniform float uCon;       // the colour's contrast about mid-grey, and its brightness
uniform float uBright;
uniform float uPix;        // 1: the poster's pixel pictogram, drawn here (no picture); vRow = the state, vFrame the step
uniform float uPixCell;    // its cell, in the figure's 30 units (head to foot)
uniform vec3 uPixInk;      // its colour: white on the black ground (the poster's), or black on the paper
uniform float uAspect;
float pxRect(vec2 p, float x0, float y0, float w, float h) {
  return step(x0, p.x) * step(p.x, x0 + w) * step(y0, p.y) * step(p.y, y0 + h);
}
// THE FUTURE OBSERVER'S BODY (the motion poster's archaeologists; the artist, 2026-11-24: "모션포스터에 미래관찰자로 넣었던
// 조그만 픽토그램 느낌" → "현장에서 바로 돌려도"): legs, body, head as blocks of cells; a step lifts one leg off the ground,
// two steps a loop; hurrying lifts higher, running bobs and spreads; talking waves an arm; standing stands
vec4 pixFig(float u, float v) {
  vec2 p = vec2((u - 0.5) * 30.0 * uAspect, v * 30.0);
  p = (floor(p / uPixCell) + 0.5) * uPixCell;
  float st = vRow;            // 0 walk · 1 brisk · 2 run · 3 stand · 4 talk
  float f = vFrame;
  float side = mod(floor(f / 8.0), 2.0);
  float k = sin(3.14159265 * mod(f, 8.0) / 8.0);
  float lift = st < 0.5 ? 3.0 : st < 1.5 ? 4.0 : st < 2.5 ? 6.0 : 0.0;
  float rise = floor(k * lift + 0.5);
  float run = st > 1.5 && st < 2.5 ? 1.0 : 0.0;
  float bob = run * floor(k * 1.5 + 0.5);
  float lL = side < 0.5 ? rise : 0.0, lR = side < 0.5 ? 0.0 : rise;
  float a = pxRect(p, -5.0 - run, lL, 4.0, 8.0 + bob - lL);
  a = max(a, pxRect(p, 1.0 + run, lR, 4.0, 8.0 + bob - lR));
  a = max(a, pxRect(p, -5.0, 8.0 + bob, 10.0, 12.0));
  a = max(a, pxRect(p, -4.0, 22.0 + bob, 8.0, 8.0));
  if (st > 3.5) {
    // (the arm up and down every four frames: a wave)
    float up = mod(floor(f / 4.0), 2.0);
    a = max(a, pxRect(p, 5.0, 12.0 + up * 6.0, 3.0, 6.0 + up * 2.0));
  }
  return vec4(uPixInk, a);
}
vec4 cell(float u, float v) {
  float uu = vMirror < 0.0 ? 1.0 - u : u;
  vec4 t = uPix > 0.5 ? pixFig(uu, v) : texture2D(uSheet, atlasUv(vRow, vFrame, vec2(clamp(uu, 0.001, 0.999), clamp(v, 0.001, 0.999))));
  // the frame's own border is always empty (shrunk far off, the sheet's neighbouring frames bleed into it), and what is
  // fainter than the threshold is not there (a faint box round a frame)
  float edge = smoothstep(0.0, 0.035, uu) * smoothstep(0.0, 0.035, 1.0 - uu) * smoothstep(0.0, 0.006, v) * smoothstep(0.0, 0.02, 1.0 - v);
  t.a = smoothstep(uEdgeTh, min(1.0, uEdgeTh + uEdgeW), t.a) * edge;
  return t;
}
// an old copy blurred (the artist, 2026-11-23: "오래된 잔상에는 블러"): two rings of taps round the point, their radius the
// copy's age × the knob (the body now stays sharp)
vec4 cellB(float u, float v) {
  float r = vBlur;
  if (r < 0.002) return cell(u, v);
  vec4 acc = cell(u, v) * 0.2;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    vec2 o = vec2(cos(a), sin(a) * 0.5);
    acc += cell(u + o.x * r, v + o.y * r) * 0.06 + cell(u + o.x * r * 0.5 + o.y * r * 0.2, v + o.y * r * 0.5) * 0.04;
  }
  return acc;
}
#ifdef SIDE
uniform float uThickInk;
uniform float uDragKind;   // 1 streaks · 2 the silhouette turned at the card, streaks beyond
uniform float uDragLen;    // how far the streaks carry (card widths)
flat varying vec2 vLoHi;
// THE FACE ALONG THE WAY — THICKNESS AND DRAG (the artist, 2026-11-23: "이것봐, 모양이 다 죽어" → "공간에서 드래그해서
// 부피 생기도록 못하나? 전에 없앴던 띠랑 합친다거나"): a front shot has no shape seen side-on, so the face never fills
// heights with a width (the blank block): at the card the silhouette itself, turned square, and from it to the copy before
// the body's middle dragged out in lines, as a long exposure smears it. (The silhouette squeezed into the face is gone —
// "실루엣 눌러 펴는 건 진짜 별론데".)
void main() {
  float xc = vUv.x;              // card widths from the card, along its normal
  vec4 t;
  float a;
  {
    float beyond = uDragKind > 1.5 ? abs(xc) - 0.5 : abs(xc);
    if (beyond <= 0.0) {
      t = cell(0.5 + xc, vUv.y);
      a = t.a;
    } else {
      // the body's middle (three columns, so a line is not one pixel's luck), fading with the distance
      vec4 c0 = cell(0.42, vUv.y), c1 = cell(0.5, vUv.y), c2 = cell(0.58, vUv.y);
      float s = c0.a + c1.a + c2.a;
      t = vec4(s > 1e-3 ? (c0.rgb * c0.a + c1.rgb * c1.a + c2.rgb * c2.a) / s : vec3(1.0), max(c1.a, (c0.a + c2.a) * 0.5));
      a = t.a * exp(-beyond / max(0.05, uDragLen));
    }
  }
  a *= vAlpha * uThickInk;
  if (a < 0.004) discard;
#else
void main() {
  float x = vUv.x;              // card widths from the card's middle
  float slitHalf = 0.5 * uSlit;
  vec4 t;
  float a;
  if (abs(x) <= slitHalf) {
    t = cellB(x + 0.5, vUv.y);
    a = t.a;
  } else {
    // the stretched part: beyond the frame's slit, towards the copy before
    float beyond = abs(x) - slitHalf;
    if (uStretchKind > 0.5) {
      // the frame itself widened: the whole stretch maps onto the slit
      float span = max(abs(x), slitHalf);
      t = cellB(0.5 + x / span * slitHalf, vUv.y);
      a = t.a;
    } else {
      // a streak: the body's middle (just inside the slit's trailing edge) pulled sideways, fading with the distance
      float edge = 0.5 + vSide * min(slitHalf, 0.12);
      t = cellB(edge, vUv.y);
      a = t.a * exp(-beyond / max(0.02, uStreakSoft));
    }
  }
  a *= vAlpha;
  if (a < 0.004) discard;
#endif
  t.rgb = mix(t.rgb, vTint.rgb, vTint.a);
  t.rgb = mix(t.rgb, gradAt(vWorld, vUv.y, vAge, vPal, vGrad), uGradAmt * vGradK);
  t.rgb = mix(t.rgb, vec3(dot(t.rgb, vec3(0.299, 0.587, 0.114))), vDesat);
  t.rgb = clamp((t.rgb - 0.5) * uCon + 0.5 + uBright, 0.0, 1.0);
  if (uMultiply > 0.5) gl_FragColor = vec4(mix(vec3(1.0), t.rgb, a), 1.0);
  else gl_FragColor = vec4(t.rgb, a);
}`;

/** THE COLOUR FLOWING INSIDE (the artist, 2026-11-23: "안에 그래디언트로 색 출렁이는 효과 한 번 넣어보자"): inside the
 *  silhouettes, a gradient of three colours that waves — along the height, through space as they walk, or with a
 *  copy's age — warped a little so it never runs straight. Mixed over the body's own colour by an amount. */
export const GRAD_GLSL = /* glsl */ `
uniform float uGradAmt;
uniform vec3 uPal[15];     // five combinations of three colours
uniform float uTime;
// g: the card's state's own (along what, wave size, speed, waver)
vec3 gradAt(vec3 world, float v, float age, float pal, vec4 g) {
  int p = int(clamp(pal, 0.0, 4.0) + 0.5) * 3;
  float x = g.x < 0.5 ? v * 1.7 : (g.x < 1.5 ? (world.x + world.z) * 0.35 : age * 2.0);
  x = x * g.y + uTime * g.z * 0.25;
  x += g.w * 0.25 * sin(world.y * 3.1 + uTime * 0.9 + world.x * 1.3) + g.w * 0.15 * sin(v * 9.0 - uTime * 1.7);
  float t = 0.5 + 0.5 * sin(x * 6.2831853);
  float t2 = 0.5 + 0.5 * sin(x * 6.2831853 * 0.5 + 1.7);
  return mix(mix(uPal[p], uPal[p + 1], t), uPal[p + 2], t2 * t2);
}`;

export function gradUniforms(): Record<string, THREE.IUniform> {
  return {
    uGradAmt: { value: 0 },
    uPal: { value: Array.from({ length: 15 }, () => new THREE.Color()) },
    uTime: { value: 0 },
  };
}

/** The frames' thickness: the same cards drawn again square to themselves (SIDE), sharing the frames' uniforms. */
export function makeSideMaterial(main: THREE.ShaderMaterial): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: main.uniforms,
    defines: { SIDE: "" },
    vertexShader: main.vertexShader,
    fragmentShader: main.fragmentShader,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
}

export function makeMaterial(): THREE.ShaderMaterial {
  // (three turns attribute/varying/texture2D/gl_FragColor into GLSL 3 for WebGL2; "flat varying" becomes flat out/in)
  return new THREE.ShaderMaterial({
    uniforms: {
      uThick: { value: 0 },
      uThickFill: { value: 0 },
      uThickInk: { value: 0.6 },
      uMinAng: { value: 0 },
      uSideFade: { value: 0 },
      uPix: { value: 0 },
      uPixCell: { value: 2 },
      uPixInk: { value: new THREE.Color(1, 1, 1) },
      uDragKind: { value: 2 },
      uDragLen: { value: 1.5 },
      uSheet: { value: null },
      uCols: { value: 16 },
      uRows: { value: 1 },
      uPer: { value: 1 },
      uAtlasRows: { value: 1 },
      uAspect: { value: 0.5 },
      uFacing: { value: 0 },
      uStretch: { value: 1 },
      uSlit: { value: 1 },
      uStretchKind: { value: 0 },
      uStreakSoft: { value: 0.6 },
      uMultiply: { value: 1 },
      uEdgeTh: { value: 0.15 },
      uEdgeW: { value: 0.15 },
      uCon: { value: 1 },
      uBright: { value: 0 },
      ...gradUniforms(),
    },
    vertexShader: VERT,
    // (the flowing colour's chunk, put in when the material is made — GRAD_GLSL is declared further down)
    fragmentShader: FRAG.replace("vec4 cell(", `${GRAD_GLSL}\nvec4 cell(`),
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
}

export function setBlend(m: THREE.ShaderMaterial, multiply: boolean): void {
  if (multiply) {
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.DstColorFactor;
    m.blendDst = THREE.ZeroFactor;
    m.blendSrcAlpha = THREE.ZeroFactor;
    m.blendDstAlpha = THREE.OneFactor;
  } else m.blending = THREE.NormalBlending;
  m.needsUpdate = true;
}

export const frac = (x: number) => x - Math.floor(x);
export const smooth01 = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

export function histAt(H: Stamp[], t: number): Stamp | null {
  if (!H.length || t < H[0].t) return null;
  let lo = 0, hi = H.length - 1;
  if (t >= H[hi].t) return H[hi];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (H[m].t <= t) lo = m;
    else hi = m;
  }
  const a = H[lo], b = H[hi], u = (t - a.t) / Math.max(1e-6, b.t - a.t);
  let dh = b.h - a.h;
  dh = ((((dh + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  let dp = b.ph - a.ph;
  if (dp < -0.5) dp += 1;
  else if (dp > 0.5) dp -= 1;
  return { t, x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, h: a.h + dh * u, ph: a.ph + dp * u };
}

/** Where a walker is on its path at parameter s, and which way it goes. */
/** A moving clip's matched speed (m/s): how far a frame carries the body ÷ how long it is held × its playback. */
export function clipSpeed(c: ClipSet): number {
  return (c.dist / Math.max(1e-3, c.gap)) * Math.max(0.05, c.play);
}

/** Of `rows`, the clips whose matched speed is within ±tol of v (on a ratio scale: 0.25 takes 1.2 … 1.875 m/s for 1.5);
 *  none: the nearest one. */
export function bySpeed(CL: ClipSet[], rows: number[], v: number, tol: number): number[] {
  if (!rows.length || v <= 0) return rows;
  const off = (i: number) => Math.abs(Math.log(clipSpeed(CL[i]) / v));
  const near = rows.filter((i) => off(i) <= Math.log(1 + tol));
  if (near.length) return near;
  return [rows.reduce((a, b) => (off(a) <= off(b) ? a : b))];
}


/** "#rrggbb" → linear rgb. */
export function hexLin(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0x141414;
  const c = (x: number) => Math.pow(x / 255, 2.2);
  return [c((v >> 16) & 255), c((v >> 8) & 255), c(v & 255)];
}

/** The colour combinations' first colours (the artist makes her own over them): warm against blue; teal-violet-pink;
 *  orange on cream with black; moss and lime on paper; greys. */
export const PALETTE_DEFAULTS: readonly (readonly [string, string, string])[] = [
  ["#ff4a2e", "#2b5dff", "#ffd23a"],
  ["#00c2a8", "#6a3cff", "#ff7ac6"],
  ["#ff6a00", "#ffe8c2", "#1a1a1a"],
  ["#2f6b3a", "#c8f560", "#f4f1e8"],
  ["#111111", "#8a8a8a", "#f0f0f0"],
];

export const STATE_KEYS: StateKey[] = ["walk", "brisk", "run", "stand", "talk"];
export const STATE_NAMES: Record<StateKey, string> = { walk: "이동 중", brisk: "경보", run: "뛰기", stand: "서 있을 때", talk: "소통 중" };
/** Each state's afterimages to begin with (the turn in degrees): walking and running leave a trail; standing ones blow
 *  away — rising, scattering, growing a little, fading and blurring (the artist: "서있을 때 잔상 날리는"). */
export const TRAIL_DEFAULTS: Record<StateKey, Omit<Trail, "turn"> & { turn: number }> = {
  walk: { life: 2, ink: 0.45, copies: 10, gap: 0.12, betweenN: 6, betweenInk: 0.5, scale: 1, rise: 0, scatter: 0, turn: 0, desat: 0, blur: 0.08 },
  brisk: { life: 1.6, ink: 0.42, copies: 10, gap: 0.1, betweenN: 6, betweenInk: 0.5, scale: 1, rise: 0, scatter: 0, turn: 0, desat: 0, blur: 0.1 },
  run: { life: 1.2, ink: 0.4, copies: 10, gap: 0.08, betweenN: 6, betweenInk: 0.5, scale: 1, rise: 0, scatter: 0, turn: 0, desat: 0, blur: 0.12 },
  stand: { life: 3, ink: 0.35, copies: 8, gap: 0.35, betweenN: 4, betweenInk: 0.4, scale: 1.12, rise: 0.7, scatter: 0.5, turn: 12, desat: 0.4, blur: 0.22 },
  talk: { life: 2.5, ink: 0.4, copies: 8, gap: 0.3, betweenN: 4, betweenInk: 0.4, scale: 1.05, rise: 0.25, scatter: 0.25, turn: 0, desat: 0.2, blur: 0.15 },
};


/** Whether the frames multiply onto the ground (white pictograms on black lay over it instead). */
export function multiplies(L: Look): boolean {
  return L.multiply && !(L.pix && L.pixWhite);
}

/** The pictogram's pose a state (the row it is drawn with). */
const STATE_INDEX: Record<StateKey, number> = { walk: 0, brisk: 1, run: 2, stand: 3, talk: 4 };

/** A person's height (m): one height for every clip and their own factor, or their clip's height (and a touch of their
 *  own). */
export function personHeight(L: Look, w: Walker, set: ClipSet | undefined): number {
  const own = 2 * frac(w.hash * 17.31) - 1;
  return L.unify ? L.heightBase * (1 + L.heightVar * own) : (set?.height ?? 1.72) * (1 + 0.03 * own);
}

/** One stride (two steps, m) of a person this tall going this fast (m/s): about 1.4 m at 1.4 m/s for 1.72 m, longer
 *  as they hurry, a running stride past 2.5 m/s — so the step's tempo rises gently, never in quick little steps. */
export function strideOf(v: number, height: number): number {
  const s = v < 2.5 ? 0.7 + 0.5 * v : 1.95 + 0.35 * (v - 2.5);
  return Math.min(3.2, Math.max(0.8, s)) * (height / 1.72);
}

/** Each arrival's phase, once (marked `pa`): the one before's plus the steps between them — the distance over this person's step
 *  at that pace, a whole number of them (none standing), two steps a loop — so both feet are down at every arrival. */
function stepPhases(L: Look, w: Walker, unit: number): void {
  const S = w.stamps;
  const set = L.clips[w.home];
  for (let k = S.length - 1; k >= 0; k--) {
    const st = S[k];
    if (st.pa) continue;
    const prev = S[k + 1];
    if (!prev) st.ph = set?.ds0 ?? 0;
    else {
      const d = Math.hypot(st.x - prev.x, st.z - prev.z) / unit;
      const span = Math.max(0.05, st.t - prev.t);
      const step = (strideOf(d / span, personHeight(L, w, set)) * (L.pix ? L.pixStride : 1)) / 2;
      const n = w.standing || d < 0.05 ? 0 : Math.max(1, Math.round(d / step));
      st.ph = prev.ph + n / 2;
    }
    st.pa = true;
  }
}

/** A walker's state for its afterimages and colours: standing (talking, when its clip is for talking) or moving (fast,
 *  when its clip runs). */
export function stateOfWalker(L: Look, w: Walker): StateKey {
  const st = L.clips[w.home]?.state;
  return w.standing ? (st === "talk" ? "talk" : "stand") : st === "run" ? "run" : st === "brisk" ? "brisk" : "walk";
}

/** How long the longest afterimage stays (s). */
export function keepSecOf(L: Look): number {
  return Math.max(...Object.values(L.trails).map((t) => Math.max(t.life, t.copies * t.gap)));
}

/** Each walker's clip, pace and frame time — from its own speed (m/s) and whether it stands (`own`). */
export function prepareWalkers(W: Walker[], L: Look, cols: number, own: (w: Walker) => { speed: number; standing: boolean }): void {
  // each walker's clip: the one fixed, or one for their state (standing: a standing or talking clip; walking: a
  // walking one), by their own hash; their pace and frame time from that clip's set
  const CL = L.clips;
  const rowsOf = (...st: ClipState[]) => CL.map((c, i) => (st.includes(c.state) ? i : -1)).filter((i) => i >= 0);
  const byHash = (list: number[], h: number) => (list.length ? list[Math.floor(frac(h * 13.7) * list.length) % list.length] : 0);
  // (a clip left 미지정 is never chosen — the artist, 2026-11-23: "미지정 하면 그 클립은 안 쓰는 걸로"; a state with no clip
  // of its own borrows any clip that is in use; none in use: nobody is drawn)
  const walkRows = rowsOf("walk"), briskRows = rowsOf("brisk"), runRows = rowsOf("run"), standRows = rowsOf("stand", "talk");
  const usedRows = rowsOf("walk", "brisk", "run", "stand", "talk");
  const first = (...lists: number[][]) => lists.find((l) => l.length) ?? usedRows;
  // (by speed, a person's own clip is a front one when there are some: profile clips come in as they cross my view)
  const frontMoving = rowsOf("walk", "brisk", "run").filter((i) => !CL[i].profile);
  for (const w of W) {
    const o = own(w);
    w.standing = o.standing;
    // THE SPEED (the artist, 2026-11-23: "속도 threshold 정해서 특정 수준 이상은 '뛰기'에 넣고, 뛰기 케이스는 내가 따로 지정"):
    // by the clips' own sets (for matching a clip), or each person their own speed — above the threshold they run, and
    // take a clip set as running
    // CLIPS BY THE BOT'S SPEED, NOT BY A MODE (the artist, 2026-11-23: "봇 최하한 속도를 내리게 하고, 그 클립들은 그럼 모드가
    // 아니라 봇 속도에 맞춰서 나오게"): each person a speed between the least and the most (more of them slow), and the
    // moving clip whose matched speed (its distance a frame ÷ its hold × its playback) is nearest — no walk/brisk/run
    // thresholds; the state a clip was given still sets its afterimages and colours
    const vOwn = o.speed;
    // (the artist, 2026-11-23: "'경보'랑 '뛰기' 나눠줘" — a brisk walk between walking and running, each its own clips)
    // (by the state thresholds by default: a person keeps one clip, its build and height — the artist went back from
    // clips by speed the same evening)
    const pace = L.speedMode !== 1 || w.standing ? 0 : vOwn >= L.runFrom ? 2 : vOwn >= L.briskFrom ? 1 : 0;
    const byState = pace === 2 ? first(runRows, briskRows, walkRows) : pace === 1 ? first(briskRows, walkRows, runRows) : first(walkRows, briskRows, runRows);
    const moving = L.speedMode === 1 && L.pickBySpeed && !w.standing ? bySpeed(CL, frontMoving.length ? frontMoving : first(walkRows, briskRows, runRows), vOwn, L.speedTol) : byState;
    w.home = L.row > 0 ? Math.min(CL.length, L.row) - 1 : w.standing ? byHash(standRows.length ? standRows : usedRows, w.hash) : byHash(moving, w.hash);
    if (L.row === 0 && !usedRows.length) w.home = -1;
    const set = CL[w.home];
    const still = w.standing || !set || set.state === "stand" || set.state === "talk";
    w.speed = still ? 0 : L.speedMode === 1 ? vOwn : set.dist / Math.max(1e-3, set.gap);
    // (the frames follow the speed: a frame for each of the clip's own steps, so the feet keep to the ground)
    w.gap = !set ? 0.04 : w.speed > 0 && L.speedMode === 1 ? (L.gait ? (strideOf(w.speed, personHeight(L, w, set)) * (L.pix ? L.pixStride : 1)) / 16 : set.dist) / w.speed : set.gap;
    // the clip's playback speed: its frames faster or slower (moving by the clip's set, the pace with them — the feet
    // stay matched); a ping-pong loop takes twice the frames a cycle
    const play = Math.max(0.05, set?.play ?? 1);
    // (each person their own speed: a clip's matched set says how far the body goes a frame shown — its distance — so
    // the frames follow the speed alone; the playback × was applied again here, the legs ran ahead of the body —
    // "클립에서 맞춰둔 거랑 다른 경우도 보이는 게 의아해서", 2026-11-23. Standing and talking clips keep it.)
    if (L.speedMode !== 1 || w.speed === 0) w.gap /= play;
    if (L.speedMode !== 1) w.speed *= play;
    w.cycle = w.gap * (cols) * (set?.pingpong ? 2 : 1);
  }
}

/** The cards of every walker (its afterimages, the body now), written into `geom`; the uniforms set. Returns the count. */
export function drawFrames(geom: THREE.InstancedBufferGeometry, mat: THREE.ShaderMaterial, L: Look, I: SpriteIndex | null, W: Walker[], cam: THREE.Vector3, now: number, unit = 1): number {
  const CL = L.clips;
  const rowsOf = (...st: ClipState[]) => CL.map((c, i) => (st.includes(c.state) ? i : -1)).filter((i) => i >= 0);
  const byHash = (list: number[], h: number) => (list.length ? list[Math.floor(frac(h * 13.7) * list.length) % list.length] : 0);
  const stateOf = (w: Walker) => stateOfWalker(L, w);
  void rowsOf;
  // the cards
  const A = (geom.getAttribute("iA") as THREE.InstancedBufferAttribute).array as Float32Array;
  const B = (geom.getAttribute("iB") as THREE.InstancedBufferAttribute).array as Float32Array;
  const C = (geom.getAttribute("iC") as THREE.InstancedBufferAttribute).array as Float32Array;
  const Dd = (geom.getAttribute("iD") as THREE.InstancedBufferAttribute).array as Float32Array;
  const Ee = (geom.getAttribute("iE") as THREE.InstancedBufferAttribute).array as Float32Array;
  const Ff = (geom.getAttribute("iF") as THREE.InstancedBufferAttribute).array as Float32Array;
  const Gg = (geom.getAttribute("iG") as THREE.InstancedBufferAttribute).array as Float32Array;

  let n = 0;

  const cols = I?.sheet.cols ?? 16;
  /** The row a card shows and its mirror: the walker's own clip (front shots only — a silhouette's front and back are
   *  one), mirrored by the clip's knob and, for variety, by the walker. */

  // (far off profile clips: only WALKING ones — a dancer or a talker found in profile once stood still in a walker's
  // place, the artist, 2026-11-23: "멀리 있는 애가 걸을 때 side 로 정지해있는 경우는 뭐야?"; of the walker's own pace
  // when there are some)
  const MOVING: ClipState[] = ["walk", "brisk", "run"];
  const sideAll = CL.map((c, i) => (c.farSide && MOVING.includes(c.state) ? i : -1)).filter((i) => i >= 0);
  const sideRowsOf = (st: ClipState) => {
    const own = sideAll.filter((i) => CL[i].state === st);
    return own.length ? own : sideAll;
  };
  // A PROFILE CLIP STANDS ALONG ITS OWN WAY, ALWAYS (the artist, 2026-11-23, round the circle: "가끔 문워크하는 구간이 생김
  // … side clip 들" → "'옆' 클립은 무조건 진행방향 정렬을 해둬야 모드 전환돼도 확실하게"): its card lies along the heading,
  // the picture's walker facing forward along it — seen from either side it walks the way it goes (from the back the
  // picture is mirrored, and so is the way). Whatever the facing knob, the tier or the mode. (Before: mirrored by chance
  // as a walker's own clip, or by my view on a card that was not facing me — half of them walked backwards.)
  const profileMirror = (row: number) => (CL[row]?.flip ? -1 : 1) * (CL[row]?.faces || 1);
  // (a front clip of the same state, for a profile walker coming straight at me or going away: its card would be edge-on)
  const frontRows = (st: ClipState) => CL.map((c, i) => (!c.profile && c.state === st ? i : -1)).filter((i) => i >= 0);
  const acrossOf = (s: Stamp) => {
    const tx = cam.x - s.x, tz = cam.z - s.z, tl = Math.hypot(tx, tz) || 1;
    return Math.sin(s.h) * (tz / tl) - Math.cos(s.h) * (tx / tl);
  };
  // CROSSING MY VIEW, NEAR TOO (the artist, 2026-11-23, "3번하자"): a front shot seen side-on has nothing to show — a knife
  // edge, or, turned to me, a sideways shuffle — so someone walking across my view is a walking profile clip at any
  // distance. (The body now keeps its choice a little past the threshold, so it does not flicker on the boundary.)
  const crossing = (w: Walker, s: Stamp, isNow: boolean): boolean => {
    const a = Math.abs(acrossOf(s));
    const thr = L.tier.sideCross;
    if (!isNow) return a > thr;
    w.sideNow = w.sideNow ? a > thr - 0.08 : a > thr;
    return w.sideNow;
  };
  const rowFor = (w: Walker, s: Stamp, far: number, isNow: boolean): { row: number; mirror: number; profile: boolean } => {
    // THE CASES (the artist, 2026-11-23): walking across my view — a walking profile clip (far off by "멀리: 가로지르면
    // 옆모습", near too by "가로지를 때는 가까이도 옆모습"); far off and still — its stand or talk clip, played or held on
    // one frame (the knob "프레임 재생은 가까이에서만"); near and talking — the talk clip plays.
    // (by speed: the profile clips whose matched speed is nearest the person's)
    const sideRows = L.speedMode === 1 && L.pickBySpeed && sideAll.length ? bySpeed(CL, sideAll, w.speed, L.speedTol) : sideRowsOf(CL[w.home]?.state ?? "walk");
    const walksAcross = L.tier.useSide && !w.standing && MOVING.includes(CL[w.home]?.state ?? "walk") && (L.tier.sideNear ? crossing(w, s, isNow) : far > 0.5 && Math.abs(acrossOf(s)) > 0.6);
    if (CL[w.home]?.profile && walksAcross) return { row: w.home, mirror: profileMirror(w.home), profile: true };
    if ((L.tier.sideNear || (L.tier.farSide && far > 0.5)) && sideRows.length && walksAcross) {
      const row = byHash(sideRows, w.hash * 1.7);
      return { row, mirror: profileMirror(row), profile: true };
    }
    // the walker's own clip, if a profile one, not crossing (head-on, or standing still): a front clip of its state
    // (any front clip when its state has none; the profile one only when there is no front clip at all)
    if (CL[w.home]?.profile) {
      let fr = frontRows(CL[w.home].state);
      if (!fr.length) fr = CL.map((c, i) => (!c.profile && c.state !== "none" ? i : -1)).filter((i) => i >= 0);
      if (fr.length) {
        const row = byHash(fr, w.hash * 2.3);
        return { row, mirror: (CL[row]?.flip ? -1 : 1) * (frac(w.hash * 3.3) > 0.5 ? -1 : 1), profile: false };
      }
      if (!w.standing) return { row: w.home, mirror: profileMirror(w.home), profile: true };
    }
    return { row: w.home, mirror: (CL[w.home]?.flip ? -1 : 1) * (frac(w.hash * 3.3) > 0.5 ? -1 : 1), profile: false };
  };
  /** A walker's place in the distance hierarchy: the tiers' multipliers blended by its distance from the eye. */
  const tierOf = (w: Walker) => {
    const Tr = L.tier;
    const d = Math.hypot(w.x - cam.x, w.z - cam.z) / unit;
    const ta = smooth01((d - (Tr.r1 - Tr.band / 2)) / Math.max(0.01, Tr.band));
    const tb = smooth01((d - (Tr.r2 - Tr.band / 2)) / Math.max(0.01, Tr.band));
    const m = (k: [number, number, number]) => k[0] + (k[1] - k[0]) * ta + (k[2] - k[1]) * tb;
    return { trail: m(Tr.trail), ink: m(Tr.ink), blur: m(Tr.blur), grad: m(Tr.grad), far: tb, mid: ta };
  };
  type Tier = ReturnType<typeof tierOf>;
  /** One card: a copy (or the body now) at its place, its age 0 … 1, the copy before it (for the stretch). */
  const put = (w: Walker, s: Stamp, alpha: number, prev: Stamp | null, u: number, T: Trail, Q: Tier) => {
    if (n >= MAX_CARDS || alpha < 0.004 || (!I && !L.pix) || w.home < 0) return;
    // passing through me: gone within nearCut, fading in over nearBand (and never drawn — no fill over the screen)
    const dEye = Math.hypot(s.x - cam.x, s.z - cam.z) / unit;
    if (dEye < L.nearCut) return;
    alpha *= smooth01((dEye - L.nearCut) / Math.max(0.01, L.nearBand));
    if (alpha < 0.004) return;
    const pick = rowFor(w, s, Q.far, u === 0);
    // (the pictogram: the row says the state, no picture to find)
    const slot = L.pix ? STATE_INDEX[stateOf(w)] : (I?.slot[pick.row] ?? -1);
    if (slot < 0) return;
    const set = CL[pick.row];
    // with age: scattered sideways (each copy its own way), grown or shrunk, risen or sunk, turned, faded in colour
    const seedA = frac(Math.sin(s.t * 12.9898 + w.hash * 78.233) * 43758.5453) * TAU;
    A[n * 4] = s.x + Math.sin(seedA) * T.scatter * u * unit;
    A[n * 4 + 1] = s.z + Math.cos(seedA) * T.scatter * u * unit;
    // (a clip standing in — a profile one crossing my view — takes the person's own height: "크기는 옆모습 사이즈랑 연동")
    const tall = personHeight(L, w, CL[w.home] ?? set);
    A[n * 4 + 2] = (tall / Math.max(0.2, set?.fill ?? 1)) * (1 + (T.scale - 1) * u) * unit;
    A[n * 4 + 3] = alpha * (set?.ink ?? 1) * Q.ink;
    B[n * 4] = slot;
    // standing or talking past the near band: one still frame of their own (no frames run where nobody reads them)
    const still = L.tier.stillNear && w.standing && Q.mid > 0.5;
    // (a clip standing in for the walker's own — a profile one crossing my view, a front one for a profile home — steps
    // at its OWN distance a frame: the walker's phase counted in the home clip's frames, turned into this clip's)
    const home = CL[w.home];
    const swap = pick.row !== w.home && !w.standing && w.speed > 0 && home && set ? (home.dist / Math.max(1e-4, set.dist)) * ((home.pingpong ? 2 : 1) / (set.pingpong ? 2 : 1)) : 1;
    // (stand mode: the clip at the original video's pace from the moment the frame stood — each its own start)
    const phStand = set ? (now - s.t) / Math.max(0.05, set.stride * (set.pingpong ? 2 : 1)) + frac(w.hash * 3.71 + s.t * 0.37) : 0;
    // (the body now, carried between arrivals, steps by its own pace; the frames left at arrivals by the original's)
    const ph = still ? frac(w.hash * 5.37) : L.standMode && L.standCarry && L.carryKind === 2 ? (set?.reverse ? -s.ph : s.ph) + (set?.offset ?? 0) : L.standMode && u > 0 ? (set?.reverse ? -phStand : phStand) + (set?.offset ?? 0) : (set?.reverse ? -s.ph : s.ph) * swap + (set?.offset ?? 0);
    const pf = ((ph % 1) + 1) % 1;
    // (ping-pong: the frames forward, then back — the artist, 2026-11-23: "a->a리버스->a 로 재생해서 루프")
    // (a profile clip walking never plays back: its ping-pong's return half walked backwards — the cycle's two halves
    // both run forward instead, at the same frame rate)
    const fwdOnly = pick.profile && !w.standing;
    B[n * 4 + 1] = set?.pingpong ? (fwdOnly ? ((2 * pf) % 1) * cols : (pf < 0.5 ? 2 * pf : 2 - 2 * pf) * (cols - 1) + 0.5) : pf * cols;
    B[n * 4 + 2] = pick.mirror;
    B[n * 4 + 3] = s.h + L.yaw + T.turn * u;
    C[n * 4] = prev ? prev.x : 0;
    C[n * 4 + 1] = prev ? prev.z : 0;
    C[n * 4 + 2] = prev ? 1 : 0;
    C[n * 4 + 3] = (T.rise * u + (set?.lift ?? 0)) * unit;
    Dd[n * 4] = T.desat * u;
    Ff[n * 4] = L.pix ? 0 : T.blur * u + Q.blur;
    // the flowing colour: the walker's state's own
    const G2 = L.grads[stateOf(w)];
    // (the pictogram has no colour flowing: "이럴거면 색 효과 넣을 필요 없음")
    Ff[n * 4 + 1] = L.pix ? 0 : Q.grad * G2.amt;
    Ff[n * 4 + 3] = 0;
    Gg[n * 4] = G2.dir;
    Gg[n * 4 + 1] = G2.scale;
    Gg[n * 4 + 2] = G2.speed;
    Gg[n * 4 + 3] = G2.warp;
    // (2: along its own way — a profile clip, always; 1: facing me — far off, by the knob)
    // (the pictogram always faces me, as the poster's figures do — one card alone, edge-on, would vanish)
    Ff[n * 4 + 2] = L.pix ? 1 : pick.profile ? 2 : L.tier.farEye && Q.far > 0.5 ? 1 : 0;
    Dd[n * 4 + 1] = L.pix ? 0 : (set?.tintAmt ?? 0);
    Dd[n * 4 + 2] = u;
    // the colour combination: one for all, or each walker their own
    Dd[n * 4 + 3] = G2.pick > 0 ? G2.pick - 1 : Math.floor(frac(w.hash * 7.91) * 5);
    Ee[n * 4] = set?.tint[0] ?? 0;
    Ee[n * 4 + 1] = set?.tint[1] ?? 0;
    Ee[n * 4 + 2] = set?.tint[2] ?? 0;
    Ee[n * 4 + 3] = L.unify ? 1 : set?.width ?? 1;
    n++;
  };
  const lerpStamp = (a: Stamp, b: Stamp, f: number): Stamp => {
    let dh = b.h - a.h;
    dh = ((((dh + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    let dp = b.ph - a.ph;
    if (dp < -0.5) dp += 1;
    else if (dp > 0.5) dp -= 1;
    return { t: a.t + (b.t - a.t) * f, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h: a.h + dh * f, ph: a.ph + dp * f };
  };
  for (const w of W) {
    const T = L.trails[stateOf(w)];
    const Q = tierOf(w);
    // the copies, oldest first, each reaching towards the one before it
    const list: { s: Stamp; age: number; newest?: boolean }[] = [];
    if (L.standMode) {
      // each arrival a frame standing where it came, facing its way, fading with its age; the newest is the body now
      const carry = L.standCarry && w.stamps.length > 0;
      if (carry && L.carryKind === 2) {
        // ONE ARRIVAL SPAN BEHIND: the body between the two arrivals round that moment, its steps counted; the frames it
        // has reached left standing, playing on from the pose it left them in
        stepPhases(L, w, unit);
        const lag = Math.max(0.2, L.sampleSec);
        const tb = now - lag;
        const S = w.stamps;
        const set = CL[w.home];
        const cyc = Math.max(0.05, (set?.stride ?? 1.2) * (set?.pingpong ? 2 : 1));
        let a = -1;
        for (let k = 0; k < S.length; k++) {
          if (S[k].t <= tb) {
            a = k;
            break;
          }
        }
        for (let k = S.length - 1; k >= 0; k--) {
          if (S[k].t > tb) continue;
          list.push({ s: { ...S[k], ph: S[k].ph + (tb - S[k].t) / cyc }, age: Math.max(1e-4, tb - S[k].t) });
        }
        const sA = a >= 0 ? S[a] : S[S.length - 1];
        const sB = a > 0 ? S[a - 1] : null;
        let body: Stamp = { t: tb, x: sA.x, z: sA.z, h: sA.h, ph: sA.ph };
        if (sB) {
          const e = Math.min(1, Math.max(0, (tb - sA.t) / Math.max(1e-3, sB.t - sA.t)));
          body = { t: tb, x: sA.x + (sB.x - sA.x) * e, z: sA.z + (sB.z - sA.z) * e, h: sB.h, ph: sA.ph + (sB.ph - sA.ph) * e };
        }
        list.push({ s: body, age: 0 });
      } else {
      for (let k = w.stamps.length - 1; k >= 0; k--) list.push({ s: w.stamps[k], age: Math.max(1e-4, now - w.stamps[k].t), newest: !carry && k === 0 });
      if (carry) {
        // the body now: on from the latest arrival at the pace and way the last two arrivals gave (standing: where it is),
        // for at most one and a half arrival spans — its frames by its own step, so the feet keep to the ground
        const s0 = w.stamps[0], s1 = w.stamps[1];
        let x = s0.x, z = s0.z;
        if (s1 && !w.standing) {
          const span = Math.max(0.05, s0.t - s1.t);
          const e = Math.min(now - s0.t, span * 1.5);
          x += ((s0.x - s1.x) / span) * e;
          z += ((s0.z - s1.z) / span) * e;
        }
        list.push({ s: { t: now, x, z, h: s0.h, ph: w.ph }, age: 0 });
      }
      }
    } else if (L.stamp) {
      // "슉": each sample left where it came; the body now sweeps from the last sample to where it is
      const s0 = w.stamps[0];
      for (let k = w.stamps.length - 1; k >= 1; k--) list.push({ s: w.stamps[k], age: now - w.stamps[k - 1].t });
      if (s0) {
        // the sweep at an even pace (an eased one pulsed every sample — the artist, 2026-11-23: "0.5로 맞춰도 0.02일 때처럼
        // 부드럽지는 않아"), and the walk's frames running on through it: the phase at the moment the place stands for
        const e = Math.min(1, Math.max(0, (now - s0.t) / Math.max(0.02, L.dashSec)));
        const from = w.stamps[1] ?? s0;
        let dh = s0.h - from.h;
        dh = ((((dh + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
        const tAt = from.t + (s0.t - from.t) * e;
        // (the walker's own frame time — its speed over the clip's step — so the feet keep to the ground)
        const ph = from.ph + (tAt - from.t) / Math.max(1e-3, w.cycle);
        list.push({ s: { t: tAt, x: from.x + (s0.x - from.x) * e, z: from.z + (s0.z - from.z) * e, h: from.h + dh * e, ph }, age: 0 });
      }
    } else {
      for (let k = T.copies; k >= 1; k--) {
        const hh = histAt(w.hist, now - k * T.gap);
        if (hh) list.push({ s: hh, age: k * T.gap });
      }
      list.push({ s: { t: now, x: w.x, z: w.z, h: w.h, ph: w.ph }, age: 0 });
    }
    let prev: Stamp | null = null;
    let prevAlpha = 0;
    let prevAge = 0;
    const life = Math.max(0.05, T.life);
    for (const { s, age, newest } of list) {
      const isNow = age === 0 || !!newest;
      // (the pictogram leaves no afterimage — a pixel person, the poster's: "이러면 잔상도 안 남겨도 됨"; the arrivals still
      // set where it walks and its steps)
      if (L.pix && !isNow) continue;
      const fade = isNow && !newest ? 1 : Math.pow(Math.max(0, 1 - age / life), L.fall);
      const alpha = (isNow ? L.ink : T.ink * Q.trail) * fade;
      // between this copy and the one before: frames of its own in between (place, step, way and age carried over)
      let last = prev;
      // (standing, copies stand on one spot: in-betweens there only when their age effects move them apart)
      if (!L.pix && !L.standMode && prev && (L.between === 2 || L.between === 3) && (Math.hypot(s.x - prev.x, s.z - prev.z) > 1e-3 || T.rise !== 0 || T.scatter > 0)) {
        // 3 — BY THE CLIP'S OWN BEAT (the artist, 2026-11-23: "사이를 메우는 게, 걷는 속도랑 프레임 머무는 시간이랑 매치가
        // 되어야"): one card for each time a frame of the clip is held between the two copies — at the place the body
        // was then, the clip's next frame each (the phase counted on by time, never the short way round); 2 — a count
        const span = Math.max(0, s.t - prev.t);
        // (capped by the walker's distance tier — the budget for a phone, 2026-11-23: near 12, middle 6, far 2 by default)
        const capT = L.tier.betweenMax[Q.far > 0.5 ? 2 : Q.mid > 0.5 ? 1 : 0];
        const nIn = Math.min(capT, L.between === 3 ? Math.min(80, Math.max(0, Math.round(span / Math.max(1e-3, w.gap)) - 1)) : Math.round(T.betweenN * Q.trail));
        for (let k = 1; k <= nIn; k++) {
          const f = k / (nIn + 1);
          const mid = lerpStamp(prev, s, f);
          // (the step counted on by time in both ways — a short-way-round blend ran the walk backwards)
          mid.ph = prev.ph + (f * span) / Math.max(1e-3, w.cycle);
          const ag = prevAge + (age - prevAge) * f;
          put(w, mid, (prevAlpha + (alpha - prevAlpha) * f) * T.betweenInk, last, Math.min(1, ag / life), T, Q);
          last = mid;
        }
      }
      put(w, s, alpha, last, Math.min(1, age / life), T, Q);
      prev = s;
      prevAlpha = alpha;
      prevAge = age;
    }
  }
  geom.instanceCount = n;
  geom.instanceCount = n;
  for (const name of ["iA", "iB", "iC", "iD", "iE", "iF", "iG"]) {
    const at = geom.getAttribute(name) as THREE.InstancedBufferAttribute;
    at.addUpdateRange(0, n * 4);
    at.needsUpdate = true;
  }
  for (const m of [mat]) {
    const g = m.uniforms;
    // (the amount is each card's own — moving or still — in iF.y)
    g.uGradAmt.value = 1;
    const pal = g.uPal.value as THREE.Color[];
    L.pals.forEach((hex, i) => pal[i]?.set(hex).convertSRGBToLinear());
    g.uTime.value = now;
    if (g.uEdgeTh) g.uEdgeTh.value = L.edgeTh;
    if (g.uEdgeW) g.uEdgeW.value = L.edgeW;
    if (g.uCon) g.uCon.value = L.con;
    if (g.uBright) g.uBright.value = L.bright;
  }
  const u = mat.uniforms;
  u.uFacing.value = L.facing === "eye" ? 0 : L.facing === "along" ? 1 : 2;
  u.uStretch.value = L.stretch;
  u.uSlit.value = L.slit;
  u.uStretchKind.value = L.stretchKind;
  u.uStreakSoft.value = L.streakSoft;
  u.uMultiply.value = multiplies(L) ? 1 : 0;
  u.uThick.value = L.thick * unit;
  u.uThickFill.value = L.thickFill ? 1 : 0;
  u.uThickInk.value = L.thickInk;
  u.uMinAng.value = (L.minAng * Math.PI) / 180;
  u.uSideFade.value = L.sideFade;
  u.uPix.value = L.pix ? 1 : 0;
  u.uPixCell.value = L.pixCell;
  (u.uPixInk.value as THREE.Color).setScalar(L.pixWhite ? 1 : 0.06);
  u.uDragKind.value = L.dragKind;
  u.uDragLen.value = L.dragLen;
  return n;
}

/** The cards' geometry: a quad, its instance attributes (iA … iG). */
export function makeFrameGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (const name of ["iA", "iB", "iC", "iD", "iE", "iF", "iG"]) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARDS * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/** The Look from a frames group's values (the study's live Leva values, or what is saved, on another page); a value
 *  never saved takes the knob's default. */
export function lookFromValues(c: Record<string, unknown>, sets: ClipSet[], pick: number, gradStart: Record<StateKey, Grad>): Look {
  const num = (k: string, d: number) => {
    const v = Number(c[k] ?? d);
    return Number.isFinite(v) ? v : d;
  };
  return {
    count: num("flCount", 3),
    path: (c.flPath ?? "across") as Path,
    spread: num("flSpread", 1.6),
    dist: num("flDist", 6),
    clips: sets,
    row: pick,
    standShare: num("flStand", 0),
    tier: {
      r1: num("flR1", 6),
      r2: num("flR2", 15),
      band: num("flBand", 3),
      farEye: c.flFarEye !== false,
      stillNear: c.flStillNear !== false,
      useSide: !!c.flUseSide,
      sideNear: !!c.flUseSide && c.flSideNear !== false,
      sideCross: Number(c.flSideCross ?? 0.8),
      farSide: !!c.flUseSide && !!c.flFarSide,
      trail: [num("flNTrail", 1), num("flMTrail", 0.5), num("flFTrail", 0.15)],
      betweenMax: [Number(c.flNBetMax ?? 12), Number(c.flMBetMax ?? 6), Number(c.flFBetMax ?? 2)],
      ink: [num("flNInk", 1), num("flMInk", 0.85), num("flFInk", 0.6)],
      blur: [num("flNBlur", 0), num("flMBlur", 0.04), num("flFBlur", 0.12)],
      grad: [num("flNGrad", 1), num("flMGrad", 0.7), num("flFGrad", 0.3)],
    },
    // (uniform clips, 2026-11-24: each person their own speed, the clip by the state thresholds, the stride model, one
    // height — the knobs that chose otherwise are gone)
    speedMode: 1,
    speedMin: Number(c.flSpeedMin ?? 0.5),
    speedMax: Number(c.flSpeedMax ?? 2.6),
    speedSkew: Number(c.flSpeedSkew ?? 1.8),
    speedTol: Number(c.flSpeedTol ?? 0.25),
    pickBySpeed: false,
    briskFrom: Number(c.flBriskFrom ?? 1.55),
    runFrom: Number(c.flRunFrom ?? 2.5),
    nearCut: Number(c.flNearCut ?? 0.8),
    nearBand: Number(c.flNearBand ?? 0.8),
    unify: true,
    heightBase: num("flHeightBase", 1.72),
    heightVar: num("flHeightVar", 0.08),
    gait: true,
    pix: c.flPix !== false,
    pixCell: num("flPixCell", 2),
    pixStride: num("flPixStride", 0.6),
    pixWhite: c.flPixInk !== "black",
    yaw: (num("flYaw", 0) * Math.PI) / 180,
    between: num("flBetween", 2),
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
    edgeTh: num("flEdge", 0.15),
    edgeW: num("flEdgeW", 0.15),
    con: num("flCon", 1),
    bright: num("flBright", 0),
    stamp: c.flStamp !== false,
    standMode: c.flStandMode !== false,
    standCarry: c.flStandCarry !== false,
    carryKind: num("flCarryKind", 2),
    sampleSec: num("flSample", 0.5),
    dashSec: num("flDash", 0.12),
    fall: num("flFall", 1.3),
    ink: num("flInk", 1),
    facing: (c.flFacing ?? "across") as Facing,
    stretch: num("flStretch", 1),
    stretchKind: num("flKind", 0),
    streakSoft: num("flSoft", 0.8),
    slit: num("flSlit", 1),
    multiply: c.flMultiply !== false,
    floor: !!c.flFloor,
  };}

/** Each clip's set: only WHEN it is used comes from the values (keys by the clip's name) — every clip is otherwise the
 *  same (the artist, 2026-11-24: "클립 획일화하자! 레바에서 다 치워봐"): one height and width, its own colour (a white
 *  matte darkened, or it vanishes on the paper), played at its own pace forward, profile as the sheet found it. */
export function setsFromValues(raw: Record<string, unknown>, clips: readonly ClipInfo[]): ClipSet[] {
  return clips.map((cl) => {
    const k = clipKey(cl.id);
    return {
      id: cl.id,
      state: (raw[`ct_${k}`] as ClipState) ?? (cl.side ? "none" : cl.walking ? "walk" : "stand"),
      flip: false,
      dist: 0.1,
      gap: cl.strideSec / 16,
      height: 1.72,
      width: 1,
      ink: 1,
      lift: 0,
      tint: hexLin("#141414"),
      tintAmt: cl.lum > 0.7 ? 1 : 0,
      reverse: false,
      play: 1,
      pingpong: false,
      fill: cl.fill,
      farSide: cl.side,
      profile: cl.side,
      faces: cl.faces || 1,
      stride: cl.strideSec,
      ds0: (cl.ds?.[0] ?? 0) / 16,
      offset: 0,
    };
  });
}

/** A clip of the sheet as the study lists it. */
export interface ClipInfo {
  id: string;
  strideSec: number;
  loop: number;
  lum: number;
  side: boolean;
  walking: boolean;
  fill: number;
  faces: number;
  /** The frames where both feet are down (tools/people-sheet/steps.py). */
  ds?: number[];
}

/** A clip's key in the saved values (its name, letters and digits). */
export const clipKey = (id: string) => id.replace(/[^A-Za-z0-9]/g, "_");

/** Where each state's colour flow starts when never set by state: the old shared (moving) knobs and the still ones'. */
export function gradStartFrom(old: (key: string, dflt: number) => number): Record<StateKey, Grad> {
  const moving: Grad = { amt: old("flGradAmt", 0.8), pick: old("flGradPick", 1), dir: old("flGradDir", 0), scale: old("flGradScale", 1), speed: old("flGradSpeed", 1), warp: old("flGradWarp", 0.6) };
  const gsPick = old("flGsPick", -1);
  const still: Grad = { ...moving, amt: old("flGsAmt", 0.8), pick: gsPick >= 0 ? gsPick : moving.pick, scale: Math.min(6, moving.scale * old("flGsScale", 1)), speed: Math.min(6, moving.speed * old("flGsSpeed", 1)) };
  return { walk: moving, brisk: moving, run: moving, stand: still, talk: still };
}

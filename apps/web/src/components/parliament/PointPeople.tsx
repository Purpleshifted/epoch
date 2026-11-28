"use client";
/**
 * PointPeople — THE OTHERS AS WALKING POINT SILHOUETTES (the artist, 2026-11-22: the personal view should feel like a
 * 길거리; "네모 대신 현실 삶과 이어지는 느낌" — criswvr Synthetic Urban 9, vinils' 4D captures). Leva 개인뷰 비주얼 › 길거리.
 *
 * Every being within the view (the record's `far` list, RoleField → witnessRef, renewed with the fold) is a body of a
 * few hundred grey points in the shape of a walking person (lib/parliament/pointPeople.ts: a stride baked as frames of
 * the same points, read here as a float texture). The record gives a place every half second or so; between them the
 * body EASES to its latest place with a top speed and an acceleration, turns to face where it goes, and its stride
 * runs with its speed — standing, the legs come together and the body breathes. Where it has just been it may leave a
 * TIME SMEAR (vinils: "the distance between people is time"): copies of the body at its places over the last seconds,
 * fading. One draw call for all bodies and copies (instanced points); an optional faint standing PLATE behind each
 * body (criswvr) is a second, instanced mesh. Greys only — human traces are achromatic.
 *
 * On the white ground (2026-11-23, the artist: no flicker; "걸어가는 모습을 잔흔으로 남겨서 … 동세의 시공간 덩어리"): each other is
 * the shared 3D body (bodySheet.ts) as their ARCHETYPE (bodyArchetypes.ts) walking continuously at the record's pace, and
 * leaving AFTERIMAGES of itself where it was — fading, softening, a little more vivid in colour — drawn straight into the
 * scene as filters on the white (no browser exposure). The default since the same evening is the POINT BODY
 * (fiberBody.ts): points on each archetype's bones, each a fiber through three moments; at each sample the body sweeps
 * to it ("슉") unless 보간 is on; runs when fast; gestures when standing. Then the 2D PEOPLE (spritePeople.ts, mode
 * "sprites", the default): real people cut out of the clips the artist finds, a card a person, afterimages along each 슉.
 *
 * Nothing here decides who is there or where they stand (RoleField's seat and fold); this only draws.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { DEFAULT_WITNESS, glyphOf, nearestImage, rhythmOf, stepAt, type Other } from "@/lib/parliament";
import { Glyph } from "./Glyph";
import { DEFAULT_BODY, DEFAULT_MOTION, WALK_CYCLES, WALK_STYLES, WAVE_STYLE, bakeWalk, jointsAt, jointsOfCycle, standingPhase, stepPerson, strideLength, type Joints, type MotionConfig, type PersonMotion } from "@/lib/parliament/pointPeople";
import { BodyPoses, cutOf, cycleOf, makeBodyGeometry, makeBodyMaterial, paletteIndexOf, poseOf, standOf, type BodyColours, type BodyGirth } from "./bodySheet";
import { DEFAULT_ARCHETYPES, STAND_GESTURES, archetypeIndexOf, bodyTuning, hexToLinear, runPose, shapePose, strideScaleOf, type Archetype } from "./bodyArchetypes";
import { makeFiberGeometry, makeFiberMaterial } from "./fiberBody";
import { loadSpriteSheet, makeSpriteGeometry, makeSpriteMaterial, spriteRow, type SpriteIndex } from "./spritePeople";
import { FramePeopleLayer } from "./FramePeopleLayer";
import { mobileLab } from "./mobileLab";
import { streetGaze } from "./streetLook";
import { onLifeEvent } from "./lifeEvents";
import { setPeopleWhere } from "./peopleWhere";

export type PeopleMode = "boxes" | "points" | "fibers" | "sprites" | "frames";

export interface PeopleLook {
  /** How the others are drawn (the artist, 2026-11-22 night: "깜빡이는 상자 속에서 사람 실루엣이 걸어가는 것처럼 … 점 낭비 안 해도
   *  되고"): "boxes" = the old blinking square, body-high, with a walking silhouette inside (a sprite sheet, one draw);
   *  "points" = the point bodies. */
  mode: PeopleMode;
  /** 흰 바탕 (오가닉): a person is a black BLOT on the paper (the long exposure, 1578–1583) — a smear when standing, stretched
   *  and trailed when walking, darker and sharper the nearer (distance = lightness); the box a faint pencil frame; within
   *  `labelDist` a small label with the being's number and a leader line (9954 · 1571). */
  paper: boolean;
  ink: number;
  blur: number;
  fadeDist: number;
  labelDist: number;
  /** 각자의 창 (the artist, 2026-11-22 night: "각자의 윈도우가 있고 그게 늘어져서 이동이 보이는… 사라지면서 꼬리를 남기고", "의도적
   *  플리커링(디바운스랑 정렬해서)"): no interpolation — when a sample comes the window shakes once and moves; it stretches by the
   *  move between samples (× stretchGain) and shrinks until the next; gone, it stays stretched and pales (the tail). Beyond
   *  `blotDist` (world) a person is not drawn here (the present's scan carries them). `bubble`: a square frame with the
   *  asker's melody glyph beside them while their question is open. */
  flicker: boolean;
  stretchGain: number;
  shake: number;
  blotDist: number;
  bubble: boolean;
  /** Each window's own proportion (width / height), drawn by the being's hash between these; and how long a gone one's
   *  tail stays (s). */
  aspectMin: number;
  aspectMax: number;
  tailSec: number;
  /** Paper (the artist, 2026-11-22 night): overlapping blots multiply darker; the frame's strength (crisp corner brackets,
   *  TD-like); the eye turns towards whoever asks; square ripples spread from the asker; how different the people are in
   *  their walk, ink, softness and tilt (0 … 1). */
  /** The exposure a frame adds (the feedback's gain). */
  exposure: number;
  frame: number;
  askTurn: boolean;
  ripple: boolean;
  paperVariety: number;
  /** The box's width as a share of its height, and its grey while the melody rests (the old square's SQUARE_REST). */
  boxAspect: number;
  boxRest: number;
  /** Whoever asks me something is cued: their box (or body) grows and brightens while the question is open. */
  cue: boolean;
  /** Points a body is made of on a desktop, and on a phone (a prefix of the same body). */
  points: number;
  pointsPhone: number;
  /** THE SCALE: metres a world unit is (the artist, 2026-11-22: the bodies were too big beside the buildings' bays and
   *  the vegetation) — every length below in metres is divided by it. */
  scale: number;
  /** A point's size (metres, shrinking with distance; never under 1 px, never over `maxPx`). */
  dot: number;
  maxPx: number;
  /** The grey of the points (0 … 1). */
  grey: number;
  /** Height of an average body (metres); bodies differ by `variety`. */
  height: number;
  /** How different the bodies are (0 = all alike, 1 = ±8 % height, ±10 % build, ±15 % pace). */
  variety: number;
  /** The walks: captured (CMU, four real gaits) or the sine skeleton. */
  gait: "mocap" | "sine";
  /** 흰 바탕: the clothes' colour (0 = grey, 1 = the palette; bodySheet.ts). */
  colour: number;
  /** The legs never cycle faster than this (strides/s). */
  maxCadence: number;
  /** The faint standing plate behind each body, and its opacity. */
  plate: boolean;
  plateAlpha: number;
  /** The time smear: how many seconds back the copies reach (0 = none), and how many copies. Off on a phone. */
  smearSec: number;
  smearCopies: number;
  /** Breathing of a standing body (0 … 1). */
  breath: number;
  /** Whether the scene's fog takes the points. */
  fog: boolean;
  /** Top speed on the way to a sample (world/s). */
  maxSpeed: number;
  /** Seconds after the last sample from which the body fades (its age); the record's own recent window. */
  recentSec: number;
  /** A standing body turns to face the nearest other within `faceRadius` (metres; a group stands together, not in a row). */
  faceEach: boolean;
  faceRadius: number;
  /** The visitor's own body (seen from behind in the eye view) in place of the square; its points blink their melody. */
  meBody: boolean;
  /** The body's brightness while its melody rests (1 = no blink). */
  meRest: number;
  /** "frames" (the pictograms): a bot asking me something hops its head on its melody, stays solid near me, grows a
   *  little (the artist, 2026-11-24: "present bot 에서 … 인터랙션 다듬게"). "frames" is the default since. */
  frHop: boolean;
  frAskSolid: boolean;
  frAskScale: number;
  /** The pictograms' size × of the frames study's height: "픽토그램 크기 전반적으로 줄이면서" (2026-11-24). */
  frSize: number;
  /** The pictograms' own blur (0 = crisp; the street's softening never reaches them). */
  frBlur: number;
  /** The tracking boxes round who is with me (0 none, 1 the asker, 2 + whoever is within frTrackRadius m). */
  frTrack: number;
  frTrackRadius: number;
  /** The pictograms seen from outside myself (the old personal view's camera — FramePeopleLayer `orbit`). */
  orbit?: boolean;
}

export const DEFAULT_PEOPLE: PeopleLook = { mode: "frames", gait: "mocap", colour: 1, paper: false, ink: 1, blur: 3, fadeDist: 12, labelDist: 4, flicker: true, stretchGain: 1, shake: 2, blotDist: 8, bubble: true, aspectMin: 0.5, aspectMax: 1.3, tailSec: 1.6, exposure: 0.5, frame: 1, askTurn: true, ripple: true, paperVariety: 1, boxAspect: 0.55, boxRest: 0.22, cue: true, points: 480, pointsPhone: 200, scale: 2.5, dot: 0.07, maxPx: 6, grey: 0.78, height: 1.7, variety: 1, maxCadence: 2.2, plate: false, plateAlpha: 0.08, smearSec: 2.5, smearCopies: 6, breath: 1, fog: false, maxSpeed: 2.6, recentSec: 10, faceEach: true, faceRadius: 3, meBody: false, meRest: 0.4, frHop: true, frAskSolid: true, frAskScale: 1.15, frSize: 0.7, frBlur: 0, frTrack: 2, frTrackRadius: 4 };

/** The visitor, for their own body: where they stand and look (the controller's yaw), and their melody. */
export interface MeInput {
  get: () => { x: number; z: number; vx?: number; vz?: number; heading: number };
  rhythm: () => boolean[] | null;
}

const TAU = Math.PI * 2;
/** How fast a standing body turns to face someone (rad/s) — slower than a walker turns. */
const FACE_TURN = 1.5;

const MAX_PEOPLE = 96;
const MAX_COPIES = 8;
const MAX_INSTANCES = MAX_PEOPLE * (1 + MAX_COPIES);
/** 흰 바탕: the bodies drawn a frame — each person now (first), then their traces (bodyArchetypes TrailLook). */
const MAX_BODIES = 1024;
/** 2D 사람: the cards a frame (a person now and the afterimages of their last two sweeps). */
const MAX_SPRITES = 96 * 12;
/** A being gone from the list for this long (s) fades out and is dropped. */
const GONE_SEC = 2.5;
const FADE_SEC = 0.8;
/** How often a body's way is written down for its traces (s). */
const HIST_EVERY = 1 / 30;

/** One moment of a body's way (for its traces): when, where, facing, the stride's phase, how much it stood, cued. */
interface Hist {
  t: number;
  x: number;
  z: number;
  h: number;
  ph: number;
  st: number;
  cue: number;
}

/** The body's way at time `t` (between two written moments), or null before the first. */
function histAt(H: readonly Hist[], t: number): Hist | null {
  if (!H.length || t < H[0].t) return null;
  let lo = 0, hi = H.length - 1;
  if (t >= H[hi].t) return H[hi];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (H[m].t <= t) lo = m;
    else hi = m;
  }
  const a = H[lo], b = H[hi], u = (t - a.t) / Math.max(1e-6, b.t - a.t);
  let dp = b.ph - a.ph;
  if (dp < -0.5) dp += 1;
  else if (dp > 0.5) dp -= 1;
  let dh = b.h - a.h;
  dh = ((((dh + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return { t, x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, h: a.h + dh * u, ph: (((a.ph + dp * u) % 1) + 1) % 1, st: a.st + (b.st - a.st) * u, cue: u < 0.5 ? a.cue : b.cue };
}

const smooth01 = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** The wave's phase at time t (the asker's hand, on its own time — the same for the body now and its traces). */
const wavePhase = (t: number, hash: number) => (((t * 0.9 + hash) % 1) + 1) % 1;

interface Person extends PersonMotion {
  seen: number;
  /** 0 … 1 (the record's brightness × the fade when gone). */
  bright: number;
  alpha: number;
  trail: { x: number; z: number; heading: number; phase: number; t: number }[];
  lastTrailAt: number;
  hash: number;
  /** This body's own height factor, build factor and motion (variety). */
  hs: number;
  ws: number;
  motion: MotionConfig;
  /** Boxes: the silhouette walks leftwards on the screen (mirrored); kept while standing. */
  flip: number;
  /** The last sample's move (world) and when it came (frame s); the shake runs until `shakeUntil`. */
  sdx: number;
  sdz: number;
  sampleAt: number;
  shakeUntil: number;
  /** 흰 바탕: the 3D body walks on its own, eased towards the samples (the window flickers; the body does not), its stride
   *  the captured cycle's length. */
  body: PersonMotion;
  bodyMotion: MotionConfig;
  /** 흰 바탕 (2026-11-23, no flicker): the body's way written down for its traces; the record's pace between its samples
   *  (world/s) and when the record last moved them — the body walks at that pace between samples. */
  hist: Hist[];
  lastHistAt: number;
  rvx: number;
  rvz: number;
  changeAt: number;
  /** The fibers' "슉" (the artist, 2026-11-23: no interpolation between samples — each leaves itself like a long
   *  exposure): the last three samples as they were (newest first); the turn of a standing one looking round. */
  stamps: Stamp[];
  lookOff: number;
}

/** A sample as the fibers keep it: when, where, which way, the stride's phase there, the pace that brought it (m/s). */
interface Stamp {
  t: number;
  x: number;
  z: number;
  h: number;
  ph: number;
  v: number;
}

/** One of a fiber's three moments: where, facing, the pose's phase, standing share, run, cued, its time. */
interface FState {
  x: number;
  z: number;
  h: number;
  ph: number;
  st: number;
  run: number;
  cue: number;
  t: number;
}

/** A test scene (`?crowd=N` on the address, a dev aid for the side-by-side with the references): N people walking away
 *  round the visitor, mostly, some across, some standing — fed in as if the record had them. */
interface Walker {
  x: number;
  z: number;
  vx: number;
  vz: number;
}
const CROWD_PARAM = typeof window === "undefined" ? 0 : Math.max(0, Math.min(80, Number(new URLSearchParams(window.location.search).get("crowd")) || 0));

/** The server's samples come about this often (s): the window's stretch lives this long, and a stride step is one sample. */
const SAMPLE_SEC = 0.5;
const SHAKE_SEC = 0.14;

const SHEET_FRAMES = 16;
const SHEET_W = 48;
const SHEET_H = 96;
/** The sheet's rows: the ways of walking (as many as the captured cycles, or the sine styles), then the wave (the asker's). */
const WALK_ROWS = Math.max(WALK_STYLES.length, WALK_CYCLES.length);
const SHEET_ROWS = WALK_ROWS + 1;
const WAVE_ROW = WALK_ROWS;

/**
 * The walking silhouette as a SPRITE SHEET: the stride's frames drawn side-on (the body walking to the right), white on
 * nothing, each frame SHEET_W × SHEET_H for a 1.9 m frame — the stroke of each limb is its thickness. Nearest-filtered:
 * the edge stays hard (brutal). Needs a document (a canvas).
 */
function walkSheet(blurPx = 0, gait: "mocap" | "sine" = "mocap"): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = SHEET_W * SHEET_FRAMES;
  c.height = SHEET_H * SHEET_ROWS;
  const g = c.getContext("2d")!;
  // the paper's blot: the same figure, its edge blurred (the long exposure's softness)
  if (blurPx > 0) g.filter = `blur(${blurPx}px)`;
  const k = SHEET_H / 1.9; // px a metre
  g.strokeStyle = "#fff";
  g.fillStyle = "#fff";
  g.lineCap = "round";
  g.lineJoin = "round";
  for (let row = 0; row < SHEET_ROWS; row++)
  for (let f = 0; f < SHEET_FRAMES; f++) {
    const J = row === WAVE_ROW ? jointsAt(f / SHEET_FRAMES, WAVE_STYLE) : gait === "mocap" && WALK_CYCLES.length ? jointsOfCycle(WALK_CYCLES[row % WALK_CYCLES.length], f / SHEET_FRAMES) : jointsAt(f / SHEET_FRAMES, WALK_STYLES[row % WALK_STYLES.length]);
    const ox = f * SHEET_W + SHEET_W / 2, oy = row * SHEET_H + SHEET_H - 2;
    const X = (p: readonly number[]) => ox + p[2] * k;
    const Y = (p: readonly number[]) => oy - p[1] * k;
    const limb = (a: readonly number[], b: readonly number[], w: number) => {
      g.lineWidth = w * k;
      g.beginPath();
      g.moveTo(X(a), Y(a));
      g.lineTo(X(b), Y(b));
      g.stroke();
    };
    limb(J.hipR, J.kneeR, 0.13);
    limb(J.kneeR, J.ankleR, 0.11);
    limb(J.ankleR, J.toeR, 0.08);
    limb(J.shR, J.elbowR, 0.1);
    limb(J.elbowR, J.wristR, 0.08);
    limb(J.pelvis, J.shoulders, 0.3);
    limb(J.shoulders, J.head, 0.1);
    g.beginPath();
    g.arc(X(J.head), Y(J.head), 0.11 * k, 0, Math.PI * 2);
    g.fill();
    limb(J.hipL, J.kneeL, 0.13);
    limb(J.kneeL, J.ankleL, 0.11);
    limb(J.ankleL, J.toeL, 0.08);
    limb(J.shL, J.elbowL, 0.1);
    limb(J.elbowL, J.wristL, 0.08);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

const BOX_VERT = /* glsl */ `
uniform float uFrames;
uniform float uRows;
uniform float uAspect;
attribute vec4 iBox;      // x, z, height, heading (the plate stands ALONG the way they go — not facing the eye)
attribute vec4 iBoxAnim;  // phase, lit, alpha, cue (0 none · 1 the asker · 2 a ripple: frame only)
attribute vec4 iBox2;     // stretch (walking), dark (near = 1), this window's aspect, 0
attribute vec4 iBox3;     // softness (0 sharp … 1 blurred), ink ×, tilt (rad), the sheet's row (the way of walking)
varying vec2 vUv;
varying vec2 vLocal;
varying float vLit;
varying float vAlpha;
varying float vDark;
varying float vCue;
varying float vSoft;
varying float vInkK;
#include <fog_pars_vertex>
void main() {
  float h = iBox.z;
  float w = h * (iBox2.z > 0.0 ? iBox2.z : uAspect) * (1.0 + iBox2.x);
  // the plate (the artist, 2026-11-22 night: "꼭 나한테 평행할 필요 없어! 각자의 진행방향과 잔상을 남겨야"): a translucent film
  // standing in the world ALONG the being's heading — its width runs the way they go, the silhouette walks along it, the
  // stretch and the tail lie behind them in the world; seen side-on it is whole, from ahead or behind it is thin. It leans
  // a little its own way (tilt about its own normal). Its foot is on the ground.
  vec3 fwd = vec3(sin(iBox.w), 0.0, cos(iBox.w));
  float ct = cos(iBox3.z), st = sin(iBox3.z);
  vec2 corner = vec2(position.x * w, position.y * h);
  corner = vec2(corner.x * ct - corner.y * st, corner.x * st + corner.y * ct);
  vec3 wp = vec3(iBox.x, 0.0, iBox.y) + fwd * corner.x + vec3(0.0, corner.y, 0.0);
  vec4 mvPosition = modelViewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float u = position.x + 0.5;
  float f = floor(fract(iBoxAnim.x) * uFrames);
  vUv = vec2((f + u) / uFrames, (iBox3.w + position.y) / uRows);
  vLocal = vec2(position.x + 0.5, position.y);
  vLit = iBoxAnim.y;
  vAlpha = iBoxAnim.z;
  vDark = iBox2.y;
  vCue = iBoxAnim.w;
  vSoft = iBox3.x;
  vInkK = iBox3.y;
  #include <fog_vertex>
}`;

const BOX_FRAG = /* glsl */ `
uniform sampler2D uSheet;
uniform sampler2D uSheetSoft;
uniform float uRest;
uniform float uPaper;
uniform float uInk;
uniform float uFrame;
uniform float uGain;
uniform float uBody3D;
varying vec2 vUv;
varying vec2 vLocal;
varying float vLit;
varying float vAlpha;
varying float vDark;
varying float vCue;
varying float vSoft;
varying float vInkK;
#include <fog_pars_fragment>
void main() {
  if (vAlpha < 0.01) discard;
  if (uPaper > 0.5) {
    // A FILTER ON THE WHITE (2026-11-23: no browser exposure, no blink): the plate as an acetate film whose edges melt,
    // multiplied over the scene, deeper for the asker; a ripple (cue 2) is a film alone.
    float body = (vCue > 1.5 || uBody3D > 0.5) ? 0.0 : mix(texture2D(uSheet, vUv).a, texture2D(uSheetSoft, vUv).a, vSoft * 0.5) * uInk * vInkK;
    float bx = min(vLocal.x, 1.0 - vLocal.x), by = min(vLocal.y, 1.0 - vLocal.y);
    // (the film is faint and its edges wide: the window is a frame of record, and on the white ground it must not read as a
    // drawn rectangle)
    float edge = smoothstep(0.0, 0.2, bx) * smoothstep(0.0, 0.14, by);
    // (with the 3D body the window's film is a third as dense: forty of them stood as one grey band behind a crowd)
    float film = edge * (0.035 + 0.06 * step(0.5, vCue)) * uFrame * (uBody3D > 0.5 ? 0.6 : 1.0);
    if (vCue > 1.5) film = edge * 0.1;
    float dens = clamp(max(body, film) * vAlpha, 0.0, 1.0);
    if (dens < 0.002) discard;
    gl_FragColor = vec4(mix(vec3(1.0), vec3(0.08), dens), 1.0);
    return;
  }
  // the box blinks the being's melody as the square did (white on a beat, dark grey at rest); the silhouette inside is
  // the other way round, so it reads in both
  float s = texture2D(uSheet, vUv).a;
  vec3 box = mix(vec3(uRest), vec3(1.0), vLit);
  vec3 sil = mix(vec3(0.82), vec3(0.05), vLit);
  gl_FragColor = vec4(mix(box, sil, step(0.5, s)), vAlpha);
  #include <fog_fragment>
}`;

/** The same functions of a body's hash the vertex shader uses: its height and build factors (variety 0 … 1). */
const frac = (x: number) => x - Math.floor(x);
const heightFactor = (hash: number, variety: number) => 1 + variety * (0.16 * frac(hash * 7.31) - 0.08);
const buildFactor = (hash: number, variety: number) => 1 + variety * (0.2 * frac(hash * 13.7) - 0.1);
const paceFactor = (hash: number, variety: number) => 1 + variety * (0.3 * frac(hash * 3.17) - 0.15);

const VERT = /* glsl */ `
uniform sampler2D uBody;
uniform float uFrames;
uniform float uPoints;
uniform float uSize;
uniform float uScale;
uniform float uTime;
uniform float uBreath;
uniform float uVariety;
uniform float uMaxPx;
attribute float aPoint;
attribute vec4 iPos;   // x, cue (0 … 1), z, heading
attribute vec4 iAnim;  // phase, alpha, standing (0 … 1), hash
varying float vAlpha;
varying float vCue;
#include <fog_pars_vertex>
void main() {
  float f = fract(iAnim.x) * uFrames;
  float f0 = floor(f);
  float f1 = mod(f0 + 1.0, uFrames);
  float ft = f - f0;
  float u = (aPoint + 0.5) / uPoints;
  vec3 p0 = texture2D(uBody, vec2(u, (f0 + 0.5) / uFrames)).xyz;
  vec3 p1 = texture2D(uBody, vec2(u, (f1 + 0.5) / uFrames)).xyz;
  vec3 p = mix(p0, p1, ft);
  // this body's own height and build (the same functions of its hash as the CPU's stride uses)
  float hs = 1.0 + uVariety * (0.16 * fract(iAnim.w * 7.31) - 0.08);
  float ws = 1.0 + uVariety * (0.2 * fract(iAnim.w * 13.7) - 0.1);
  p.y *= hs;
  p.xz *= ws;
  // a standing body breathes: the chest rises a little, slowly, each in its own time
  float breath = uBreath * iAnim.z * 0.012 * sin(uTime * 1.3 + iAnim.w * 6.2832);
  p.y *= 1.0 + breath * smoothstep(0.6, 1.5, p.y / hs);
  // cued (asking me something): a little larger
  p *= 1.0 + 0.15 * iPos.y;
  float c = cos(iPos.w), s = sin(iPos.w);
  vec3 w = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + vec3(iPos.x, 0.0, iPos.z);
  vCue = iPos.y;
  vec4 mvPosition = modelViewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp(uSize * (uScale / -mvPosition.z), 1.0, uMaxPx);
  vAlpha = iAnim.y;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uGrey;
varying float vAlpha;
varying float vCue;
#include <fog_pars_fragment>
void main() {
  if (vAlpha < 0.01) discard;
  gl_FragColor = vec4(vec3(mix(uGrey, 1.0, vCue)), vAlpha);
  #include <fog_fragment>
}`;

/** The instanced draw's count and the uniforms are set through these (plain functions on the objects, every frame). */
/** A small seeded random (the crowd test scene is the same every time). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A crowd walker round `me` (world; k = world units a metre): most walk away from the visitor, some across, some stand. */
function spawnWalker(rnd: () => number, me: { x: number; z: number }, k: number, first: boolean): Walker {
  const a = rnd() * Math.PI * 2;
  const r = (first ? 4 + rnd() * 12 : 4 + rnd() * 3) * k;
  const kind = rnd();
  const speed = (1 + rnd() * 0.6) * k;
  const dir = kind < 0.15 ? null : kind < 0.4 ? a + (rnd() < 0.5 ? 1 : -1) * Math.PI * 0.5 : a + (rnd() - 0.5) * 0.9;
  return { x: me.x + Math.sin(a) * r, z: me.z + Math.cos(a) * r, vx: dir === null ? 0 : Math.sin(dir) * speed, vz: dir === null ? 0 : Math.cos(dir) * speed };
}

function setInstanceCount(g: THREE.InstancedBufferGeometry, n: number): void {
  g.instanceCount = n;
}
function setUniforms(u: Record<string, THREE.IUniform>, values: Record<string, unknown>): void {
  for (const k in values) u[k].value = values[k];
}

function idHash(o: string): number {
  let h = 0;
  for (let i = 0; i < o.length; i++) h = (Math.imul(h, 31) + o.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

export function PointPeople({
  getOthers,
  playerPosRef,
  look = DEFAULT_PEOPLE,
  phone = false,
  me: selfIn,
  viewFog = false,
}: {
  /** Everyone within the view, nearest first (the record's `far`); null before the first fold. */
  getOthers: () => readonly Other[] | null;
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  look?: PeopleLook;
  /** A phone: fewer points a body, no smear. */
  phone?: boolean;
  /** The visitor themself (drawn as a body when look.meBody). */
  me?: MeInput;
  /** 시야 반경: the points take the scene's fog whatever look.fog says. */
  viewFog?: boolean;
}) {
  const fogOn = look.fog || !!viewFog || look.paper;
  const points = Math.max(32, Math.round(phone ? look.pointsPhone : look.points));
  const copies = phone || look.smearSec <= 0 ? 0 : Math.min(MAX_COPIES, Math.max(0, Math.round(look.smearCopies)));
  const frames = DEFAULT_BODY.frames;
  // metres → world units
  const k = 1 / Math.max(0.1, look.scale);
  const heightU = look.height * k;

  // the stride as a float texture: one row a frame, one texel a point (an average body; each differs by its hash)
  const body = useMemo(() => {
    const data = bakeWalk({ ...DEFAULT_BODY, points, height: heightU }, look.gait === "mocap" ? WALK_CYCLES[0] : undefined);
    const t = new THREE.DataTexture(data, points, frames, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }, [points, frames, heightU, look.gait]);

  const geom = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    // the base: one vertex a point of the body (its index); a position is needed for the draw count only
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points * 3), 3));
    const idx = new Float32Array(points);
    for (let i = 0; i < points; i++) idx[i] = i;
    g.setAttribute("aPoint", new THREE.BufferAttribute(idx, 1));
    g.setAttribute("iPos", new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("iAnim", new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, [points]);

  // the boxes: a billboard quad an instance, the walking silhouette as a sprite sheet
  const sheet = useMemo(() => walkSheet(0, look.gait), [look.gait]);
  const sheetSoft = useMemo(() => walkSheet(look.blur, look.gait), [look.blur, look.gait]);
  useEffect(() => () => sheet.dispose(), [sheet]);
  useEffect(() => () => sheetSoft.dispose(), [sheetSoft]);
  const boxGeom = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute("iBox", new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("iBoxAnim", new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("iBox2", new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("iBox3", new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, []);
  const boxMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSheet: { value: null }, uSheetSoft: { value: null }, uFrames: { value: SHEET_FRAMES }, uRows: { value: SHEET_ROWS }, uAspect: { value: 0.55 }, uRest: { value: 0.22 }, uPaper: { value: 0 }, uInk: { value: 0.9 }, uFrame: { value: 1 }, uGain: { value: 0.5 }, uBody3D: { value: 0 } }]),
        vertexShader: BOX_VERT,
        fragmentShader: BOX_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: fogOn && !look.paper,
        // on paper the window is a faint film MULTIPLIED on the white (no browser exposure any more — 2026-11-23)
        blending: look.paper ? THREE.CustomBlending : THREE.NormalBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.ZeroFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      }),
    [fogOn, look.paper],
  );
  const boxMesh = useRef<THREE.Mesh>(null);
  const gazeId = useRef<string | null>(null);
  useEffect(
    () => () => {
      boxGeom.dispose();
      boxMat.dispose();
      sheet.dispose();
    },
    [boxGeom, boxMat, sheet],
  );
  // the paper's labels: the nearest few, within labelDist, each with its number and a leader line (drei Html)
  const [labels, setLabels] = useState<{ id: string; x: number; y: number; z: number }[]>([]);
  const [bubbles, setBubbles] = useState<{ id: string; x: number; y: number; z: number }[]>([]);
  const labelTimer = useRef(0);
  // whoever asks me something (the record's lines, as RoleField hears them for the sound): cued while the question is open
  const asking = useRef(new Map<string, number>());
  useEffect(
    () =>
      onLifeEvent((e) => {
        if ((e.kind === "word.new" || e.kind === "word.asked") && e.who) asking.current.set(e.who, performance.now() + DEFAULT_WITNESS.askOpenSec * 1000);
        else if (e.kind === "word.answered" && e.who) asking.current.delete(e.who);
        // (a life that ends with a question open: nobody is asking any more — its bubble, its hold and its box go; the
        // artist, 2026-11-27: "죽을 때 응답 안 하면 블롭이 남음")
        else if (e.kind === "ended" || e.kind === "life.begin") asking.current.clear();
      }),
    [],
  );

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          { uBody: { value: null }, uFrames: { value: frames }, uPoints: { value: points }, uSize: { value: look.dot }, uScale: { value: 400 }, uTime: { value: 0 }, uBreath: { value: 1 }, uGrey: { value: look.grey }, uVariety: { value: 1 }, uMaxPx: { value: 6 } },
        ]),
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        fog: fogOn,
      }),
    // (the material is remade only when the fog switch or the body changes; the size and grey are set per frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fogOn, points, frames],
  );
  useEffect(
    () => () => {
      geom.dispose();
      mat.dispose();
      body.dispose();
    },
    [geom, mat, body],
  );

  // the plates (criswvr): one faint standing quad behind each body
  const plateMesh = useRef<THREE.InstancedMesh>(null);
  const plateGeom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => plateGeom.dispose(), [plateGeom]);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const v3 = useMemo(() => new THREE.Vector3(), []);
  const s3 = useMemo(() => new THREE.Vector3(), []);

  const people = useRef(new Map<string, Person>());
  const lastList = useRef<readonly Other[] | null>(null);
  const framesList = useRef<readonly Other[] | null>(null);
  // (frames: where the pictograms held in talk are drawn — the bubble follows them)
  const framePins = useRef(new Map<string, { x: number; z: number }>());
  // (where each is drawn, for marks that go off at a person — my answer's burst at the one I answered: peopleWhere.ts)
  const framesMode = look.mode === "frames";
  const paperWhere = !!look.paper;
  useEffect(() => {
    setPeopleWhere((id) => {
      const p = people.current.get(id);
      if (!p) return null;
      const at = (framesMode ? framePins.current.get(id) : undefined) ?? (paperWhere ? p.body : p);
      return { x: at.x, z: at.z };
    }, paperWhere);
    return () => setPeopleWhere(null);
  }, [framesMode, paperWhere]);
  // 흰 바탕: the 3D bodies (bodySheet.ts) — each person now and their traces, ray-marched, drawn as filters on the white
  // (bodySheet "paper"); the bodies now once more into the depth only (the scene's near-sharp/far-soft rule reads them)
  const poses = useMemo(() => new BodyPoses(MAX_BODIES), []);
  const bodyGeom = useMemo(() => makeBodyGeometry(MAX_BODIES), []);
  const depthGeom = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(bodyGeom.index);
    g.setAttribute("position", bodyGeom.getAttribute("position"));
    g.setAttribute("iBody", bodyGeom.getAttribute("iBody"));
    g.setAttribute("iBody2", bodyGeom.getAttribute("iBody2"));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, [bodyGeom]);
  const bodyMat = useMemo(() => makeBodyMaterial(poses, "paper"), [poses]);
  const depthMat = useMemo(() => makeBodyMaterial(poses, "depth"), [poses]);
  useEffect(
    () => () => {
      poses.dispose();
      bodyGeom.dispose();
      depthGeom.dispose();
      bodyMat.dispose();
      depthMat.dispose();
    },
    [poses, bodyGeom, depthGeom, bodyMat, depthMat],
  );
  const bodyMesh = useRef<THREE.Mesh>(null);
  // the fibers (fiberBody.ts): points on each person's bones, each a thread through three moments
  const [fiberCount, setFiberCount] = useState(() => Math.max(64, Math.round(bodyTuning.fiber.count * (phone ? 0.4 : 1))));
  const fiberCountRef = useRef(fiberCount);
  const fiberGeom = useMemo(() => makeFiberGeometry(fiberCount, MAX_PEOPLE), [fiberCount]);
  const fiberMat = useMemo(() => makeFiberMaterial(poses), [poses]);
  useEffect(() => () => fiberGeom.dispose(), [fiberGeom]);
  useEffect(() => () => fiberMat.dispose(), [fiberMat]);
  // 2D 사람 (spritePeople.ts): the cut-out people's strips, packed into one texture once
  const spriteGeom = useMemo(() => makeSpriteGeometry(MAX_SPRITES), []);
  const spriteMat = useMemo(() => makeSpriteMaterial(), []);
  const spriteIdx = useRef<SpriteIndex | null>(null);
  const gl = useThree((st) => st.gl);
  useEffect(() => {
    let live = true;
    loadSpriteSheet(gl)
      .then(({ index, texture }) => {
        if (!live) return;
        spriteIdx.current = index;
        setUniforms(spriteMat.uniforms, { uSheet: texture, uCols: index.sheet.cols, uPer: index.per, uAtlasRows: index.atlasRows, uAspect: index.sheet.cellW / index.sheet.cellH });
      })
      .catch(() => {
        /* no sheet yet: no 2D people */
      });
    return () => {
      live = false;
    };
  }, [spriteMat, gl]);
  useEffect(() => () => spriteGeom.dispose(), [spriteGeom]);
  useEffect(() => () => spriteMat.dispose(), [spriteMat]);
  // the crowd test scene
  const crowd = useRef<{ walkers: Walker[]; at: number; list: Other[]; real: readonly Other[] | null | undefined; both: Other[] }>({ walkers: [], at: -1, list: [], real: null, both: [] });
  const motion = useMemo<MotionConfig>(() => ({ ...DEFAULT_MOTION, maxSpeed: look.maxSpeed, stride: strideLength(heightU), maxCadence: look.maxCadence }), [look.maxSpeed, heightU, look.maxCadence]);
  /** This body's own motion: its pace and its stride follow its height and pace factors. */
  const motionOf = (hash: number): MotionConfig => {
    const hs = heightFactor(hash, look.variety), pace = paceFactor(hash, look.variety);
    return { ...motion, maxSpeed: motion.maxSpeed * pace, accel: motion.accel * pace, stride: motion.stride * hs, turnRate: motion.turnRate * (0.8 + 0.4 * frac(hash * 5.3)) };
  };
  // the 3D body's own way of moving: the captured cycle's stride (metres → world), a walking cadence, a slower ease
  const bodyMotionOf = (hash: number): MotionConfig => {
    const m = motionOf(hash);
    const strideM = (look.gait === "mocap" ? cycleOf(hash)?.strideM : undefined) ?? 1.4;
    return { ...m, stride: strideM * k * heightFactor(hash, look.variety) * (look.height / 1.7), reachSec: 0.6, maxCadence: Math.min(m.maxCadence, 1.6) };
  };
  const crowdRnd = useRef<(() => number) | null>(null);
  // the visitor's own body (look.meBody): its stride runs with their speed; its points blink their melody
  const self = useRef({ phase: 0, breathe: 0 });

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const now = state.clock.elapsedTime;
    const me = playerPosRef.current;
    const P = people.current;
    // the live knobs (bodyArchetypes.bodyTuning): the archetypes, the traces, the lab's view of one archetype
    const T = bodyTuning.trail;
    const archs = bodyTuning.archetypes.length ? bodyTuning.archetypes : DEFAULT_ARCHETYPES;
    const view = mobileLab() === "bot-present" ? bodyTuning.view : "all";
    const archOf = (hash: number) => Math.max(0, archetypeIndexOf(hash, archs, view));
    const F = bodyTuning.fiber, M = bodyTuning.move;
    const fibers = look.mode === "fibers";
    const sprites = look.mode === "sprites";
    const SP = bodyTuning.sprite;
    // (the fibers' point count rebuilds their geometry — once, when the knob changes)
    const wantFiber = Math.max(64, Math.round(F.count * (phone ? 0.4 : 1)));
    if (fibers && wantFiber !== fiberCountRef.current) {
      fiberCountRef.current = wantFiber;
      setFiberCount(wantFiber);
    }
    // the record's latest places (a new list after every fold)
    let list = getOthers();
    // the crowd test scene (?crowd=N): walkers round the visitor, sampled as the record would be, before the record's own
    if (CROWD_PARAM > 0) {
      const C = crowd.current;
      if (!C.walkers.length) {
        const rnd = mulberry32(20261123);
        for (let i = 0; i < CROWD_PARAM; i++) C.walkers.push(spawnWalker(rnd, me, k, true));
        crowdRnd.current = rnd;
      }
      const rnd = crowdRnd.current ?? Math.random;
      for (let i = 0; i < C.walkers.length; i++) {
        const w = C.walkers[i];
        // (each walks at their archetype's pace)
        const pace = archs[archOf(idHash(`crowd-${i}`))]?.pace ?? 1;
        w.x += w.vx * pace * dt;
        w.z += w.vz * pace * dt;
        if (Math.hypot(w.x - me.x, w.z - me.z) > 18 * k) C.walkers[i] = spawnWalker(rnd, me, k, false);
      }
      if (now - C.at >= SAMPLE_SEC || list !== C.real) {
        if (now - C.at >= SAMPLE_SEC) {
          C.at = now;
          C.list = C.walkers.map((w, i) => ({ o: `crowd-${i}`, r: "worker", x: w.x, z: w.z, dist: Math.hypot(w.x - me.x, w.z - me.z), bearing: "", moving: w.vx !== 0 || w.vz !== 0, ageSec: 0 }) as Other);
        }
        C.real = list;
        C.both = C.list.concat(list ?? []);
      }
      list = C.both;
    }
    // (the frames layer reads the same list — the record's places and the crowd test's)
    framesList.current = list;
    if (list && list !== lastList.current) {
      lastList.current = list;
      for (const o of list) {
        const tx = nearestImage(o.x, me.x), tz = nearestImage(o.z, me.z);
        const bright = Math.exp(-o.ageSec / Math.max(0.1, look.recentSec));
        const p = P.get(o.o);
        if (!p) {
          if (P.size >= MAX_PEOPLE) continue;
          const h = idHash(o.o);
          P.set(o.o, { x: tx, z: tz, vx: 0, vz: 0, heading: h * Math.PI * 2, phase: h, tx, tz, seen: now, bright, alpha: 0, trail: [], lastTrailAt: now, hash: h, hs: heightFactor(h, look.variety), ws: buildFactor(h, look.variety), motion: motionOf(h), flip: 0, sdx: 0, sdz: 0, sampleAt: now, shakeUntil: 0, body: { x: tx, z: tz, vx: 0, vz: 0, heading: h * Math.PI * 2, phase: h, tx, tz }, bodyMotion: bodyMotionOf(h), hist: [], lastHistAt: -1, rvx: 0, rvz: 0, changeAt: now, stamps: [{ t: now - 5, x: tx, z: tz, h: h * Math.PI * 2, ph: h, v: 0 }], lookOff: 0 });
        } else {
          // the record's place is drawn where it lies round the walker (the world wraps): a far jump is the wrap, not a walk
          const dx = tx - p.tx, dz = tz - p.tz;
          if (dx !== 0 || dz !== 0) {
            const d = Math.hypot(dx, dz);
            if (d < motionOf(p.hash).snapDist) {
              p.sdx = dx;
              p.sdz = dz;
              p.sampleAt = now;
              if (look.paper) {
                // 흰 바탕: no jump, no shake (the artist, 2026-11-23: "플리커링 있어 보이는 거 끔찍") — the record's pace
                // between its samples is what the body walks at until the next
                const since = Math.min(1.5, Math.max(0.25, now - p.changeAt));
                p.rvx += (dx / since - p.rvx) * 0.6;
                p.rvz += (dz / since - p.rvz) * 0.6;
                p.changeAt = now;
                // the fibers' "슉": this sample as it is, newest first
                const last = p.stamps[0];
                const ph = ((last ? last.ph : p.hash) + Math.min(0.5, d / Math.max(1e-3, p.bodyMotion.stride))) % 1;
                p.stamps.unshift({ t: now, x: tx, z: tz, h: Math.atan2(dx, dz), ph, v: d / k / since });
                if (p.stamps.length > 3) p.stamps.length = 3;
              } else p.shakeUntil = now + SHAKE_SEC;
            }
          }
          p.tx = tx;
          p.tz = tz;
          p.seen = now;
          p.bright = bright;
        }
      }
    }
    // every body moves on; a gone one fades and is dropped
    const iPos = geom.getAttribute("iPos") as THREE.InstancedBufferAttribute;
    const iAnim = geom.getAttribute("iAnim") as THREE.InstancedBufferAttribute;
    const A = iPos.array as Float32Array, B = iAnim.array as Float32Array;
    const iBox = boxGeom.getAttribute("iBox") as THREE.InstancedBufferAttribute;
    const iBoxAnim = boxGeom.getAttribute("iBoxAnim") as THREE.InstancedBufferAttribute;
    const BX = iBox.array as Float32Array, BY = iBoxAnim.array as Float32Array;
    const iBox2 = boxGeom.getAttribute("iBox2") as THREE.InstancedBufferAttribute;
    const BZ = iBox2.array as Float32Array;
    const iBox3 = boxGeom.getAttribute("iBox3") as THREE.InstancedBufferAttribute;
    const BW = iBox3.array as Float32Array;
    // (the windows stand for the 3D body and for the fibers alike)
    const boxes = look.mode === "boxes" || fibers || sprites;
    const pv = look.paperVariety;
    const paper = look.paper;
    const fadeU = Math.max(0.5, look.fadeDist);
    let n = 0, nb = 0, nbody = 0;
    const iBodyA = bodyGeom.getAttribute("iBody") as THREE.InstancedBufferAttribute;
    const iBodyB = bodyGeom.getAttribute("iBody2") as THREE.InstancedBufferAttribute;
    const BB = iBodyA.array as Float32Array, BB2 = iBodyB.array as Float32Array;
    const fA = (name: string) => fiberGeom.getAttribute(name) as THREE.InstancedBufferAttribute;
    const FN = fA("iNow").array as Float32Array, FM = fA("iMid").array as Float32Array, FO = fA("iOld").array as Float32Array, FR = fA("iRows").array as Float32Array;
    let nf = 0;
    const sA = (name: string) => spriteGeom.getAttribute(name) as THREE.InstancedBufferAttribute;
    const SA = sA("iA").array as Float32Array, SB = sA("iB").array as Float32Array, SC = sA("iC").array as Float32Array;
    let ns = 0;
    // each archetype's girth, own colours, and its gait-free copy (the wave, the sine walk: proportions only)
    const archGirth: BodyGirth[] = archs.map((a) => ({ limbs: a.limbs, girth: a.girth, belly: a.belly, head: a.head }));
    const archCol: (BodyColours | null)[] = archs.map((a) => (a.fixedColour ? { top: hexToLinear(a.top), pants: hexToLinear(a.pants) } : null));
    const archPlain: Archetype[] = archs.map((a) => ({ ...a, stride: 1, swing: 1, bounce: 1, sway: 1, lift: 1, armStyle: "swing" }));
    /** World units a body metre is for this person (their variety × the knob's height × the archetype's). */
    const scaleOf = (p: Person, a: Archetype) => (k * p.hs * look.height * a.height) / (1.7 * 1.7);
    const cycleFor = (p: Person, a: Archetype) => (a.gait >= 0 && a.gait < WALK_CYCLES.length ? WALK_CYCLES[Math.round(a.gait)] : cycleOf(p.hash));
    /** How far a stride carries this person (world): the captured stride × their scale × the archetype's reach. */
    const strideOf = (p: Person, a: Archetype) => ((look.gait === "mocap" ? cycleFor(p, a)?.strideM : undefined) ?? 1.4) * scaleOf(p, a) * strideScaleOf(a);
    /** The person's joints at a stride phase, standing share and cue (the wave on its own time t), as their archetype. */
    const poseFor = (p: Person, ai: number, ph: number, st: number, cue: number, t: number): Joints => {
      if (cue) {
        const W = poseOf(undefined, wavePhase(t, p.hash), 0, true);
        return shapePose(W, W, archPlain[ai], 0);
      }
      const cyc = look.gait === "mocap" ? cycleFor(p, archs[ai]) : undefined;
      if (!cyc) {
        const J = jointsAt(ph, WALK_STYLES[Math.floor(frac(p.hash * 29.7) * WALK_STYLES.length)]);
        return shapePose(J, J, archPlain[ai], 1 - st);
      }
      return shapePose(poseOf(cyc, ph, st), standOf(cyc), archs[ai], 1 - st);
    };
    /** One body instance (the person now, or a trace): its pose row, place, facing, strength, colours' saturation, softness. */
    const putBody = (row: number, J: Joints, p: Person, ai: number, x: number, z: number, h: number, alpha: number, sat: number, soft: number) => {
      const a = archs[ai];
      const c = cutOf(p.hash);
      const hem = a.hem === "any" ? c.hem : a.hem === "waist" ? 0 : a.hem === "hip" ? 1 : 2;
      const long = a.hair === "any" ? c.longHair : a.hair === "long" ? 1 : 0;
      poses.write(row, J, p.ws, { cut: hem + 3 * c.shortSleeve + 6 * long, palette: paletteIndexOf(p.hash).code }, archGirth[ai], archCol[ai]);
      BB[row * 4] = x;
      BB[row * 4 + 1] = z;
      BB[row * 4 + 2] = h;
      BB[row * 4 + 3] = scaleOf(p, a);
      BB2[row * 4] = row;
      BB2[row * 4 + 1] = alpha;
      BB2[row * 4 + 2] = sat;
      BB2[row * 4 + 3] = soft;
    };
    /** The pose row alone (the fibers place their own instances). */
    const writePose = (row: number, J: Joints, p: Person, ai: number) => {
      const a = archs[ai];
      const c = cutOf(p.hash);
      const hem = a.hem === "any" ? c.hem : a.hem === "waist" ? 0 : a.hem === "hip" ? 1 : 2;
      const long = a.hair === "any" ? c.longHair : a.hair === "long" ? 1 : 0;
      poses.write(row, J, p.ws, { cut: hem + 3 * c.shortSleeve + 6 * long, palette: paletteIndexOf(p.hash).code }, archGirth[ai], archCol[ai]);
    };
    /** What a standing person does now (a gesture for gestureSec, by their hash and the time), the one before it, and how
     *  far into this one they are (s) — the change is eased over ~1.2 s, never a snap. */
    const gestureOf = (p: Person, t: number) => {
      const len = Math.max(0.5, M.gestureSec);
      const x = (t + p.hash * 37) / len;
      const slot = Math.floor(x);
      const pick = (sl: number) => STAND_GESTURES[Math.floor(frac(Math.sin(sl * 12.9898 + p.hash * 78.233) * 43758.5453) * STAND_GESTURES.length) % STAND_GESTURES.length];
      return { g: pick(slot), prev: pick(slot - 1), into: (x - slot) * len, side: slot % 2 ? 1 : -1 };
    };
    /** The joints of one of a fiber's moments: the archetype's walk at its phase (a run when fast), a gesture when standing,
     *  the wave when cued. */
    const statePose = (p: Person, ai: number, s: FState): Joints => {
      if (s.cue) {
        const W = poseOf(undefined, wavePhase(s.t, p.hash), 0, true);
        return shapePose(W, W, archPlain[ai], 0);
      }
      const a = archs[ai];
      const cyc = look.gait === "mocap" ? cycleFor(p, a) : undefined;
      if (!cyc) {
        const J = jointsAt(s.ph, WALK_STYLES[Math.floor(frac(p.hash * 29.7) * WALK_STYLES.length)]);
        return shapePose(J, J, archPlain[ai], 1 - s.st);
      }
      const St = standOf(cyc);
      const P0 = poseOf(cyc, s.ph, s.st);
      const as = (g: string) => (g === "look" || g === "swing" ? a : { ...a, armStyle: g as Archetype["armStyle"] });
      let J: Joints;
      if (M.gestures && s.st > 0.5) {
        // standing: this gesture, eased in from the one before
        const G = gestureOf(p, s.t);
        J = shapePose(P0, St, as(G.g), 0);
        const w = smooth01(G.into / 1.2);
        if (w < 1) {
          const Jp = shapePose(P0, St, as(G.prev), 0);
          for (const key of Object.keys(J) as (keyof Joints)[]) for (let i = 0; i < 3; i++) J[key][i] = Jp[key][i] + (J[key][i] - Jp[key][i]) * w;
        }
        // and never quite still: the weight shifts from foot to foot, slowly, each in their own time
        const sway = 0.018 * Math.sin(s.t * 0.55 + p.hash * 6.3) + 0.008 * Math.sin(s.t * 1.3 + p.hash * 2.1);
        for (const key of ["pelvis", "shoulders", "head", "hipL", "hipR", "shL", "shR", "elbowL", "elbowR", "wristL", "wristR"] as const) J[key][0] += sway;
        J.kneeL[0] += sway * 0.5;
        J.kneeR[0] += sway * 0.5;
        J.head[1] += 0.006 * Math.sin(s.t * 0.8 + p.hash * 4.4);
      } else J = shapePose(P0, St, a, 1 - s.st);
      return s.run > 0 ? runPose(J, shapePose(St, St, a, 0), s.run) : J;
    };
    const runOf = (vMs: number) => M.run * smooth01((vMs - M.runFrom) / 0.8);
    /** A fiber's three moments for this person: in the "슉" from the last three samples (the sweep to the newest, the
     *  older ones drawn back towards it over the fiber's time), otherwise from the body's written way. */
    const fiberStates = (p: Person, cue: number): [FState, FState, FState] => {
      const b = p.body;
      const look1 = M.gestures && gestureOf(p, now).g === "look" ? gestureOf(p, now).side * 0.8 : 0;
      if (M.stamp && p.stamps.length) {
        const s0 = p.stamps[0], s1 = p.stamps[1] ?? s0, s2 = p.stamps[2] ?? s1;
        const standing = now - s0.t > 1 || s0.v < 0.3;
        p.lookOff += ((standing ? look1 : 0) - p.lookOff) * Math.min(1, dt * 2.5);
        const h0 = cue ? Math.atan2(me.x - b.x, me.z - b.z) : b.heading + p.lookOff;
        const st0: FState = { x: b.x, z: b.z, h: h0, ph: s0.ph, st: standing ? 1 : 0, run: standing ? 0 : runOf(s0.v), cue, t: now };
        const r1 = smooth01((now - s0.t - M.dashSec) / Math.max(0.05, F.sec));
        const r2 = smooth01((now - s0.t) / Math.max(0.05, F.sec * 1.4));
        const mix = (a: Stamp, to: FState, u: number, st: number, run: number, t: number): FState => {
          let dh = to.h - a.h;
          dh = ((((dh + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
          return { x: a.x + (to.x - a.x) * u, z: a.z + (to.z - a.z) * u, h: a.h + dh * u, ph: u > 0.5 ? to.ph : a.ph, st: u > 0.5 ? to.st : st, run: u > 0.5 ? to.run : run, cue, t };
        };
        const st1 = mix(s1, st0, r1, s1.v < 0.3 ? 1 : 0, runOf(s1.v), now - F.sec * 0.5);
        const st2 = mix(s2, st1, r2, s2.v < 0.3 ? 1 : 0, runOf(s2.v), now - F.sec);
        return [st0, st1, st2];
      }
      const stand = 1 - Math.min(1, Math.hypot(b.vx, b.vz) / motion.standBelow);
      const vMs = Math.hypot(b.vx, b.vz) / k;
      p.lookOff += ((stand > 0.5 ? look1 : 0) - p.lookOff) * Math.min(1, dt * 2.5);
      const at = (t: number): FState => {
        const hh = t < now ? histAt(p.hist, t) : null;
        if (!hh) return { x: b.x, z: b.z, h: cue ? Math.atan2(me.x - b.x, me.z - b.z) : b.heading + p.lookOff, ph: b.phase, st: stand, run: runOf(vMs), cue, t };
        return { x: hh.x, z: hh.z, h: hh.h, ph: hh.ph, st: hh.st, run: runOf(vMs), cue: hh.cue, t };
      };
      return [at(now), at(now - F.sec * 0.5), at(now - F.sec)];
    };
    /** 흰 바탕: the body walks on at the record's pace, gently pulled towards where the record will have it (dead
     *  reckoning): continuous, no surge every half second. A far jump (a wrap, a new life) is a cut: it is there. */
    const reckon = (p: Person, a: Archetype) => {
      const b = p.body, m = p.bodyMotion;
      if (now - p.changeAt > 1) {
        const kd = Math.exp(-dt / 0.25);
        p.rvx *= kd;
        p.rvz *= kd;
      }
      const ahead = Math.min(0.8, now - p.changeAt);
      const gx = p.tx + p.rvx * ahead, gz = p.tz + p.rvz * ahead;
      const ex = gx - b.x, ez = gz - b.z;
      if (Math.hypot(ex, ez) > m.snapDist) {
        b.x = gx;
        b.z = gz;
        b.vx = p.rvx;
        b.vz = p.rvz;
        p.hist.length = 0;
        return;
      }
      let wx = p.rvx + ex * 1.6, wz = p.rvz + ez * 1.6;
      const top = m.maxSpeed * a.pace * 1.3, wl = Math.hypot(wx, wz);
      if (wl > top) {
        wx *= top / wl;
        wz *= top / wl;
      }
      const kk = 1 - Math.exp(-3.5 * dt);
      b.vx += (wx - b.vx) * kk;
      b.vz += (wz - b.vz) * kk;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      const speed = Math.hypot(b.vx, b.vz);
      if (speed > m.standBelow) {
        let diff = Math.atan2(b.vx, b.vz) - b.heading;
        diff = ((((diff + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
        const mt = m.turnRate * dt;
        b.heading += Math.max(-mt, Math.min(mt, diff));
        // (running, the cadence may rise: the feet keep up with the ground — no gliding)
        const cap = speed / k > M.runFrom ? Math.max(m.maxCadence, 2.9) : m.maxCadence;
        b.phase = (b.phase + Math.min(cap, speed / Math.max(1e-3, strideOf(p, a))) * dt) % 1;
      } else {
        const target = standingPhase(b.phase);
        b.phase += (target - b.phase) * Math.min(1, 6 * dt);
        if (b.phase >= 1) b.phase -= 1;
      }
    };
    /** The people whose traces are drawn after every body now (so the depth pass takes the bodies now alone). */
    const jobs: { p: Person; ai: number; A: number }[] = [];
    const plates = plateMesh.current;
    let np = 0;
    const smearEvery = copies > 0 ? look.smearSec / copies : Infinity;
    // the melody's step now
    const step = stepAt(performance.now());
    const nowMs = performance.now();
    for (const [id, p] of P) {
      const gone = now - p.seen > GONE_SEC;
      if (gone && p.alpha <= 0.01) {
        P.delete(id);
        continue;
      }
      // the wrap: if the walker crossed the edge since, the body's place is re-imaged beside its target
      if (Math.abs(p.x - p.tx) > motion.snapDist || Math.abs(p.z - p.tz) > motion.snapDist) {
        p.x = p.tx;
        p.z = p.tz;
        p.trail.length = 0;
      }
      const ai = archOf(p.hash);
      const arch = archs[ai];
      if (paper && (fibers || sprites) && M.stamp && p.stamps.length) {
        // the fibers' "슉": at each sample the body sweeps to it in dashSec and holds there; the window, the label and the
        // bubble follow
        const s0 = p.stamps[0], s1 = p.stamps[1] ?? s0;
        const e = smooth01((now - s0.t) / Math.max(0.02, M.dashSec));
        const b = p.body;
        b.x = s1.x + (s0.x - s1.x) * e;
        b.z = s1.z + (s0.z - s1.z) * e;
        let dh = s0.h - s1.h;
        dh = ((((dh + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
        b.heading = s1.h + dh * e;
        const walking = now - s0.t < 1 && s0.v > 0.3;
        const span = Math.max(0.25, s0.t - s1.t);
        b.vx = walking ? (s0.x - s1.x) / span : 0;
        b.vz = walking ? (s0.z - s1.z) / span : 0;
        b.phase = s0.ph;
        p.x = b.x;
        p.z = b.z;
        p.vx = b.vx;
        p.vz = b.vz;
        p.heading = b.heading;
        p.phase = b.phase;
      } else if (paper) {
        // 흰 바탕: one continuous body; the window, the label and the bubble follow it
        reckon(p, arch);
        const b = p.body;
        p.x = b.x;
        p.z = b.z;
        p.vx = b.vx;
        p.vz = b.vz;
        p.heading = b.heading;
        p.phase = b.phase;
      } else {
        stepPerson(p, dt, p.motion);
        p.body.tx = p.tx;
        p.body.tz = p.tz;
        stepPerson(p.body, dt, p.bodyMotion);
      }
      // standing near someone, the body turns to face the nearest of them (slowly): a group, not a row
      if (look.faceEach && Math.hypot(p.vx, p.vz) < motion.standBelow) {
        let best: Person | null = null, bd = look.faceRadius * k;
        for (const q of P.values()) {
          if (q === p) continue;
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < bd) {
            bd = d;
            best = q;
          }
        }
        if (best) {
          let diff = Math.atan2(best.x - p.x, best.z - p.z) - p.heading;
          diff = ((((diff + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
          const maxTurn = FACE_TURN * dt;
          p.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
        }
      }
      if (paper) p.body.heading = p.heading;
      const target = gone ? 0 : p.bright;
      // gone: the fade is the tail's length on paper
      p.alpha += (target - p.alpha) * Math.min(1, dt / (gone && paper ? Math.max(0.2, look.tailSec) : FADE_SEC)) * (gone ? 1 : 3);
      const speed = Math.hypot(p.vx, p.vz);
      const standing = 1 - Math.min(1, speed / motion.standBelow);
      // the smear: a copy of the body where it was, every smearEvery seconds, kept smearSec
      if (copies > 0) {
        if (now - p.lastTrailAt >= smearEvery && speed > motion.standBelow * 0.5) {
          p.lastTrailAt = now;
          p.trail.push({ x: p.x, z: p.z, heading: p.heading, phase: p.phase, t: now });
          if (p.trail.length > copies) p.trail.shift();
        }
        while (p.trail.length && now - p.trail[0].t > look.smearSec) p.trail.shift();
      } else if (p.trail.length) p.trail.length = 0;
      const askUntil = asking.current.get(id);
      const cue = look.cue && askUntil !== undefined && nowMs < askUntil ? 1 : 0;
      // (the pictograms: the eye turns to whoever asks me something — the boxes' branch below, where it lived, is not run
      // for them; "고개 그쪽으로 돌아감", 2026-11-25)
      if (look.mode === "frames" && askUntil !== undefined && nowMs < askUntil && gazeId.current !== id) {
        gazeId.current = id;
        streetGaze.x = p.x;
        streetGaze.z = p.z;
        streetGaze.until = now + 1.2;
        streetGaze.on = look.askTurn;
      }
      // the body's way, written down for its traces
      if (paper && (fibers || sprites ? !M.stamp : T.on)) {
        const b = p.body;
        if (now - p.lastHistAt >= HIST_EVERY) {
          p.lastHistAt = now;
          p.hist.push({ t: now, x: b.x, z: b.z, h: cue ? Math.atan2(me.x - b.x, me.z - b.z) : b.heading, ph: b.phase, st: 1 - Math.min(1, Math.hypot(b.vx, b.vz) / motion.standBelow), cue });
        }
        const keep = now - Math.max(T.sec, F.sec) - 0.25;
        let drop = 0;
        while (drop < p.hist.length && p.hist[drop].t < keep) drop++;
        if (drop) p.hist.splice(0, drop);
      } else if (p.hist.length) p.hist.length = 0;
      if (boxes) {
        if (nb < MAX_INSTANCES) {
          // the plate stands along the heading (a standing one keeps its last way)
          if (speed > motion.standBelow) p.flip = 0;
          // paper: nearer = darker and sharper; walking = stretched along the screen
          const dist = Math.hypot(p.x - me.x, p.z - me.z);
          const dark = paper ? 0.2 + 0.8 * Math.max(0, 1 - dist / fadeU) : 1;
          const lit = paper ? 0 : rhythmOf(id)[step] ? 1 : 0;
          // 각자의 창: the window stretched by the last sample's move along the screen, shrinking until the next sample;
          // gone, it stays stretched (the tail); the shake right after a sample
          // this window's own proportion (paper): by the being's hash, between aspectMin and aspectMax
          const aspect = paper ? look.aspectMin + (look.aspectMax - look.aspectMin) * frac(p.hash * 19.3) : look.boxAspect;
          // (on paper the window is as tall as the archetype's body)
          const tall = heightU * p.hs * (paper ? arch.height / 1.7 : 1);
          let cx = p.x, cz = p.z, stretch = 0;
          if (paper && look.stretchGain > 0 && T.on) {
            // the window spans the traces (from where the body was 0.7 of the trace time ago to now): smooth, it grows
            // as they walk and closes as they stop
            const back = histAt(p.hist, now - T.sec * 0.7);
            if (back) {
              const ax = (back.x - p.x) * look.stretchGain, az = (back.z - p.z) * look.stretchGain;
              const w0 = Math.max(0.05, tall * aspect);
              stretch = Math.min(6, Math.hypot(ax, az) / w0);
              cx += 0.5 * ax;
              cz += 0.5 * az;
            }
          }
          // beyond the blot radius the present's scan carries them (future-presence): nothing drawn here
          const cut = paper ? Math.max(0, Math.min(1, 1 - (dist - look.blotDist) / 1.5)) : 1;
          BX[nb * 4] = cx;
          BX[nb * 4 + 1] = cz;
          BX[nb * 4 + 2] = tall * (1 + 0.35 * cue);
          BX[nb * 4 + 3] = p.heading;
          BY[nb * 4] = p.phase;
          BY[nb * 4 + 1] = lit;
          BY[nb * 4 + 2] = p.alpha * cut;
          BY[nb * 4 + 3] = cue;
          BZ[nb * 4] = stretch;
          BZ[nb * 4 + 1] = dark;
          BZ[nb * 4 + 2] = aspect;
          // this person's way: a walk of their own (the sheet's row), their ink, the softness of their edge, their lean;
          // the asker waves instead of walking
          // (the canvas's rows count from the top, the texture's v from the bottom: the row is written mirrored)
          const row = SHEET_ROWS - 1 - (cue ? WAVE_ROW : Math.floor(frac(p.hash * 29.7) * WALK_ROWS));
          BW[nb * 4] = pv * frac(p.hash * 41.3);
          BW[nb * 4 + 1] = 1 + pv * (0.4 * frac(p.hash * 53.1) - 0.2);
          BW[nb * 4 + 2] = pv * (frac(p.hash * 61.7) - 0.5) * 0.14;
          BW[nb * 4 + 3] = row;
          const baseNb = nb;
          nb++;
          // 흰 바탕: the 3D body (bodySheet.ts) where the eased body is, seen from wherever the visitor stands; the asker
          // turns to the visitor and waves
          if (paper && fibers) {
            // THE FIBERS: three moments of this person — now, a little ago, longer ago — each its own pose row; every point
            // of the body is drawn as a thread through its three places
            if (nf < MAX_PEOPLE && nbody + 3 <= MAX_BODIES) {
              const A = Math.min(1, BW[baseNb * 4 + 1] * p.alpha * cut);
              const Sx = fiberStates(p, cue);
              for (let r = 0; r < 3; r++) {
                const s = Sx[r];
                writePose(nbody + r, statePose(p, ai, s), p, ai);
                const I = r === 0 ? FN : r === 1 ? FM : FO;
                I[nf * 4] = s.x;
                I[nf * 4 + 1] = s.z;
                I[nf * 4 + 2] = s.h;
                I[nf * 4 + 3] = scaleOf(p, archs[ai]);
              }
              FR[nf * 4] = nbody;
              FR[nf * 4 + 1] = nbody + 1;
              FR[nf * 4 + 2] = nbody + 2;
              FR[nf * 4 + 3] = A;
              nbody += 3;
              nf++;
            }
          } else if (paper && sprites) {
            // 2D 사람: the person now as a card of the cut-out video, and the afterimages their last two sweeps left
            const idx = spriteIdx.current;
            if (idx) {
              const A = Math.min(1, BW[baseNb * 4 + 1] * p.alpha * cut) * SP.ink * look.ink;
              const a = archs[ai];
              const hgt = scaleOf(p, a) * 1.7 * 1.06 * SP.scale;
              const wide = Math.pow(Math.max(0.3, a.girth), 0.7);
              const hue = (frac(p.hash * 3.71) - 0.5) * Math.PI * 2 * SP.hue;
              const cols = idx.sheet.cols;
              const b = p.body;
              const put = (x: number, z: number, h: number, ph: number, standing: boolean, alpha: number) => {
                if (ns >= MAX_SPRITES || alpha < 0.004) return;
                const { row, mirror } = spriteRow(idx, h - Math.atan2(me.x - x, me.z - z), standing, p.hash);
                SA[ns * 4] = x;
                SA[ns * 4 + 1] = z;
                SA[ns * 4 + 2] = hgt;
                SA[ns * 4 + 3] = alpha;
                SB[ns * 4] = idx.slot[row] ?? 0;
                SB[ns * 4 + 1] = (((ph % 1) + 1) % 1) * cols;
                SB[ns * 4 + 2] = mirror;
                SB[ns * 4 + 3] = hue;
                SC[ns * 4] = wide;
                SC[ns * 4 + 1] = SP.sat;
                ns++;
              };
              const n = Math.max(0, Math.round(phone ? SP.copies / 2 : SP.copies));
              const lerpPh = (p0: number, p1: number, f: number) => {
                let d = p1 - p0;
                if (d < -0.5) d += 1;
                else if (d > 0.5) d -= 1;
                return p0 + d * f;
              };
              if (M.stamp && p.stamps.length) {
                const s0 = p.stamps[0], s1 = p.stamps[1] ?? s0, s2 = p.stamps[2] ?? s1;
                const standing = now - s0.t > 1 || s0.v < 0.3;
                const e = smooth01((now - s0.t) / Math.max(0.02, M.dashSec));
                // the afterimages along the last sweep (only where the body has already passed) and the one before, each
                // fading from when its sample came
                const segs: [Stamp, Stamp, number, number][] = [[s1, s0, now - s0.t, e], [s2, s1, now - s1.t, 1]];
                for (const [from, to, age, upTo] of segs) {
                  const fade = 1 - age / Math.max(0.05, SP.sec);
                  if (fade <= 0 || (from.x === to.x && from.z === to.z)) continue;
                  for (let i = 0; i < n; i++) {
                    const f = (i + 0.5) / n;
                    if (f > upTo) break;
                    put(from.x + (to.x - from.x) * f, from.z + (to.z - from.z) * f, to.h, lerpPh(from.ph, to.ph, f), false, A * SP.trail * fade * fade);
                  }
                }
                put(b.x, b.z, cue ? Math.atan2(me.x - b.x, me.z - b.z) : b.heading, s0.ph, standing && !cue, A);
              } else {
                const stand = 1 - Math.min(1, Math.hypot(b.vx, b.vz) / motion.standBelow);
                for (let i = n; i >= 1; i--) {
                  const age = (i * SP.sec) / (n + 1);
                  const hh = histAt(p.hist, now - age);
                  if (hh) put(hh.x, hh.z, hh.h, hh.ph, hh.st > 0.5, A * SP.trail * (1 - age / SP.sec));
                }
                put(b.x, b.z, cue ? Math.atan2(me.x - b.x, me.z - b.z) : b.heading, b.phase, stand > 0.5 && !cue, A);
              }
            }
          } else if (paper && nbody < MAX_BODIES) {
            const b = p.body;
            const stand = 1 - Math.min(1, Math.hypot(b.vx, b.vz) / motion.standBelow);
            // the person's whole ink (the knob × their own × their fade); the body now is a share of it, the traces the rest
            const A = Math.min(0.995, look.ink * BW[baseNb * 4 + 1] * p.alpha * cut);
            const h = cue ? Math.atan2(me.x - b.x, me.z - b.z) : b.heading;
            putBody(nbody, poseFor(p, ai, b.phase, stand, cue, now), p, ai, b.x, b.z, h, T.on ? A * T.now : A, 1, T.softNow / 100);
            nbody++;
            if (T.on && A > 0.004) jobs.push({ p, ai, A });
          }
          // the asker: the wave runs on its own time; square ripples spread from the window on the bar; the eye turns
          if (cue) {
            p.phase = (p.phase + dt * 0.9) % 1;
            if (gazeId.current !== id) {
              gazeId.current = id;
              streetGaze.x = p.x;
              streetGaze.z = p.z;
              streetGaze.until = now + 1.2;
              streetGaze.on = look.askTurn;
            }
            if (paper && look.ripple) {
              for (let r = 0; r < 2; r++) {
                if (nb >= MAX_INSTANCES) break;
                const t = ((now * 0.9 + r * 0.5) % 1);
                const grow = 1.15 + 0.7 * t;
                for (let q = 0; q < 4; q++) {
                  BX[nb * 4 + q] = BX[baseNb * 4 + q];
                  BY[nb * 4 + q] = BY[baseNb * 4 + q];
                  BZ[nb * 4 + q] = BZ[baseNb * 4 + q];
                  BW[nb * 4 + q] = BW[baseNb * 4 + q];
                }
                BX[nb * 4 + 2] = tall * grow;
                BY[nb * 4 + 2] = p.alpha * cut * (1 - t) * 0.8;
                BY[nb * 4 + 3] = 2;
                BZ[nb * 4] = stretch;
                nb++;
              }
            }
          } else if (gazeId.current === id) gazeId.current = null;
          // (the trail copies are not drawn on paper any more: the exposure's feedback leaves the real one)
          if (false) {
            for (const c of p.trail) {
              if (nb >= MAX_INSTANCES) break;
              const age = (now - c.t) / Math.max(0.1, look.smearSec);
              BX[nb * 4] = c.x;
              BX[nb * 4 + 1] = c.z;
              BX[nb * 4 + 2] = heightU * p.hs;
              BX[nb * 4 + 3] = c.heading;
              BY[nb * 4] = c.phase;
              BY[nb * 4 + 1] = 0;
              BY[nb * 4 + 2] = p.alpha * cut * 0.6 * (1 - age) * (1 - age);
              BY[nb * 4 + 3] = 0;
              BZ[nb * 4] = stretch;
              BZ[nb * 4 + 1] = dark;
              BZ[nb * 4 + 2] = aspect;
              for (let q = 0; q < 4; q++) BW[nb * 4 + q] = BW[baseNb * 4 + q];
              nb++;
            }
          }
        }
      } else if (n < MAX_INSTANCES) {
        A[n * 4] = p.x;
        A[n * 4 + 1] = cue;
        A[n * 4 + 2] = p.z;
        A[n * 4 + 3] = p.heading;
        B[n * 4] = p.phase;
        B[n * 4 + 1] = p.alpha;
        B[n * 4 + 2] = standing;
        B[n * 4 + 3] = p.hash;
        n++;
      }
      if (boxes && !paper) p.trail.length = 0;
      if (boxes) continue;
      for (const c of p.trail) {
        if (n >= MAX_INSTANCES) break;
        const age = (now - c.t) / Math.max(0.1, look.smearSec);
        A[n * 4] = c.x;
        A[n * 4 + 1] = 0;
        A[n * 4 + 2] = c.z;
        A[n * 4 + 3] = c.heading;
        B[n * 4] = c.phase;
        B[n * 4 + 1] = p.alpha * 0.55 * (1 - age) * (1 - age);
        B[n * 4 + 2] = 0;
        B[n * 4 + 3] = p.hash;
        n++;
      }
      if (plates && look.plate && np < MAX_PEOPLE) {
        v3.set(p.x, heightU * p.hs * 0.56, p.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
        s3.set(0.95 * heightU * p.ws * (1 / 1.7), heightU * p.hs * 1.12, 1);
        m4.compose(v3, q, s3);
        plates.setMatrixAt(np, m4);
        np++;
      }
    }
    // THE TRACES (the artist, 2026-11-23: "걸어가는 모습을 잔흔으로 남겨서 그게 마치 '동세의 시공간 덩어리'로 보이게"): every
    // `sec / count` seconds a body leaves itself where it is — its pose there, which stays put while the body walks on —
    // fading and softening with its age, its colours a little more vivid. Where they pile up (standing; the torso of one
    // walking away) they are as dense as one body, where they spread (the swinging limbs; one crossing) they thin: the
    // walk's spacetime mass. No browser exposure, no flicker: a new trace is born under the body and fades in.
    const nNow = nbody;
    let nTrace = 0;
    if (paper && T.on && jobs.length) {
      const count = Math.max(1, Math.round(phone ? T.count / 2 : T.count));
      const every = Math.max(0.02, T.sec / count);
      // the whole set's weight (each trace's strength is its share of it)
      let W = 0;
      for (let j = 0; j < count; j++) W += Math.pow(Math.max(0, 1 - (j + 0.5) / count), T.fall);
      W = Math.max(1e-3, W);
      for (const { p, ai, A } of jobs) {
        if (!p.hist.length) continue;
        const At = Math.min(0.995, A * T.ink);
        const off = frac(p.hash * 7.77) * every;
        const t0 = Math.floor((now - off) / every) * every + off;
        for (let j = 0; j <= count; j++) {
          if (nbody >= MAX_BODIES) break;
          const tau = t0 - j * every, age = now - tau;
          if (age > T.sec) break;
          const hh = histAt(p.hist, tau);
          if (!hh) break;
          const u = age / T.sec;
          const w = smooth01(age / every) * Math.pow(Math.max(0, 1 - u), T.fall);
          if (w < 1e-3) continue;
          const a = 1 - Math.pow(1 - At, w / W);
          // (the saturation written negative marks a trace: the shader colours it by height, cheaply)
          putBody(nbody, poseFor(p, ai, hh.ph, hh.st, hh.cue, tau), p, ai, hh.x, hh.z, hh.h, a, -Math.max(1e-3, 1 + (T.sat - 1) * u), (T.softNow + (T.softOld - T.softNow) * u) / 100);
          nbody++;
          nTrace++;
        }
      }
    }
    // THE VISITOR'S OWN BODY (the artist, 2026-11-22: with the eye at a person's height, must "me" be a square in front
    // of the gaze? — and then how is the melody carried?): their back, a body like the others, walking as they walk;
    // its points go dim while their melody rests and bright on its beats (the square's blink, carried by the body)
    if (selfIn && look.meBody && !boxes && n < MAX_INSTANCES) {
      const m = selfIn.get();
      const speed = Math.hypot(m.vx ?? 0, m.vz ?? 0);
      const s = self.current;
      if (speed > motion.standBelow) s.phase = (s.phase + Math.min(motion.maxCadence, speed / motion.stride) * dt) % 1;
      else {
        const target = s.phase > 0.25 && s.phase < 0.75 ? 0.5 : s.phase < 0.5 ? 0 : 1;
        s.phase += (target - s.phase) * Math.min(1, 6 * dt);
        if (s.phase >= 1) s.phase -= 1;
      }
      const r = selfIn.rhythm();
      const lit = !r || r[stepAt(performance.now())];
      A[n * 4] = m.x;
      A[n * 4 + 1] = 0;
      A[n * 4 + 2] = m.z;
      A[n * 4 + 3] = m.heading;
      B[n * 4] = s.phase;
      B[n * 4 + 1] = lit ? 1 : look.meRest;
      B[n * 4 + 2] = 1 - Math.min(1, speed / motion.standBelow);
      B[n * 4 + 3] = 0.5;
      n++;
    }
    setInstanceCount(geom, n);
    iPos.addUpdateRange(0, n * 4);
    iAnim.addUpdateRange(0, n * 4);
    iPos.needsUpdate = true;
    iAnim.needsUpdate = true;
    setInstanceCount(boxGeom, nb);
    setInstanceCount(bodyGeom, paper && boxes && !fibers && !sprites ? nbody : 0);
    setInstanceCount(depthGeom, paper && boxes && !fibers && !sprites ? nNow : 0);
    setInstanceCount(spriteGeom, paper && sprites ? ns : 0);
    for (const name of ["iA", "iB", "iC"]) {
      const at = sA(name);
      at.addUpdateRange(0, ns * 4);
      at.needsUpdate = true;
    }
    setInstanceCount(fiberGeom, paper && fibers ? nf : 0);
    for (const name of ["iNow", "iMid", "iOld", "iRows"]) {
      const at = fA(name);
      at.addUpdateRange(0, nf * 4);
      at.needsUpdate = true;
    }
    (fiberMat.uniforms.uView.value as THREE.Vector2).set(state.size.width * state.viewport.dpr, state.size.height * state.viewport.dpr);
    setUniforms(fiberMat.uniforms, { uSize: F.sizeMm / 1000, uMinPx: F.minPx * state.viewport.dpr, uScatter: F.scatterCm / 100, uFlyShare: F.flyShare, uFlyM: F.flyM, uFlySpeed: F.flySpeed, uTime: now, uInk: F.ink * look.ink, uTail: F.tail, uSat: F.sat, uColour: look.colour });
    iBodyA.addUpdateRange(0, nbody * 4);
    iBodyB.addUpdateRange(0, nbody * 4);
    iBodyA.needsUpdate = true;
    iBodyB.needsUpdate = true;
    if (nbody) poses.commit();
    setUniforms(bodyMat.uniforms, { uColour: look.colour });
    // (the bodies stand in the scene now — layer 0 — not on InkPaper's exposure layer)
    if (bodyMesh.current) bodyMesh.current.layers.set(0);
    iBox.addUpdateRange(0, nb * 4);
    iBoxAnim.addUpdateRange(0, nb * 4);
    iBox2.addUpdateRange(0, nb * 4);
    iBox3.addUpdateRange(0, nb * 4);
    iBox.needsUpdate = true;
    iBoxAnim.needsUpdate = true;
    iBox2.needsUpdate = true;
    iBox3.needsUpdate = true;
    setUniforms(boxMat.uniforms, { uSheet: sheet, uSheetSoft: sheetSoft, uAspect: look.boxAspect, uRest: look.boxRest, uPaper: paper ? 1 : 0, uInk: look.ink, uFrame: look.frame, uGain: look.exposure, uBody3D: paper ? 1 : 0 });
    // (the windows stand in the scene, layer 0, on paper too)
    if (boxMesh.current) boxMesh.current.layers.set(0);
    // the paper's labels, a few times a second: the nearest three within labelDist
    labelTimer.current += dt;
    if (labelTimer.current > 0.3) {
      labelTimer.current = 0;
      if (paper && look.labelDist > 0) {
        const near: { id: string; x: number; y: number; z: number; d: number }[] = [];
        for (const [id, p] of P) {
          const d = Math.hypot(p.x - me.x, p.z - me.z);
          if (d <= look.labelDist * k && p.alpha > 0.3) near.push({ id, x: p.x, y: heightU * p.hs, z: p.z, d });
        }
        near.sort((a, b) => a.d - b.d);
        const next = near.slice(0, 3).map(({ id, x, y, z }) => ({ id, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) }));
        setLabels((prev) => (prev.length === next.length && prev.every((l, i) => l.id === next[i].id && l.x === next[i].x && l.z === next[i].z) ? prev : next));
      } else if (labels.length) setLabels([]);
      // the bubbles: a square frame with the asker's melody beside whoever has a question open
      const bl: { id: string; x: number; y: number; z: number }[] = [];
      if (look.bubble && look.cue) {
        for (const [id, until] of asking.current) {
          const p = P.get(id);
          if (!p || nowMs >= until || p.alpha <= 0.3) continue;
          if (look.mode === "frames") {
            // (the pictogram: the melody right over its head — where it stands, at its own height, the asker's size)
            const at = framePins.current.get(id) ?? (paper ? p.body : p);
            bl.push({ id, x: +at.x.toFixed(2), y: +(1.72 * (look.frSize ?? 0.7) * (look.frAskScale ?? 1.15) * k).toFixed(2), z: +at.z.toFixed(2) });
          } else bl.push({ id, x: +p.x.toFixed(2), y: +(heightU * p.hs).toFixed(2), z: +p.z.toFixed(2) });
        }
      }
      setBubbles((prev) => (prev.length === bl.length && prev.every((b, i) => b.id === bl[i].id && b.x === bl[i].x && b.z === bl[i].z) ? prev : bl));
    }
    if (plates) {
      plates.count = look.plate ? np : 0;
      if (np) plates.instanceMatrix.needsUpdate = true;
    }
    setUniforms(mat.uniforms, { uBody: body, uSize: look.dot * k, uMaxPx: look.maxPx, uGrey: paper ? 0.08 : look.grey, uBreath: look.breath, uVariety: look.variety, uTime: now, uScale: (state.size.height * state.viewport.dpr) / 2 });
    // a readout for the console (like __parliament): how many bodies and copies are drawn, and the nearest body
    let nearest: { d: number; x: number; z: number; speed: number } | null = null;
    for (const p of P.values()) {
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (!nearest || d < nearest.d) nearest = { d: +d.toFixed(1), x: +p.x.toFixed(1), z: +p.z.toFixed(1), speed: +Math.hypot(p.vx, p.vz).toFixed(2) };
    }
    (window as unknown as { __street?: unknown }).__street = { mode: look.mode, people: P.size, bodies: nNow, traces: nTrace, crowd: CROWD_PARAM, instances: boxes ? nb : n, points, copies, nearest, me: { x: +me.x.toFixed(1), z: +me.z.toFixed(1) } };
  });

  return (
    <>
      {/* (the frames' pictograms draw the people alone: the old windows — on the black ground the boxes with their edge
          lines, "검정바탕에서 보니까... 슬릿 보임" — are not drawn under them) */}
      {look.mode === "frames" ? null : look.mode !== "points" ? <mesh ref={boxMesh} geometry={boxGeom} material={boxMat} frustumCulled={false} renderOrder={9} /> : <points geometry={geom} material={mat} frustumCulled={false} renderOrder={9} />}
      {look.mode === "boxes" && <mesh ref={bodyMesh} geometry={bodyGeom} material={bodyMat} frustumCulled={false} renderOrder={10} />}
      {look.mode === "boxes" && <mesh geometry={depthGeom} material={depthMat} frustumCulled={false} renderOrder={11} />}
      {look.mode === "fibers" && <mesh geometry={fiberGeom} material={fiberMat} frustumCulled={false} renderOrder={10} />}
      {look.mode === "sprites" && <mesh geometry={spriteGeom} material={spriteMat} frustumCulled={false} renderOrder={10} />}
      {/* (frames: the pictograms where these bodies are, read each frame — 2026-11-24) */}
      {look.mode === "frames" && <FramePeopleLayer getList={() => framesList.current} playerPosRef={playerPosRef} unit={k} asking={asking} hop={look.frHop ?? true} askSolid={look.frAskSolid ?? true} askScale={look.frAskScale ?? 1.15} size={look.frSize ?? 0.7} blur={look.frBlur ?? 0} track={look.frTrack ?? 2} trackRadius={look.frTrackRadius ?? 4} pins={framePins} getPeople={() => people.current} paper={look.paper} orbit={look.orbit} />}
      {/* 흰 바탕: the record device's labels — the being's number and a leader line, by the nearest few */}
      {look.paper &&
        labels.map((l) => (
          <Html key={l.id} position={[l.x, l.y, l.z]} style={{ pointerEvents: "none" }} zIndexRange={[5, 0]}>
            <div style={{ transform: "translate(6px, -34px)", width: 26, height: 28, borderLeft: "1px solid #444", borderBottom: "1px solid #444", borderRadius: "0 0 0 1px" }} />
            {/* the name is the melody (the artist: "이름은 봇_숫자가 아니라 멜로디 음형으로") */}
            <div style={{ position: "absolute", left: 34, top: -46, filter: "invert(1)" }}>
              <Glyph dots={glyphOf(l.id)} cell={2} live />
            </div>
          </Html>
        ))}
      {/* the asker's bubble (TD): a square frame with their melody glyph, beating with the bar, beside them while the question is open */}
      {bubbles.map((b) => (
        <Html key={`bubble-${b.id}`} position={[b.x, b.y, b.z]} style={{ pointerEvents: "none" }} zIndexRange={[6, 0]}>
          {/* (pictograms: centred right over the head — the artist, 2026-11-27: "머리랑 바짝 붙어서 떠야") */}
          <div className="hud-blink" style={{ transform: look.mode === "frames" ? "translate(-50%, calc(-100% - 5px))" : "translate(14px, -46px)", border: `1px solid ${look.paper ? "#111" : "#fff"}`, background: look.paper ? "rgba(244,242,236,0.85)" : "rgba(0,0,0,0.6)", padding: "5px 6px", filter: look.paper ? "invert(1)" : undefined }}>
            <Glyph dots={glyphOf(b.id)} cell={3} live />
          </div>
        </Html>
      ))}
      {look.plate && look.mode === "points" && (
        <instancedMesh ref={plateMesh} args={[plateGeom, undefined, MAX_PEOPLE]} frustumCulled={false} renderOrder={8}>
          <meshBasicMaterial color="#ffffff" transparent opacity={look.plateAlpha} depthWrite={false} side={THREE.DoubleSide} fog={fogOn} />
        </instancedMesh>
      )}
    </>
  );
}

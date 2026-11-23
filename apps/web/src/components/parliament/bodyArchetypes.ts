/**
 * bodyArchetypes — WHO WALKS IN THE PRESENT (the artist, 2026-11-23, the mobile view lab · bot (present): "골격이나 움직이는
 * 것들도 레바로 세세하게 조절해보고, 체형 아키타입도 present 에서 만들고 싶음 … 커스텀이나 다양화를 하려고 이 세션을 만든 것").
 *
 * An ARCHETYPE is a kind of body and a way of walking that the artist makes with knobs (labKnobsBotPresent.ts: five
 * slots, each its own folder, saved together): its proportions (legs, torso, shoulders, hips, arms), its girth (trunk, waist, limbs, head), its posture (lean,
 * hunch, head down), its gait over the captured CMU walk (stride, arm swing, bounce, sway, lift, pace), what its arms do
 * (swing, pockets, behind the back, a phone, crossed) and its clothes (hem, hair, colours). Each person of the crowd is one
 * archetype by their hash and the archetypes' shares; inside it they still vary a little (variety).
 *
 * `shapePose` turns a captured pose into the archetype's: everything happens on the joints (CPU, a few dozen flops a
 * joint), so the shared body (bodySheet.ts) only learns the girth (`BodyShape`) and the colours.
 *
 * `bodyTuning` is the live set of values (set by the knobs' hook each render, read by PointPeople each frame): the
 * archetypes, the afterimages (the walk's spacetime mass) and the lab's view.
 */

import type { Joints } from "@/lib/parliament/pointPeople";
import { DEFAULT_FIBER, type FiberLook } from "./fiberBody";

export type ArmStyle = "swing" | "pockets" | "behind" | "phone" | "crossed" | "hips" | "scratch" | "clasp" | "chin";

/** What someone standing does with themselves (gestures; the artist, 2026-11-23: "제스처 다양하게", "가만히 서있거나 정주할 때
 *  제스처도 자연스럽게 좀 다양화"): each standing person
 *  takes one of these for a few seconds, then another, by their hash and the time. "look" turns the body to look round. */
export const STAND_GESTURES: readonly (ArmStyle | "look")[] = ["swing", "pockets", "crossed", "phone", "behind", "hips", "scratch", "look", "clasp", "chin", "pockets", "phone", "look", "swing"];
export type HemChoice = "any" | "waist" | "hip" | "knee";
export type HairChoice = "any" | "short" | "long";

export interface Archetype {
  name: string;
  /** The share of the crowd (0 = nobody). */
  weight: number;
  /** Height (m), head to foot. */
  height: number;
  /** Proportions (× the captured body's): legs, torso, shoulder width, hip width, arm length. The height stays. */
  legs: number;
  torso: number;
  shoulders: number;
  hips: number;
  arms: number;
  /** Girth (×): the trunk, the waist (belly), the limbs, the head. */
  girth: number;
  belly: number;
  limbs: number;
  head: number;
  /** Posture: lean forward (deg), a rounded back (0 … 1), the head bowed (deg). */
  lean: number;
  hunch: number;
  headDown: number;
  /** The captured walk (-1 = each their own by hash; 0 … 3 = one of the four). */
  gait: number;
  /** Gait over the captured walk (×): the stride, the arms' swing, the up-and-down, the side-to-side, the feet's lift. */
  stride: number;
  swing: number;
  bounce: number;
  sway: number;
  lift: number;
  /** Walking speed (×; the test scene's walkers and the body's top speed). */
  pace: number;
  /** What the arms do. */
  armStyle: ArmStyle;
  /** The clothes: the top's hem, the hair, the colours (palette by hash, or these two). */
  hem: HemChoice;
  hair: HairChoice;
  fixedColour: boolean;
  top: string;
  pants: string;
}

const BASE: Archetype = {
  name: "",
  weight: 1,
  height: 1.72,
  legs: 1,
  torso: 1,
  shoulders: 1,
  hips: 1,
  arms: 1,
  girth: 1,
  belly: 1,
  limbs: 1,
  head: 1,
  lean: 0,
  hunch: 0,
  headDown: 0,
  gait: -1,
  stride: 1,
  swing: 1,
  bounce: 1,
  sway: 1,
  lift: 1,
  pace: 1,
  armStyle: "swing",
  hem: "any",
  hair: "any",
  fixedColour: false,
  top: "#1d1d22",
  pants: "#2a3550",
};

/** The five slots' first values (the artist makes her own over them): read off the long-exposure crowds (IMG_1575 · 1576 ·
 *  1580 · 1582 · 1583) — most walk plainly, some tall in long coats with their hands in their pockets, some stocky and
 *  brisk, a few bowed with their hands behind them, a few looking at a phone. */
export const DEFAULT_ARCHETYPES: readonly Archetype[] = [
  { ...BASE, name: "보통", weight: 1 },
  { ...BASE, name: "키 큰 코트", weight: 0.5, height: 1.84, legs: 1.08, torso: 0.97, shoulders: 1.04, girth: 0.92, belly: 0.9, limbs: 0.92, stride: 1.12, swing: 0.6, bounce: 0.8, armStyle: "pockets", hem: "knee", fixedColour: true, top: "#202024", pants: "#18181b" },
  { ...BASE, name: "다부진", weight: 0.45, height: 1.7, legs: 0.94, torso: 1.03, shoulders: 1.14, hips: 1.06, girth: 1.2, belly: 1.15, limbs: 1.18, head: 1.04, stride: 0.92, swing: 1.35, bounce: 1.2, sway: 1.3, pace: 1.12, hem: "hip" },
  { ...BASE, name: "구부정한", weight: 0.25, height: 1.62, legs: 0.96, girth: 1.05, belly: 1.2, lean: 6, hunch: 0.6, headDown: 12, stride: 0.72, swing: 0.4, bounce: 0.6, lift: 0.7, pace: 0.7, armStyle: "behind", hem: "knee", hair: "short" },
  { ...BASE, name: "폰 보는", weight: 0.3, height: 1.68, girth: 0.95, lean: 3, headDown: 22, stride: 0.85, swing: 0.5, pace: 0.82, armStyle: "phone", hem: "waist" },
];
export const ARCHETYPE_SLOTS = DEFAULT_ARCHETYPES.length;

/** The girth the shader takes (bodySheet `BodyShape`). */
export interface BodyShape {
  limbs: number;
  girth: number;
  belly: number;
  head: number;
}

/** THE AFTERIMAGES — the walk left as a spacetime mass (the artist, 2026-11-23: "걸어가는 모습을 잔흔으로 남겨서 그게 마치
 *  '동세의 시공간 덩어리'로 보이게"; not a browser long exposure, and no flicker). */
export interface TrailLook {
  on: boolean;
  /** How long a trace stays (s) and how many are left in that time. */
  sec: number;
  count: number;
  /** The body now (0 … 1 of the full ink) and all the traces together (where they pile up: a standing body is solid). */
  now: number;
  ink: number;
  /** How fast a trace fades with its age (1 = evenly, higher = the older ones go sooner). */
  fall: number;
  /** The edge's softness (cm): the body now, the oldest trace. */
  softNow: number;
  softOld: number;
  /** The colours of the old traces (× saturation; 1 = as the clothes). */
  sat: number;
}

export const DEFAULT_TRAIL: TrailLook = { on: true, sec: 1.2, count: 8, now: 0.6, ink: 0.85, fall: 1.4, softNow: 0.5, softOld: 6, sat: 1.35 };

/** The lab's view of the crowd: every archetype by its share, or only one (on the lab page alone; slot 0 … 4). */
export type ArchetypeView = "all" | number;

/** HOW THEY MOVE between the record's samples (the artist, 2026-11-23: "사이사이 위치 들어오는 간격은 그냥 보간하지 말고
 *  그때그때 장노출 사진처럼 슉슉 남는 게"; "봇 속도 일정 이상이면 뛰어가야"; "제스처 다양하게"). */
export interface MoveLook {
  /** true: at each sample the body sweeps to its new place in `dashSec` and holds there (the fibers leave the sweep);
   *  false: it walks on continuously. */
  stamp: boolean;
  dashSec: number;
  /** Faster than this (m/s) a person runs; how much (0 … 1 = a full run). */
  runFrom: number;
  run: number;
  /** Standing people take a gesture for this many seconds, then another. */
  gestures: boolean;
  gestureSec: number;
}

export const DEFAULT_MOVE: MoveLook = { stamp: true, dashSec: 0.12, runFrom: 2.2, run: 1, gestures: true, gestureSec: 5 };

/** A captured walking pose made a run (amount 0 … 1): longer reach, higher knees and feet, the arms bent at the elbow
 *  and swinging wider, the body leaning in. Applied to the archetype's pose; returns the same object. */
export function runPose(J: Joints, S: Joints, amount: number): Joints {
  if (amount <= 0) return J;
  const k = amount;
  for (const key of ["kneeL", "kneeR", "ankleL", "ankleR", "toeL", "toeR"] as const) {
    J[key][2] = S[key][2] + (J[key][2] - S[key][2]) * (1 + 0.55 * k);
    J[key][1] = S[key][1] + (J[key][1] - S[key][1]) * (1 + 1.4 * k) + (key.startsWith("knee") ? 0.04 * k : 0.03 * k);
  }
  for (const [sh, el, wr] of [["shL", "elbowL", "wristL"], ["shR", "elbowR", "wristR"]] as const) {
    // the swing wider, then the forearm bent up ~80° about the elbow
    for (const q of [el, wr] as const) for (let i = 0; i < 3; i++) J[q][i] = J[sh][i] + (S[q][i] - S[sh][i]) + (J[q][i] - J[sh][i] - (S[q][i] - S[sh][i])) * (1 + 0.9 * k);
    const f: V = sub(J[wr], J[el]);
    const ang = -1.35 * k;
    const c = Math.cos(ang), s = Math.sin(ang);
    J[wr][1] = J[el][1] + f[1] * c - f[2] * s;
    J[wr][2] = J[el][2] + f[2] * c + f[1] * s;
  }
  const lean = (12 * k * Math.PI) / 180;
  const pivot: V = [J.pelvis[0], J.pelvis[1] - 0.05, J.pelvis[2]];
  for (const key of ["shoulders", "head", "shL", "shR", "elbowL", "elbowR", "wristL", "wristR"] as const) rotX(J[key], pivot, lean);
  return J;
}

export const bodyTuning: { archetypes: Archetype[]; trail: TrailLook; view: ArchetypeView; fiber: FiberLook; move: MoveLook } = {
  archetypes: DEFAULT_ARCHETYPES.map((a) => ({ ...a })),
  fiber: { ...DEFAULT_FIBER },
  move: { ...DEFAULT_MOVE },
  trail: { ...DEFAULT_TRAIL },
  view: "all",
};
// (a handle for the console and the headless checks, like __street: the live values to read — the knobs' hook rewrites
// them on every render, so a value written here lasts only until then)
if (typeof window !== "undefined") (window as unknown as { __bodyTuning?: typeof bodyTuning }).__bodyTuning = bodyTuning;

const frac = (x: number) => x - Math.floor(x);

/** The archetype (slot index) of a person by their hash and the shares; -1 when every share is 0. */
export function archetypeIndexOf(hash: number, archetypes: readonly Archetype[], view: ArchetypeView = "all"): number {
  if (view !== "all" && view >= 0 && view < archetypes.length) return view;
  let total = 0;
  for (const a of archetypes) total += Math.max(0, a.weight);
  if (total <= 0) return -1;
  let u = frac(hash * 97.13 + 0.31) * total;
  for (let i = 0; i < archetypes.length; i++) {
    u -= Math.max(0, archetypes[i].weight);
    if (u < 0) return i;
  }
  return archetypes.length - 1;
}

/** How much farther a step reaches with this archetype (stride × legs, at its normalised height): the phase's pace. */
export function strideScaleOf(a: Archetype): number {
  return a.stride * a.legs * heightNorm(a);
}

/** The captured body's top of the head grows with longer legs and torso: this brings it back (the height is the knob's). */
function heightNorm(a: Archetype): number {
  const grow = 0.81 * (a.legs - 1) + 0.63 * (a.torso - 1);
  return 1.55 / Math.max(0.5, 1.55 + grow);
}

type V = [number, number, number];
const UPPER = ["pelvis", "shoulders", "head", "shL", "shR", "elbowL", "elbowR", "wristL", "wristR"] as const;
const LEGS = ["hipL", "hipR", "kneeL", "kneeR", "ankleL", "ankleR", "toeL", "toeR"] as const;

function rotX(p: V, pivot: V, ang: number): void {
  const c = Math.cos(ang), s = Math.sin(ang);
  const y = p[1] - pivot[1], z = p[2] - pivot[2];
  p[1] = pivot[1] + y * c - z * s;
  p[2] = pivot[2] + z * c + y * s;
}

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addTo = (p: V, d: V): void => {
  p[0] += d[0];
  p[1] += d[1];
  p[2] += d[2];
};
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);

/** Put a two-bone arm through targets with its own lengths (the elbow's and the wrist's directions kept). */
function reach(sh: V, elbow: V, wrist: V, eT: V, wT: V, upper: number, fore: number): void {
  const de = sub(eT, sh), le = Math.max(1e-4, len(de));
  for (let i = 0; i < 3; i++) elbow[i] = sh[i] + (de[i] / le) * upper;
  const dw = sub(wT, elbow), lw = Math.max(1e-4, len(dw));
  for (let i = 0; i < 3; i++) wrist[i] = elbow[i] + (dw[i] / lw) * fore;
}

/**
 * A captured pose (`P`, from bodySheet.poseOf) made the archetype's. `S` is the same walker's standing pose (the gait's
 * knobs scale the motion's distance from it); `moving` 0 standing … 1 walking (the arms' styles keep a little swing only
 * while walking). Returns a new pose; the inputs are left alone.
 */
export function shapePose(P: Joints, S: Joints, a: Archetype, moving: number): Joints {
  const J = {} as Joints;
  for (const k of Object.keys(P) as (keyof Joints)[]) J[k] = [P[k][0], P[k][1], P[k][2]];

  // ── the gait: scale the motion's distance from standing ──
  // the whole body's bob and sway (pelvis, hips and above move together; the knees half; the feet stay on the ground)
  const bob = (a.bounce - 1) * (P.pelvis[1] - S.pelvis[1]);
  const sway = (a.sway - 1) * (P.pelvis[0] - S.pelvis[0]);
  for (const k of [...UPPER, "hipL", "hipR"] as const) {
    J[k][1] += bob;
    J[k][0] += sway;
  }
  for (const k of ["kneeL", "kneeR"] as const) {
    J[k][1] += bob * 0.5;
    J[k][0] += sway * 0.5;
  }
  // the legs: the stride's reach (z) and the feet's lift (y above the ground)
  for (const k of LEGS) {
    if (k === "hipL" || k === "hipR") continue;
    J[k][2] = S[k][2] + (J[k][2] - S[k][2]) * a.stride;
    if (k === "kneeL" || k === "kneeR") J[k][1] = S[k][1] + (J[k][1] - S[k][1]) * a.lift;
    else {
      const floor = k === "ankleL" || k === "ankleR" ? 0.068 : 0.008;
      J[k][1] = floor + Math.max(0, J[k][1] - floor) * a.lift;
    }
  }
  // the arms' swing about their shoulder
  for (const [sh, el, wr] of [["shL", "elbowL", "wristL"], ["shR", "elbowR", "wristR"]] as const) {
    for (const k of [el, wr] as const) {
      const rel = sub(J[k], J[sh]), relS = sub(S[k], S[sh]);
      for (let i = 0; i < 3; i++) J[k][i] = J[sh][i] + relS[i] + (rel[i] - relS[i]) * a.swing;
    }
  }

  // ── the proportions ──
  const pel = J.pelvis;
  const hipY = 0.5 * (J.hipL[1] + J.hipR[1]);
  // hips wider or narrower: each leg moves with its hip (the feet a little less)
  for (const [hip, chain] of [["hipL", ["kneeL", "ankleL", "toeL"]], ["hipR", ["kneeR", "ankleR", "toeR"]]] as const) {
    const dx = (J[hip][0] - pel[0]) * (a.hips - 1);
    J[hip][0] += dx;
    J[chain[0]][0] += dx;
    J[chain[1]][0] += dx * 0.8;
    J[chain[2]][0] += dx * 0.8;
  }
  // legs longer or shorter: the leg's heights and reach scale, everything above rises with the hips
  for (const k of LEGS) {
    J[k][1] *= a.legs;
    J[k][2] = pel[2] + (J[k][2] - pel[2]) * a.legs;
  }
  const rise = hipY * (a.legs - 1);
  for (const k of UPPER) J[k][1] += rise;
  // the torso longer or shorter (the arms ride on their shoulders)
  const py = J.pelvis[1];
  for (const [k, arm] of [["shoulders", null], ["head", null], ["shL", ["elbowL", "wristL"]], ["shR", ["elbowR", "wristR"]]] as const) {
    const dy = (J[k][1] - py) * (a.torso - 1);
    J[k][1] += dy;
    if (arm) for (const q of arm) J[q][1] += dy;
  }
  // shoulders wider or narrower (the arms move with them)
  for (const [sh, el, wr] of [["shL", "elbowL", "wristL"], ["shR", "elbowR", "wristR"]] as const) {
    const dx = (J[sh][0] - J.shoulders[0]) * (a.shoulders - 1);
    J[sh][0] += dx;
    J[el][0] += dx;
    J[wr][0] += dx;
  }
  // the arms longer or shorter
  for (const [sh, el, wr] of [["shL", "elbowL", "wristL"], ["shR", "elbowR", "wristR"]] as const) {
    const fore = sub(J[wr], J[el]);
    for (let i = 0; i < 3; i++) J[el][i] = J[sh][i] + (J[el][i] - J[sh][i]) * a.arms;
    for (let i = 0; i < 3; i++) J[wr][i] = J[el][i] + fore[i] * a.arms;
  }

  // ── what the arms do ──
  if (a.armStyle !== "swing") {
    const keep = 0.14 * moving; // a little of the swing stays while walking
    for (const s of [1, -1] as const) {
      const sh = s > 0 ? J.shL : J.shR, el = s > 0 ? J.elbowL : J.elbowR, wr = s > 0 ? J.wristL : J.wristR;
      const upper = len(sub(el, sh)), fore = len(sub(wr, el));
      const L = (upper + fore) / 0.52;
      let eT: V, wT: V;
      if (a.armStyle === "pockets") {
        eT = [sh[0] + s * 0.035 * L, sh[1] - 0.265 * L, sh[2] - 0.05 * L];
        wT = [sh[0] + s * 0.015 * L, sh[1] - 0.45 * L, sh[2] + 0.07 * L];
      } else if (a.armStyle === "behind") {
        eT = [sh[0] + s * 0.02 * L, sh[1] - 0.24 * L, sh[2] - 0.1 * L];
        wT = [J.pelvis[0] + s * 0.035, sh[1] - 0.4 * L, J.pelvis[2] - 0.17];
      } else if (a.armStyle === "crossed") {
        eT = [sh[0] + s * 0.03 * L, sh[1] - 0.22 * L, sh[2] + 0.1 * L];
        wT = [J.shoulders[0] - s * 0.13, sh[1] - 0.16 * L, sh[2] + 0.19 * L];
      } else if (a.armStyle === "hips") {
        // hands on the hips, elbows out
        eT = [sh[0] + s * 0.2 * L, sh[1] - 0.2 * L, sh[2] - 0.02 * L];
        wT = [J.pelvis[0] + s * 0.17, J.pelvis[1] + 0.06, J.pelvis[2] + 0.02];
      } else if (a.armStyle === "clasp") {
        // the hands held together in front, low
        eT = [sh[0] + s * 0.05 * L, sh[1] - 0.25 * L, sh[2] + 0.03 * L];
        wT = [J.pelvis[0] + s * 0.03, J.pelvis[1] - 0.02, J.pelvis[2] + 0.16];
      } else if (a.armStyle === "chin") {
        // the right hand at the chin, the left arm across under its elbow
        if (s < 0) {
          eT = [sh[0] + 0.06 * L, sh[1] - 0.2 * L, sh[2] + 0.12 * L];
          wT = [J.head[0] - 0.02, J.head[1] - 0.04, J.head[2] + 0.12];
        } else {
          eT = [sh[0] + 0.03 * L, sh[1] - 0.24 * L, sh[2] + 0.08 * L];
          wT = [J.shoulders[0] - 0.12, sh[1] - 0.22 * L, sh[2] + 0.17 * L];
        }
      } else if (a.armStyle === "scratch") {
        // the right hand to the back of the head; the left hangs
        if (s < 0) {
          eT = [sh[0] - 0.14 * L, sh[1] + 0.06 * L, sh[2] + 0.05 * L];
          wT = [J.head[0] - 0.04, J.head[1] + 0.12, J.head[2] - 0.05];
        } else continue;
      } else {
        // a phone in the right hand before the chest; the left arm hangs, swinging less
        if (s < 0) {
          eT = [sh[0] + 0.04 * L, sh[1] - 0.24 * L, sh[2] + 0.07 * L];
          wT = [sh[0] + 0.11 * L, sh[1] - 0.17 * L, sh[2] + 0.3 * L];
        } else continue;
      }
      const elS = [...el] as V, wrS = [...wr] as V;
      reach(sh, el, wr, eT, wT, upper, fore);
      for (let i = 0; i < 3; i++) {
        el[i] += (elS[i] - el[i]) * keep;
        wr[i] += (wrS[i] - wr[i]) * keep;
      }
    }
  }

  // ── the posture: lean the upper body forward about the hips, round the back, bow the head ──
  const lean = (a.lean * Math.PI) / 180;
  if (lean !== 0) {
    const pivot: V = [J.pelvis[0], J.pelvis[1] - 0.05, J.pelvis[2]];
    for (const k of ["shoulders", "head", "shL", "shR", "elbowL", "elbowR", "wristL", "wristR"] as const) rotX(J[k], pivot, lean);
  }
  if (a.hunch > 0) {
    const fwd: V = [0, -0.03 * a.hunch, 0.06 * a.hunch];
    for (const k of ["shL", "shR", "elbowL", "elbowR", "wristL", "wristR"] as const) addTo(J[k], fwd);
    addTo(J.shoulders, [0, -0.015 * a.hunch, 0.04 * a.hunch]);
  }
  const bow = ((a.headDown + 28 * a.hunch + (a.armStyle === "phone" ? 8 : 0)) * Math.PI) / 180;
  if (bow !== 0) rotX(J.head, J.shoulders, bow);

  // ── the height stays the knob's: longer legs or torso do not make a taller person ──
  const f = heightNorm(a);
  if (f !== 1) for (const k of Object.keys(J) as (keyof Joints)[]) for (let i = 0; i < 3; i++) J[k][i] *= f;
  return J;
}

/** "#rrggbb" → linear RGB (0 … 1). */
export function hexToLinear(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x808080;
  const c = (v: number) => Math.pow(v / 255, 2.2);
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}

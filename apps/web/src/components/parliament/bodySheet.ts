/**
 * bodySheet — THE PERSON'S BODY, shared by the personal view's people (street-feel, PointPeople.tsx) and the future's
 * observers (future-presence). Owned by the street-feel session; future-presence reads it. (The name stays from the first
 * agreement, a 2D sheet; the body is now 3D — the artist, 2026-11-23: "옆모습도 기울임이 아니라 내 위치 따라 자연스러웠으면".)
 *
 * The body is seen from wherever the visitor stands: a SMOOTH SIGNED-DISTANCE BODY (no mesh, no asset), ray-marched per
 * person inside a box that bounds them, its bones the CMU walks (lib/parliament/walkCycles.json): a real stride's asymmetry
 * and weight shift. The limbs are tapered cones melted into each other (smooth union), the clothes are shapes over them (a
 * top to the waist, a jacket to the hip, a coat to the knee), the head an ellipsoid with its hair; so the silhouette is one
 * surface, not capsules joined. No outline, no paint: on the white ground the body is an ABSORPTION drawn into the long
 * exposure's feedback (InkPaper), which alone smears it.
 *
 * What it gives:
 *   - `BodyPoses`: a float texture, one row a person — 17 joints in metres (feet on y = 0, facing +z, pelvis over the
 *     origin), then one texel of that person's build, cut and palette. `write(row, pose, person)` each frame.
 *   - `poseOf(...)`: a person's joints now — a CMU cycle at a phase, settling to a stand, or the asker's wave.
 *   - `BODY_GLSL`: the body as GLSL (`loadPose`, `bodyDist`, `bodyPart`, `marchBody`) for any shader that wants it.
 *   - `makeBodyGeometry` / `makeBodyMaterial({ mode })`: an instanced box a person; "exposure" writes the absorption into
 *     the feedback (PointPeople), "mask" writes the coverage alone — a silhouette for a window (future-presence).
 *   - The clothes: `cutOf`, `paletteIndexOf`, `paletteOf`, `personCode` (by a person's hash, the same person everywhere).
 */

import * as THREE from "three";
import { WALK_CYCLES, WAVE_STYLE, jointsAt, type Joints, type WalkCycle } from "@/lib/parliament/pointPeople";

/** The joints in the pose texture's order. */
export const BODY_JOINTS = ["pelvis", "shoulders", "head", "hipL", "hipR", "kneeL", "kneeR", "ankleL", "ankleR", "toeL", "toeR", "shL", "shR", "elbowL", "elbowR", "wristL", "wristR"] as const satisfies readonly (keyof Joints)[];
export const JOINT_COUNT = BODY_JOINTS.length;
/** Texels a person: the joints, then (build, cut code, palette code, 0). */
export const POSE_TEXELS = JOINT_COUNT + 1;

/** The body's box in its own metres (x across, y up, z forward): the stride, the arms' swing and a coat's flare fit. */
export const BODY_BOX = { min: [-0.45, -0.03, -0.66] as const, max: [0.45, 1.86, 0.66] as const };

// ---------------------------------------------------------------- the clothes

/** The hems in metres from the ground (a 1.7 m body): where the top ends and the pants show. */
export const HEMS = { waist: 0.95, hip: 0.8, thigh: 0.52 };

/** The clothes' colours (sRGB 0 … 1), read off the references (IMG_1575 · 1576 · 1580). */
export const TOPS: readonly [number, number, number][] = [
  [0.09, 0.09, 0.1], // black coat
  [0.14, 0.17, 0.3], // navy
  [0.28, 0.29, 0.31], // charcoal
  [0.78, 0.62, 0.42], // camel
  [0.93, 0.92, 0.9], // white shirt
  [0.3, 0.45, 0.72], // a blue
  [0.66, 0.24, 0.2], // brick red
  [0.85, 0.66, 0.2], // mustard
  [0.55, 0.6, 0.5], // sage
  [0.9, 0.5, 0.6], // a pink
];
export const PANTS: readonly [number, number, number][] = [
  [0.1, 0.1, 0.12], // black
  [0.24, 0.32, 0.5], // denim
  [0.45, 0.52, 0.66], // light denim
  [0.55, 0.5, 0.4], // khaki
  [0.9, 0.88, 0.84], // white
  [0.22, 0.22, 0.24], // dark grey
  [0.5, 0.26, 0.2], // rust
];
export const HAIRS: readonly [number, number, number][] = [
  [0.07, 0.06, 0.06],
  [0.2, 0.13, 0.08],
  [0.45, 0.32, 0.2],
  [0.72, 0.6, 0.42], // fair
];
export const SKINS: readonly [number, number, number][] = [
  [0.95, 0.82, 0.72],
  [0.88, 0.7, 0.56],
  [0.72, 0.52, 0.38],
  [0.45, 0.3, 0.22],
];

const frac = (x: number) => x - Math.floor(x);

/** One person's cut (by their hash 0 … 1): the hem (0 waist · 1 hip · 2 knee), short sleeves, long hair, and the code
 *  the shader takes (hem + 3 × sleeve + 6 × hair). Jackets and coats are commoner than shirts; short sleeves rare. */
export function cutOf(hash: number): { hem: 0 | 1 | 2; shortSleeve: 0 | 1; longHair: 0 | 1; code: number } {
  const h = frac(hash * 53.77);
  const hem: 0 | 1 | 2 = h < 0.3 ? 0 : h < 0.7 ? 1 : 2;
  const shortSleeve: 0 | 1 = frac(hash * 61.03) < 0.15 ? 1 : 0;
  const longHair: 0 | 1 = frac(hash * 71.33) < 0.45 ? 1 : 0;
  return { hem, shortSleeve, longHair, code: hem + 3 * shortSleeve + 6 * longHair };
}

/** One person's palette as indices into TOPS / PANTS / HAIRS / SKINS, and the four packed in one number. */
export function paletteIndexOf(hash: number): { top: number; pants: number; hair: number; skin: number; code: number } {
  const top = Math.floor(frac(hash * 17.13) * TOPS.length);
  const pants = Math.floor(frac(hash * 23.71) * PANTS.length);
  const hair = Math.floor(frac(hash * 31.37) * HAIRS.length);
  const skin = Math.floor(frac(hash * 43.19) * SKINS.length);
  return { top, pants, hair, skin, code: top + 16 * (pants + 8 * (hair + 4 * skin)) };
}

/** One person's palette as colours (sRGB 0 … 1). */
export function paletteOf(hash: number): { top: [number, number, number]; pants: [number, number, number]; hair: [number, number, number]; skin: [number, number, number] } {
  const i = paletteIndexOf(hash);
  return { top: TOPS[i.top], pants: PANTS[i.pants], hair: HAIRS[i.hair], skin: SKINS[i.skin] };
}

/** The palettes in linear light, for `uTops[10] · uPants[7] · uHairs[4] · uSkins[4]` (makeBodyMaterial sets them). */
function paletteUniforms(): Record<string, { value: THREE.Vector3[] }> {
  const lin = (c: readonly [number, number, number]) => new THREE.Vector3(...c.map((x) => Math.pow(x, 2.2)));
  return { uTops: { value: TOPS.map(lin) }, uPants: { value: PANTS.map(lin) }, uHairs: { value: HAIRS.map(lin) }, uSkins: { value: SKINS.map(lin) } };
}

// ---------------------------------------------------------------- the pose

/** The mean of a cycle's frames: the feet under the body, the arms hanging — how this walker stands. */
const standCache = new WeakMap<WalkCycle, Joints>();
function standOf(cycle: WalkCycle): Joints {
  let s = standCache.get(cycle);
  if (s) return s;
  s = {} as Joints;
  for (const k of BODY_JOINTS) {
    const fr = cycle.joints[k];
    const m: [number, number, number] = [0, 0, 0];
    for (const v of fr) for (let i = 0; i < 3; i++) m[i] += v[i] / fr.length;
    s[k] = m;
  }
  // the mean of a walk puts the feet near the midline (where walking feet land): a person standing has them under the
  // hips, so the legs stand apart and the gap between them shows from behind (IMG_1575)
  for (const [hip, knee, ankle, toe] of [["hipL", "kneeL", "ankleL", "toeL"], ["hipR", "kneeR", "ankleR", "toeR"]] as const) {
    const hx = s[hip][0], out = Math.sign(hx) * 0.02;
    s[knee][0] = hx * 0.94;
    s[toe][0] += hx * 0.92 - s[ankle][0] + out;
    s[ankle][0] = hx * 0.92;
  }
  standCache.set(cycle, s);
  return s;
}

/**
 * A person's joints now (metres, a 1.7 m body, facing +z): the captured cycle at `phase`, blended towards how that walker
 * stands by `stand` (0 walking … 1 standing); or the wave (the one who asks me) when `wave`.
 */
export function poseOf(cycle: WalkCycle | undefined, phase: number, stand = 0, wave = false): Joints {
  if (wave || !cycle) return jointsAt(phase, WAVE_STYLE);
  const n = cycle.frames;
  const f = (((phase % 1) + 1) % 1) * n;
  const i0 = Math.floor(f) % n, i1 = (i0 + 1) % n, t = f - Math.floor(f);
  const st = standOf(cycle);
  const out = {} as Joints;
  for (const k of BODY_JOINTS) {
    const a = cycle.joints[k][i0], b = cycle.joints[k][i1], s = st[k];
    const at = (i: number) => {
      const w = a[i] + (b[i] - a[i]) * t;
      return w + (s[i] - w) * stand;
    };
    out[k] = [at(0), at(1), at(2)];
  }
  return out;
}

/** The walking cycle of a person by their hash (each walks one of the captured gaits). */
export function cycleOf(hash: number): WalkCycle | undefined {
  return WALK_CYCLES.length ? WALK_CYCLES[Math.floor(frac(hash * 29.7) * WALK_CYCLES.length)] : undefined;
}

/** A person's one number for the shader's last texel: their cut and palette (exact in a float). */
export function personCode(hash: number): { cut: number; palette: number } {
  return { cut: cutOf(hash).code, palette: paletteIndexOf(hash).code };
}

/** The poses of up to `rows` people, as a float texture (`uPoses`). Write each frame, then `commit()`. */
export class BodyPoses {
  readonly rows: number;
  readonly data: Float32Array;
  readonly texture: THREE.DataTexture;
  constructor(rows = 128) {
    this.rows = rows;
    this.data = new Float32Array(POSE_TEXELS * rows * 4);
    this.texture = new THREE.DataTexture(this.data, POSE_TEXELS, rows, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
  }
  /** Row `row`: the joints (metres), the build (1 = average width) and the person's cut and palette codes. */
  write(row: number, J: Joints, build: number, code: { cut: number; palette: number }): void {
    if (row < 0 || row >= this.rows) return;
    const o = row * POSE_TEXELS * 4;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const v = J[BODY_JOINTS[j]];
      this.data[o + j * 4] = v[0];
      this.data[o + j * 4 + 1] = v[1];
      this.data[o + j * 4 + 2] = v[2];
      this.data[o + j * 4 + 3] = 1;
    }
    const p = o + JOINT_COUNT * 4;
    this.data[p] = build;
    this.data[p + 1] = code.cut;
    this.data[p + 2] = code.palette;
    this.data[p + 3] = 0;
  }
  commit(): void {
    this.texture.needsUpdate = true;
  }
  dispose(): void {
    this.texture.dispose();
  }
}

// ---------------------------------------------------------------- the GLSL

/**
 * The body in GLSL. Declares `uPoses` (the BodyPoses texture) and the globals the functions share; call `loadPose(row)`
 * once a fragment, then `bodyDist(p)` / `bodyPart(p)` / `marchBody(...)` with p in the person's metres.
 */
export const BODY_GLSL = /* glsl */ `
uniform sampler2D uPoses;
vec3 J[${JOINT_COUNT}];
float bBuild;
float bHemY;
float bShort;
float bLong;
float bPalette;
void loadPose(float row) {
  int r = int(row + 0.5);
  ${BODY_JOINTS.map((_, i) => `J[${i}] = texelFetch(uPoses, ivec2(${i}, r), 0).xyz;`).join("\n  ")}
  vec4 q = texelFetch(uPoses, ivec2(${JOINT_COUNT}, r), 0);
  bBuild = q.x > 0.0 ? q.x : 1.0;
  float cut = q.y;
  bLong = floor(cut / 6.0 + 0.001);
  float rest = cut - bLong * 6.0;
  bShort = floor(rest / 3.0 + 0.001);
  float hem = rest - bShort * 3.0;
  bHemY = hem < 0.5 ? ${HEMS.waist.toFixed(3)} : (hem < 1.5 ? ${HEMS.hip.toFixed(3)} : ${HEMS.thigh.toFixed(3)});
  bPalette = q.z;
}
// a tapered capsule, radius r1 at a, r2 at b (not exact for a strong taper; the march steps 0.9 of it)
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - mix(r1, r2, h);
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
// the trunk is deeper than wide's half: squash z about the spine
float sdTrunk(vec3 p, vec3 a, vec3 b, float r1, float r2, float squash) {
  vec3 q = p;
  q.z = a.z + (p.z - a.z) * squash;
  vec3 b2 = b;
  b2.z = a.z + (b.z - a.z) * squash;
  return sdRoundCone(q, a, b2, r1, r2) / squash;
}
const vec3 HEAD_C = vec3(0.0, 0.05, 0.03);
// the groups, unmelted (for the part), each its own function (a dispatch by index kept the compiler from inlining)
float gTrunk(vec3 p) {
  vec3 pel = J[0], sho = J[1];
  // the chest wider than the waist (seen from behind a back narrows before the hips)
  float d = sdTrunk(p, pel + vec3(0.0, 0.1, 0.0), sho - vec3(0.0, 0.1, 0.0), 0.128, 0.165, 1.45);
  // the shoulders slope from the neck's base down to each shoulder (a flat bar across read as a coat hanger)
  vec3 nb = 0.5 * (J[11] + J[12]) + vec3(0.0, 0.03, 0.0);
  d = smin(d, min(sdRoundCone(p, nb, J[11] - vec3(0.0, 0.02, 0.0), 0.06, 0.06), sdRoundCone(p, nb, J[12] - vec3(0.0, 0.02, 0.0), 0.06, 0.06)), 0.08);
  // the hips: a little inside the hip joints and above them, so the crotch is at ~0.8 m and the legs part below it
  vec3 hc = 0.5 * (J[3] + J[4]) + vec3(0.0, 0.045, 0.0), hh = 0.425 * (J[3] - J[4]);
  d = smin(d, sdCapsule(p, hc + hh, hc - hh, 0.095), 0.08);
  if (bHemY < 0.9) {
    // a jacket or a coat: from the chest to the hem, flaring a little, CUT at the hem (its round end would have filled
    // the space between the legs below it in the trousers' colour)
    vec3 hemC = vec3(pel.x, bHemY, pel.z);
    float flare = bHemY < 0.6 ? 0.205 : 0.19;
    float jk = max(sdTrunk(p, hemC, sho - vec3(0.0, 0.14, 0.0), flare, 0.175, 1.35), bHemY - p.y);
    d = smin(d, jk, 0.06);
  }
  return d;
}
float gUpperArms(vec3 p) { return min(sdRoundCone(p, J[11], J[13], 0.058, 0.047), sdRoundCone(p, J[12], J[14], 0.058, 0.047)); }
float gForearms(vec3 p) { return min(sdRoundCone(p, J[13], J[15], 0.046, 0.036), sdRoundCone(p, J[14], J[16], 0.046, 0.036)); }
float gHands(vec3 p) {
  vec3 hl = J[15] + normalize(J[15] - J[13] + vec3(1e-4)) * 0.06;
  vec3 hr = J[16] + normalize(J[16] - J[14] + vec3(1e-4)) * 0.06;
  return min(sdEllipsoid(p - hl, vec3(0.032, 0.05, 0.04)), sdEllipsoid(p - hr, vec3(0.032, 0.05, 0.04)));
}
float gLegs(vec3 p) {
  float l = smin(sdRoundCone(p, J[3], J[5], 0.08, 0.056), sdRoundCone(p, J[5], J[7], 0.055, 0.04), 0.03);
  float r = smin(sdRoundCone(p, J[4], J[6], 0.08, 0.056), sdRoundCone(p, J[6], J[8], 0.055, 0.04), 0.03);
  return min(l, r);
}
float gShoes(vec3 p) {
  vec3 tl = J[9] + vec3(0.0, 0.02, 0.0), tr = J[10] + vec3(0.0, 0.02, 0.0);
  return min(sdRoundCone(p, J[7] - vec3(0.0, 0.02, 0.03), tl, 0.048, 0.04), sdRoundCone(p, J[8] - vec3(0.0, 0.02, 0.03), tr, 0.048, 0.04));
}
// (the captured "head" joint is the skull's base, 1.55 m on a 1.7 m body: the head's centre is above and a little forward)
float gHead(vec3 p) { return sdEllipsoid(p - (J[2] + HEAD_C), vec3(0.08, 0.108, 0.098)); }
float gNeck(vec3 p) { return sdRoundCone(p, J[1] - vec3(0.0, 0.03, 0.0), J[2] + vec3(0.0, -0.01, 0.01), 0.058, 0.05); }
// long hair: from the crown down behind the neck to the shoulders
float gHair(vec3 p) { return bLong < 0.5 ? 1e3 : sdRoundCone(p, J[2] + vec3(0.0, 0.06, -0.025), J[1] + vec3(0.0, 0.0, -0.065), 0.084, 0.09); }
// a LOWER BOUND of bodyDist: capsules that enclose the trunk with the head, each arm and each leg with its foot —
// far from all of them the march steps by this and never evaluates the body
float bodyBound(vec3 p) {
  p.x = J[0].x + (p.x - J[0].x) / bBuild;
  float d = sdCapsule(p, vec3(J[0].x, min(bHemY, 0.8) - 0.1, J[0].z), J[2] + vec3(0.0, 0.08, 0.02), 0.32);
  d = min(d, sdCapsule(p, J[11], J[15], 0.13));
  d = min(d, sdCapsule(p, J[12], J[16], 0.13));
  d = min(d, sdCapsule(p, J[3], J[7], 0.13));
  d = min(d, sdCapsule(p, J[4], J[8], 0.13));
  d = min(d, sdCapsule(p, J[7], J[9], 0.09));
  d = min(d, sdCapsule(p, J[8], J[10], 0.09));
  return d * min(bBuild, 1.0);
}
float bodyDist(vec3 p) {
  // the build: wider or narrower across (x), the distance kept conservative
  p.x = J[0].x + (p.x - J[0].x) / bBuild;
  float d = gTrunk(p);
  d = smin(d, gUpperArms(p), 0.03);
  d = smin(d, gForearms(p), 0.02);
  d = smin(d, gHands(p), 0.02);
  d = smin(d, gLegs(p), 0.04);
  d = smin(d, gShoes(p), 0.03);
  d = smin(d, gNeck(p), 0.04);
  d = smin(d, gHead(p), 0.04);
  d = smin(d, gHair(p), 0.03);
  return d * min(bBuild, 1.0);
}
// which part a point of the surface is: 0 top · 1 pants · 2 skin · 3 dark (hair, shoes)
int bodyPart(vec3 p) {
  p.x = J[0].x + (p.x - J[0].x) / bBuild;
  int best = 0;
  float bd = gTrunk(p), d;
  d = gUpperArms(p); if (d < bd) { bd = d; best = 1; }
  d = gForearms(p); if (d < bd) { bd = d; best = 2; }
  d = gHands(p); if (d < bd) { bd = d; best = 3; }
  d = gLegs(p); if (d < bd) { bd = d; best = 4; }
  d = gShoes(p); if (d < bd) { bd = d; best = 5; }
  d = gHead(p); if (d < bd) { bd = d; best = 6; }
  d = gNeck(p); if (d < bd) { bd = d; best = 7; }
  d = gHair(p); if (d < bd) { bd = d; best = 8; }
  if (best == 0) return p.y > bHemY ? 0 : 1;
  if (best == 1) return 0;
  if (best == 2) return bShort > 0.5 ? 2 : 0;
  if (best == 3) return 2;
  if (best == 4) return p.y > bHemY ? 0 : 1;
  if (best == 5) return 3;
  if (best == 6) {
    vec3 h = p - (J[2] + HEAD_C);
    // the face: the front, below the hairline; the rest is hair
    return (h.z > 0.03 && h.y < 0.035) ? 2 : 3;
  }
  if (best == 7) return (bLong > 0.5 && p.z < J[2].z) ? 3 : 2;
  return 3;
}
// a ray through the person's box (metres): the coverage of the pixel (by the nearest approach, antialiased with the
// pixel's own footprint) and the point it is nearest at
float marchBody(vec3 ro, vec3 rd, float pixAng, out vec3 at) {
  vec3 bmin = vec3(${BODY_BOX.min.join(", ")});
  vec3 bmax = vec3(${BODY_BOX.max.join(", ")});
  vec3 inv = 1.0 / (rd + vec3(1e-6));
  vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float tN = max(max(tn.x, tn.y), max(tn.z, 0.0));
  float tF = min(min(tf.x, tf.y), tf.z);
  at = ro;
  if (tF <= tN) return 0.0;
  float t = tN, minD = 1e5, tAt = tN;
  bool hit = false;
  for (int i = 0; i < 40; i++) {
    vec3 p = ro + rd * t;
    float fp = pixAng * t;
    float d = bodyBound(p);
    if (d < 0.06) d = bodyDist(p);
    if (d < minD) { minD = d; tAt = t; }
    if (d < fp * 0.5) { hit = true; break; }
    t += max(d * 0.9, fp * 0.6);
    if (t > tF) break;
  }
  at = ro + rd * tAt;
  if (hit) return 1.0;
  float fp = max(pixAng * tAt, 1e-4);
  return 1.0 - smoothstep(fp * 0.5, fp * 1.5, minD);
}
vec3 bodyNormal(vec3 p) {
  const vec2 e = vec2(0.006, -0.006);
  return normalize(e.xyy * bodyDist(p + e.xyy) + e.yyx * bodyDist(p + e.yyx) + e.yxy * bodyDist(p + e.yxy) + e.xxx * bodyDist(p + e.xxx));
}
`;

// ---------------------------------------------------------------- the mesh

const BODY_VERT = /* glsl */ `
attribute vec4 iBody;   // world x, z, heading (rad; forward = (sin h, 0, cos h)), world units a metre (× this person's height)
attribute vec4 iBody2;  // pose row, alpha, ink ×, 0
varying vec3 vWorld;
varying vec4 vB;
varying vec4 vB2;
void main() {
  vec3 bmin = vec3(${BODY_BOX.min.join(", ")});
  vec3 bmax = vec3(${BODY_BOX.max.join(", ")});
  vec3 l = bmin + (position + 0.5) * (bmax - bmin);
  float c = cos(iBody.z), s = sin(iBody.z);
  vec3 w = vec3(iBody.x, 0.0, iBody.y) + vec3(l.x * c + l.z * s, l.y, -l.x * s + l.z * c) * iBody.w;
  vWorld = w;
  vB = iBody;
  vB2 = iBody2;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const BODY_FRAG = /* glsl */ `
uniform float uMode;     // 0 the exposure (an absorption, additive) · 1 the mask (coverage)
uniform float uGain;
uniform float uInk;
uniform float uColour;   // 0 grey … 1 the palette
uniform vec3 uTops[${TOPS.length}];
uniform vec3 uPants[${PANTS.length}];
uniform vec3 uHairs[${HAIRS.length}];
uniform vec3 uSkins[${SKINS.length}];
varying vec3 vWorld;
varying vec4 vB;
varying vec4 vB2;
${BODY_GLSL}
vec3 toLocal(vec3 w) {
  vec3 d = (w - vec3(vB.x, 0.0, vB.y)) / vB.w;
  float c = cos(vB.z), s = sin(vB.z);
  return vec3(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
}
void main() {
  if (vB2.y < 0.01) discard;
  vec3 ro = toLocal(cameraPosition);
  vec3 rd = normalize(toLocal(vWorld) - ro);
  float pixAng = max(length(dFdx(rd)), length(dFdy(rd)));
  loadPose(vB2.x);
  vec3 at;
  float cover = marchBody(ro, rd, pixAng, at);
  if (cover < 0.004) discard;
  if (uMode > 0.5) { gl_FragColor = vec4(vec3(cover * vB2.y), 1.0); return; }
  // the clothes' colour at that point, lit softly from above (an overexposed day: the shade is slight)
  int part = bodyPart(at);
  float w = bPalette;
  int ti = int(mod(w, 16.0) + 0.5); w = floor(w / 16.0 + 0.001);
  int pi = int(mod(w, 8.0) + 0.5); w = floor(w / 8.0 + 0.001);
  int hi = int(mod(w, 4.0) + 0.5); w = floor(w / 4.0 + 0.001);
  int si = int(w + 0.5);
  vec3 albedo = part == 0 ? uTops[ti] : (part == 1 ? uPants[pi] : (part == 2 ? uSkins[si] : uHairs[hi]));
  albedo = mix(vec3(dot(albedo, vec3(0.299, 0.587, 0.114))), albedo, uColour);
  float shade = 0.86 + 0.14 * clamp(at.y / 1.5, 0.0, 1.0);
  // the floor is blown out (the references): the feet and shins dissolve into it
  float floorGlow = mix(0.3, 1.0, smoothstep(0.02, 0.5, at.y));
  vec3 absorb = (1.0 - albedo * shade) * cover * floorGlow * uInk * vB2.z * vB2.y * uGain;
  gl_FragColor = vec4(absorb, 1.0);
}`;

/** An instanced box a person (attributes iBody, iBody2; `instanceCount` set by the caller). */
export function makeBodyGeometry(max: number): THREE.InstancedBufferGeometry {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = box.index;
  g.setAttribute("position", box.getAttribute("position"));
  g.setAttribute("iBody", new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("iBody2", new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/**
 * The people's material. "exposure": an absorption per channel, ADDED into the long exposure's feedback (no depth test —
 * overlaps darken by themselves); "mask": the coverage alone, for a silhouette render target. `uPoses` is the BodyPoses
 * texture; `uGain` the frame's weight in the exposure (longExposure.exposureRate) × the knob.
 */
export function makeBodyMaterial(poses: BodyPoses, mode: "exposure" | "mask" = "exposure"): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uPoses: { value: poses.texture }, uMode: { value: mode === "mask" ? 1 : 0 }, uGain: { value: 0.06 }, uInk: { value: 1 }, uColour: { value: 1 }, ...paletteUniforms() },
    vertexShader: BODY_VERT,
    fragmentShader: BODY_FRAG,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });
}

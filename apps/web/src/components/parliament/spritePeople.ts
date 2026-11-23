/**
 * spritePeople — THE OTHERS AS REAL PEOPLE, CUT OUT OF VIDEO (the artist, 2026-11-23: "걍 3d 몸 버려야하나 … 후져 …
 * 2d 실루엣 오픈소스 공짜 gif 로 해결해야하나" → "Pexels 클립으로 먼저 시험해봐", "내가 찾을게"). The clips she finds
 * (visual_reference_images/people_clips/, a green screen or a plain backdrop, the view at the end of the name) are cut
 * out by tools/people-sheet/people_sheet.py into one sheet — a row a clip, 16 frames of one stride (or of a standing
 * gesture) — served at /people/people.png with /people/people.json.
 *
 * Each person is an upright card facing the eye, their feet on the ground, its picture the row for how they are seen
 * (walking away → "back", towards → "front", across → "side", mirrored by the way they go; standing → "stand" when there
 * is one) and the frame their stride's phase. The card is MULTIPLIED onto the white (the photograph's own colours; where
 * there is no body the sheet is white). Clothes may be turned to another hue per person (the strongly coloured parts
 * only), and the card stretched a little across by the archetype's girth. One draw for everyone and their afterimages.
 */

import * as THREE from "three";

export type SpriteView = "back" | "front" | "side" | "stand";

export interface SpriteSheet {
  cols: number;
  cellW: number;
  cellH: number;
  rows: { id: string; view: SpriteView; strideSec: number; source: string }[];
}

/** The sheet's rows by view (for choosing), filled once the json is in. */
export interface SpriteIndex {
  sheet: SpriteSheet;
  byView: Record<SpriteView, number[]>;
}

let sheetPromise: Promise<{ index: SpriteIndex; texture: THREE.Texture }> | null = null;

/** The people's sheet (loaded once; the same texture for every view of the page). */
export function loadSpriteSheet(): Promise<{ index: SpriteIndex; texture: THREE.Texture }> {
  if (sheetPromise) return sheetPromise;
  sheetPromise = (async () => {
    const sheet = (await (await fetch("/people/people.json", { cache: "no-store" })).json()) as SpriteSheet;
    const texture = await new THREE.TextureLoader().loadAsync(`/people/people.png?v=${sheet.rows.map((r) => r.id).join(",").length}-${sheet.rows.length}`);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    const byView: Record<SpriteView, number[]> = { back: [], front: [], side: [], stand: [] };
    sheet.rows.forEach((r, i) => byView[r.view]?.push(i));
    return { index: { sheet, byView }, texture };
  })();
  return sheetPromise;
}

/**
 * The row to show for a person seen at `rel` (radians: their heading minus the direction from them to the eye; 0 =
 * coming straight at me), standing or not, chosen among that view's rows by their hash; and whether to mirror it.
 * A view with no rows borrows the nearest that has some (front ↔ back, side → back/front).
 */
export function spriteRow(index: SpriteIndex, rel: number, standing: boolean, hash: number): { row: number; mirror: number } {
  const pick = (list: number[]) => list[Math.floor(((hash * 7.13) % 1) * list.length) % list.length];
  const a = Math.atan2(Math.sin(rel), Math.cos(rel));
  const abs = Math.abs(a);
  const V = index.byView;
  if (standing && V.stand.length) return { row: pick(V.stand), mirror: hash > 0.5 ? -1 : 1 };
  const order: SpriteView[] = abs < Math.PI / 4 ? ["front", "back", "side"] : abs > (3 * Math.PI) / 4 ? ["back", "front", "side"] : ["side", "back", "front"];
  for (const v of order) {
    if (V[v].length) {
      // across: the clip walks one way — mirrored when they go the other (which way is the clip's? unknown: by sign)
      const mirror = v === "side" ? (a > 0 ? 1 : -1) : hash > 0.5 ? -1 : 1;
      return { row: pick(V[v]), mirror };
    }
  }
  return { row: 0, mirror: 1 };
}

/** One card a person or afterimage: attributes iA (x, z, height world, alpha), iB (row, frame 0 … cols, mirror, hue
 *  turn rad), iC (width ×, saturation ×, 0, 0). */
export function makeSpriteGeometry(max: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (const name of ["iA", "iB", "iC"]) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

const VERT = /* glsl */ `
uniform float uCols;
uniform float uRows;
uniform float uAspect;   // a cell's width / height
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
varying vec2 vUv;
varying float vAlpha;
varying float vHue;
varying float vSat;
void main() {
  vec3 feet = vec3(iA.x, 0.0, iA.y);
  // upright, turned to the eye about the vertical
  vec3 toEye = cameraPosition - feet;
  toEye.y = 0.0;
  vec3 fwd = normalize(toEye + vec3(1e-5, 0.0, 0.0));
  vec3 right = vec3(fwd.z, 0.0, -fwd.x);
  float h = iA.z;
  float w = h * uAspect * iC.x;
  vec3 p = feet + right * position.x * w + vec3(0.0, position.y * h, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  float frame = floor(mod(iB.y, uCols));
  float u = position.x * iB.z + 0.5;
  // (rows count from the top of the picture; texture v from the bottom)
  vUv = vec2((frame + u) / uCols, (uRows - 1.0 - iB.x + position.y) / uRows);
  vAlpha = iA.w;
  vHue = iB.w;
  vSat = iC.y;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uSheet;
varying vec2 vUv;
varying float vAlpha;
varying float vHue;
varying float vSat;
// a hue turn in YIQ, weighted by how coloured the pixel is (skin and greys stay)
vec3 hueTurn(vec3 c, float ang, float sat) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float chroma = length(vec2(i, q));
  float k = smoothstep(0.12, 0.25, chroma);
  float a = ang * k;
  float ca = cos(a), sa = sin(a);
  vec2 iq = vec2(i * ca - q * sa, i * sa + q * ca) * sat;
  return clamp(vec3(y + 0.956 * iq.x + 0.621 * iq.y, y - 0.272 * iq.x - 0.647 * iq.y, y - 1.106 * iq.x + 1.703 * iq.y), 0.0, 1.0);
}
void main() {
  vec4 t = texture2D(uSheet, vUv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  vec3 col = hueTurn(t.rgb, vHue, vSat);
  gl_FragColor = vec4(mix(vec3(1.0), col, a), 1.0);
}`;

/** The cards' material: the photograph multiplied onto the white, depth-tested, both faces. */
export function makeSpriteMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { uSheet: { value: null }, uCols: { value: 16 }, uRows: { value: 1 }, uAspect: { value: 0.5 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
  });
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.DstColorFactor;
  m.blendDst = THREE.ZeroFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  return m;
}

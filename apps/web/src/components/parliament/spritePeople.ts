/**
 * spritePeople — THE OTHERS AS REAL PEOPLE, CUT OUT OF VIDEO (the artist, 2026-11-23: "걍 3d 몸 버려야하나 … 후져 …
 * 2d 실루엣 오픈소스 공짜 gif 로 해결해야하나" → "Pexels 클립으로 먼저 시험해봐", "내가 찾을게"). The clips she finds
 * (visual_reference_images/people_clips/, a green screen or a plain backdrop, the view at the end of the name) are cut
 * out by tools/people-sheet/people_sheet.py into a strip a clip — 16 frames of one stride (or of a standing gesture) —
 * served at /people/clips/<file>.png with /people/people.json, and packed here into one texture (only the clips used).
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
  rows: { id: string; file?: string; view: SpriteView; strideSec: number; source: string }[];
}

/** The sheet's rows by view (for choosing, only rows that were loaded), and where each row sits in the packed texture. */
export interface SpriteIndex {
  sheet: SpriteSheet;
  byView: Record<SpriteView, number[]>;
  /** sheet row → slot in the packed texture (−1: not loaded) */
  slot: number[];
  /** strips side by side in one row of the texture, and the texture's rows */
  per: number;
  atlasRows: number;
}

let jsonPromise: Promise<SpriteSheet> | null = null;
/** The clips' list (people.json), fetched once. */
export function loadSpriteList(): Promise<SpriteSheet> {
  if (!jsonPromise) jsonPromise = fetch("/people/people.json", { cache: "no-store" }).then((r) => r.json() as Promise<SpriteSheet>);
  return jsonPromise;
}

const atlases = new Map<string, Promise<{ index: SpriteIndex; texture: THREE.Texture }>>();

/**
 * THE PEOPLE'S TEXTURE, PACKED FROM THE CLIPS IN USE (the artist, 2026-11-23: "폴더에 넣어서 돌리면 많이 무거워지는지"):
 * one strip file a clip (people/clips/<file>.png, 16 frames of 128 × 256), only those `use` keeps (all when absent),
 * copied on the GPU into one texture no taller than the device allows (a phone may stop at 4096 px: 16 strips a column,
 * a second column beside when more). One texture, one draw, as before; memory grows with the clips used, not the folder.
 */
export function loadSpriteSheet(renderer: THREE.WebGLRenderer, use?: (row: SpriteSheet["rows"][number], i: number) => boolean): Promise<{ index: SpriteIndex; texture: THREE.Texture }> {
  return loadSpriteList().then((sheet) => {
    const keep = sheet.rows.map((r, i) => (!use || use(r, i)) && !!r.file);
    const key = keep.map((k) => (k ? 1 : 0)).join("");
    let p = atlases.get(key);
    if (!p) {
      p = packAtlas(renderer, sheet, keep);
      atlases.set(key, p);
    }
    return p;
  });
}

async function packAtlas(renderer: THREE.WebGLRenderer, sheet: SpriteSheet, keep: boolean[]): Promise<{ index: SpriteIndex; texture: THREE.Texture }> {
  const stripW = sheet.cols * sheet.cellW, stripH = sheet.cellH;
  const max = Math.min(renderer.capabilities.maxTextureSize, 16384);
  const maxRows = Math.max(1, Math.floor(max / stripH));
  const maxPer = Math.max(1, Math.floor(Math.min(max, 4096) / stripW));
  const want = keep.filter(Boolean).length;
  const per = Math.min(maxPer, Math.max(1, Math.ceil(want / maxRows)));
  const cap = per * maxRows;
  if (want > cap) console.warn(`[people] ${want} clips asked, ${cap} fit this device's textures — the rest left out`);
  // the strips themselves: the colour at a soft edge must stay as drawn (a decoder that premultiplies loses it at low
  // alpha — the dark rim the artist saw, 2026-11-23), so ImageBitmaps without premultiplication, flipped for GL
  const loader = new THREE.ImageBitmapLoader();
  loader.setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const slot = sheet.rows.map(() => -1);
  const order: number[] = [];
  keep.forEach((k, i) => {
    if (k && order.length < cap) order.push(i);
  });
  const bitmaps = await Promise.all(
    order.map((i) =>
      loader.loadAsync(`/people/clips/${encodeURIComponent(sheet.rows[i].file!)}?v=${sheet.rows.length}`).then(
        (b) => b as unknown as ImageBitmap,
        () => null,
      ),
    ),
  );
  const placed = order.filter((_, k) => bitmaps[k]);
  const atlasRows = Math.max(1, Math.ceil(placed.length / per));
  const texture = new THREE.DataTexture(null, per * stripW, atlasRows * stripH);
  (texture.source as unknown as { dataReady: boolean }).dataReady = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.needsUpdate = true;
  renderer.initTexture(texture);
  let s = 0;
  bitmaps.forEach((b, k) => {
    if (!b) return;
    const row = order[k];
    // slot s: column s % per, row s / per counted from the picture's top (GL's y counts from the bottom)
    const x = (s % per) * stripW, y = (atlasRows - 1 - Math.floor(s / per)) * stripH;
    const src = new THREE.Texture(b as unknown as HTMLImageElement);
    renderer.copyTextureToTexture(src, texture, null, new THREE.Vector2(x, y));
    b.close();
    slot[row] = s++;
  });
  // the smaller copies for far off, from what was packed
  const gl = renderer.getContext();
  const tp = renderer.properties.get(texture) as { __webglTexture?: WebGLTexture };
  if (tp.__webglTexture) {
    renderer.state.bindTexture(gl.TEXTURE_2D, tp.__webglTexture);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  const byView: Record<SpriteView, number[]> = { back: [], front: [], side: [], stand: [] };
  sheet.rows.forEach((r, i) => {
    if (slot[i] >= 0) byView[r.view]?.push(i);
  });
  return { index: { sheet, byView, slot, per, atlasRows }, texture };
}

/** GLSL: where in the packed texture a slot's frame lies (uv 0 … 1 inside the frame). Needs uCols, uPer, uAtlasRows. */
export const ATLAS_GLSL = /* glsl */ `
vec2 atlasUv(float slot, float frame, vec2 uv) {
  float col = mod(slot, uPer);
  float row = floor((slot + 0.5) / uPer);
  return vec2((col * uCols + frame + uv.x) / (uCols * uPer), (uAtlasRows - 1.0 - row + uv.y) / uAtlasRows);
}`;

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

/** One card a person or afterimage: attributes iA (x, z, height world, alpha), iB (slot, frame 0 … cols, mirror, hue
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
uniform float uPer;
uniform float uAtlasRows;
uniform float uAspect;   // a cell's width / height
${ATLAS_GLSL}
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
  // (iB.x: the clip's slot in the packed texture)
  vUv = atlasUv(iB.x, frame, vec2(u, position.y));
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
    uniforms: { uSheet: { value: null }, uCols: { value: 16 }, uPer: { value: 1 }, uAtlasRows: { value: 1 }, uAspect: { value: 0.5 } },
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

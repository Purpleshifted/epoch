/**
 * THE INFERRED VILLAGE, DRAWN (lib/parliament/futureVillage.ts; the artist, 2026-11-16): a layer of what will be
 * found after the people are gone ("인류가 멸망한 후 남겨져서 발견될 모습")
 * — two or three slots, in 3D, standing on a ground of its own — APART FROM THE COLUMN, above its top ("꼭대기는
 * 지금 기둥에서 분리된 형태여야 해"). It is worked out in the wall's worker with the parts (SpaceRequest.future) and
 * comes back through `futureLink`; here it is only drawn: the buildings as the parts the column's own generator made
 * of them (one instanced mesh a kind, in the column's greys), lines for the paths and the water (the pools' rims
 * among them), clouds of points for the plants, a plate for its ground. It stands above where the building has come
 * to, a gap apart, and follows that as it rises. Nothing of it is fused, eroded or kept.
 *
 * Its knobs are a folder of their own (미래 마을 층), saved like every other group.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three";
import { PART_KINDS, WORLD_SIZE, type PartKind } from "@/lib/parliament";
import { DEFAULT_FUTURE, type FutureConfig, type FutureResult } from "@/lib/parliament/futureVillage";
import { futureOnly } from "@/lib/parliament/futureOnly";
import { plantTone, tone } from "@/lib/parliament/plantTone";
// (the parts come and go softly: futureLife.ts)
import { futureLifeU, lifeDissolve, liveAndFading, newKeyedLife, placeKey, setLifeAttr, type KeyedLife } from "./futureLife";
import { savable } from "./levaSave";

/** Between the wall's ticker (which asks for it with these knobs) and its answer (which is drawn here). */
export const futureLink: { cfg: FutureConfig | null; result: FutureResult | null; version: number } = { cfg: null, result: null, version: 0 };

const GROUP = "미래 마을 층";
/** The most parts of one kind that are drawn (the worker sends no more: SpaceModel.computeFuture). */
const KIND_CAP = 12000;

const setLines = (m: THREE.LineSegments | null, flat: Float32Array, y: number) => {
  if (!m) return;
  const pos = new Float32Array((flat.length / 4) * 6);
  for (let i = 0, o = 0; i + 3 < flat.length; i += 4) {
    pos[o++] = flat[i];
    pos[o++] = y;
    pos[o++] = flat[i + 1];
    pos[o++] = flat[i + 2];
    pos[o++] = y;
    pos[o++] = flat[i + 3];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  m.geometry.dispose();
  m.geometry = g;
};

/** The versions of the pit: which is drawn is set every frame. From the side and from below it is always "beam" (the
 *  artist, 2026-11-17: "옆에서 본 뷰는 그걸로 고정하고"); from above, the one chosen with the knob 위에서 볼 때. */
type PitStyle = "lit" | "dark" | "shaft" | "lid" | "beam" | "section" | "none";
const PIT_STYLES: Record<string, PitStyle> = {
  "1 · 밝은 땅에 뚫린 구멍 — 벽 위쪽에 빛이 묻음": "lit",
  "2 · 밝은 땅 + 벽까지 어두운 상자": "dark",
  "3 · 어두운 상자 위로 솟은 네모난 통로 — 그 벽을 타고 빛이 내려옴": "shaft",
  "4 · 빛나는 네모 천장 (바깥 땅 없음 · 입구가 빛의 면)": "lid",
  "6 · 빛나는 네모 천장 + 그 아래 빛기둥 (옆 · 아래에서 볼 때와 같은 것 — 위에서는 천장이 기둥을 가림)": "beam",
  "5 · 땅속 단면 (상자 밖에서 볼 때 앞쪽 땅이 잘리고 지층 띠가 보임)": "section",
  "0 · 없음 (예전의 반투명 판)": "none",
};

/** A quad (a, b, c, d in order round it) as two triangles, turned so that their face looks towards the point `to`. */
function quad(pos: number[], col: number[], P: [number, number, number][], C: [number, number, number][], to: [number, number, number]): void {
  const [a, b, c] = P;
  const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
  const facing = n[0] * (to[0] - a[0]) + n[1] * (to[1] - a[1]) + n[2] * (to[2] - a[2]) > 0;
  for (const i of facing ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
    pos.push(...P[i]);
    col.push(...C[i]);
  }
}

/** The pit's walls and floor in a unit box (±0.5), facing inwards, their colours the light at the rim falling to the
 *  floor's darkness by `fall`. */
function pitGeometry(light: string, dark: string, fall: number, wall = 1, floor = true): THREE.BufferGeometry {
  const L = new THREE.Color(light), D = new THREE.Color(dark);
  const at = (t: number): [number, number, number] => {
    // (t: 0 at the rim … 1 at the floor)
    // (`wall`: how much of the ground's light the walls carry at all — 1 = the rim's own brightness at the top)
    const w = Math.max(0, Math.min(1, wall)) * Math.pow(1 - t, Math.max(0.25, fall));
    return [D.r + (L.r - D.r) * w, D.g + (L.g - D.g) * w, D.b + (L.b - D.b) * w];
  };
  const pos: number[] = [], col: number[] = [];
  const corners: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const ROWS = 12;
  for (let s = 0; s < 4; s++) {
    const [x0, z0] = corners[s], [x1, z1] = corners[(s + 1) % 4];
    for (let r = 0; r < ROWS; r++) {
      const t0 = r / ROWS, t1 = (r + 1) / ROWS, y0 = 0.5 - t0, y1 = 0.5 - t1;
      quad(pos, col, [[x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]], [at(t0), at(t0), at(t1), at(t1)], [0, (y0 + y1) / 2, 0]);
    }
  }
  if (floor) quad(pos, col, [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]], [at(1), at(1), at(1), at(1)], [0, 0, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
  return g;
}

/**
 * THE PILLAR OF LIGHT under the bright ceiling (the artist, 2026-11-17, of the lit walls: "빛이 내려올 때 벽 모서리가
 * 너무 좀 그래서 비용도 줄일 겸 그냥 '그라디언트기둥'이 모서리 사이즈에 맞춰서 보이게 하는 게 나을지도"): no walls, no
 * floor — only the ceiling's light in the air under it. First it was a veil along the square's four sides; then (the
 * same day: "아래 경계 좀 퍼지게 해서 자연스럽게", "감쇠 훨씬 빡세게 … 아래로 가면 거의 그냥 핀조명효과처럼 사라지고
 * 좁아지게 보여야") A BODY OF LIGHT: a box under the ceiling whose brightness along each line of sight is summed in the
 * fragment shader — strongest right under the ceiling and gone with depth (`uFall`), narrowing as it goes down
 * (`uTaper`), thinning towards its sides (`uSoft`) so that it has no edge of its own.
 *
 * The fall with depth is taken exactly (the samples are spread evenly over ITS integral, so a fall of 40 is as smooth
 * as a fall of 2); only the thinning towards the sides is sampled — THREE steps, no more (the artist: "굳이 '그것처럼
 * 보이게 하는' 목적의 요소들에 렌더 리소스 많이 쓰지 마"), shifted from pixel to pixel so that no bands show. Drawn on the box's far faces with the depth test on: what stands in the light (the column, what is
 * found on the layer) is not washed by it — it stands dark before it.
 */
// (where the box stands in the world and how large it is are read from its own matrix: it is never turned)
const BEAM_VERTEX =
  "varying vec3 vW;\nvarying vec3 vCentre;\nvarying vec3 vSize;\nvoid main() {\n  vec4 w = modelMatrix * vec4( position, 1.0 );\n  vW = w.xyz;\n  vCentre = modelMatrix[ 3 ].xyz;\n  vSize = vec3( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ), length( modelMatrix[ 2 ].xyz ) );\n  gl_Position = projectionMatrix * viewMatrix * w;\n}";
const BEAM_FRAGMENT = [
  "uniform vec3 uLight;",
  "varying vec3 vCentre;",
  "varying vec3 vSize;",
  "uniform float uCap;",
  "uniform float uFall;",
  "uniform float uGlow;",
  "uniform float uTaper;",
  "uniform float uSoft;",
  "varying vec3 vW;",
  "float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }",
  "void main() {",
  // (the light itself: the box that is drawn, less the part of it above the bright square)
  "  vec3 uCentre = vCentre - vec3( 0.0, 0.5 * uCap, 0.0 );",
  "  vec3 uSize = max( vSize - vec3( 0.0, uCap, 0.0 ), vec3( 1e-4 ) );",
  "  vec3 ro = cameraPosition;",
  "  vec3 rd = normalize( vW - ro );",
  "  rd += vec3( 1e-6 ) * ( 1.0 - step( 1e-6, abs( rd ) ) );",
  // (the line of sight inside the box: from where it enters — or from the eye, inside it — to where it leaves)
  "  vec3 a = ( uCentre - 0.5 * uSize - ro ) / rd;",
  "  vec3 b = ( uCentre + 0.5 * uSize - ro ) / rd;",
  "  vec3 lo = min( a, b );",
  "  vec3 hi = max( a, b );",
  "  float tn = max( max( lo.x, lo.y ), max( lo.z, 0.0 ) );",
  "  float tf = min( min( hi.x, hi.y ), hi.z );",
  "  if ( tf <= tn ) discard;",
  // (h: 0 under the ceiling … 1 at the light's end; along the line it goes evenly from h0 to h1)
  "  float top = uCentre.y + 0.5 * uSize.y;",
  "  float h0 = clamp( ( top - ( ro.y + rd.y * tn ) ) / uSize.y, 0.0, 1.0 );",
  "  float h1 = clamp( ( top - ( ro.y + rd.y * tf ) ) / uSize.y, 0.0, 1.0 );",
  "  float F = max( 0.25, uFall );",
  "  float u0 = pow( 1.0 - h0, F + 1.0 );",
  "  float u1 = pow( 1.0 - h1, F + 1.0 );",
  "  float dh = h1 - h0;",
  "  bool level = abs( dh ) < 1e-4;",
  // (the whole of the fall along the line, exactly)
  "  float fallSum = level ? pow( 1.0 - h0, F ) : abs( u1 - u0 ) / ( ( F + 1.0 ) * abs( dh ) );",
  "  float j = ign( gl_FragCoord.xy );",
  "  float sum = 0.0;",
  "  for ( int i = 0; i < 3; i++ ) {",
  "    float f = ( float( i ) + j ) / 3.0;",
  "    float h = level ? h0 : 1.0 - pow( mix( u0, u1, f ), 1.0 / ( F + 1.0 ) );",
  "    float t = level ? mix( tn, tf, f ) : tn + ( h - h0 ) / dh * ( tf - tn );",
  "    vec3 q = ( ro + rd * t - uCentre ) / uSize;",
  // (how far from the middle, against the light's half-width at this depth: 1 = its side)
  "    float m = max( abs( q.x ), abs( q.z ) ) / max( 1e-4, 0.5 * ( 1.0 - uTaper * h ) );",
  "    sum += 1.0 - smoothstep( 1.0 - uSoft, 1.0, m );",
  "  }",
  "  float lit = uGlow * fallSum * ( sum / 3.0 ) * ( tf - tn ) / uSize.x;",
  "  gl_FragColor = vec4( max( vec3( 0.0 ), uLight * lit + ( j - 0.5 ) / 255.0 * step( 1e-4, lit ) ), 1.0 );",
  "  #include <colorspace_fragment>",
  "}",
].join("\n");

/** The ground round the pit's mouth: a square of half-side `R` with the mouth (half-side `h`) cut out of it. */
function rimGeometry(h: number, R: number): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const one: [number, number, number] = [1, 1, 1];
  const inner: [number, number][] = [[-h, -h], [h, -h], [h, h], [-h, h]], outer: [number, number][] = [[-R, -R], [R, -R], [R, R], [-R, R]];
  for (let s = 0; s < 4; s++) {
    const a = inner[s], b = inner[(s + 1) % 4], c = outer[(s + 1) % 4], d = outer[s];
    quad(pos, col, [[a[0], 0, a[1]], [b[0], 0, b[1]], [c[0], 0, c[1]], [d[0], 0, d[1]]], [one, one, one, one], [0, 1e6, 0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  return g;
}

export function FutureVillage({ unit, top, kindColor }: { unit: number; top: THREE.IUniform<number>; kindColor: Record<PartKind, string> }) {
  const k = useControls(
    GROUP,
    savable(GROUP, {
      on: { value: DEFAULT_FUTURE.on, label: "켜기 (기둥 위에 떨어져 떠 있는 층 — 인류가 사라진 뒤 남겨져 발견될 모습)" },
      ruin: { value: 0.5, min: 0, max: 1, step: 0.05, label: "얼마나 삭았나 (0 = 서 있던 그대로 … 1 = 가장 오래 선 것의 기초만)" },
      anchor: { options: { "창의 꼭대기 위 (고정 — 기둥 상승을 멈추면 움직이지 않음)": "window", "지어진 꼭대기 위 (건물이 올라오면 따라감)": "built" }, value: "window" as "window" | "built", label: "층의 자리" },
      gap: { value: 8, min: 0, max: 40, step: 1, label: "그 자리와의 간격 (단 · 0 = 붙음)" },
      band: { value: DEFAULT_FUTURE.band, min: 4, max: 40, step: 2, label: "변화를 읽는 범위 (가장 최근에 지어진 몇 단 · 앞 절반과 뒤 절반을 비교)" },
      gain: { value: DEFAULT_FUTURE.gain, min: 0, max: 3, step: 0.1, label: "최근 변화를 얼마나 더 밀고 가나 (성장 규칙에만 쓰임)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.edge`) },
      maxH: { value: DEFAULT_FUTURE.maxH, min: 1, max: 4, step: 1, label: "가장 높은 건물 (단)" },
      persist: { value: true, label: "오래 선 것일수록 많이 남음 (오래 걸은 길 = 남는 뼈대 · 갓 지은 것 · 먼저 버려진 것은 기초만 · 갓 걸은 길은 풀에 덮임)" },
      edge: { value: DEFAULT_FUTURE.edge, label: "마을이 가장자리에서 자람 (성장 규칙 — '남겨진 모습'에는 맞지 않아 기본 끔)" },
      margin: { value: DEFAULT_FUTURE.margin, min: 1, max: 8, step: 1, label: "식생이 나는 범위 (다녀간 곳에서 몇 칸 밖까지)" },
      vegPer: { value: DEFAULT_FUTURE.vegPer, min: 0, max: 10, step: 0.5, label: "식생 구름의 짙기 (점 수)" },
      opacity: { value: 1, min: 0.1, max: 1, step: 0.05, label: "건물의 불투명도 (옅을수록 '아직 아닌 것')" },
      ground: { value: true, label: "제 땅을 그림 (기둥에서 떨어진 판 · 처음부터 땅 전체 크기)" },
      // (the artist, 2026-11-17: "땅 transparency 조절 가능해야 하고" — the plate's opacity and colour)
      groundOpacity: { value: 0.5, min: 0, max: 1, step: 0.05, label: "땅의 불투명도 (0 = 안 보임 … 1 = 꽉 참)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.ground`) },
      groundColor: { value: "#2a2d31", label: "땅의 색", render: (get: (path: string) => unknown) => !!get(`${GROUP}.ground`) },
      // THE PIT (the artist, 2026-11-17: "배경에 미래 땅이랑 맞는 직육면체 벽처럼 보이게 넣어서 '파인 상자 속을 내려다본다'
      // 느낌 가능하게 만드는 레바 스위치"; then, seeing it: "미래 땅이 훨씬 넓고 … 상자 밖이 더 밝아야 '파였'다고 보일 듯",
      // "봇이 활동하는 범위 배경이 어두운 게 더 맞고 그 바깥 땅에 더 밝은 색", "꼭 어두운 상자 위에 네모난 통로로 빛
      // 들어오는 것처럼", and: "옆에서 본 렌더랑 위에서 봤을 때 렌더를 (지면 기준) 좀 나누면 좋을 것 같음. 일단 여러
      // 버전을 넣어서 한 번 어떤지 좀 보고싶어") — SEVERAL VERSIONS, chosen apart for the eye above the layer's
      // ground and for the eye below it. Then, having seen them: "옆에서 본 뷰는 그걸로 고정하고" — FROM THE SIDE AND
      // FROM BELOW IT IS THE BRIGHT CEILING WITH ITS LIGHT UNDER IT (version 6), no longer chosen; from above it still is.
      pit: { value: false, label: "파인 상자 (눈이 미래 땅보다 아래 = 빛나는 네모 천장 + 빛기둥으로 고정 · 위일 때는 아래 줄에서 고름)" },
      pitAbove: { options: PIT_STYLES, value: "lit" as PitStyle, label: "위에서 볼 때 (눈이 미래 땅보다 위)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      // THE LIGHT UNDER THE CEILING ("감쇠 훨씬 빡세게 넣을 수 있게 … 아래로 가면 거의 그냥 핀조명효과처럼 사라지고
      // 좁아지게"): its own knobs, apart from the box's (which the versions seen from above go on using)
      beamGlow: { value: 1, min: 0, max: 4, step: 0.05, label: "빛기둥의 세기 (1 = 천장 바로 아래를 가로질러 보면 천장만큼 밝음)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      beamFall: { value: 14, min: 0.5, max: 80, step: 0.5, label: "빛기둥의 감쇠 (클수록 천장 바로 아래에서만 빛나고 곧 사라짐)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      beamTaper: { value: 0.7, min: 0, max: 1, step: 0.02, label: "빛기둥이 아래로 좁아지는 정도 (0 = 곧게 … 1 = 끝에서 한 점)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      beamSoft: { value: 0.8, min: 0.05, max: 1, step: 0.05, label: "빛기둥 옆 가장자리의 번짐 (작으면 또렷한 네모 기둥 … 1 = 가운데부터 옅어짐)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      beamDeep: { value: 120, min: 5, max: 400, step: 5, label: "빛기둥의 길이 (단 · 천장에서 아래로 — 좁아짐은 이 끝에서 다함)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      pitDepth: { value: 160, min: 10, max: 400, step: 5, label: "상자의 깊이 (단 · 미래 땅에서 아래로 — 위에서 볼 때의 버전들)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      pitWide: { value: 6, min: 1.5, max: 20, step: 0.5, label: "바깥 땅의 넓이 (상자 한 변의 몇 배)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      pitShaft: { value: 40, min: 2, max: 200, step: 2, label: "통로의 높이 (단 · 버전 3: 상자 위로 솟은 네모난 통로)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      pitLight: { value: "#a9adb3", label: "밝은 쪽 — 바깥 땅 · 통로 위 · 천장 (해와 무관한 제 빛)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      pitDark: { value: "#101214", label: "어두운 쪽 — 상자 안 (봇이 다니는 범위의 배경)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      pitWall: { value: 0.12, min: 0, max: 1, step: 0.02, label: "'어두운 상자'의 벽 위쪽에 묻는 빛 (0 = 벽 전체가 어두움)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      pitFall: { value: 2, min: 0.5, max: 6, step: 0.25, label: "벽의 빛이 깊이에 따라 줄어드는 정도 (위에서 볼 때의 버전들 · 클수록 맨 위만 밝음)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      pitBands: { value: 26, min: 0, max: 80, step: 1, label: "단면의 지층 띠 수 (버전 5 · 0 = 띠 없음)", render: (get: (path: string) => unknown) => !!get(`${GROUP}.pit`) },
      vegSize: { value: 0.12, min: 0.02, max: 1, step: 0.01, label: "식생 점 크기 (월드)" },
      vegColorA: { value: "#5f7a3a", label: "식생 색 1 (자연색)" },
      vegColorB: { value: "#a9b56a", label: "식생 색 2 (자연색)" },
    }),
    { collapsed: true },
  );
  // (the ticker reads the knobs from here: SpaceRequest.future)
  futureLink.cfg = useMemo<FutureConfig>(() => ({ on: k.on, band: k.band, gain: k.gain, maxH: k.maxH, edge: k.edge, margin: k.margin, vegPer: k.vegPer, persist: k.persist, ruin: k.ruin }), [k.ruin, k.persist, k.on, k.band, k.gain, k.maxH, k.edge, k.margin, k.vegPer]);
  useEffect(
    () => () => {
      futureLink.cfg = null;
    },
    [],
  );

  const group = useRef<THREE.Group>(null);
  const meshes = useRef<Partial<Record<PartKind, THREE.InstancedMesh | null>>>({});
  const roads = useRef<THREE.LineSegments>(null);
  const roadsOld = useRef<THREE.LineSegments>(null);
  const water = useRef<THREE.LineSegments>(null);
  const veg = useRef<THREE.Points>(null);
  const ground = useRef<THREE.Mesh>(null);
  const pit = useRef<THREE.Mesh>(null);
  const rim = useRef<THREE.Mesh>(null);
  // THE PIT'S LIGHT IS ITS OWN (the artist: "위에서 빛이 내려오는 것처럼 … 햇빛이랑 무관하게"): nothing of it is lit by the
  // scene's sun — every face carries its brightness itself.
  const shaft = useRef<THREE.Mesh>(null);
  const lid = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const beamMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        // (the box's far faces, so that it is drawn with the eye inside it too; what stands before them hides it)
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: { uLight: { value: new THREE.Color() }, uCap: { value: 0 }, uFall: { value: 14 }, uGlow: { value: 1 }, uTaper: { value: 0.7 }, uSoft: { value: 0.8 } },
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
      }),
    [],
  );
  useEffect(() => () => beamMat.dispose(), [beamMat]);
  const litGeo = useMemo(() => pitGeometry(k.pitLight, k.pitDark, k.pitFall, 1), [k.pitLight, k.pitDark, k.pitFall]);
  const darkGeo = useMemo(() => pitGeometry(k.pitLight, k.pitDark, k.pitFall, k.pitWall), [k.pitLight, k.pitDark, k.pitFall, k.pitWall]);
  const shaftGeo = useMemo(() => pitGeometry(k.pitLight, k.pitDark, k.pitFall, 1, false), [k.pitLight, k.pitDark, k.pitFall]);
  const rimGeo = useMemo(() => rimGeometry(WORLD_SIZE / 2, (WORLD_SIZE / 2) * Math.max(1.5, k.pitWide)), [k.pitWide]);
  useEffect(() => () => litGeo.dispose(), [litGeo]);
  useEffect(() => () => darkGeo.dispose(), [darkGeo]);
  useEffect(() => () => shaftGeo.dispose(), [shaftGeo]);
  useEffect(() => () => rimGeo.dispose(), [rimGeo]);
  // VERSION 5, THE SECTION (seen from outside the box, the ground between the eye and the box is cut away by an upright
  // plane through the box's middle that faces the eye; on the plane stands the cut face — the ground's body left and
  // right of the box and under its floor, in bands)
  const gl = useThree((st) => st.gl);
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);
  const cutPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e9), []);
  const cutPlanes = useMemo(() => [cutPlane], [cutPlane]);
  const face = useRef<THREE.Group>(null);
  const faceParts = useRef<(THREE.Mesh | null)[]>([null, null, null]);
  const faceMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { uLight: { value: new THREE.Color() }, uDark: { value: new THREE.Color() }, uTop: { value: 0 }, uDeep: { value: 1 }, uBands: { value: 26 }, uFall: { value: 2 } },
        vertexShader: "varying vec3 vW;\nvoid main() {\n  vec4 w = modelMatrix * vec4( position, 1.0 );\n  vW = w.xyz;\n  gl_Position = projectionMatrix * viewMatrix * w;\n}",
        fragmentShader:
          "uniform vec3 uLight;\nuniform vec3 uDark;\nuniform float uTop;\nuniform float uDeep;\nuniform float uBands;\nuniform float uFall;\nvarying vec3 vW;\nfloat h1( float n ) { return fract( sin( n * 91.3458 ) * 47453.5453 ); }\nvoid main() {\n  float t = clamp( ( uTop - vW.y ) / uDeep, 0.0, 1.0 );\n  float wob = sin( ( vW.x + vW.z ) * 0.07 ) * 0.35 + sin( ( vW.x - vW.z ) * 0.19 ) * 0.15;\n  float band = uBands > 0.5 ? h1( floor( t * uBands + wob ) ) : 0.5;\n  float lit = pow( 1.0 - t, max( 0.25, uFall * 0.5 ) );\n  vec3 col = mix( uDark, uLight, 0.25 + 0.6 * lit ) * ( 0.72 + 0.38 * band );\n  gl_FragColor = vec4( col, 1.0 );\n  #include <colorspace_fragment>\n}",
      }),
    [],
  );
  useEffect(() => () => faceMat.dispose(), [faceMat]);
  const seen = useRef(-1);
  // (each kind of part's coming and going, by its place: futureLife.ts)
  const partLife = useRef<Partial<Record<PartKind, KeyedLife>>>({});
  /** The slot the layer is drawn above, following the slot it was made for softly. */
  const shownK = useRef<number | null>(null);
  const tint = useMemo(() => new THREE.Color(), []);
  const colA = useMemo(() => new THREE.Color(), []);
  const colB = useMemo(() => new THREE.Color(), []);
  const colors = useRef({ a: "", b: "", t: -1 });

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const r = futureLink.result;
    // (the clock the parts come and go by — the lengths are the layer's knobs, FutureUnder's 보기)
    futureLifeU.value.x = performance.now() / 1000;
    // WHERE IT STANDS (the artist, 2026-11-17: "미래 층을 고정시켜"): above THE WINDOW'S TOP, the gap apart — a place
    // that does not move while the column's rise is stopped (rise.ts), whatever is built below it. (Or, as before:
    // above where the building has come to, following that softly.) Its parts are made at their own slots (above
    // FutureResult.k); the whole is moved so that their foot is at that place.
    const madeFor = r && r.ground.length ? r.k : null;
    if (madeFor === null) shownK.current = null;
    else if (shownK.current === null || Math.abs(madeFor - shownK.current) > 30) shownK.current = madeFor;
    else shownK.current += (madeFor - shownK.current) * 0.05;
    const foot = madeFor === null ? 0 : (madeFor + 1) * unit;
    const base = (k.anchor === "built" && shownK.current !== null ? shownK.current + 1 : top.value) + Math.max(0, k.gap);
    g.position.y = base * unit - foot;
    // ITS GROUND IS THE WHOLE GROUND OF THE WORLD, FROM THE START ("마을 땅을 보여주는 땅 크기가 처음부터 큰 게 맞는 것 같고") — not
    // the square round what happens to be built so far, which grew as the village did
    const plate = ground.current;
    if (plate) {
      plate.position.set(0, foot - 0.06, 0);
      plate.scale.set(WORLD_SIZE, 0.1, WORLD_SIZE);
    }
    // THE PIT, BY WHERE THE EYE IS: above the layer's ground the version chosen for looking down, below it the one for
    // looking from the side or from underneath.
    const groundY = g.position.y + foot;
    const cam = state.camera.position;
    // (the layer alone — /rehearsal/future, lib/parliament/futureOnly.ts: no pit and none of its light, whatever the knob)
    const style: PitStyle = !k.pit || futureOnly() ? "none" : cam.y >= groundY ? k.pitAbove : "beam";
    const deep = Math.max(1, k.pitDepth) * unit;
    const up = style === "shaft" ? Math.max(1, k.pitShaft) * unit : 0;
    if (plate) plate.visible = k.ground && k.groundOpacity > 0.001 && style === "none";
    const box = pit.current;
    if (box) {
      // (drawn from the inside only: a wall between the eye and the column is not drawn)
      box.visible = style !== "none" && style !== "beam";
      box.geometry = style === "lit" || style === "lid" ? litGeo : darkGeo;
      box.position.set(0, foot - 0.02 - deep / 2, 0);
      box.scale.set(WORLD_SIZE, deep, WORLD_SIZE);
    }
    // the wide ground round the mouth — raised to the top of the passage when there is one
    if (rim.current) {
      rim.current.visible = style === "lit" || style === "dark" || style === "shaft" || style === "section";
      rim.current.position.set(0, foot - 0.02 + up, 0);
    }
    // 3: the square passage that rises from the dark box to the bright ground — the light comes down its walls
    if (shaft.current) {
      shaft.current.visible = style === "shaft";
      shaft.current.position.set(0, foot - 0.02 + up / 2, 0);
      shaft.current.scale.set(WORLD_SIZE, Math.max(1e-3, up), WORLD_SIZE);
    }
    // 4: no ground outside — the mouth itself is a bright square, a little above what is found (a ceiling of light)
    // Under the layer's ground (version 6) THE BRIGHT SQUARE IS A BACKGROUND, AT THE HEIGHT OF WHAT IS FOUND (the artist,
    // 2026-11-17: "상자 윗면보다 미래 마을이 더 낮게 형성되고 있음, 높이 같아야", "애초에 빛나는 네모가 배경 에셋이도록
    // 하면 성능 덜 먹고 좋을 듯"): it stands in the layer's own ground plane, is drawn before everything else and
    // neither reads nor writes depth — so whatever is drawn after it (the column, what is found, from below too) is
    // seen before it, and it costs a fill of its pixels and no more.
    const back = style === "beam";
    const lidY = back ? foot : foot + 6 * unit;
    if (lid.current) {
      lid.current.visible = style === "lid" || back;
      lid.current.position.set(0, lidY, 0);
      lid.current.scale.set(WORLD_SIZE, WORLD_SIZE, 1);
      lid.current.renderOrder = back ? -1000 : 0;
      const m = lid.current.material as THREE.MeshBasicMaterial;
      m.depthTest = !back;
      m.depthWrite = !back;
    }
    // 6: under that ceiling nothing but its light — a body of it, strongest under the ceiling, narrowing and gone with
    // depth (the shader reads where the box stands from the box's own matrix)
    if (beam.current) {
      const long = Math.max(1, k.beamDeep) * unit;
      beam.current.visible = style === "beam" && k.beamGlow > 0;
      // (the box that is drawn reaches a little ABOVE the square — over what is found — though the light begins at the
      // square (uCap): seen from below, what is found then stands before the box's far face and is not washed by it)
      const cap = 6 * unit;
      beam.current.position.set(0, lidY + cap - (long + cap) / 2, 0);
      beam.current.scale.set(WORLD_SIZE, long + cap, WORLD_SIZE);
      const u = beamMat.uniforms;
      u.uCap.value = cap;
      (u.uLight.value as THREE.Color).set(k.pitLight);
      u.uFall.value = k.beamFall;
      u.uGlow.value = k.beamGlow;
      u.uTaper.value = k.beamTaper;
      u.uSoft.value = k.beamSoft;
    }
    // 5: the section's plane, by where the eye is — its normal points away from the eye (what is beyond it is kept)
    const fg = face.current;
    if (fg) {
      const h = WORLD_SIZE / 2, R = h * Math.max(1.5, k.pitWide);
      const dist = Math.hypot(cam.x, cam.z);
      const outside = Math.abs(cam.x) > h || Math.abs(cam.z) > h;
      if (style !== "section" || !outside || dist < 1e-3) {
        cutPlane.constant = 1e9;
        fg.visible = false;
      } else {
        const dx = cam.x / dist, dz = cam.z / dist;
        cutPlane.normal.set(-dx, 0, -dz);
        cutPlane.constant = 0;
        fg.visible = true;
        // along the plane: p = u · n, n the plane's own horizontal
        const nx = -dz, nz = dx;
        const span = (half: number): [number, number] => {
          const m = half / Math.max(Math.abs(nx), Math.abs(nz), 1e-6);
          return [-m, m];
        };
        const outer = span(R), inner = span(h);
        fg.position.set(0, foot, 0);
        fg.rotation.set(0, Math.atan2(nx, nz) - Math.PI / 2, 0);
        const total = deep * 1.25;
        // [from u, to u, from depth, to depth]: left of the box, right of it, under its floor
        const parts: [number, number, number, number][] = [[outer[0], inner[0], 0, total], [inner[1], outer[1], 0, total], [inner[0], inner[1], deep, total]];
        parts.forEach((q, i) => {
          const m = faceParts.current[i];
          if (!m) return;
          m.position.set((q[0] + q[1]) / 2, -(q[2] + q[3]) / 2, 0);
          m.scale.set(Math.max(1e-3, q[1] - q[0]), Math.max(1e-3, q[3] - q[2]), 1);
        });
        faceMat.uniforms.uLight.value.set(k.pitLight);
        faceMat.uniforms.uDark.value.set(k.pitDark);
        faceMat.uniforms.uTop.value = groundY;
        faceMat.uniforms.uDeep.value = total;
        faceMat.uniforms.uBands.value = k.pitBands;
        faceMat.uniforms.uFall.value = k.pitFall;
      }
    }
    const recolour = colors.current.a !== k.vegColorA || colors.current.b !== k.vegColorB || colors.current.t !== plantTone.version;
    if (seen.current === futureLink.version && !recolour) return;
    seen.current = futureLink.version;
    colors.current = { a: k.vegColorA, b: k.vegColorB, t: plantTone.version };
    if (!r) return;
    const y0 = (r.k + 1) * unit;
    for (const kind of PART_KINDS) {
      const im = meshes.current[kind];
      if (!im) continue;
      const m = r.parts[kind], t = r.tones[kind];
      const n0 = m ? Math.min(KIND_CAP, m.length / 16) : 0;
      // A PART THAT COMES OR GOES DOES SO SOFTLY (the artist, 2026-11-18: "여튼 그것들도 이어서 처리해"): known by its
      // place and its size from one layer to the next, one new dissolves in, one gone dissolves away where it stood
      // (futureLife.ts) — [its matrix, its tone] a part
      const rec = new Float32Array(n0 * 17);
      for (let i = 0; i < n0; i++) {
        rec.set(m!.subarray(i * 16, i * 16 + 16), i * 17);
        rec[i * 17 + 16] = t ? t[i] : 0.5;
      }
      const L = (partLife.current[kind] ??= newKeyedLife());
      const lv = liveAndFading(L, futureLink.version, rec, 17, (a, o) => placeKey(a[o + 12], a[o + 14], a[o + 13] * 64 + (a[o] + a[o + 5] + a[o + 10]) * 256), performance.now() / 1000, futureLifeU.value.z);
      const n = Math.min(KIND_CAP, lv.n), arr = im.instanceMatrix.array as Float32Array;
      tint.set(kindColor[kind]);
      for (let i = 0; i < n; i++) {
        arr.set(lv.recs.subarray(i * 17, i * 17 + 16), i * 16);
        // (the column's own shading of a part by its tone)
        const v = 0.86 + 0.14 * lv.recs[i * 17 + 16];
        im.setColorAt(i, colA.setRGB(tint.r * v, tint.g * v, tint.b * v));
      }
      setLifeAttr(im.geometry, KIND_CAP, lv.life, n);
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    setLines(roads.current, r.roads, y0 + 0.03);
    setLines(roadsOld.current, r.roadsOld ?? new Float32Array(0), y0 + 0.04);
    setLines(water.current, r.water, y0 + 0.05);
    if (veg.current) {
      const n = r.veg.length / 4;
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      colA.set(k.vegColorA);
      colB.set(k.vegColorB);
      const ar = colA.r, ag = colA.g, ab = colA.b;
      for (let i = 0; i < n; i++) {
        pos[i * 3] = r.veg[i * 4];
        pos[i * 3 + 1] = y0 + r.veg[i * 4 + 1] * unit + 0.04;
        pos[i * 3 + 2] = r.veg[i * 4 + 2];
        const sh = r.veg[i * 4 + 3];
        // (livelier, each point turned its own way: plantTone.ts — the knobs of 미래 마을 층 — 땅 아래)
        tone(tint, ar + (colB.r - ar) * sh, ag + (colB.g - ag) * sh, ab + (colB.b - ab) * sh, (r.veg[i * 4] * 7.13 + r.veg[i * 4 + 2] * 3.71) % 1);
        col[i * 3] = tint.r;
        col[i * 3 + 1] = tint.g;
        col[i * 3 + 2] = tint.b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      veg.current.geometry.dispose();
      veg.current.geometry = geo;
    }
  });

  return (
    <group ref={group} visible={k.on}>
      {PART_KINDS.map((kind) => (
        <instancedMesh
          key={kind}
          ref={(m) => {
            meshes.current[kind] = m;
            if (m && !m.instanceColor) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(KIND_CAP * 3), 3);
            if (m && seen.current < 0) m.count = 0;
          }}
          args={[undefined, undefined, KIND_CAP]}
          frustumCulled={false}
          castShadow
          receiveShadow
        >
          {kind === "pile" ? <cylinderGeometry args={[0.5, 0.5, 1, 10]} /> : <boxGeometry args={[1, 1, 1]} />}
          <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} transparent={k.opacity < 1} opacity={k.opacity} depthWrite={k.opacity >= 0.99} onBeforeCompile={lifeDissolve} customProgramCacheKey={() => "future-life-dissolve"} />
        </instancedMesh>
      ))}
      {/* the paths: what has only just been walked, faint — and the frame (walked for half the band on end), bright */}
      <lineSegments ref={roads} frustumCulled={false}>
        <bufferGeometry />
        <lineBasicMaterial color="#7d8187" />
      </lineSegments>
      <lineSegments ref={roadsOld} frustumCulled={false}>
        <bufferGeometry />
        <lineBasicMaterial color="#e6e7e9" />
      </lineSegments>
      <lineSegments ref={water} frustumCulled={false}>
        <bufferGeometry />
        <lineBasicMaterial color="#6f757c" />
      </lineSegments>
      {/* (named: the folder 미래 마을 층 — 땅 아래 shows it or not — FutureUnder showInferred) */}
      <points ref={veg} name="future-veg" frustumCulled={false}>
        <bufferGeometry />
        <pointsMaterial vertexColors size={k.vegSize} sizeAttenuation />
      </points>
      {/* (no shadow on it while it is see-through at all — the artist, 2026-11-17: "반투명 땅에는 그림자 없어도 될 듯") */}
      <mesh ref={ground} visible={false} receiveShadow={k.groundOpacity >= 0.99}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial key={k.groundOpacity >= 0.99 ? "solid" : "clear"} color={k.groundColor} roughness={1} metalness={0} transparent={k.groundOpacity < 0.99} opacity={k.groundOpacity} depthWrite={k.groundOpacity >= 0.99} />
      </mesh>
      {/* THE PIT (which of these is drawn is set every frame, by the version and where the eye is): its walls and floor
          seen from inside, the wide ground round its mouth, the passage above it, the bright ceiling, the cut face */}
      <mesh ref={pit} visible={false} geometry={darkGeo} frustumCulled={false}>
        <meshBasicMaterial vertexColors toneMapped={false} clippingPlanes={cutPlanes} />
      </mesh>
      <mesh ref={rim} visible={false} geometry={rimGeo} frustumCulled={false}>
        <meshBasicMaterial color={k.pitLight} toneMapped={false} side={THREE.DoubleSide} clippingPlanes={cutPlanes} />
      </mesh>
      <mesh ref={shaft} visible={false} geometry={shaftGeo} frustumCulled={false}>
        <meshBasicMaterial vertexColors toneMapped={false} />
      </mesh>
      <mesh ref={lid} visible={false} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={k.pitLight} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={beam} visible={false} material={beamMat} frustumCulled={false} renderOrder={2}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <group ref={face} visible={false}>
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            ref={(m) => {
              faceParts.current[i] = m;
            }}
            material={faceMat}
            frustumCulled={false}
          >
            <planeGeometry args={[1, 1]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

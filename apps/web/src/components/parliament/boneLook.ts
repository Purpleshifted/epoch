/**
 * BONE — THE FOSSIL'S, THE PIPES' AND THE WAYS' MATERIAL (the artist, 2026-11-20: "좀 더 '뼈' 같은 비주얼 재질로 어떻게
 * 값싸게 만들 수 있을지도", and of the pipes and ways' fossilisation: "둘 다 해").
 *
 * CHEAP: nothing is drawn again and no pass is added — it is a few lines in the materials' own fragment shaders.
 * ITS OWN COLOUR STAYS (the artist, 2026-11-20, of the first version's ivory and ochre: "지금 뼈 색은 끔찍해 무늬랑
 * 반투명 가장자리 느낌 말한 거야"): only the pattern and the light are bone's —
 * - SPONGY: the pores of cancellous bone as a cellular texture made ONCE (32³, eight cells a side, tiling — the
 *   distances to the nearest and second-nearest cell point) and read by world position: one texture fetch a pixel,
 *   dark in the pores' middles, the struts between them a little lighter; and round the edge of every hole the
 *   fossil and the pipes already have (the decay's, the corrosion's) a band where it is porous, darker, stained;
 * - TRANSLUCENT without a transmission pass (the resin's refraction draws the scene again and is the heaviest thing
 *   the wall had): the sun's light WRAPS a little round to the shadowed side (as light scattered under the surface
 *   comes out past the terminator), warm; a warm RIM where the surface turns away from the eye; and a fill of its
 *   own colour.
 *
 * THE PIPES AND THE WAYS FOSSILISE ON THE MASS'S OWN RULER (FUSE_GROW_VERT_BODY in ParliamentSpace): the age since
 * their slot, slowed by the depth — read from where they lie, with the mass's uniforms, so they turn to bone when
 * the mass round them comes out. Their slot is read off their height: they are drawn at the slot they were laid in
 * (a pipe that much below it: the water's pipeDepth). In the field of the mass they were too many (11/16: 570 000
 * tubes, 3 fps) — here they stay what they are and only their material changes.
 */

import * as THREE from "three";

/** The bone's knobs (the folder 뼈 재질), shared by reference by every material that reads them. */
/** The pores' texture: per texel the distance to the nearest cell point and the gap to the second (in cells). */
function poreTexture(): THREE.Data3DTexture {
  const N = 32, C = 8, S = N / C;
  const pts = new Float32Array(C * C * C * 3);
  let seed = 1234567;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  const data = new Uint8Array(N * N * N * 2);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = (x + 0.5) / S, py = (y + 0.5) / S, pz = (z + 0.5) / S;
    const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
    let d1 = 9, d2 = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx, gy = cy + dy, gz = cz + dz;
      const w = (((gz % C) + C) % C) * C * C + (((gy % C) + C) % C) * C + (((gx % C) + C) % C);
      const qx = gx + pts[w * 3] - px, qy = gy + pts[w * 3 + 1] - py, qz = gz + pts[w * 3 + 2] - pz;
      const d = Math.hypot(qx, qy, qz);
      if (d < d1) [d2, d1] = [d1, d];
      else if (d < d2) d2 = d;
    }
    const o = (z * N * N + y * N + x) * 2;
    data[o] = Math.min(255, Math.round((d1 / 1.2) * 255));
    data[o + 1] = Math.min(255, Math.round(((d2 - d1) / 0.6) * 255));
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export const boneU = {
  uBoneTex: { value: typeof window === "undefined" ? null : poreTexture() },
  uBoneWrap: { value: 0.5 },
  /** the colour of the light that wraps round and of the rim — white = neutral (it was a fixed warm peach, and on the
   *  grey fossil that read as an odd pink: the artist, 2026-11-20, "이거 색이 왜 묘하게 핑크색이지?") */
  uBoneWarm: { value: new THREE.Color("#ffffff") },
  uBoneRim: { value: 0.35 },
  uBonePores: { value: 0.6 },
  uBonePoreSize: { value: 0.35 },
  uBoneFill: { value: 0.25 },
  /** the mass (1 = bone instead of the resin's colour), the pipes and the ways (how much of them turns, 0 … 1) */
  uBoneMass: { value: 1 },
  uBonePipes: { value: 1 },
  uBoneWays: { value: 1 },
};

/** The bone's colour at a point (GLSL): ivory, its pores dark and stained, more stained the older (0 … 1). */
export const BONE_GLSL = `
uniform float uBonePores, uBonePoreSize, uBoneFill, uBoneMass, uBonePipes, uBoneWays, uBoneWrap, uBoneRim;
uniform vec3 uBoneWarm;
uniform highp sampler3D uBoneTex;
// (how much of its own colour bone leaves at a point — the pores dark in their middles, the struts a little lighter,
// a fine grain; and where it is \`band\` (0 … 1) near the edge of a hole, porous through and darker)
float bonePattern( vec3 wp, float band ) {
  vec2 c = texture( uBoneTex, wp / max( 0.02, uBonePoreSize ) * 0.125 ).rg * vec2( 1.2, 0.6 );
  float open = clamp( uBonePores + 0.6 * band, 0.0, 1.0 );
  float pore = ( 1.0 - smoothstep( 0.06 + 0.12 * band, 0.3 + 0.2 * band, c.x ) ) * open;
  float fine = texture( uBoneTex, wp / max( 0.02, uBonePoreSize ) * 0.6 + 0.37 ).r;
  return ( 1.0 - 0.6 * pore ) * ( 1.0 - 0.3 * band ) * ( 0.95 + 0.1 * smoothstep( 0.0, 0.1, c.y ) ) * ( 0.96 + 0.08 * fine );
}
`;

/** THE LIGHT THROUGH IT (GLSL, after <lights_fragment_end> of a standard / physical material): the sun wraps round
 *  to the shadowed side, warm; and a warm rim where the surface turns from the eye. \`amt\`: how much it is bone. */
export const boneLight = (amt: string): string => `
#if NUM_DIR_LIGHTS > 0
if ( ${amt} > 0.0 ) {
  vec3 boneWarm = uBoneWarm;
  float boneNdl = dot( normal, directionalLights[ 0 ].direction );
  float boneWrapT = max( 0.0, ( boneNdl + uBoneWrap ) / ( 1.0 + uBoneWrap ) ) - max( 0.0, boneNdl );
  reflectedLight.directDiffuse += diffuseColor.rgb * boneWarm * directionalLights[ 0 ].color * boneWrapT * ${amt} * 0.6;
  float boneFres = pow( 1.0 - saturate( dot( normalize( vViewPosition ), normal ) ), 3.0 );
  reflectedLight.indirectDiffuse += diffuseColor.rgb * boneWarm * boneFres * uBoneRim * ${amt} * 1.5;
}
#endif
`;

/** How far a thing of slot `slot` has fossilised (GLSL, 0 … 1): the mass's ruler, with the mass's uniforms. */
export const FOSSIL_AT_GLSL = `
uniform float uGrowOn, uGrowTop, uGrowHeight, uGrowStood, uGrowAfter, uGrowDeep, uGrowAgeSpan;
float fossilAt( float slot ) {
  if ( uGrowOn < 0.5 ) return 0.0;
  float depth = ( uGrowTop - ( slot + 0.5 ) ) / max( 1.0, uGrowHeight );
  float age = uGrowTop + uGrowStood - slot - uGrowAfter;
  float t = age * ( 1.0 - uGrowDeep * ( 1.0 - clamp( depth, 0.0, 1.0 ) ) );
  return clamp( t / max( 1.0, uGrowAgeSpan ), 0.0, 1.0 );
}
`;

/** The mass's uniforms the fossil's ruler reads (a subset of ParliamentSpace's FuseUniforms, by reference). */
export type FossilClock = Record<"uGrowOn" | "uGrowTop" | "uGrowHeight" | "uGrowStood" | "uGrowAfter" | "uGrowDeep" | "uGrowAgeSpan", THREE.IUniform>;
export const pickClock = (u: FossilClock): FossilClock => ({ uGrowOn: u.uGrowOn, uGrowTop: u.uGrowTop, uGrowHeight: u.uGrowHeight, uGrowStood: u.uGrowStood, uGrowAfter: u.uGrowAfter, uGrowDeep: u.uGrowDeep, uGrowAgeSpan: u.uGrowAgeSpan });

/**
 * THE WAYS' LINES ARE KEPT IN THE STONE (a lineBasicMaterial's onBeforeCompile): an old way's line, see-through, goes
 * solid in its own colour as the mass round it fossilises — the trace kept in the stone. `unit`
 * is the height of a slot (the line's height / unit = its slot).
 */
export function wayBoneShader(clock: () => FossilClock, unit: () => number) {
  return (shader: THREE.WebGLProgramParametersWithUniforms): void => {
    Object.assign(shader.uniforms, pickClock(clock()), boneU, { uWayUnit: { get value() { return unit(); } } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWayP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWayP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vWayP;\nuniform float uWayUnit;${BONE_GLSL}${FOSSIL_AT_GLSL}`)
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\nfloat wayF = fossilAt( vWayP.y / max( 1e-4, uWayUnit ) ) * uBoneWays;\nif ( wayF > 0.0 ) diffuseColor.a = mix( diffuseColor.a, 1.0, 0.85 * wayF );",
      );
  };
}

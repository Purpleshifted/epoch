/**
 * BONE — THE FOSSIL'S, THE PIPES' AND THE WAYS' MATERIAL (the artist, 2026-11-20: "좀 더 '뼈' 같은 비주얼 재질로 어떻게
 * 값싸게 만들 수 있을지도", and of the pipes and ways' fossilisation: "둘 다 해").
 *
 * CHEAP: nothing is drawn again and no pass is added — it is a few lines in the materials' own fragment shaders.
 * - ivory, stained ochre where it is old and in its pores (iron seeping in from the ground);
 * - SPONGY: the pores of cancellous bone as a cellular noise in world space (eight cells a pixel: the 2×2×2 of
 *   Worley's nearest neighbours), dark in their middles, the struts between them a little lighter;
 * - the light that seems to come through it (bone is a little translucent) as a fill of its own colour — no
 *   transmission pass (the resin's refraction draws the scene again and is the heaviest thing the wall had).
 *
 * THE PIPES AND THE WAYS FOSSILISE ON THE MASS'S OWN RULER (FUSE_GROW_VERT_BODY in ParliamentSpace): the age since
 * their slot, slowed by the depth — read from where they lie, with the mass's uniforms, so they turn to bone when
 * the mass round them comes out. Their slot is read off their height: they are drawn at the slot they were laid in
 * (a pipe that much below it: the water's pipeDepth). In the field of the mass they were too many (11/16: 570 000
 * tubes, 3 fps) — here they stay what they are and only their material changes.
 */

import * as THREE from "three";

/** The bone's knobs (the folder 뼈 재질), shared by reference by every material that reads them. */
export const boneU = {
  uBoneIvory: { value: new THREE.Color("#e6dccb") },
  uBoneStain: { value: new THREE.Color("#94764e") },
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
uniform vec3 uBoneIvory, uBoneStain;
uniform float uBonePores, uBonePoreSize, uBoneFill, uBoneMass, uBonePipes, uBoneWays;
vec3 boneH3( vec3 p ) {
  return fract( sin( vec3( dot( p, vec3( 127.1, 311.7, 74.7 ) ), dot( p, vec3( 269.5, 183.3, 246.1 ) ), dot( p, vec3( 113.5, 271.9, 124.6 ) ) ) ) * 43758.5453 );
}
// (the nearest and second-nearest of the cells' points: the eight cells round the nearest corner)
vec2 boneCells( vec3 p ) {
  vec3 i = floor( p ), f = fract( p ), o = step( 0.5, f ) - 1.0;
  float d1 = 9.0, d2 = 9.0;
  for ( int z = 0; z < 2; z ++ ) for ( int y = 0; y < 2; y ++ ) for ( int x = 0; x < 2; x ++ ) {
    vec3 g = o + vec3( float( x ), float( y ), float( z ) );
    vec3 r = g + boneH3( i + g ) - f;
    float d = dot( r, r );
    if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d;
  }
  return vec2( sqrt( d1 ), sqrt( d2 ) - sqrt( d1 ) );
}
vec3 boneColour( vec3 wp, float age ) {
  vec2 c = boneCells( wp / max( 0.02, uBonePoreSize ) );
  float pore = ( 1.0 - smoothstep( 0.06, 0.3, c.x ) ) * uBonePores;
  float fine = boneH3( floor( wp / max( 0.02, uBonePoreSize ) * 5.0 ) ).x;
  float stain = clamp( 0.15 + 0.45 * age + 0.7 * pore + 0.25 * ( fine - 0.5 ), 0.0, 1.0 );
  vec3 col = mix( uBoneIvory, uBoneStain, stain * 0.6 );
  col *= ( 1.0 - 0.6 * pore ) * ( 0.95 + 0.1 * smoothstep( 0.0, 0.1, c.y ) );
  return col;
}
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
 * THE WAYS' LINES TURN TO BONE (a lineBasicMaterial's onBeforeCompile): an old way's line goes from its own grey,
 * see-through, to the bone's ivory and solid, as the mass round it fossilises — the trace kept in the stone. `unit`
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
        "#include <color_fragment>\nfloat wayF = fossilAt( vWayP.y / max( 1e-4, uWayUnit ) ) * uBoneWays;\nif ( wayF > 0.0 ) {\n\tdiffuseColor.rgb = mix( diffuseColor.rgb, mix( uBoneIvory, uBoneStain, 0.25 * wayF ), wayF );\n\tdiffuseColor.a = mix( diffuseColor.a, 1.0, 0.85 * wayF );\n}",
      );
  };
}

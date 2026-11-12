/**
 * ARRIVAL ON THE WALL: a part is BUILT, it does not pop (the artist, 2026-11-12: "건물 지어지는 거 좀 더 연속적으로
 * 보이게 가능한가?"). The model gives every instance when it was first there and where in its slot's order of building
 * it starts (arrive.ts, `aBorn`); this vertex shader brings it in from then on. Per frame only the
 * time uniform moves — no buffer is uploaded, no part is touched on the main thread.
 *
 * Three ways (the knob "들어오는 방식"), all inside the part's own unit box, before its instance matrix:
 *   grow    it rises from its own base to its full height (a tilted brace along its own length)
 *   settle  it comes down from above onto its place, growing to its size on the way
 *   swell   it grows from its own centre
 * A part whose turn has not come yet is not drawn at all (collapsed to a point). Duration 0 = off: every part is
 * simply there, as before.
 */

import * as THREE from "three";

export type ArriveWay = "grow" | "settle" | "swell";
const WAY: Record<ArriveWay, number> = { grow: 0, settle: 1, swell: 2 };

export interface ArriveUniforms {
  /** Seconds on the model's arrival clock (PartsResult.bornEpochMs). */
  uArriveNow: { value: number };
  /** How long one part takes (s); 0 = off. */
  uArriveDur: { value: number };
  /** The parts of one slot start one after another over this long (s). */
  uArriveStagger: { value: number };
  uArriveWay: { value: number };
  /** settle: from how far above (world). */
  uArriveLift: { value: number };
}

export function makeArriveUniforms(): ArriveUniforms {
  return { uArriveNow: { value: 0 }, uArriveDur: { value: 0 }, uArriveStagger: { value: 0 }, uArriveWay: { value: 0 }, uArriveLift: { value: 1 } };
}

export function setArrive(u: ArriveUniforms, a: { on: boolean; sec: number; stagger: number; way: ArriveWay; lift: number }): void {
  u.uArriveDur.value = a.on ? Math.max(0, a.sec) : 0;
  u.uArriveStagger.value = Math.max(0, a.stagger);
  u.uArriveWay.value = WAY[a.way] ?? 0;
  u.uArriveLift.value = a.lift;
}

const HEAD = "attribute vec2 aBorn;\nuniform float uArriveNow, uArriveDur, uArriveStagger, uArriveWay, uArriveLift;";
const BODY = `
#ifdef USE_INSTANCING
if (uArriveDur > 0.0) {
  float arriveP = clamp((uArriveNow - aBorn.x - aBorn.y * uArriveStagger) / uArriveDur, 0.0, 1.0);
  float arriveG = 1.0 - (1.0 - arriveP) * (1.0 - arriveP) * (1.0 - arriveP);
  if (uArriveWay < 0.5) {
    transformed.y = (transformed.y + 0.5) * arriveG - 0.5;
  } else if (uArriveWay < 1.5) {
    transformed *= smoothstep(0.0, 0.4, arriveP);
    transformed.y += (1.0 - arriveG) * uArriveLift / max(1e-4, length(instanceMatrix[1].xyz));
  } else {
    transformed *= arriveG;
  }
  transformed *= step(1e-4, arriveP);
}
#endif`;

/** `onBeforeCompile` for a part's material (and its shadow's): the instance comes in by `aBorn`. */
export function arriveCompile(u: ArriveUniforms): (shader: { uniforms: Record<string, unknown>; vertexShader: string }) => void {
  return (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${HEAD}`).replace("#include <begin_vertex>", `#include <begin_vertex>${BODY}`);
  };
}

/** The shadow of an arriving part arrives with it (three.js would otherwise cast the whole part's from the start). */
export function arriveDepthMaterial(u: ArriveUniforms): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial();
  m.onBeforeCompile = arriveCompile(u);
  return m;
}

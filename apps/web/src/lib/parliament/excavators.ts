/**
 * parliament/excavators.ts — THE FUTURE'S ARCHAEOLOGISTS (the artist, 2026-11-22: "미래에서는 늘 고고학 봇 6-7개 정도가
 * 돌아다니고, 미래는 z 축 따로 없으니 xy 에서만 돌아가니겠지 아마. 걔들이랑 xy 좌표가 일정 범위 내로 겹칠 때 '미래가
 * 당신을 응시합니다...' 혹은 '미래가 당신의 삶을 발견했습니다' 등의 안내멘트 로그와 함께 그 인근 미래의 모습을
 * pointcloud 로 보여줬다가 쏴아 사라져서 잔상처럼").
 *
 * A few walkers of the layer of what is found after the people are gone. They have no time axis: they walk its ground
 * only, from one spot to the next and stand there a while, for good. They are not bots of the bot server — they are a
 * pure function of the world's epoch and its clock, so every view (each phone, the wall) sees the same ones at the same
 * places with nothing sent. Where one crosses a visitor (on the ground, whatever the visitor's time) the future near
 * the visitor shows itself for a moment (FuturePresence.tsx).
 */

import { wrapCoord, wrapDelta } from "./world";

export interface ExcavatorConfig {
  /** How many walk the future (the artist: 6–7). */
  count: number;
  /** The disc round the world's middle they walk in (world units; the villages' ground is about 44). */
  roam: number;
  /** Seconds of one leg: walking to the next spot and standing there. */
  legSec: number;
  /** The share of a leg spent standing at the spot. */
  stand: number;
}

export const DEFAULT_EXCAVATORS: ExcavatorConfig = { count: 7, roam: 44, legSec: 24, stand: 0.35 };

export interface Excavator {
  i: number;
  x: number;
  z: number;
  /** Which way it walks (a unit vector; the last leg's while it stands). */
  dx: number;
  dz: number;
  standing: boolean;
}

const hash = (a: number, b: number, c: number): number => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

/** The spot of excavator `i`'s leg `leg` in the world `seed`: a point of the roaming disc (even over its area). */
function spot(seed: number, i: number, leg: number, roam: number): [number, number] {
  const a = hash(seed, i * 7919 + 13, leg) * Math.PI * 2, r = roam * Math.sqrt(hash(seed, i * 7919 + 29, leg));
  return [wrapCoord(Math.cos(a) * r), wrapCoord(Math.sin(a) * r)];
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Where every excavator is at `sec` seconds of the world `epochMs`. */
export function excavatorsAt(epochMs: number, sec: number, cfg: ExcavatorConfig = DEFAULT_EXCAVATORS): Excavator[] {
  const seed = Math.floor(epochMs / 1000) % 2147483647;
  const L = Math.max(4, cfg.legSec), walk = 1 - Math.max(0, Math.min(0.9, cfg.stand));
  const out: Excavator[] = [];
  for (let i = 0; i < Math.max(0, Math.round(cfg.count)); i++) {
    // (each its own pace: a leg 0.75 … 1.25 of `legSec`, and its own phase)
    const Li = L * (0.75 + 0.5 * hash(seed, i, 401));
    const t = Math.max(0, sec) + hash(seed, i, 402) * Li;
    const leg = Math.floor(t / Li), u = t / Li - leg;
    const [ax, az] = spot(seed, i, leg, cfg.roam), [bx, bz] = spot(seed, i, leg + 1, cfg.roam);
    const ddx = wrapDelta(bx - ax), ddz = wrapDelta(bz - az), len = Math.hypot(ddx, ddz) || 1;
    const f = u < walk ? smooth(u / walk) : 1;
    out.push({ i, x: wrapCoord(ax + ddx * f), z: wrapCoord(az + ddz * f), dx: ddx / len, dz: ddz / len, standing: u >= walk });
  }
  return out;
}

"use client";
/**
 * StreetHud — 방향 말 (the artist, 2026-11-22 evening: "아예 내가 움직이고 가까이 가야지만 알 수 있도록 '현재'에 대한 경험도 …
 * 눈에 나타나기 전까지는 로그랑 사운드로만 단서를 받을 수 있도록"). Three rings round the walker: far, the sound alone (the
 * headset's panning, lib/sound — untouched here); the MIDDLE ring, a line of words with a direction, from this; near, the
 * eye (PointPeople, and the 시야 반경 fog that hides what is farther).
 *
 * Reads the record's far list (witnessRef.far: everyone within the view radius, nearest first) and the gaze (the
 * controller's yaw), and says, at most once every `everySec`, where the nearest unseen one is — relative to where the
 * visitor looks ("왼쪽 어딘가에서 누군가 걷고 있다", "앞에 무언가 서 있다"). Nothing is written to the record itself (witness.ts,
 * the recording); this is a line beside the log, in the log's place. Korean or English by `lang`.
 */

import { useEffect, useState } from "react";
import type { Lang, Other } from "@/lib/parliament";

export type LogPlace = "bottom" | "left" | "top";

const SECTORS_KO = ["앞", "오른쪽 앞", "오른쪽", "오른쪽 뒤", "뒤", "왼쪽 뒤", "왼쪽", "왼쪽 앞"];
const SECTORS_EN = ["ahead", "ahead to the right", "to the right", "behind to the right", "behind", "behind to the left", "to the left", "ahead to the left"];

/** Which of eight sectors round the gaze `(dx, dz)` falls in: 0 = ahead, clockwise (right = 2). */
export function sectorOf(dx: number, dz: number, yaw: number): number {
  // forward = (sin yaw, cos yaw); a positive turn from it is to the right
  const a = Math.atan2(dx, dz) - yaw;
  const k = Math.round(a / (Math.PI / 4));
  return ((k % 8) + 8) % 8;
}

/** The line for someone in sector `s`, walking or standing. */
export function hintLine(s: number, moving: boolean, lang: Lang): string {
  if (lang === "ko") {
    const dir = SECTORS_KO[s];
    return moving ? `${dir} 어딘가에서 누군가 걷고 있다` : `${dir}에 무언가 서 있다`;
  }
  const dir = SECTORS_EN[s];
  return moving ? `someone is walking somewhere ${dir}` : `something stands ${dir}`;
}

export function StreetHud({
  getFar,
  playerPosRef,
  playerYawRef,
  place,
  lang,
  coarse = false,
  nearRadius,
  farRadius,
  everySec = 6,
  showSec = 7,
}: {
  getFar: () => readonly Other[] | null | undefined;
  playerPosRef: React.MutableRefObject<{ x: number; z: number }>;
  playerYawRef: React.MutableRefObject<number>;
  /** Where the log stands (the line stands by it). */
  place: LogPlace;
  lang: Lang;
  coarse?: boolean;
  /** Inside this (world) they are seen — no words; words are for those between it and `farRadius`. */
  nearRadius: number;
  farRadius: number;
  /** At most one line every this many seconds; a line stays this long. */
  everySec?: number;
  showSec?: number;
}) {
  const [line, setLine] = useState<{ text: string; key: string } | null>(null);
  useEffect(() => {
    let lastAt = 0, lastKey = "", hide = 0;
    const id = window.setInterval(() => {
      const now = performance.now();
      const far = getFar();
      if (!far || !far.length) return;
      // the nearest one beyond the eye's reach
      const o = far.find((f) => f.dist > nearRadius && f.dist <= farRadius);
      if (!o) return;
      const p = playerPosRef.current;
      const s = sectorOf(o.x - p.x, o.z - p.z, playerYawRef.current);
      const key = `${o.o}:${s}:${o.moving ? 1 : 0}`;
      // a new line only when there is something new to say, or the old one is long gone
      if (now - lastAt < everySec * 1000) return;
      if (key === lastKey && now - lastAt < everySec * 3000) return;
      lastAt = now;
      lastKey = key;
      setLine({ text: hintLine(s, o.moving, lang), key });
      // the line goes after showSec (unless a newer one has taken its place)
      window.clearTimeout(hide);
      hide = window.setTimeout(() => setLine((l) => (l && l.key === key ? null : l)), showSec * 1000);
    }, 500);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(hide);
    };
  }, [getFar, playerPosRef, playerYawRef, nearRadius, farRadius, everySec, showSec, lang]);
  if (!line) return null;
  const say = lang === "ko" ? "hud-ko" : "";
  // by the log: the left column's head (a laptop), under the top strip (a phone), or above the bottom box
  // (the left: just beside the record's long panel when there is one — --log-panel, ParliamentScene — else at the edge)
  const pos = place === "left" ? "top-6 max-w-[min(48vw,36rem)]" : place === "top" ? "inset-x-0 top-[10.5rem] flex justify-center px-3" : "left-4 bottom-[11.5rem] max-w-[36rem]";
  return (
    <div className={`pointer-events-none absolute select-none ${pos}`} style={place === "left" ? { left: "calc(var(--log-panel, 0px) + 1rem)" } : undefined}>
      <div className={`${say} border border-white bg-black px-3 py-1.5 text-white ${coarse ? "text-[14px]" : "text-[15px]"} leading-[1.25] tracking-[0.04em]`}>{line.text}</div>
    </div>
  );
}

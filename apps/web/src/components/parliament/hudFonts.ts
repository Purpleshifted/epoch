/**
 * hudFonts — the faces the player view can speak in, to compare on the screen (Leva 개인뷰 비주얼 › 글꼴; the artist,
 * 2026-11-01: "폰트도 별로라는 평"). All free and self-hosted at build time like VT323; only the one in use is fetched by
 * the browser (no preload). neodgm is the pixel face that has been there (`.hud-ko`, globals.css, Korean only).
 */

import { Black_Han_Sans, Gowun_Batang, Hahmlet, IBM_Plex_Sans_KR, Nanum_Gothic_Coding } from "next/font/google";

const plex = IBM_Plex_Sans_KR({ weight: "400", subsets: ["latin"], preload: false, display: "swap" });
const coding = Nanum_Gothic_Coding({ weight: "400", subsets: ["latin"], preload: false, display: "swap" });
const batang = Gowun_Batang({ weight: "400", subsets: ["latin"], preload: false, display: "swap" });
const hahmlet = Hahmlet({ weight: "400", subsets: ["latin"], preload: false, display: "swap" });
const blackHan = Black_Han_Sans({ weight: "400", subsets: ["latin"], preload: false, display: "swap" });

const CLASSES = {
  neodgm: "hud-ko",
  plex: plex.className,
  coding: coding.className,
  batang: batang.className,
  hahmlet: hahmlet.className,
  blackHan: blackHan.className,
};

export type HudFont = keyof typeof CLASSES;

export const HUD_FONT_OPTIONS: Record<string, HudFont> = {
  "Neo둥근모 — 지금, 픽셀": "neodgm",
  "IBM Plex Sans KR — 깔끔한 고딕": "plex",
  "나눔고딕코딩 — 고정폭, 터미널": "coding",
  "고운바탕 — 부드러운 명조": "batang",
  "함렛 — 각진 명조": "hahmlet",
  "검은고딕 — 굵은 표지": "blackHan",
};

/** The class for a face; the pixel face has no Latin of its own, so English stays in VT323 with it. */
export function hudFontClass(font: HudFont, lang: "ko" | "en"): string {
  return font === "neodgm" && lang !== "ko" ? "" : CLASSES[font];
}

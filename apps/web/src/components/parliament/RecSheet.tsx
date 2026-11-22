"use client";
/**
 * RecSheet — the paper the specimen card's QR opens on (the design canvas's "QR로 여는 페이지", 2026-11-21, taken into
 * the app 11/22): white, the title and the day, the being's number with its melody, then what the page is for (the
 * recording: app/rec/[id]/RecPlayer; the 발굴노트: app/rec/[id]/note), the ways on (발굴노트, 웹포스터, 갤러리), and the
 * record card's last two lines. GalmuriMono11, the card's face.
 */

import { glyphOf, individualNo, type Lang } from "@/lib/parliament";
import { Glyph } from "./Glyph";

/** The web poster (the motion poster site, poster-motion/). */
export const WEB_POSTER = "https://homo-inventus.vercel.app";

export const SHEET_WORDS = {
  ko: {
    title: "발견된 인류",
    who: (no: string) => `개체 ${no}`,
    listen: "삶의 흔적을 간직하고 들어보세요",
    play: "재생",
    pause: "멈춤",
    note: "발굴노트",
    noteSub: "이 삶의 기록표",
    poster: "웹포스터",
    posterSub: "발견된 인류 — Homo inventus",
    gallery: "갤러리",
    gallerySub: "게시된 삶들",
    recording: "녹음",
    recordingSub: "이 삶 동안 들은 소리",
    loading: "불러오는 중…",
    waiting: "녹음이 올라오기를 기다리는 중… 삶의 잔향이 다 울리면 올라옵니다.",
    missing: "이 기록은 아직 없습니다.",
    noNote: "이 삶의 발굴노트는 남아 있지 않습니다.",
    local: "이 기기에 보관된 사본",
    life: "존속",
    kept: "기록은 남습니다.",
    read: "흔적은 벽의 창에서 읽힐 수도, 읽히지 않을 수도 있습니다.",
  },
  en: {
    title: "Homo inventus",
    who: (no: string) => `No. ${no}`,
    listen: "Keep the traces of a life, and listen",
    play: "Play",
    pause: "Pause",
    note: "Excavation note",
    noteSub: "this life's record",
    poster: "Web poster",
    posterSub: "Homo inventus",
    gallery: "Gallery",
    gallerySub: "the posted lives",
    recording: "Recording",
    recordingSub: "what this life heard",
    loading: "Loading…",
    waiting: "Waiting for the recording… it goes up once the life's last reverb has rung out.",
    missing: "This record is not here yet.",
    noNote: "No excavation note was kept for this life.",
    local: "this device's own copy",
    life: "Lived",
    kept: "The record remains.",
    read: "The traces may or may not be read in the wall's window.",
  },
} as const;

const two = (v: number) => String(v).padStart(2, "0");
/** 2026.12.14 15:42 */
export function sheetDate(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}.${two(d.getMonth() + 1)}.${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** The page itself: white paper, the card's face, one column. */
export function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-white text-[#111111]" style={{ fontFamily: "GalmuriMono11, monospace" }}>
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[34rem] flex-col gap-6 px-6 py-7 text-[13px] leading-[1.5]">{children}</div>
    </main>
  );
}

/** The title and the day; the being's number, big, with its melody. */
export function SheetHead({ lang, me, at, extra }: { lang: Lang; me: string; at: number; extra?: string }) {
  const W = SHEET_WORDS[lang];
  return (
    <>
      <div className="flex items-baseline justify-between gap-4 text-[#6b6b66]">
        <span>{extra ? `${W.title} · ${extra}` : W.title}</span>
        <span className="text-[12px]">{sheetDate(at)}</span>
      </div>
      {me && (
        <div className="flex items-end justify-between">
          <span className="text-[52px] leading-none">{individualNo(me)}</span>
          <Glyph dots={glyphOf(me)} cell={6.5} />
        </div>
      )}
    </>
  );
}

/** The ways on from the page: each a row with what it is under it. */
export function SheetLinks({ links }: { links: { href: string; label: string; sub: string; external?: boolean }[] }) {
  return (
    <nav className="flex flex-col border-t border-[#111111]">
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          {...(l.external ? { target: "_blank", rel: "noopener" } : {})}
          className="flex min-h-[52px] items-center justify-between gap-4 border-b border-[#111111] py-2 outline-none active:bg-[#111111] active:text-white"
        >
          <span className="flex flex-col">
            <span>{l.label}</span>
            <span className="text-[12px] text-[#6b6b66]">{l.sub}</span>
          </span>
          <span aria-hidden>{l.external ? "↗" : "→"}</span>
        </a>
      ))}
    </nav>
  );
}

/** The record card's last two lines. */
export function SheetFoot({ lang }: { lang: Lang }) {
  const W = SHEET_WORDS[lang];
  return (
    <div className="mt-auto flex flex-col gap-1 pt-4 text-[12px]">
      <span>{W.kept}</span>
      <span className="text-[#6b6b66]">{W.read}</span>
    </div>
  );
}

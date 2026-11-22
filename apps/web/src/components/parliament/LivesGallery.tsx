"use client";
/**
 * LivesGallery — the posted lives (the artist, 2026-11-22: "게시공간 … 게시하기 누르고 나면 갤러리 보기 … 거기 녹음본 찾을
 * 수 있는 공간"): every life a visitor posted or printed, newest first, each as its specimen card the way the visitor set
 * it (paper, orientation), its number, when, posted or printed; a card opens its recording (/rec/<id>). A life not
 * posted is not here (its recording is on the Worker, reachable only by the QR it got). From /api/lives; on a branch
 * preview that is production's, trials included (marked).
 *
 * On the gallery machine (`venue=gallery`) the gallery gives the screen back by itself: IDLE_SEC without a touch, a key
 * or a scroll and it goes to the experience (`back`, the page 갤러리 보기 came from; else the exhibition's personal view)
 * — the artist, 2026-11-22: "갤러리 홈에서 일정시간 이상 지나면 경험창으로". 돌아가기 goes there too.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { glyphOf, individualNo, plateSize, plateSvg, type PlateInput, type PlateOrient, type PlateTheme } from "@/lib/parliament";
import { qrModules } from "@/lib/qr";

interface Life {
  id: string;
  card: PlateInput;
  look: { theme?: PlateTheme; orient?: PlateOrient };
  via: "post" | "print";
  recordingUrl: string | null;
  postedAt: number;
  trial?: boolean;
}

type Lang = "ko" | "en";

const WORDS = {
  ko: {
    title: "갤러리",
    count: (n: number, more: boolean) => `게시된 삶 ${n}${more ? "+" : ""}`,
    back: "돌아가기",
    loading: "불러오는 중…",
    empty: "아직 게시된 삶이 없습니다.",
    failed: "갤러리를 불러오지 못했습니다.",
    more: "더 보기",
    no: (n: string) => `개체 ${n}`,
    via: { post: "게시", print: "출력" },
    noRecording: "녹음 없음",
    trial: "시험",
    preview: "미리보기 — 실서비스의 갤러리에 시험 게시를 더해 보여 줍니다.",
    listen: "카드를 누르면 그 삶의 녹음이 열립니다.",
  },
  en: {
    title: "Gallery",
    count: (n: number, more: boolean) => `${n}${more ? "+" : ""} lives posted`,
    back: "Back",
    loading: "Loading…",
    empty: "No life has been posted yet.",
    failed: "Could not load the gallery.",
    more: "More",
    no: (n: string) => `No. ${n}`,
    via: { post: "posted", print: "printed" },
    noRecording: "no recording",
    trial: "trial",
    preview: "Preview — the production gallery, with trial posts.",
    listen: "Tap a card to hear that life.",
  },
} as const;

const PAGE = 60;
/** The gallery machine's gallery goes back to the experience after this long untouched (s). */
const IDLE_SEC = 60;
/** A way back that stays on this site (a path, not another origin). */
const safeBack = (b: string | undefined): string | null => (b && b.startsWith("/") && !b.startsWith("//") ? b : null);
const two = (v: number) => String(v).padStart(2, "0");
const when = (ms: number) => {
  const d = new Date(ms);
  return `${two(d.getMonth() + 1)}.${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};
/** The recording's page on this site (the stored address may carry another origin: a preview's, localhost). */
const recPath = (url: string | null): string | null => {
  if (!url) return null;
  try {
    const p = new URL(url).pathname;
    return /^\/rec\/[^/]+$/.test(p) ? p : null;
  } catch {
    return null;
  }
};

export default function LivesGallery({ lang = "ko", venue, back }: { lang?: Lang; venue?: string; back?: string }) {
  const W = WORDS[lang];
  const kiosk = venue === "gallery";
  /** The experience this gallery returns to. */
  const home = safeBack(back) ?? `/exhibition/personal?${kiosk ? "venue=gallery&" : ""}lang=${lang}`;
  const [lives, setLives] = useState<Life[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [more, setMore] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(async (before?: number) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await fetch(`/api/lives?limit=${PAGE}${before ? `&before=${before}` : ""}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { lives?: Life[]; from?: string };
      const got = (j.lives ?? []).filter((l) => l && typeof l.id === "string" && l.card && typeof l.card === "object");
      setLives((was) => (before ? [...was, ...got.filter((g) => !was.some((w) => w.id === g.id))] : got));
      setMore(got.length === PAGE);
      setFrom(j.from ?? null);
      setState("ready");
    } catch {
      setState((s) => (s === "loading" ? "failed" : s));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const goBack = () => {
    if (!safeBack(back) && !kiosk && window.history.length > 1) window.history.back();
    else window.location.replace(home);
  };

  // the gallery machine: untouched for IDLE_SEC, the screen goes back to the experience for the next visitor
  useEffect(() => {
    if (!kiosk) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => window.location.replace(home), IDLE_SEC * 1000);
    };
    const kinds = ["pointerdown", "pointermove", "wheel", "scroll", "keydown", "touchstart"] as const;
    for (const k of kinds) window.addEventListener(k, arm, { passive: true });
    arm();
    return () => {
      window.clearTimeout(timer);
      for (const k of kinds) window.removeEventListener(k, arm);
    };
  }, [kiosk, home]);

  return (
    <main className="min-h-[100dvh] bg-black px-4 pb-16 pt-6 text-[14px] leading-[1.45] text-white" style={{ fontFamily: "GalmuriMono11, monospace" }}>
      <div className="mx-auto w-full max-w-[72rem]">
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-4">
            <h1 className="text-[24px] font-normal">{W.title}</h1>
            {state === "ready" && <span className="text-[#8c8c8c]">{W.count(lives.length, more)}</span>}
          </div>
          <button type="button" onClick={goBack} className="min-h-[44px] border border-white/40 px-4 text-white/80 outline-none">
            {W.back}
          </button>
        </div>
        {from && <div className="mt-1 text-[12px] text-[#8c8c8c]">{W.preview}</div>}
        {state === "ready" && lives.length > 0 && <div className="mt-1 text-[12px] text-[#8c8c8c]">{W.listen}</div>}
        {state === "loading" && <div className="mt-10 text-[#8c8c8c]">{W.loading}</div>}
        {state === "failed" && <div className="mt-10">{W.failed}</div>}
        {state === "ready" && lives.length === 0 && <div className="mt-10">{W.empty}</div>}
        <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {lives.map((l) => (
            <Tile key={l.id} life={l} lang={lang} />
          ))}
        </div>
        {more && (
          <div className="mt-8 flex justify-center">
            <button type="button" onClick={() => void load(lives[lives.length - 1]?.postedAt)} className="min-h-[44px] border border-white px-6 outline-none">
              {W.more}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

/** One posted life: its card (drawn when it comes into view — each one draws its worldline), number, when, how. */
function Tile({ life, lang }: { life: Life; lang: Lang }) {
  const W = WORDS[lang];
  const box = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const path = recPath(life.recordingUrl);
  const orient: PlateOrient = life.look?.orient === "landscape" ? "landscape" : "portrait";
  const theme: PlateTheme = life.look?.theme === "screen" ? "screen" : "paper";
  const svg = useMemo(() => {
    if (!seen) return null;
    try {
      const qr = path ? qrModules(`${window.location.origin}${path}`) : null;
      return plateSvg({ ...life.card, qr }, glyphOf, { theme, orient });
    } catch {
      return "";
    }
  }, [seen, life.card, path, theme, orient]);
  const { w, h } = plateSize(orient);
  let no = "";
  try {
    no = individualNo(String(life.card.me ?? ""));
  } catch {
    /* a card without its being */
  }
  const card = (
    <div ref={box} className="flex aspect-square w-full items-center justify-center">
      <div
        className={`outline outline-1 outline-white/20 [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${svg ? "" : "bg-white/5"}`}
        style={{ aspectRatio: `${w} / ${h}`, [orient === "landscape" ? "width" : "height"]: "100%" }}
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
    </div>
  );
  return (
    <div className="min-w-0">
      {path ? (
        <Link href={path} className="block outline-none">
          {card}
        </Link>
      ) : (
        card
      )}
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-2 text-[13px]">
        <span>{W.no(no)}</span>
        <span className="text-[#8c8c8c]">{when(life.postedAt)}</span>
      </div>
      <div className="flex flex-wrap gap-x-2 text-[12px] text-[#8c8c8c]">
        <span>{W.via[life.via] ?? life.via}</span>
        {!path && <span>· {W.noRecording}</span>}
        {life.trial && <span className="text-white/70">· {W.trial}</span>}
      </div>
    </div>
  );
}

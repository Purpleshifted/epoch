"use client";
/**
 * MobileLabStage — one page of the mobile view lab (mobileLab.ts): the personal view itself (ParliamentScene, `lab`)
 * with the life begun at once, the asset alone on its page (or everything, in the action preview), its Leva group and
 * the shared ground listed and nothing else, the references beside it (local only), and a bar to the other pages.
 * The test scene each asset needs is put on the address when missing (?botserver=0 always on an asset page: the lab
 * never joins the shared bot world; ?crowd= for the people, ?futurefix= for an observer in view).
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { levaStore } from "leva";
import { LAB_ASSETS, LAB_INFO, installLabPanelFilter, setMobileLab, type LabPage } from "./mobileLab";

const ParliamentScene = dynamic(() => import("./ParliamentScene"), {
  ssr: false,
  loading: () => <div className="h-screen w-full bg-[#f4f2ec]" />,
});

/** The address with what the page's test scene needs added; null when nothing is missing. */
function withScene(page: LabPage): string | null {
  const url = new URL(window.location.href);
  let changed = false;
  for (const [k, v] of Object.entries(LAB_INFO[page].query)) {
    if (url.searchParams.has(k)) continue;
    url.searchParams.set(k, v);
    changed = true;
  }
  return changed ? url.toString() : null;
}

/** The preview's two scenes: the rehearsal's world as it runs (the bot server, read only), or the lab's fixed test scene. */
const PREVIEW_TEST = "?botserver=0&crowd=24&futurefix=1";

export default function MobileLabStage({ page }: { page: LabPage }) {
  // (set while rendering, before the scene's Leva reads which groups to list — and only while this page is open)
  setMobileLab(page);
  installLabPanelFilter(levaStore);
  useEffect(() => {
    setMobileLab(page);
    return () => setMobileLab(null);
  }, [page]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const to = withScene(page);
    if (to) window.location.replace(to);
    else setReady(true);
  }, [page]);
  const info = LAB_INFO[page];
  const [refsOn, setRefsOn] = useState(true);
  const [big, setBig] = useState<string | null>(null);
  const [missing, setMissing] = useState<Set<string>>(() => new Set());
  const refs = info.refs.filter((f) => !missing.has(f));
  if (!ready) return <div className="fixed inset-0 bg-[#f4f2ec]" />;
  return (
    <div className="fixed inset-0 bg-[#f4f2ec]">
      <ParliamentScene lab={page} />
      {/* the bar: back to the lab, this page, the other pages (a click here is never a gesture of the life — data-hud-control) */}
      <div data-hud-control className="pointer-events-auto absolute left-1/2 top-2 z-20 flex -translate-x-1/2 items-center gap-2 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-white/80">
        <Link href="/lab/mobile" className="text-white/50 hover:text-white">
          ← lab
        </Link>
        {[...LAB_ASSETS, "preview" as const].map((p) => (
          <a key={p} href={`/lab/mobile/${p}`} className={p === page ? "text-white underline" : "text-white/50 hover:text-white"}>
            {LAB_INFO[p].name}
          </a>
        ))}
        {page === "preview" && (
          <>
            <span className="text-white/30">|</span>
            <a href="/lab/mobile/preview" className="text-white/50 hover:text-white" title="the rehearsal's world as it runs (bot server, read only)">
              리허설 세계
            </a>
            <a href={`/lab/mobile/preview${PREVIEW_TEST}`} className="text-white/50 hover:text-white" title="no bot server · 24 test walkers · one observer in view">
              시험 장면
            </a>
          </>
        )}
        {refs.length > 0 && (
          <button type="button" className="text-white/50 hover:text-white" onClick={() => setRefsOn((v) => !v)}>
            {refsOn ? "레퍼런스 끄기" : "레퍼런스"}
          </button>
        )}
      </div>
      {/* the references (visual_reference_images/mobile_view_refs, read through the dev-only route): a strip along the
          bottom right; a click enlarges one, another click closes it */}
      {refsOn && refs.length > 0 && (
        <div data-hud-control className="pointer-events-auto absolute bottom-2 right-2 z-20 flex max-w-[60vw] gap-1 overflow-x-auto">
          {refs.map((f) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={f}
              src={`/api/dev-refs?f=${encodeURIComponent(f)}`}
              alt={f}
              title={f}
              className="h-24 w-auto cursor-zoom-in rounded-sm object-cover opacity-90 hover:opacity-100"
              onClick={() => setBig(f)}
              onError={() => setMissing((m) => new Set(m).add(f))}
            />
          ))}
        </div>
      )}
      {big && (
        <div data-hud-control className="pointer-events-auto absolute inset-0 z-30 flex cursor-zoom-out items-center justify-center bg-black/80" onClick={() => setBig(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/dev-refs?f=${encodeURIComponent(big)}`} alt={big} className="max-h-[92vh] max-w-[92vw] object-contain" />
          <div className="absolute bottom-3 font-mono text-[10px] text-white/60">{big}</div>
        </div>
      )}
    </div>
  );
}

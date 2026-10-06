"use client";
/**
 * SpriteLab: for each search term, the newest openly licensed Commons photos, turned into
 * 16-colour sprites in the browser (lib/sprites/pixelize.ts). A dev/design tool, not part of the
 * artwork: it shows what the "latest image for a term" pipeline produces, and how often it fails.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { pixelizeRGBA, CELL } from "@/lib/sprites/pixelize";
import type { SpriteCandidate } from "@/lib/sprites/licence";

const ARTIFICIAL_TERMS = ["plastic bottle", "cigarette butt", "smartphone", "chicken bone", "mussel shell"];
/** One search term per natural item (ITEMS_N in lib/stratum/items.data.ts), in that order. */
const NATURAL_TERMS = [
  "leaf", "flower petal", "mushroom", "seed", "grass", "twig", "tree bark", "insect", "small fish",
  "feather", "animal fur", "bird bone", "animal bone", "tooth", "snail shell", "crab", "sea urchin", "coral",
];
const DEFAULT_TERMS = ARTIFICIAL_TERMS;
const PER_TERM = 8;
const LIVE_EVERY_MS = 60_000;
const SPRITE_SCALE = 6;

interface Made {
  meta: SpriteCandidate;
  rgba: Uint8ClampedArray;
  bgRemoved: boolean;
}
interface TermState {
  items: Made[];
  status: "idle" | "busy" | "error";
  message?: string;
  scanned?: number;
  checkedAt?: number;
}

async function makeSprite(c: SpriteCandidate): Promise<Made> {
  const res = await fetch(`/api/sprites/image?url=${encodeURIComponent(c.thumbUrl)}`);
  if (!res.ok) throw new Error(`image ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const k = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
  const w = Math.max(8, Math.round(bmp.width * k));
  const h = Math.max(8, Math.round(bmp.height * k));
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const out = pixelizeRGBA(ctx.getImageData(0, 0, w, h).data, w, h);
  return { meta: c, rgba: out.rgba, bgRemoved: out.bgRemoved };
}

function SpriteCanvas({ rgba }: { rgba: Uint8ClampedArray }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), CELL, CELL), 0, 0);
  }, [rgba]);
  return (
    <canvas
      ref={ref}
      width={CELL}
      height={CELL}
      style={{ width: CELL * SPRITE_SCALE, height: CELL * SPRITE_SCALE, imageRendering: "pixelated", background: "#05060a" }}
    />
  );
}

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}분 전`;
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
  return `${Math.round(s / 86400)}일 전`;
}

export default function SpriteLab() {
  const [terms, setTerms] = useState<string[]>(DEFAULT_TERMS);
  const perTerm = useRef(PER_TERM);
  const [state, setState] = useState<Record<string, TermState>>({});
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState(false);
  const seen = useRef<Record<string, Set<string>>>({});
  const busy = useRef(false);

  const patch = useCallback((term: string, p: Partial<TermState> | ((s: TermState) => Partial<TermState>)) => {
    setState((prev) => {
      const cur = prev[term] ?? { items: [], status: "idle" as const };
      return { ...prev, [term]: { ...cur, ...(typeof p === "function" ? p(cur) : p) } };
    });
  }, []);

  /** One term: search, then make sprites for the files not seen before (Commons wants serial requests). */
  const runTerm = useCallback(
    async (term: string) => {
      patch(term, { status: "busy", message: undefined });
      try {
        const res = await fetch(`/api/sprites/search?term=${encodeURIComponent(term)}&limit=${perTerm.current}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `search ${res.status}`);
        const known = (seen.current[term] ??= new Set());
        const fresh = (json.results as SpriteCandidate[]).filter((c) => !known.has(c.title));
        patch(term, { scanned: json.scanned, checkedAt: Date.now() });
        for (const c of fresh) {
          known.add(c.title);
          try {
            const made = await makeSprite(c);
            patch(term, (s) => ({ items: [made, ...s.items].slice(0, perTerm.current * 2) }));
          } catch (e) {
            console.warn("sprite failed", c.title, e);
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        patch(term, { status: "idle" });
      } catch (e) {
        patch(term, { status: "error", message: (e as Error).message });
      }
    },
    [patch],
  );

  const runAll = useCallback(
    async (list: string[]) => {
      if (busy.current) return;
      busy.current = true;
      for (const t of list) await runTerm(t);
      busy.current = false;
    },
    [runTerm],
  );

  useEffect(() => {
    // ?set=natural | ?terms=a,b,c | ?per=3  (so a given run can be reproduced from a URL)
    const q = new URLSearchParams(window.location.search);
    const per = Number(q.get("per"));
    if (per >= 1 && per <= 20) perTerm.current = per;
    const list = q.get("terms")?.split(",").map((s) => s.trim()).filter(Boolean)
      ?? (q.get("set") === "natural" ? NATURAL_TERMS : DEFAULT_TERMS);
    setTerms(list);
    void runAll(list);
  }, [runAll]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => void runAll(terms), LIVE_EVERY_MS);
    return () => clearInterval(id);
  }, [live, terms, runAll]);

  const add = () => {
    const t = draft.trim();
    if (!t || terms.includes(t)) return;
    setTerms((p) => [...p, t]);
    setDraft("");
    void runAll([t]);
  };

  /** Switch to a preset list; waits for a batch that is still running. */
  const loadSet = (list: string[]) => {
    setTerms(list);
    const start = () => {
      if (busy.current) return void setTimeout(start, 500);
      void runAll(list);
    };
    start();
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] px-6 py-8 font-mono text-[12px] text-white/80">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/" className="text-white/40 hover:text-white/80">← back</Link>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="search term"
            className="w-56 rounded border border-white/25 bg-transparent px-3 py-1.5 outline-none focus:border-white/60"
          />
          <button onClick={add} className="rounded border border-white/30 px-3 py-1.5 hover:bg-white/10">add</button>
          <button onClick={() => void runAll(terms)} className="rounded border border-white/30 px-3 py-1.5 hover:bg-white/10">refresh</button>
          <button onClick={() => loadSet(ARTIFICIAL_TERMS)} className="rounded border border-white/30 px-3 py-1.5 hover:bg-white/10">set: artificial</button>
          <button onClick={() => loadSet(NATURAL_TERMS)} className="rounded border border-emerald-400/40 px-3 py-1.5 text-emerald-300/80 hover:bg-white/10">set: natural (18)</button>
          <label className="flex items-center gap-2 text-white/60">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            live (60s)
          </label>
          <span className="text-white/30">Wikimedia Commons · CC0 / PD / CC BY only · newest first</span>
        </div>

        {terms.map((term) => {
          const s = state[term] ?? { items: [], status: "idle" as const };
          return (
            <section key={term} className="space-y-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-sm text-white">{term}</h2>
                <span className="text-white/35">
                  {s.status === "busy" ? "working…" : s.status === "error" ? `error: ${s.message}` : `${s.items.length} sprites`}
                  {s.scanned != null && ` · ${s.scanned} files scanned`}
                  {s.checkedAt && ` · checked ${new Date(s.checkedAt).toLocaleTimeString()}`}
                </span>
              </div>
              <div className="flex flex-wrap gap-4">
                {s.items.map((m) => (
                  <div key={m.meta.title} className="w-[150px] space-y-1.5">
                    <SpriteCanvas rgba={m.rgba} />
                    <div className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/sprites/image?url=${encodeURIComponent(m.meta.thumbUrl)}`}
                        alt=""
                        className="h-8 w-8 object-cover opacity-70"
                      />
                      <span className={m.bgRemoved ? "text-emerald-400/70" : "text-amber-400/70"}>
                        {m.bgRemoved ? "bg removed" : "centre crop"}
                      </span>
                    </div>
                    <div className="text-[10px] leading-snug text-white/45">
                      {m.meta.license} · {ago(m.meta.timestamp)}
                      <br />
                      {m.meta.author.slice(0, 28)}
                      <br />
                      <a href={m.meta.pageUrl} target="_blank" rel="noreferrer" className="underline hover:text-white/80">source</a>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

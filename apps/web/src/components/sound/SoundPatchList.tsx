"use client";
/**
 * SoundPatchList (/v2/sound) — the NoiseCraft PATCH LIST (v4 A5n, the artist: the list and the patch are two steps). Every .ncft of
 * apps/web/noisecraft/examples: open one in the bench (/v2/sound/<patch>), duplicate it under a new name, rename it,
 * or start an empty one. The patch the player plays (patchChoice.ts) is marked; opening a patch makes it that one.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadPatchChoice } from "@/lib/sound/patchChoice";
import { benchHref } from "@/components/sound/SoundBench";

interface PatchRow {
  filename: string;
  size: number;
  lastModified: number;
}

const ncft = (name: string) => (name.trim().endsWith(".ncft") ? name.trim() : `${name.trim()}.ncft`);
const post = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { filename?: string; error?: string };
  return { ok: r.ok && !!j.filename, filename: j.filename, error: j.error ?? String(r.status) };
};

export default function SoundPatchList() {
  const router = useRouter();
  const [rows, setRows] = useState<PatchRow[] | null>(null);
  const [player] = useState<string>(loadPatchChoice); // client only (see the page): the player's patch
  const [msg, setMsg] = useState("");
  const refresh = () =>
    fetch("/noisecraft/list-patches")
      .then((r) => r.json())
      .then((j: { patches?: PatchRow[] }) => setRows((j.patches ?? []).slice().sort((a, b) => a.filename.localeCompare(b.filename))))
      .catch(() => setRows([]));
  useEffect(() => {
    void refresh();
  }, []);

  const duplicate = async (f: string) => {
    const name = window.prompt(`${f.replace(/\.ncft$/, "")} 을(를) 복제할 새 이름`, f.replace(/\.ncft$/, "") + "_copy");
    if (!name) return;
    const res = await post("/noisecraft/duplicate-patch", { sourceFile: f, newName: ncft(name) });
    if (!res.ok) return setMsg(`복제 실패: ${res.error}`);
    await refresh();
    setMsg(`복제됨 → ${res.filename}`);
  };
  const rename = async (f: string) => {
    const name = window.prompt("새 이름", f.replace(/\.ncft$/, ""));
    if (!name || ncft(name) === f) return;
    const res = await post("/noisecraft/rename-patch", { oldFilename: f, newFilename: ncft(name) });
    if (!res.ok) return setMsg(`이름 바꾸기 실패: ${res.error}`);
    await refresh();
    setMsg(`이름 바꿈 → ${res.filename}`);
  };
  const create = async () => {
    const name = window.prompt("새 패치 이름 (빈 패치로 시작)");
    if (!name) return;
    const res = await post("/noisecraft/create-patch", { name: ncft(name) });
    if (!res.ok || !res.filename) return setMsg(`만들기 실패: ${res.error}`);
    router.push(benchHref(res.filename));
  };

  return (
    <div className="min-h-screen w-screen bg-[#0b0c10] px-6 py-6 font-mono text-[12px] text-white/80">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Link href="/" className="text-white/40 hover:text-white/80">
          ← home
        </Link>
        <span className="text-white">NoiseCraft 패치</span>
        <span className="text-white/40">{rows ? `${rows.length}개 · apps/web/noisecraft/examples` : "불러오는 중…"}</span>
        <button className="border border-white/30 px-2 py-0.5" onClick={() => void create()}>
          새 패치…
        </button>
        {msg && <span className="text-amber-200/80">{msg}</span>}
      </div>
      <div className="mb-2 text-white/35">열면 벤치로 들어가고, 그 패치가 플레이어의 패치가 됩니다 (★). 편집은 자동저장.</div>
      <div className="flex flex-col divide-y divide-white/10 border-y border-white/10">
        {(rows ?? []).map((r) => {
          const name = r.filename.replace(/\.ncft$/, "");
          const isPlayer = r.filename === player;
          return (
            <div key={r.filename} className="flex flex-wrap items-center gap-3 py-2">
              <Link href={benchHref(r.filename)} className={`min-w-[260px] hover:underline ${isPlayer ? "text-white" : "text-white/80"}`}>
                {isPlayer ? "★ " : ""}
                {name}
              </Link>
              <span className="w-[70px] text-right text-white/35">{Math.round(r.size / 1024)} KB</span>
              <span className="w-[150px] text-white/35">{new Date(r.lastModified).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              <Link href={benchHref(r.filename)} className="border border-white/30 px-2 py-0.5">
                열기
              </Link>
              <button className="border border-white/20 px-2 py-0.5 text-white/60" onClick={() => void duplicate(r.filename)}>
                복제…
              </button>
              <button className="border border-white/20 px-2 py-0.5 text-white/60" onClick={() => void rename(r.filename)}>
                이름…
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

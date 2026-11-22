"use client";
/**
 * NoteView — a life's 발굴노트 (lib/parliament/note.ts): the record card's rows as the end screen had them, on the QR
 * page's paper (RecSheet). From the summary that went up with the recording; for a life posted before that, from its
 * posted card (/api/lives?rec=). Linked from the recording page (the artist, 2026-11-22).
 */

import { useEffect, useState } from "react";
import { Glyph } from "@/components/parliament/Glyph";
import { Sheet, SheetFoot, SheetHead, SheetLinks, SHEET_WORDS, WEB_POSTER } from "@/components/parliament/RecSheet";
import { fmtClock } from "@/lib/parliament";
import { readNote, type Note } from "@/lib/parliament/note";
import { RECORDING_ID, type RecordingMeta } from "@/lib/sound/recorder";
import { recordingMetaUrl } from "@/lib/sound/recordingUpload";

export default function NoteView({ id }: { id: string }) {
  const [note, setNote] = useState<Note | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">(() => (RECORDING_ID.test(id) ? "loading" : "missing"));
  const [startedAt, setStartedAt] = useState(0);

  useEffect(() => {
    if (!RECORDING_ID.test(id)) return;
    let cancelled = false;
    (async () => {
      const meta = await fetch(recordingMetaUrl(id), { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<RecordingMeta>) : null))
        .catch(() => null);
      if (cancelled) return;
      if (meta?.startedAt) setStartedAt(Date.parse(meta.startedAt));
      let n = readNote(meta?.note);
      if (!n) {
        const posted = await fetch(`/api/lives?rec=${encodeURIComponent(id)}`, { cache: "no-store" })
          .then((r) => (r.ok ? (r.json() as Promise<{ life?: { card?: unknown } | null }>) : null))
          .catch(() => null);
        n = readNote(posted?.life?.card);
      }
      if (cancelled) return;
      setNote(n);
      setState(n ? "ready" : "missing");
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const lang = note?.lang ?? "ko";
  const W = SHEET_WORDS[lang];
  return (
    <Sheet>
      <SheetHead lang={lang} me={note?.me ?? (RECORDING_ID.test(id) ? id : "")} at={note?.endedAt || startedAt} extra={W.note} />
      {state === "loading" && <div className="text-[#6b6b66]">{W.loading}</div>}
      {state === "missing" && <div>{W.noNote}</div>}
      {note && (
        <>
          <div className="flex items-baseline justify-between border-y border-[#111111] py-3">
            <span>{W.who(note.no)}</span>
            <span className="tabular-nums text-[#6b6b66]">
              {W.life} {fmtClock(note.lifeSec)}
              {note.venue ? ` · ${note.venue}` : ""}
            </span>
          </div>
          <dl className="m-0 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-3">
            {note.rows.map((r, i) => (
              <div key={i} className="contents">
                <dt className="text-[#6b6b66]">{r.label}</dt>
                <dd className={`m-0 ${r.big ? "text-[18px]" : ""}`}>
                  <span>{r.text}</span>
                  {r.glyph && <Glyph dots={r.glyph} cell={4} className="ml-2" />}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <SheetLinks
        links={[
          { href: `/rec/${encodeURIComponent(id)}`, label: W.recording, sub: W.recordingSub },
          { href: WEB_POSTER, label: W.poster, sub: W.posterSub, external: true },
          { href: "/exhibition/gallery", label: W.gallery, sub: W.gallerySub },
        ]}
      />
      <SheetFoot lang={lang} />
    </Sheet>
  );
}

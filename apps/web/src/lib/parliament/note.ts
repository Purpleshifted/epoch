/**
 * The 발굴노트 — a life's summary as the end screen's record card had it (SessionHud, the record step), in rows: the
 * group, the words, what was found, the concrete, the moving, the vegetation, the tries, the cause. Read from the
 * summary that went up with the recording (RecordingMeta.note: plate.ts PlateInput without the trail and cells) or from
 * the posted card (/api/lives); either is data from the network, so every field is checked as it is read.
 * The recording page links to it (/rec/<id>/note; the artist, 2026-11-22).
 */
import { glyphOf, individualNo, type GlyphDot } from "./glyph";
import type { LedgerSummary } from "./ledger";
import { SCRIPT, asLang, type Lang } from "./script";

export interface NoteRow {
  label: string;
  text: string;
  /** A melody beside the words (a new word, the found one's). */
  glyph?: GlyphDot[];
  /** The cause: a size up. */
  big?: boolean;
}

export interface Note {
  lang: Lang;
  /** The being's id (its number, its melody). */
  me: string;
  no: string;
  /** Seconds lived. */
  lifeSec: number;
  /** Wall ms the life ended (0: not known). */
  endedAt: number;
  venue: string | null;
  rows: NoteRow[];
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The note from a life's summary (`raw`: the recording's note or the posted card), or null when it has no being. */
export function readNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const me = str(p.me);
  if (!me) return null;
  const lang = asLang(str(p.lang));
  const E = SCRIPT[lang].ended;
  const group = arr<string>(p.group);
  const newWords = arr<GlyphDot[]>(p.newWords);
  const found = arr<string>(p.found).filter((f) => typeof f === "string");
  const sum = p.sum && typeof p.sum === "object" ? (p.sum as LedgerSummary) : null;
  const withOthers = arr<string>(sum?.with);
  const attempts = num(p.attempts);
  const rows: NoteRow[] = [
    { label: E.group, text: E.groupRow(group.length, num(p.ensembleSec)) },
    { label: E.word, text: E.wordRow(newWords.length, num(p.asked)), glyph: newWords.length ? newWords[newWords.length - 1] : undefined },
  ];
  if (found.length) rows.push({ label: E.found, text: E.foundRow(individualNo(found[0]), found.length - 1), glyph: glyphOf(found[0]) });
  rows.push(
    { label: E.built, text: E.builtRow(num(sum?.slabs), withOthers.length, num(p.unmet, withOthers.filter((o) => !group.includes(o)).length)) },
    { label: E.moved, text: E.movedRow(sum, num(p.stillSec)) },
    { label: E.veg, text: E.vegRow(sum) },
  );
  if (attempts > 0) rows.push({ label: E.stop, text: E.tried(attempts) });
  if (str(p.cause)) rows.push({ label: E.cause, text: str(p.cause), big: true });
  return { lang, me, no: individualNo(me), lifeSec: num(p.lifeSec), endedAt: num(p.endedAt), venue: str(p.venue) || null, rows };
}

/**
 * parliament/script.ts — everything the player view SAYS to the visitor (V2): the title screen, the notices before a
 * life, the consent, the headset, the hints, the end screen. Two languages. The machine log (witness.ts) stays in
 * English upper case in both: it is the apparatus's raw output; this is the apparatus speaking.
 *
 * Register (docs/session-logic.md §8): an apparatus that allots and records lives — whose it is, it does not say.
 * No first person, no exclamation marks, formal declaratives, at most three lines a screen, numbers and states
 * rather than adjectives. The humour is in the arrangement (a consent with only yes; a life that begins the moment
 * the headset is on) and is never explained. The notices are the artist's own words (2026-10-20).
 */

import type { CauseId } from "./intake";
import type { LedgerSummary } from "./ledger";
import { fmtClock } from "./session";
import type { RoleId } from "./types";
import { nameOf, type LogArgs, type LogEntry, type LogKey, type NearItemArgs, type StatusArgs, type Surface, type Who } from "./witness";

export type Lang = "ko" | "en";
export const LANGS: readonly Lang[] = ["ko", "en"];
export const DEFAULT_LANG: Lang = "ko";

/** Reads a language from a query value / saved value; anything else is the default. */
export function asLang(v: string | null | undefined, fallback: Lang = DEFAULT_LANG): Lang {
  return v === "ko" || v === "en" ? v : fallback;
}

/**
 * The title is not decided yet: "발견된 인류" is the working title. An empty English title means "none yet": the
 * title screen then shows the Korean one in both languages.
 */
export const TITLE: Record<Lang, string> = { ko: "발견된 인류", en: "" };

/** The roles as the apparatus names them when speaking (the English log keeps session.ts ROLE_TAG). */
export const ROLE_NAME: Record<Lang, Record<RoleId, string>> = {
  ko: { worker: "회사원", cat: "길고양이", car: "자동차", tree: "나무", shepherd: "양치기", wolf: "늑대", warrior: "전사" },
  en: { worker: "Worker", cat: "Street cat", car: "Car", tree: "Tree", shepherd: "Shepherd", wolf: "Wolf", warrior: "Warrior" },
};



export const CAUSE_NAME: Record<Lang, Record<CauseId, string>> = {
  ko: {
    suicide: "자살",
    overwork: "과로",
    lonely: "고독사",
    traffic: "교통사고",
    illness: "병사",
    cardiac: "심정지",
    roadkill: "로드킬",
    starved: "아사",
    cold: "저체온",
    captured: "포획",
    collision: "추돌",
    abandoned: "방치",
    seized: "압류",
    scrapped: "폐차",
    felled: "벌목",
    road: "도로 확장",
    lightning: "낙뢰",
    withered: "고사",
    blight: "병충해",
  },
  en: {
    suicide: "Suicide",
    overwork: "Overwork",
    lonely: "Died alone",
    traffic: "Traffic accident",
    illness: "Illness",
    cardiac: "Cardiac arrest",
    roadkill: "Roadkill",
    starved: "Starvation",
    cold: "Hypothermia",
    captured: "Captured",
    collision: "Collision",
    abandoned: "Abandoned",
    seized: "Seized",
    scrapped: "Scrapped",
    felled: "Felled",
    road: "Road widening",
    lightning: "Lightning",
    withered: "Withered",
    blight: "Blight",
  },
};

export interface Script {
  /** `…Touch`: the same line for a phone (no keys, no mouse: the screen is tapped, tilted and held). */
  idle: { press: string; pressTouch: string; duration: (min: number) => string };
  /** The notice: pages of a few lines each; the lines come on one after another. */
  notice: string[][];
  consent: { question: string; yes: string; no: string; noNote: string };
  headset: string[];
  headsetTouch: string[];
  /** `controls`: how to walk, shown faintly for the first seconds of the life (the life begins right after the headset). */
  live: { look: string; controls: string; controlsTouch: string; stop: (holdSec: number) => string; stopTouch: (holdSec: number) => string };
  attempt: { failed: string };
  ended: {
    title: string;
    cause: string;
    present: string;
    still: string;
    near: string;
    metUnit: string;
    /** Only when there were attempts to stop living: the label, and "n tried". */
    stop: string;
    tried: (n: number) => string;
    /** The ledger's rows (ledger.ts ledgerSummary): the labels and what each row reads; `nothing` when all are empty. */
    grass: string;
    ground: string;
    concrete: string;
    world: string;
    water: string;
    grassRow: (s: LedgerSummary) => string;
    groundRow: (s: LedgerSummary) => string;
    concreteRow: (s: LedgerSummary) => string;
    worldRow: (s: LedgerSummary) => string;
    waterRow: string;
    nothing: string;
    kept: string;
    read: string;
    next: string;
    nextTouch: string;
    /** One line of help, shown after a suicide only when the knob is on. */
    help: string;
  };
}

export const SCRIPT: Record<Lang, Script> = {
  ko: {
    idle: { press: "아무 키나 누르세요", pressTouch: "화면을 누르세요", duration: (min) => `한 번의 삶 · 약 ${min}분` },
    notice: [
      ["인류는 멸망했습니다.", "먼 미래, 지구에 도착한 외계의 고고학자들이 인류세를 연구하고 있습니다."],
      ["그들에게 주어진 단서는 지층 속 흔적들입니다.", "벽의 창 너머로 미래의 모습이 보입니다."],
      ["눈 앞의 화면으로 돌아오세요.", "당신은 현재 그 흔적을 남기며 살고 있습니다."],
      ["당신의 삶은 미래의 풍경에 영향을 줄 수도 있고,", "주지 않을 수도 있습니다."],
      ["다만 태어난 이상 살아가야 합니다."],
    ],
    consent: { question: "속절없이 존재하시겠습니까?", yes: "예", no: "아니요", noNote: "선택할 수 없습니다" },
    headset: ["헤드셋을 착용하세요.", "착용했으면 아무 키나 누르세요."],
    headsetTouch: ["이어폰을 착용하세요.", "착용했으면 화면을 누르세요."],
    live: {
      look: "화면을 클릭하세요",
      controls: "W A S D 걷기 · 마우스 둘러보기",
      controlsTouch: "누르는 동안 걷고, 떼면 머뭅니다 · 끌면 돕니다",
      stop: (s) => `그만 살기: X 키를 ${s}초 동안 누르세요`,
      stopTouch: (s) => `그만 살기 — ${s}초 길게 누르기`,
    },
    attempt: { failed: "저런. 그만 살기에 실패했습니다. 삶은 계속됩니다." },
    ended: {
      title: "삶이 끝났습니다.",
      cause: "사인",
      present: "생존",
      still: "머묾",
      near: "가까이",
      metUnit: "만남",
      stop: "그만 살기",
      tried: (n) => `${n}회 시도 · 실패`,
      grass: "풀",
      ground: "길",
      concrete: "콘크리트",
      world: "세계",
      water: "물",
      grassRow: (s) =>
        s.pressed < 0.05 ? "눌린 풀 없음" : `눌림 ${s.pressed}칸 분 · ${s.recoveredPct ?? "—"} % 회복${s.under > 0 ? ` · 길·콘크리트 아래 ${s.under}칸 분` : ""}`,
      groundRow: (s) =>
        s.trodden === 0 ? "걸은 땅 없음" : `걸은 땅 ${s.trodden}칸 · ${s.walkedM} m · ${s.newPathPct} %가 길이 됨${s.prePathPct > 0 ? ` · 앞서 다져진 길 ${s.prePathPct} %` : ""}`,
      concreteRow: (s) => (s.slabs === 0 ? "없음 · 혼자서는 지어지지 않습니다" : `${s.slabs}칸 · 당신의 몫 ${s.sharePct} % · ${s.withN}명과 함께`),
      worldRow: (s) =>
        s.worldPathPct === null && s.worldSlabPct === null ? "—" : `길의 ${s.worldPathPct ?? "—"} %를 밟음 · 콘크리트의 ${s.worldSlabPct ?? "—"} %에 몫`,
      waterRow: "—",
      nothing: "남긴 것이 없습니다.",
      kept: "기록은 남습니다.",
      read: "흔적은 벽의 창에서 읽힐 수도, 읽히지 않을 수도 있습니다.",
      next: "SPACE — 다음 삶",
      nextTouch: "화면을 누르면 — 다음 삶",
      help: "자살예방상담전화 109",
    },
  },
  en: {
    idle: { press: "Press any key", pressTouch: "Tap the screen", duration: (min) => `One life · about ${min} min` },
    notice: [
      ["Humanity is extinct.", "In the far future, archaeologists from elsewhere have reached Earth and are studying the Anthropocene."],
      ["Their only clues are the traces in the strata.", "Through the window in the wall, the future can be seen."],
      ["Come back to the screen in front of you.", "You are living now, leaving those traces."],
      ["Your life may affect what that future looks like,", "or it may not."],
      ["Still, having been born, you have to live."],
    ],
    consent: { question: "Will you exist regardless?", yes: "Yes", no: "No", noNote: "not available" },
    headset: ["Put on the headset.", "Press any key once it is on."],
    headsetTouch: ["Put on the earphones.", "Tap the screen once they are on."],
    live: {
      look: "Click the screen",
      controls: "W A S D walk · mouse look",
      controlsTouch: "Hold to walk, let go to stay · drag to turn",
      stop: (s) => `Stop living: hold X for ${s} second${s === 1 ? "" : "s"}`,
      stopTouch: (s) => `Stop living — hold ${s} second${s === 1 ? "" : "s"}`,
    },
    attempt: { failed: "Oh. Stopping living has failed. Life goes on." },
    ended: {
      title: "Life has ended.",
      cause: "Cause",
      present: "Present",
      still: "Still",
      near: "Near",
      metUnit: "met",
      stop: "Stop living",
      tried: (n) => `tried ${n}× · failed`,
      grass: "Grass",
      ground: "Ground",
      concrete: "Concrete",
      world: "World",
      water: "Water",
      grassRow: (s) =>
        s.pressed < 0.05 ? "none pressed" : `pressed ${s.pressed} cells · ${s.recoveredPct ?? "—"} % back${s.under > 0 ? ` · under paths and concrete ${s.under} cells` : ""}`,
      groundRow: (s) =>
        s.trodden === 0 ? "none trodden" : `trodden ${s.trodden} cells · ${s.walkedM} m · ${s.newPathPct} % became paths${s.prePathPct > 0 ? ` · ${s.prePathPct} % were paths before you` : ""}`,
      concreteRow: (s) => (s.slabs === 0 ? "none · nothing sets alone" : `${s.slabs} cells · your share ${s.sharePct} % · with ${s.withN} others`),
      worldRow: (s) =>
        s.worldPathPct === null && s.worldSlabPct === null ? "—" : `${s.worldPathPct ?? "—"} % of its paths trodden · a share in ${s.worldSlabPct ?? "—"} % of its concrete`,
      waterRow: "—",
      nothing: "Nothing was left.",
      kept: "The record is kept.",
      read: "The traces may be read through the window in the wall, or they may not.",
      next: "SPACE — next life",
      nextTouch: "Tap — next life",
      help: "Lifeline 109",
    },
  },
};

/** The title to show for a language: the English one, or the Korean working title while there is none. */
export function titleFor(lang: Lang): { main: string; sub: string | null } {
  if (lang === "en") return { main: TITLE.en || TITLE.ko, sub: null };
  return { main: TITLE.ko, sub: TITLE.en || null };
}

// ── the record's words (witness.ts entries, ledger.ts lines) ─────────────────
//
// One record, in the chosen language. English is the machine's upper case (byte for byte what the record said before
// 2026-10-20); Korean is the apparatus's voice: no subject on the visitor's own lines (the others are named, so a line
// without a name is about you), "당신" only where it stands against the others (your share of the concrete).
// Levels (witness.ts LogLevel): 0 a fact, 1 notable, 2 important — the HUD colours them grey / white / yellow.
// The artist edits the Korean here; the rule stays: at most two short lines, no "!" (intake.test.ts).

export type NameFn = (w: Who) => string;

/** How the apparatus names someone when speaking: ko "회사원 #03" / "회사원 AB12C"; en the machine tag (nameOf). */
export function nameIn(lang: Lang, o: string, r: RoleId): string {
  if (lang === "en") return nameOf(o, r);
  const role = ROLE_NAME.ko[r] ?? r;
  if (o.startsWith("bot")) return `${role} #${o.slice(3).padStart(2, "0")}`;
  return `${role} ${o.replace(/^v_/, "").toUpperCase()}`;
}

const SURFACE_EN: Record<Surface, string> = { open: "OPEN GROUND", trodden: "TRODDEN GROUND", sealed: "SEALED GROUND" };
const SURFACE_KO: Record<Surface, string> = { open: "열린 땅", trodden: "다져진 땅", sealed: "봉인된 땅" };
const COMPASS_KO: Record<string, string> = { N: "북", NE: "북동", E: "동", SE: "남동", S: "남", SW: "남서", W: "서", NW: "북서" };
const mvEn = (m?: boolean) => (m ? "MOVING" : "STATIONARY");
const mvKo = (m?: boolean) => (m ? "이동 중" : "머묾");
const d1 = (v?: number) => (v ?? 0).toFixed(1);
const sfEn = (s?: Surface) => SURFACE_EN[s ?? "open"];
const sfKo = (s?: Surface) => SURFACE_KO[s ?? "open"];
const koBearing = (b?: string) => COMPASS_KO[b ?? "N"] ?? b ?? "";
const listOf = (w: Who[] | undefined, name: NameFn, sep: string) => (w ?? []).slice(0, 3).map(name).join(sep);

export interface LogTemplates {
  line: Record<LogKey, (a: LogArgs, name: NameFn) => string>;
  status: (a: StatusArgs) => string;
  nearItem: (a: NearItemArgs, name: NameFn) => string;
}

export const LOG: Record<Lang, LogTemplates> = {
  ko: {
    line: {
      "you.state": (a) => `${mvKo(a.moving)} · ${sfKo(a.surface)}`,
      "you.moving": (a) => mvKo(a.moving),
      surface: (a) => `지면  ${sfKo(a.surface)}`,
      near: (a, name) => `${name(a.who!)}  가까이 · ${d1(a.dist)} m ${koBearing(a.bearing)} · ${mvKo(a.moving)}`,
      "other.moving": (a, name) => `${name(a.who!)}  ${mvKo(a.moving)} · ${d1(a.dist)} m ${koBearing(a.bearing)}`,
      gone: (a, name) => `${name(a.who!)}  떠남 · ${fmtClock(a.forSec ?? 0)} 동안 가까이`,
      "attempt.tried": (a) => `그만 살기 시도${(a.near ?? 0) > 0 ? ` · 가까이 ${a.near}` : ""}`,
      "attempt.failed": () => "실패",
      // the ledger (후보 — 작가가 고침): ① 발밑의 풀이 눌렸습니다. ② 지나온 자리의 풀이 누웠습니다. ③ 풀  눌림 n칸 분
      "grass.pressed": (a) => `풀 ${a.n}칸 분이 눌렸습니다.`,
      // ① 떠난 자리의 풀이 절반 넘게 돌아왔습니다. ② 풀  회복 n %
      "grass.recovered": (a) => `떠난 자리의 풀 ${a.pct} %가 돌아왔습니다.`,
      // ① 걸은 자리가 다져지고 있습니다. ② 땅  다져짐 n칸
      "ground.worn": (a) => `걸은 자리 ${a.n}칸이 다져지고 있습니다.`,
      // ① 앞서 다져진 길입니다. ② 다져진 땅 · 앞서 n번 지나감
      "ground.prePath": (a) => `앞서 다져진 길입니다 · ${a.n}번 지나감`,
      // ① 걸은 자리 n칸이 길이 되었습니다. ② 밟은 자리가 길이 되었습니다. ③ 길  생김 · n칸
      // (혼자 2분을 왕복해도 길은 생기므로 "혼자 낸 길은 아닙니다"는 늘 참이 아님)
      "path.formed": (a) => `걸은 자리 ${a.n}칸이 길이 되었습니다.`,
      // ① 머문 자리에 콘크리트가 생겼습니다. 당신의 몫 n %. ② 회사원 #03·#07과 머문 자리에 콘크리트. 당신의 몫 n %
      // ③ 함께 머문 셋이 바닥을 굳혔습니다. 당신의 몫 n %.
      "concrete.share": (a, name) => {
        const w = listOf(a.with, name, "·");
        return w ? `${w}과 머문 자리에 콘크리트가 생겼습니다. 당신의 몫 ${a.pct} %.` : `머문 자리에 콘크리트가 생겼습니다. 당신의 몫 ${a.pct} %.`;
      },
      // ① 이 아래의 풀은 n %만 남았습니다. ② 발밑은 콘크리트입니다. 풀 n %.
      "sealed.under": (a) => `발밑은 콘크리트입니다. 이 아래의 풀은 ${a.pct} %만 남았습니다.`,
      // ① 혼자서는 아무것도 지어지지 않습니다. ② n초째 가까이 아무도 없습니다.
      "alone.long": (a) => `${a.sec}초째 가까이 아무도 없습니다. 혼자서는 아무것도 지어지지 않습니다.`,
    },
    status: (a) => `${mvKo(a.moving)} ${fmtClock(a.forSec)} · ${sfKo(a.surface)} · 가까이 ${a.near}`,
    nearItem: (a, name) => `${name(a.who)} ${d1(a.dist)} m ${koBearing(a.bearing)} · ${mvKo(a.moving)} · ${fmtClock(a.forSec)}`,
  },
  en: {
    line: {
      "you.state": (a) => `YOU  ${mvEn(a.moving)} · ${sfEn(a.surface)}`,
      "you.moving": (a) => `YOU  ${mvEn(a.moving)}`,
      surface: (a) => `SURFACE  ${sfEn(a.surface)}`,
      near: (a, name) => `${name(a.who!)}  NEAR · ${d1(a.dist)} M ${a.bearing} · ${mvEn(a.moving)}`,
      "other.moving": (a, name) => `${name(a.who!)}  ${mvEn(a.moving)} · ${d1(a.dist)} M ${a.bearing}`,
      gone: (a, name) => `${name(a.who!)}  GONE · NEAR FOR ${fmtClock(a.forSec ?? 0)}`,
      "attempt.tried": (a) => `YOU  TRIED TO STOP LIVING${(a.near ?? 0) > 0 ? ` · NEAR ${a.near}` : ""}`,
      "attempt.failed": () => "YOU  FAILED",
      "grass.pressed": (a) => `GRASS  PRESSED · ${a.n} CELLS`,
      "grass.recovered": (a) => `GRASS  RECOVERED · ${a.pct} %`,
      "ground.worn": (a) => `GROUND  WORN · ${a.n} CELLS`,
      "ground.prePath": (a) => `TRODDEN  BEFORE YOU · ${a.n} PASSES`,
      "path.formed": (a) => `PATH  FORMED · ${a.n} CELLS`,
      "concrete.share": (a, name) => {
        const w = listOf(a.with, name, " ");
        return w ? `CONCRETE  WITH ${w} · YOUR SHARE ${a.pct} %` : `CONCRETE  YOUR SHARE ${a.pct} %`;
      },
      "sealed.under": (a) => `SEALED  GRASS BELOW ${a.pct} %`,
      "alone.long": (a) => `ALONE  ${a.sec} S · NOTHING SETS`,
    },
    status: (a) => `YOU  ${mvEn(a.moving)} ${fmtClock(a.forSec)} · ${sfEn(a.surface)} · NEAR ${a.near}`,
    nearItem: (a, name) => `${name(a.who)} ${d1(a.dist)} M ${a.bearing} · ${mvEn(a.moving)} · ${fmtClock(a.forSec)}`,
  },
};

/** One record line in the chosen language: the `T+mm:ss` prefix (machine face) and the text (apparatus face). */
export function formatEntry(e: LogEntry, lang: Lang): { prefix: string; text: string } {
  const name: NameFn = (w) => nameIn(lang, w.o, w.r);
  return { prefix: `T+${fmtClock(e.t)}`, text: LOG[lang].line[e.key](e.args, name) };
}
export const formatStatus = (a: StatusArgs, lang: Lang): string => LOG[lang].status(a);
export const formatNearItem = (a: NearItemArgs, lang: Lang): string => LOG[lang].nearItem(a, (w) => nameIn(lang, w.o, w.r));

/**
 * parliament/script.ts — everything the player view SAYS to the visitor (V2): the title screen, the notices before a
 * life, the consent, the headset, the hints, the end screen, and the record while live (LOG). Two languages.
 *
 * Register (docs/session-logic.md §8): an apparatus that allots and records lives — whose it is, it does not say.
 * No first person, no exclamation marks, formal declaratives, at most three lines a screen, numbers and states
 * rather than adjectives. The humour is in the arrangement (a consent with only yes; a life that begins the moment
 * the headset is on) and is never explained. The notices are the artist's own words (2026-10-20).
 */

import type { CauseId } from "./intake";
import type { LedgerSummary } from "./ledger";
import { fmtClock } from "./session";
import type { LogArgs, LogEntry, LogKey, StatusArgs, Surface } from "./witness";

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
  /** `mine`: the word beside the visitor's own melody, written down, on the name screen and above the record. */
  live: { look: string; controls: string; controlsTouch: string; mine: string; enter: string; answer: string; answerTouch: string; stop: (holdSec: number) => string; stopTouch: (holdSec: number) => string };
  attempt: { failed: string };
  /**
   * The end screen is one being's record card, in the voice of a specimen looked at from the future (the words while
   * living are LOG's plain ones): a label and what it reads, per row. The melody rows (own, word, found) draw the melody
   * beside the words. No shares and no percentages (the artist, 2026-11-01).
   */
  ended: {
    title: string;
    /** The record card's head: which being this was. */
    who: (no: string) => string;
    life: string;
    own: string;
    group: string;
    /** `sec`: how long the being stayed with others who stayed. */
    groupRow: (n: number, sec?: number) => string;
    word: string;
    /** `n`: the times the being answered (each leaves a new word); `asked`: the times it was called. */
    wordRow: (n: number, asked?: number) => string;
    found: string;
    foundRow: (no: string, more: number) => string;
    built: string;
    /** `layer`: the others in the same concrete; `unmet`: how many of them this being was never near for long. */
    builtRow: (cells: number, layer: number, unmet: number) => string;
    moved: string;
    movedRow: (s: LedgerSummary | null, stillSec: number) => string;
    veg: string;
    vegRow: (s: LedgerSummary | null) => string;
    /** Only when there were attempts to stop living: the label, and "n tried". */
    stop: string;
    tried: (n: number) => string;
    cause: string;
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
    notice: [["미래의 고고학자들이 멸망한 인류를 발굴 중입니다."], ["현재의 당신은 무엇을 남기시겠습니까?"]],
    consent: { question: "태어나시겠습니까?", yes: "예", no: "아니요", noNote: "선택할 수 없습니다" },
    headset: ["헤드셋을 착용하세요.", "착용했으면 아무 키나 누르세요."],
    headsetTouch: ["이어폰을 착용하세요.", "착용했으면 화면을 누르세요."],
    live: {
      look: "화면을 클릭하세요",
      controls: "W A S D 걷기 · 마우스 둘러보기",
      controlsTouch: "누르는 동안 걷고, 떼면 머뭅니다 · 끌면 돕니다",
      mine: "이름:",
      enter: "살아가기",
      answer: "SPACE — 응답",
      answerTouch: "응답",
      stop: (s) => `그만 살기: X 키를 ${s}초 동안 누르세요`,
      stopTouch: (s) => `그만 살기 — ${s}초 길게 누르기`,
    },
    attempt: { failed: "저런. 그만 살기에 실패했습니다. 삶은 계속됩니다." },
    ended: {
      title: "삶이 끝났습니다.",
      who: (no) => `개체 ${no}`,
      life: "존속",
      own: "고유 어휘",
      group: "군집",
      groupRow: (n, sec = 0) => (n === 0 ? "타 개체와 집단생활 관찰되지 않음" : `${n}개체와 집단생활${sec >= 1 ? ` · 공동 체류 ${fmtClock(sec)}` : ""}`),
      word: "어휘 변화",
      wordRow: (n, asked = 0) => `${n === 0 ? "관찰되지 않음" : n === 1 ? "접촉 후 새로운 어휘 발생" : `접촉 후 새로운 어휘 ${n}종 발생`}${asked > 0 ? ` · 호출 ${asked}회 · 응답 ${n}회` : ""}${n > 0 ? ` · 홀씨 ${n}건 출토` : ""}`,
      found: "발견",
      foundRow: (no, more) => `개체 ${no}${josaIGa(no)} 남긴 말${more > 0 ? ` 외 ${more}건` : ""}`,
      built: "구조물",
      builtRow: (cells, layer, unmet) =>
        cells === 0 ? "관찰되지 않음" : `콘크리트 ${cells}칸${layer > 0 ? ` · 같은 층에서 어휘 ${layer}종 출토` : ""}${unmet > 0 ? ` · 이 중 ${unmet}종은 접촉 흔적 없음` : ""}`,
      moved: "이동",
      movedRow: (s, still) => {
        const parts: string[] = [];
        if (s && s.walkedM > 0) parts.push(`약 ${s.walkedM} m`);
        if (still >= 1) parts.push(`체류 ${fmtClock(still)}`);
        if (s && s.newPaths > 0) parts.push(`통로 ${s.newPaths}칸 형성`);
        if (s && s.prePaths > 0) parts.push("기존 통로 이용");
        return parts.join(" · ") || "관찰되지 않음";
      },
      veg: "식생",
      vegRow: (s) => (!s || s.pressed < 0.05 ? "손상 관찰되지 않음" : `경로의 식생 ${s.pressed}칸 분 소실${s.recovered ? " · 일부 회복" : ""}`),
      stop: "그만 살기",
      tried: (n) => `${n}회 시도 · 실패`,
      cause: "사인",
      kept: "기록은 남습니다.",
      read: "흔적은 벽의 창에서 읽힐 수도, 읽히지 않을 수도 있습니다.",
      next: "SPACE — 다음 삶",
      nextTouch: "화면을 누르면 — 다음 삶",
      help: "자살예방상담전화 109",
    },
  },
  en: {
    idle: { press: "Press any key", pressTouch: "Tap the screen", duration: (min) => `One life · about ${min} min` },
    notice: [["Future archaeologists are excavating extinct humanity."], ["You, in the present: what will you leave?"]],
    consent: { question: "Will you be born?", yes: "Yes", no: "No", noNote: "not available" },
    headset: ["Put on the headset.", "Press any key once it is on."],
    headsetTouch: ["Put on the earphones.", "Tap the screen once they are on."],
    live: {
      look: "Click the screen",
      controls: "W A S D walk · mouse look",
      controlsTouch: "Hold to walk, let go to stay · drag to turn",
      mine: "Name:",
      enter: "Live",
      answer: "SPACE — answer",
      answerTouch: "Answer",
      stop: (s) => `Stop living: hold X for ${s} second${s === 1 ? "" : "s"}`,
      stopTouch: (s) => `Stop living — hold ${s} second${s === 1 ? "" : "s"}`,
    },
    attempt: { failed: "Oh. Stopping living has failed. Life goes on." },
    ended: {
      title: "Life has ended.",
      who: (no) => `Individual ${no}`,
      life: "Duration",
      own: "Own vocabulary",
      group: "Group",
      groupRow: (n, sec = 0) => (n === 0 ? "no group life observed" : `group life with ${n} individuals${sec >= 1 ? ` · stayed together ${fmtClock(sec)}` : ""}`),
      word: "Vocabulary",
      wordRow: (n, asked = 0) => `${n === 0 ? "no change observed" : n === 1 ? "a new word after contact" : `${n} new words after contact`}${asked > 0 ? ` · called ${asked}× · answered ${n}×` : ""}${n > 0 ? ` · ${n} seed heads found` : ""}`,
      found: "Found",
      foundRow: (no, more) => `a word left by individual ${no}${more > 0 ? ` and ${more} more` : ""}`,
      built: "Structure",
      builtRow: (cells, layer, unmet) =>
        cells === 0 ? "none observed" : `${cells} cells of concrete${layer > 0 ? ` · ${layer} vocabularies in the same layer` : ""}${unmet > 0 ? ` · ${unmet} of them with no trace of contact` : ""}`,
      moved: "Movement",
      movedRow: (s, still) => {
        const parts: string[] = [];
        if (s && s.walkedM > 0) parts.push(`about ${s.walkedM} m`);
        if (still >= 1) parts.push(`stayed ${fmtClock(still)}`);
        if (s && s.newPaths > 0) parts.push(`${s.newPaths} cells of path formed`);
        if (s && s.prePaths > 0) parts.push("used existing paths");
        return parts.join(" · ") || "none observed";
      },
      veg: "Vegetation",
      vegRow: (s) => (!s || s.pressed < 0.05 ? "no damage observed" : `${s.pressed} cells lost along the way${s.recovered ? " · partly back" : ""}`),
      stop: "Stop living",
      tried: (n) => `tried ${n}× · failed`,
      cause: "Cause",
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
// What is said WHILE living: plain words that anyone follows at a glance, about what is happening now (the artist,
// 2026-11-01). The end screen's card (SCRIPT.ended) is the other voice: a specimen looked at from the future.
// Levels (witness.ts LogLevel): 0 a fact, 1 notable, 2 important — the HUD draws them grey / white / white on black.
// `{}` in a line is where the melody it speaks of is drawn (Glyph): beings have no other name while living.
// The artist edits the words here; the rule stays: at most two short lines, no "!" (intake.test.ts).

/** The subject particle after a number read digit by digit (…2 이, …4 사, …5 오, …9 구 end in a vowel). */
function josaIGa(no: string): string {
  return "2459".includes(no[no.length - 1]) ? "가" : "이";
}

const WHERE_KO: Record<Surface, string> = { open: "풀밭", trodden: "다져진 길", sealed: "콘크리트 위" };
const WHERE_EN: Record<Surface, string> = { open: "grass", trodden: "a trodden path", sealed: "concrete" };
/** 48 → "48초", 72 → "1분 12초". */
const secKo = (v?: number): string => {
  const s = Math.max(0, Math.round(v ?? 0));
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ""}`;
};
const secEn = (v?: number): string => {
  const s = Math.max(0, Math.round(v ?? 0));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
};

export interface LogTemplates {
  line: Record<LogKey, (a: LogArgs) => string>;
  status: (a: StatusArgs) => string;
}

export const LOG: Record<Lang, LogTemplates> = {
  ko: {
    line: {
      "you.state": (a) => {
        const on = a.surface ?? "open";
        if (on === "open") return a.moving ? "풀밭을 걷고 있습니다." : "풀밭에 서 있습니다.";
        if (on === "trodden") return a.moving ? "다져진 길을 걷고 있습니다." : "다져진 길에 서 있습니다.";
        return a.moving ? "콘크리트 위를 걷고 있습니다." : "콘크리트 위에 서 있습니다.";
      },
      "you.moving": (a) => (a.moving ? "걷기 시작합니다." : "멈춰 섭니다."),
      surface: (a) => (a.surface === "trodden" ? "누군가 다져 놓은 길입니다." : a.surface === "sealed" ? "콘크리트 위입니다." : "풀밭으로 나왔습니다."),
      near: () => "({}) 접근",
      gone: (a) => `({}) 떠남 · ${secKo(a.forSec)} 함께`,
      "word.new": () => "누군가 말을 겁니다: ({}?)",
      "word.asked": (a) => ["({}?)", "곁에서 묻습니다: ({}?)", "({}...?)", "다시 묻습니다: ({}?)"][(a.n ?? 0) % 4],
      "word.answered": () => "새로운 어휘가 탄생했습니다 ({})",
      "word.found": () => "({})가 남긴 말 발견",
      dying: () => "죽어가고 있습니다...",
      "dying.watched": () => "({})가 당신의 마지막을 지킵니다...",
      "ensemble.start": () => "합주 중… 함께 집을 짓습니다.",
      "ensemble.end": (a) => `합주가 끝났습니다 · ${secKo(a.forSec)}`,
      "attempt.tried": () => "그만 살기를 시도했습니다.",
      "attempt.failed": () => "실패했습니다.",
      "grass.pressed": () => "지나온 자리의 풀이 사라졌습니다.",
      "grass.recovered": () => "떠난 자리에 풀이 돌아오고 있습니다.",
      "ground.worn": () => "걸은 자리가 다져지고 있습니다.",
      "ground.prePath": () => "누군가 먼저 낸 길을 걷고 있습니다.",
      "path.formed": () => "걸은 자리가 길이 되었습니다.",
      "concrete.share": (a) => `집이 올라갑니다 · ${(a.with?.length ?? 0) + 1}명이 함께`,
      "sealed.under": () => "함께 지은 집 위에 서 있습니다.",
      "alone.long": (a) => `${secKo(a.sec)}째 혼자입니다. 혼자서는 집을 지을 수 없습니다.`,
    },
    status: (a) => `${a.together ? "합주 중" : a.moving ? "걷는 중" : "머무는 중"} ${fmtClock(a.forSec)} · ${WHERE_KO[a.surface]} · 곁에 ${a.near}명`,
  },
  en: {
    line: {
      "you.state": (a) => `${a.moving ? "Walking" : "Standing"} on ${WHERE_EN[a.surface ?? "open"]}.`,
      "you.moving": (a) => (a.moving ? "You start walking." : "You stop."),
      surface: (a) => (a.surface === "trodden" ? "A path someone trod." : a.surface === "sealed" ? "On concrete." : "Out on the grass."),
      near: () => "({}) comes near",
      gone: (a) => `({}) leaves · together ${secEn(a.forSec)}`,
      "word.new": () => "Someone speaks to you: ({}?)",
      "word.asked": (a) => ["({}?)", "Asked beside you: ({}?)", "({}...?)", "Asked again: ({}?)"][(a.n ?? 0) % 4],
      "word.answered": () => "A new word is born ({})",
      "word.found": () => "A word left by ({}) found",
      dying: () => "You are dying...",
      "dying.watched": () => "({}) keeps watch over your last moments...",
      "ensemble.start": () => "In ensemble… building a house together.",
      "ensemble.end": (a) => `The ensemble is over · ${secEn(a.forSec)}`,
      "attempt.tried": () => "You tried to stop living.",
      "attempt.failed": () => "It failed.",
      "grass.pressed": () => "The grass behind you is gone.",
      "grass.recovered": () => "The grass is coming back where you left.",
      "ground.worn": () => "The ground you walk is packing down.",
      "ground.prePath": () => "You are on a path someone made before you.",
      "path.formed": () => "Where you walked has become a path.",
      "concrete.share": (a) => `A house goes up · ${(a.with?.length ?? 0) + 1} together`,
      "sealed.under": () => "You stand on a house you helped build.",
      "alone.long": (a) => `Alone for ${secEn(a.sec)}. A house cannot be built alone.`,
    },
    status: (a) => `${a.together ? "In ensemble" : a.moving ? "Walking" : "Staying"} ${fmtClock(a.forSec)} · ${WHERE_EN[a.surface]} · ${a.near} near`,
  },
};

/** One record line in the chosen language: the `T+mm:ss` prefix (machine face) and the text (apparatus face). */
export function formatEntry(e: LogEntry, lang: Lang): { prefix: string; text: string } {
  return { prefix: `T+${fmtClock(e.t)}`, text: LOG[lang].line[e.key](e.args) };
}
export const formatStatus = (a: StatusArgs, lang: Lang): string => LOG[lang].status(a);

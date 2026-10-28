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
import type { RoleId } from "./types";

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

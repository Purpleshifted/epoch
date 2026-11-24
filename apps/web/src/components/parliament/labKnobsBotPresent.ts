"use client";
/**
 * bot (present) · 현재의 사람 — the others' bodies, walk, their afterimages and windows, the asker's cue, and the body
 * archetypes (PointPeople, bodySheet, bodyArchetypes, fiberBody, spritePeople). The afterimages, the motion, the 2D
 * people, the fibers and the archetypes are folders of the group with their own saved sets (`<group>.잔흔 — …`,
 * `<group>.움직임`, `<group>.2D 사람`, `<group>.점 몸 · 섬유`, `<group>.체형 아키타입`); any save row saves the whole group.
 * One of the mobile view lab's asset groups (mobileLab.ts): stored under /lab/mobile whatever page reads it, listed
 * only on its lab page. Keys are the old 길거리 folder's (11/22–23), so the components read them as before
 * (usePersonalVisuals assembles them into StreetVisual / GrassVisual).
 */

import { folder, useControls } from "leva";
import { savable } from "./levaSave";
import { LAB_GROUP, labLists } from "./mobileLab";
import { DEFAULT_PEOPLE, type PeopleMode } from "./PointPeople";
import { DEFAULT_ARCHETYPES, DEFAULT_MOVE, DEFAULT_SPRITE, DEFAULT_TRAIL, bodyTuning, type ArchetypeView, type ArmStyle, type HairChoice, type HemChoice } from "./bodyArchetypes";
import { DEFAULT_FIBER } from "./fiberBody";

const ARM_STYLES: Record<string, ArmStyle> = { "흔들며 걷기": "swing", "주머니에 손": "pockets", "뒷짐": "behind", "휴대폰 보기": "phone", "팔짱": "crossed", "허리에 손": "hips", "앞에 손 모음": "clasp", "턱 괴기": "chin" };
const HEMS: Record<string, HemChoice> = { "사람마다": "any", "허리까지 (윗옷)": "waist", "엉덩이까지 (재킷)": "hip", "무릎까지 (코트)": "knee" };
const HAIRS: Record<string, HairChoice> = { "사람마다": "any", "짧은 머리": "short", "긴 머리": "long" };
const GAITS: Record<string, number> = { "사람마다 (넷 중 하나)": -1, "캡처 1 · CMU 07_01": 0, "캡처 2 · CMU 07_02": 1, "캡처 3 · CMU 02_01": 2, "캡처 4 · CMU 35_01": 3 };

/** One archetype's knobs (keys a<i>…: one saved set for all five), in folders by what they shape. */
function archetypeSchema(i: number, v2: () => boolean) {
  const d = DEFAULT_ARCHETYPES[i];
  const k = (name: string) => `a${i}${name}`;
  const n = (name: string, value: number, min: number, max: number, step: number, label: string) => ({ [k(name)]: { value, min, max, step, label, render: v2 } });
  return folder(
    {
      [k("Name")]: { value: d.name, label: "이름 (메모)", render: v2 },
      ...n("Weight", d.weight, 0, 1, 0.05, "군중 속 비중 (0 = 없음)"),
      ...n("Height", d.height, 1.2, 2.1, 0.01, "키 (m)"),
      "몸 비례": folder(
        {
          ...n("Legs", d.legs, 0.8, 1.25, 0.01, "다리 길이 ×"),
          ...n("Torso", d.torso, 0.8, 1.25, 0.01, "상체 길이 ×"),
          ...n("Shoulders", d.shoulders, 0.75, 1.35, 0.01, "어깨 너비 ×"),
          ...n("Hips", d.hips, 0.75, 1.35, 0.01, "골반 너비 ×"),
          ...n("Arms", d.arms, 0.8, 1.2, 0.01, "팔 길이 ×"),
        },
        { collapsed: true },
      ),
      "두께": folder(
        {
          ...n("Girth", d.girth, 0.7, 1.6, 0.01, "몸통 ×"),
          ...n("Belly", d.belly, 0.7, 1.6, 0.01, "허리·배 ×"),
          ...n("Limbs", d.limbs, 0.7, 1.6, 0.01, "팔다리 굵기 ×"),
          ...n("Head", d.head, 0.8, 1.3, 0.01, "머리 크기 ×"),
        },
        { collapsed: true },
      ),
      "자세": folder(
        {
          ...n("Lean", d.lean, -8, 20, 0.5, "앞으로 기울기 (°)"),
          ...n("Hunch", d.hunch, 0, 1, 0.05, "구부정함"),
          ...n("HeadDown", d.headDown, -10, 40, 1, "고개 숙임 (°)"),
        },
        { collapsed: true },
      ),
      "걸음": folder(
        {
          [k("Gait")]: { options: GAITS, value: d.gait, label: "캡처한 걸음", render: v2 },
          ...n("Stride", d.stride, 0.5, 1.5, 0.01, "보폭 ×"),
          ...n("Swing", d.swing, 0, 2.5, 0.05, "팔 흔들기 ×"),
          ...n("Bounce", d.bounce, 0, 3, 0.05, "위아래 출렁임 ×"),
          ...n("Sway", d.sway, 0, 3, 0.05, "좌우 흔들림 ×"),
          ...n("Lift", d.lift, 0.3, 2, 0.05, "발 들기 ×"),
          ...n("Pace", d.pace, 0.5, 1.6, 0.01, "걷는 빠르기 ×"),
        },
        { collapsed: true },
      ),
      "팔과 옷": folder(
        {
          [k("Arms2")]: { options: ARM_STYLES, value: d.armStyle, label: "팔", render: v2 },
          [k("Hem")]: { options: HEMS, value: d.hem, label: "윗옷 길이", render: v2 },
          [k("Hair")]: { options: HAIRS, value: d.hair, label: "머리", render: v2 },
          [k("Fixed")]: { value: d.fixedColour, label: "옷 색 지정 (끄면 팔레트에서 사람마다)", render: v2 },
          [k("Top")]: { value: d.top, label: "윗옷 색", render: v2 },
          [k("Pants")]: { value: d.pants, label: "바지 색", render: v2 },
        },
        { collapsed: true },
      ),
    },
    { collapsed: true },
  );
}

/**
 * The afterimages and the archetypes (bodyArchetypes.ts — the artist, 2026-11-23), each a folder of the group with its
 * own saved set; their values go to `bodyTuning`, which PointPeople reads every frame.
 */
function useBodyKnobs(isV2: boolean) {
  const v2 = () => isV2;
  const show = () => isV2 && labLists("bot-present");
  const G = LAB_GROUP["bot-present"];
  // (a folder shows only while its way of drawing is chosen — the artist, 2026-11-23: "안 쓰는 노브는 다 지워가고 새로운 건
  // 추가해가면서"; hidden values are kept)
  const modeIs = (m: string) => (get: (path: string) => unknown) => show() && get(`${G}.사람.ppMode`) === m;
  // (the frames' pictograms read none of the bodies' knobs — "안 쓰는 레바 싹 없애고", 2026-11-24)
  const notFrames = (get: (path: string) => unknown) => show() && get(`${G}.사람.ppMode`) !== "frames";
  const moveRoot = `${G}.움직임`;
  const mv = useControls(
    moveRoot,
    savable(moveRoot, {
      mvStamp: { value: DEFAULT_MOVE.stamp, label: "보간 끄기 — 표본마다 슉 하고 남음 (끄면 보간하며 걸음)", render: v2 },
      mvDash: { value: DEFAULT_MOVE.dashSec, min: 0.02, max: 0.5, step: 0.01, label: "슉 — 새 자리로 쓸려 가는 시간 (s)", render: v2 },
      mvRunFrom: { value: DEFAULT_MOVE.runFrom, min: 0.8, max: 5, step: 0.1, label: "이보다 빠르면 뜀 (m/s)", render: v2 },
      mvRun: { value: DEFAULT_MOVE.run, min: 0, max: 1, step: 0.05, label: "뛰는 정도", render: v2 },
      mvGest: { value: DEFAULT_MOVE.gestures, label: "서 있으면 제스처", render: v2 },
      mvGestSec: { value: DEFAULT_MOVE.gestureSec, min: 1, max: 20, step: 0.5, label: "제스처가 바뀌는 간격 (s)", render: v2 },
    }),
    { collapsed: false, render: notFrames },
  ) as unknown as Record<string, number | boolean>;
  const spriteRoot = `${G}.2D 사람`;
  const sp = useControls(
    spriteRoot,
    savable(spriteRoot, {
      spInk: { value: DEFAULT_SPRITE.ink, min: 0.1, max: 1, step: 0.05, label: "진하기", render: v2 },
      spScale: { value: DEFAULT_SPRITE.scale, min: 0.6, max: 1.6, step: 0.01, label: "키 ×", render: v2 },
      spCopies: { value: DEFAULT_SPRITE.copies, min: 0, max: 16, step: 1, label: "슉마다 남는 잔상 수", render: v2 },
      spSec: { value: DEFAULT_SPRITE.sec, min: 0.1, max: 5, step: 0.05, label: "잔상이 남는 시간 (s)", render: v2 },
      spTrail: { value: DEFAULT_SPRITE.trail, min: 0, max: 1, step: 0.05, label: "잔상 진하기", render: v2 },
      spHue: { value: DEFAULT_SPRITE.hue, min: 0, max: 1, step: 0.05, label: "옷 색 바꾸기 (사람마다)", render: v2 },
      spSat: { value: DEFAULT_SPRITE.sat, min: 0, max: 2, step: 0.05, label: "채도 ×", render: v2 },
    }),
    { collapsed: false, render: modeIs("sprites") },
  ) as unknown as Record<string, number>;
  bodyTuning.sprite = { ink: Number(sp.spInk), scale: Number(sp.spScale), copies: Number(sp.spCopies), sec: Number(sp.spSec), trail: Number(sp.spTrail), hue: Number(sp.spHue), sat: Number(sp.spSat) };
  const fiberRoot = `${G}.점 몸 · 섬유`;
  const fb = useControls(
    fiberRoot,
    savable(fiberRoot, {
      fbCount: { value: DEFAULT_FIBER.count, min: 300, max: 6000, step: 100, label: "한 사람의 점 수", render: v2 },
      fbSize: { value: DEFAULT_FIBER.sizeMm, min: 4, max: 80, step: 1, label: "점 크기 (mm)", render: v2 },
      fbMinPx: { value: DEFAULT_FIBER.minPx, min: 0.5, max: 4, step: 0.1, label: "점 최소 (px)", render: v2 },
      fbInk: { value: DEFAULT_FIBER.ink, min: 0.05, max: 1, step: 0.05, label: "점 진하기", render: v2 },
      fbSec: { value: DEFAULT_FIBER.sec, min: 0.05, max: 3, step: 0.05, label: "섬유 — 지나온 길이 남는 시간 (s)", render: v2 },
      fbTail: { value: DEFAULT_FIBER.tail, min: 0, max: 1, step: 0.05, label: "섬유 끝의 진하기", render: v2 },
      fbScatter: { value: DEFAULT_FIBER.scatterCm, min: 0, max: 60, step: 1, label: "섬유 끝이 흩어짐 (cm)", render: v2 },
      fbFly: { value: DEFAULT_FIBER.flyShare, min: 0, max: 0.5, step: 0.01, label: "흩날리는 점의 몫", render: v2 },
      fbFlyM: { value: DEFAULT_FIBER.flyM, min: 0, max: 4, step: 0.05, label: "흩날려 가는 거리 (m)", render: v2 },
      fbFlySpeed: { value: DEFAULT_FIBER.flySpeed, min: 0.05, max: 2, step: 0.05, label: "흩날림 빠르기", render: v2 },
      fbSat: { value: DEFAULT_FIBER.sat, min: 0, max: 2.5, step: 0.05, label: "옷 색 채도 ×", render: v2 },
    }),
    { collapsed: false, render: modeIs("fibers") },
  ) as unknown as Record<string, number | boolean>;
  bodyTuning.move = { stamp: !!mv.mvStamp, dashSec: Number(mv.mvDash), runFrom: Number(mv.mvRunFrom), run: Number(mv.mvRun), gestures: !!mv.mvGest, gestureSec: Number(mv.mvGestSec) };
  bodyTuning.fiber = { count: Number(fb.fbCount), sizeMm: Number(fb.fbSize), minPx: Number(fb.fbMinPx), sec: Number(fb.fbSec), tail: Number(fb.fbTail), ink: Number(fb.fbInk), scatterCm: Number(fb.fbScatter), flyShare: Number(fb.fbFly), flyM: Number(fb.fbFlyM), flySpeed: Number(fb.fbFlySpeed), sat: Number(fb.fbSat) };
  const trailRoot = `${G}.잔흔 — 동세의 시공간 덩어리`;
  const t = useControls(
    trailRoot,
    savable(trailRoot, {
      trOn: { value: DEFAULT_TRAIL.on, label: "잔흔 켜기", render: v2 },
      trSec: { value: DEFAULT_TRAIL.sec, min: 0.2, max: 4, step: 0.05, label: "남는 시간 (s)", render: v2 },
      trCount: { value: DEFAULT_TRAIL.count, min: 2, max: 24, step: 1, label: "잔흔 수 (그 시간 동안)", render: v2 },
      trNow: { value: DEFAULT_TRAIL.now, min: 0, max: 1, step: 0.05, label: "지금의 몸 진하기", render: v2 },
      trInk: { value: DEFAULT_TRAIL.ink, min: 0, max: 1, step: 0.05, label: "잔흔 진하기 (겹치면 한 몸만큼)", render: v2 },
      trFall: { value: DEFAULT_TRAIL.fall, min: 0.3, max: 4, step: 0.05, label: "오래된 것이 빠지는 정도", render: v2 },
      trSoftNow: { value: DEFAULT_TRAIL.softNow, min: 0, max: 10, step: 0.1, label: "지금 몸 가장자리 번짐 (cm)", render: v2 },
      trSoftOld: { value: DEFAULT_TRAIL.softOld, min: 0, max: 40, step: 0.5, label: "가장 오래된 잔흔 번짐 (cm)", render: v2 },
      trSat: { value: DEFAULT_TRAIL.sat, min: 0, max: 2.5, step: 0.05, label: "잔흔 색 채도 ×", render: v2 },
    }),
    { collapsed: false, render: modeIs("boxes") },
  ) as unknown as Record<string, number | boolean>;
  const archRoot = `${G}.체형 아키타입`;
  const archSchema: Record<string, unknown> = {
    archView: { options: { "군중 — 비중대로": "all", "1만": 0, "2만": 1, "3만": 2, "4만": 3, "5만": 4 } as Record<string, ArchetypeView>, value: "all", label: "보기 (이 랩 페이지에서만)", render: v2 },
  };
  for (let i = 0; i < DEFAULT_ARCHETYPES.length; i++) archSchema[`아키타입 ${i + 1}`] = archetypeSchema(i, v2);
  const a = useControls(archRoot, savable(archRoot, archSchema) as Parameters<typeof useControls>[1], { collapsed: false, render: notFrames }) as unknown as Record<string, unknown>;
  bodyTuning.trail = {
    on: !!t.trOn,
    sec: Number(t.trSec),
    count: Number(t.trCount),
    now: Number(t.trNow),
    ink: Number(t.trInk),
    fall: Number(t.trFall),
    softNow: Number(t.trSoftNow),
    softOld: Number(t.trSoftOld),
    sat: Number(t.trSat),
  };
  bodyTuning.view = (a.archView as ArchetypeView) ?? "all";
  bodyTuning.archetypes = DEFAULT_ARCHETYPES.map((d, i) => {
    const g = (name: string) => a[`a${i}${name}`];
    const num = (name: string, def: number) => (typeof g(name) === "number" ? (g(name) as number) : def);
    return {
      name: String(g("Name") ?? d.name),
      weight: num("Weight", d.weight),
      height: num("Height", d.height),
      legs: num("Legs", d.legs),
      torso: num("Torso", d.torso),
      shoulders: num("Shoulders", d.shoulders),
      hips: num("Hips", d.hips),
      arms: num("Arms", d.arms),
      girth: num("Girth", d.girth),
      belly: num("Belly", d.belly),
      limbs: num("Limbs", d.limbs),
      head: num("Head", d.head),
      lean: num("Lean", d.lean),
      hunch: num("Hunch", d.hunch),
      headDown: num("HeadDown", d.headDown),
      gait: num("Gait", d.gait),
      stride: num("Stride", d.stride),
      swing: num("Swing", d.swing),
      bounce: num("Bounce", d.bounce),
      sway: num("Sway", d.sway),
      lift: num("Lift", d.lift),
      pace: num("Pace", d.pace),
      armStyle: (g("Arms2") as ArmStyle) ?? d.armStyle,
      hem: (g("Hem") as HemChoice) ?? d.hem,
      hair: (g("Hair") as HairChoice) ?? d.hair,
      fixedColour: typeof g("Fixed") === "boolean" ? (g("Fixed") as boolean) : d.fixedColour,
      top: typeof g("Top") === "string" ? (g("Top") as string) : d.top,
      pants: typeof g("Pants") === "string" ? (g("Pants") as string) : d.pants,
    };
  });
}

// (the labels say what each draws on the white ground now — 2026-11-23; the stored values stay "boxes" / "points")
const PEOPLE_MODES: Record<string, PeopleMode> = {
  // (the artist, 2026-11-23: "이제 슬슬 봇 랩에 연결해보자" → 2026-11-24: the poster's pixel people, each a body walking
  // where it is — "카드가 아니라 동적 에셋으로 그려내는 픽토그램"; the stored value stays "frames")
  "픽토그램 — 움직이는 픽셀 사람 (미래관찰자)": "frames",
  "2D 사람 — 영상에서 오린 실제 사람 (people_clips)": "sprites",
  "점 몸 — 뼈대 위의 점, 점마다 섬유 · 흩날림 (체형 아키타입)": "fibers",
  "3D 몸 — 면, 잔흔 (체형 아키타입)": "boxes",
  "옛 점 몸 — 점 N개 + 시간 번짐 복사본": "points",
};

export function useBotPresentKnobs(isV2: boolean) {
  const v2 = () => isV2;
  // (what the frames' pictograms do not read is hidden while they draw the people — "안 쓰는 레바 싹 없애고"; the values
  // are kept for the other ways of drawing)
  const nf = (get: (path: string) => unknown) => isV2 && get(`${LAB_GROUP["bot-present"]}.사람.ppMode`) !== "frames";
  const isFr = (get: (path: string) => unknown) => isV2 && get(`${LAB_GROUP["bot-present"]}.사람.ppMode`) === "frames";
  useBodyKnobs(isV2);
  return useControls(
    LAB_GROUP["bot-present"],
    savable(
      LAB_GROUP["bot-present"],
      {
      "사람": folder({
        streetPeople: { value: true, label: "사람을 아래 방식으로 (끄면 옛 네모)", render: v2 },
        ppMode: { options: PEOPLE_MODES, value: DEFAULT_PEOPLE.mode, label: "그리기", render: v2 },
        // (the artist, 2026-11-24: "픽토그램 크기 전반적으로 줄이면서")
        frSize: { value: DEFAULT_PEOPLE.frSize, min: 0.3, max: 1.5, step: 0.01, label: "프레임: 픽토그램 크기 ×", render: isFr },
        // (its own blur, apart from the street's softening — the artist, 2026-11-24: "픽토그램에는 블러 적용 따로 되도록";
        // drawn in the pictogram's shader, so the same on the white ground and the black)
        frBlur: { value: DEFAULT_PEOPLE.frBlur, min: 0, max: 0.2, step: 0.005, label: "프레임: 픽토그램 흐림 (0 = 또렷)", render: isFr },
        ppGait: { options: { "모캡 걷기 — CMU 실제 보행 넷 (사람마다 하나)": "mocap", "사인 걷기 — 절차적 골격": "sine" } as Record<string, "mocap" | "sine">, value: DEFAULT_PEOPLE.gait, label: "걸음", render: nf },
        ppColour: { value: DEFAULT_PEOPLE.colour, min: 0, max: 1, step: 0.05, label: "옷 색 (0 = 회색, 1 = 팔레트)", render: nf },
        ppHeight: { value: DEFAULT_PEOPLE.height, min: 1, max: 2.4, step: 0.05, label: "키 (m, 평균)", render: nf },
        ppVariety: { value: DEFAULT_PEOPLE.variety, min: 0, max: 1, step: 0.05, label: "다양성 — 키·체격·걸음", render: nf },
        paperVariety: { value: 1, min: 0, max: 1, step: 0.05, label: "다양성 — 진하기·창의 기울기", render: nf },
        ppMaxCadence: { value: DEFAULT_PEOPLE.maxCadence, min: 0.8, max: 4, step: 0.1, label: "걸음 박자 상한 (걸음/s)", render: nf },
        ppFaceEach: { value: DEFAULT_PEOPLE.faceEach, label: "서 있으면 가까운 이를 마주 봄", render: nf },
        ppFaceRadius: { value: DEFAULT_PEOPLE.faceRadius, min: 1, max: 8, step: 0.5, label: "마주 보는 거리 (m)", render: nf },
      }),
      "지나간 자리 — 사람마다의 창": folder(
        {
        paperInk: { value: 1, min: 0.2, max: 1, step: 0.05, label: "몸의 진하기", render: v2 },
        // (hidden 2026-11-23 — the artist: "플리커링 있어 보이는 거 끔찍": on the white the body walks continuously and
        // the window neither jumps nor shakes; the values are kept)
        paperFlicker: { value: true, label: "표본마다 점프 (보간 없음)", render: () => false },
        paperStretch: { value: 1, min: 0, max: 3, step: 0.1, label: "창이 잔흔만큼 늘어남 (배수)", render: v2 },
        paperShake: { value: 2, min: 0, max: 8, step: 0.5, label: "표본이 올 때 떨림 (cm)", render: () => false },
        paperTail: { value: 1.6, min: 0.2, max: 6, step: 0.1, label: "사라질 때 옅어지는 시간 (s)", render: v2 },
        paperFrame: { value: 1, min: 0, max: 2, step: 0.1, label: "창 필름의 세기", render: v2 },
        paperAspectMin: { value: 0.5, min: 0.2, max: 2, step: 0.05, label: "창 비율 최소 (폭/키)", render: v2 },
        paperAspectMax: { value: 1.3, min: 0.2, max: 2.5, step: 0.05, label: "창 비율 최대", render: v2 },
        },
        { render: nf },
      ),
      "말 걸기": folder({
        ppCue: { value: DEFAULT_PEOPLE.cue, label: "말 거는 이의 창이 커짐", render: nf },
        askTurn: { value: true, label: "시선이 그쪽으로 돌아감 (손대면 멈춤)", render: v2 },
        askRipple: { value: true, label: "창에서 사각 파문", render: nf },
        paperBubble: { value: true, label: "옆에 멜로디 기호 버블", render: v2 },
        // (the frames' pictograms — the artist, 2026-11-24: "present bot 에서 해당 작업내용 보고 인터랙션 다듬게")
        frHop: { value: DEFAULT_PEOPLE.frHop, label: "프레임: 말 거는 이의 머리가 멜로디 박자로 튐", render: isFr },
        frAskSolid: { value: DEFAULT_PEOPLE.frAskSolid, label: "프레임: 말 거는 이는 가까이서도 진하게", render: isFr },
        frAskScale: { value: DEFAULT_PEOPLE.frAskScale, min: 1, max: 1.6, step: 0.01, label: "프레임: 말 거는 이 크기 ×", render: isFr },
      }),
      "옛 점 몸 · 옛 노브": folder({
        ppPoints: { value: DEFAULT_PEOPLE.points, min: 64, max: 800, step: 16, label: "점 몸: 점 수", render: v2 },
        ppPointsPhone: { value: DEFAULT_PEOPLE.pointsPhone, min: 32, max: 480, step: 16, label: "점 몸: 폰 점 수", render: v2 },
        ppDot: { value: DEFAULT_PEOPLE.dot, min: 0.01, max: 0.3, step: 0.005, label: "점 몸: 점 크기 (m)", render: v2 },
        ppMaxPx: { value: DEFAULT_PEOPLE.maxPx, min: 2, max: 24, step: 1, label: "점 몸: 점 최대 (px)", render: v2 },
        ppGrey: { value: DEFAULT_PEOPLE.grey, min: 0.2, max: 1, step: 0.02, label: "점 몸: 회색", render: v2 },
        ppBreath: { value: DEFAULT_PEOPLE.breath, min: 0, max: 3, step: 0.1, label: "점 몸: 숨", render: v2 },
        ppSmearSec: { value: DEFAULT_PEOPLE.smearSec, min: 0, max: 8, step: 0.25, label: "점 몸: 번짐 (s)", render: v2 },
        ppSmearCopies: { value: DEFAULT_PEOPLE.smearCopies, min: 1, max: 8, step: 1, label: "점 몸: 번짐 복사본", render: v2 },
        ppPlate: { value: DEFAULT_PEOPLE.plate, label: "점 몸: 세운 판", render: v2 },
        ppPlateAlpha: { value: DEFAULT_PEOPLE.plateAlpha, min: 0.02, max: 0.5, step: 0.01, label: "점 몸: 판 불투명도", render: v2 },
        ppFog: { value: DEFAULT_PEOPLE.fog, label: "점 몸: 안개를 받음", render: v2 },
        ppMaxSpeed: { value: DEFAULT_PEOPLE.maxSpeed, min: 1, max: 6, step: 0.1, label: "보간 최고 속도 (월드/s)", render: v2 },
        meBody: { value: DEFAULT_PEOPLE.meBody, label: "나 = 내 등 (점 몸)", render: v2 },
        meRest: { value: DEFAULT_PEOPLE.meRest, min: 0, max: 1, step: 0.05, label: "내 몸: 쉴 때 밝기", render: v2 },
        ppBoxAspect: { value: DEFAULT_PEOPLE.boxAspect, min: 0.3, max: 1.2, step: 0.05, label: "검은 바탕 상자: 폭", render: v2 },
        ppBoxRest: { value: DEFAULT_PEOPLE.boxRest, min: 0.05, max: 0.6, step: 0.01, label: "검은 바탕 상자: 쉴 때 회색", render: v2 },
        // (hidden 11/23: the white ground's bodies are 3D now — bodySheet.ts — and no sheet is blurred; the value is kept)
        paperBlur: { value: 3, min: 0, max: 8, step: 0.5, label: "옛: 시트 번짐 (px)", render: () => false },
        paperFade: { value: 12, min: 3, max: 30, step: 0.5, label: "옛: 필름 옅어지는 거리", render: v2 },
      }, { collapsed: true, render: (get) => get(`${LAB_GROUP["bot-present"]}.사람.ppMode`) === "points" }),
      },
      [],
      // (the people become the frames study's pictograms — once, over what was saved before the day's end)
      [{ tag: "pp-frames-2026-11-24", set: { ppMode: "frames" } }],
    ),
    { collapsed: false, order: 0.6, render: () => isV2 && labLists("bot-present") },
  );
}

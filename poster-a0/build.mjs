#!/usr/bin/env node
// Builds the A0 poster as HTML, sized in real millimetres; Chrome prints it to PDF (tools/cdp.mjs pdf).
//   node poster-a0/build.mjs     writes out/E.html, out/F.html and out/layout.json (for tools/overlap.py)
// Words: poster-a0/text.md. Image: the work's own wall without vegetation (renders/column_bare.png, tools/capture.mjs
// + key.py). Glyphs and traces: the app's own code (tools/glyphs.mjs, tools/traces.mjs).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "out");
mkdirSync(OUT, { recursive: true });
const data = (f) => JSON.parse(readFileSync(resolve(HERE, "data", f), "utf8"));
const glyphs = data("glyphs.json");
const fig = data("figure.json");

const W = 841;
const H = 1189;
const IMG = "column_bare.png";
const COLUMN_RATIO = 5967 / 5400; // the cutout's frame: 7 × 4 tiles, world 92 × 83.4 units
const INK = "#141414";

const TEXT = {
  title: ["발견된", "인류"],
  titleEn: "Homo inventus",
  head: ["미래의 고고학자들이 멸망한 인류를 발굴 중입니다.", "현재의 당신은 무엇을 남기시겠습니까?"],
  // the main text is the thought; the raised numbers lead to the notes, which are the work
  body: [
    "인류세(Anthropocene)는 인간의 활동이 지구에 남긴 변화가 지층에 기록될 만큼 커졌다는 생각에서 나온 말이다. 공식 지질 시대로 채택되지는 않았지만, 플라스틱, 콘크리트, 핵실험에서 나온 방사성 물질은 이미 퇴적층에서 확인된다. 이 말은 우리가 사는 지금을 먼 미래에 발견될 지층으로 바라보게 한다.",
    "철학자 티머시 모턴은 기후 변화처럼 시간과 공간에 너무 넓게 퍼져 있어 한눈에 파악할 수 없는 대상을 하이퍼객체라고 불렀다. 인류세도 그런 대상이다. 그 규모에 비하면 한 사람이 할 수 있는 일은 아주 작고, 자신의 행동이 어떤 영향을 미치는지 전부 알기도 어렵다. 그래도 모든 삶은 흔적을 남기고, 그 흔적들이 모여 미래에 보일 인류세의 풍경이 된다. 태어난 이상 살아가는 수밖에 없다.",
    "인류세의 화석은 무엇일까. 고생물학에서는 발자국이나 굴처럼 생물의 몸이 아니라 활동의 자취가 남은 화석을 생흔화석이라고 부른다. 이 작품은 인간의 생흔화석을 도시의 주거, 수로, 길의 흔적<sup>4</sup>으로 본다. 사람들이 살아가면서 만든 구조가 곧 인간이 살았다는 기록이라는 관점이다.",
    "〈발견된 인류〉에서 관객은 짧은 삶<sup>1</sup>을 살며 가상의 세계를 걷는다. 개인 화면<sup>2</sup>에는 자기 주변만 보이지만, 벽<sup>3</sup>에는 모든 관객의 흔적이 시간 순서대로 쌓인 전체가 나타난다. 두 화면의 차이는 한 개인과 인류세 사이의 규모 차이이고, 벽의 시점은 미래에 이 지층을 발굴하는 사람의 시점이다.",
  ],
  notes: [
    ["삶", "관객은 약 3분의 삶을 배정받는다. 이름 대신 고유한 멜로디를 받고, 8칸 악보로 적은 이 기호가 곧 이름이다. 이름을 받으면서 세계 안의 존재가 된다.", "name"],
    ["개인 화면", "자기 주변만 보인다. 다른 존재 곁에 오래 머물면 그 멜로디가 내 멜로디에 섞이고, 말을 걸어 오는 상대에게 응답하면 새 어휘가 생긴다. 여럿이 머물면 화음이 되고, 그 자리에 건물이 선다.", "word"],
    ["벽", "모든 삶의 흔적이 시간 축을 따라 쌓인다. 위가 현재, 아래가 과거다. 오래된 층의 건물은 서로 엉겨 붙어 뼈처럼 변한다. 같은 멜로디들이 전시장 스피커에서는 두 옥타브 아래의 한 덩어리로 들린다.", "low"],
    ["흔적", "거주: 여럿이 오래 머문 자리에 콘크리트가 선다. 혼자서는 지을 수 없다. 이동: 많이 밟힌 땅은 길이 된다. 물: 건물과 길이 덮은 땅의 빗물은 스며들지 못하고 수로와 배관으로 흐른다.", null],
  ],
  credit: ["Hayeon Park · 20220875", "Supervised by Yiyun Kang", "ID40009 Graduation Design Studio · 2026"],
};

const rects = (dots) => dots.map(([c, r, l]) => `<rect x="${c}" y="${r}" width="${l - 0.08}" height="0.92"/>`).join("");
const glyph = (dots, size) => `<svg viewBox="0 0 8 8" width="${size}mm" height="${size}mm" fill="${INK}" shape-rendering="crispEdges" style="display:block">${rects(dots)}</svg>`;
const chord = (list, size, opacity, squash = 1) => {
  const t = squash < 1 ? `translate(0 ${8 * (1 - squash)}) scale(1 ${squash})` : "";
  return `<svg viewBox="0 0 8 8" width="${size}mm" height="${size}mm" fill="${INK}" shape-rendering="crispEdges" style="display:block">${list.map((g) => `<g transform="${t}" opacity="${opacity}">${rects(g.dots)}</g>`).join("")}</svg>`;
};
const fig_a = () => fig.a.dots;
const fig_b = () => fig.b.dots;
const fig_w = () => fig.word;
const figure = (kind, s) => (kind === "name" ? glyph(fig.a.dots, s) : kind === "word" ? glyph(fig.word, s) : kind === "low" ? chord(glyphs.slice(0, 19), s, 0.34, 0.22) : "");

/** Time ticks down the cut; `y0` = the present on the page, `mmPerSec` = the image's scale. */
const timeAxis = ({ x, y0, mmPerSec, yEnd, font = 4.6 }) => {
  const out = [`<line x1="${x}" y1="0" x2="${x}" y2="${yEnd}" stroke="${INK}" stroke-width=".25"/>`];
  for (let s = 0; y0 + s * mmPerSec <= yEnd; s += 60) {
    const y = y0 + s * mmPerSec;
    const major = s % 300 === 0;
    out.push(`<line x1="${x}" y1="${y}" x2="${x + (major ? 6 : 2.5)}" y2="${y}" stroke="${INK}" stroke-width=".25"/>`);
    if (major) out.push(`<text x="${x + 8}" y="${y + font * 0.34}" font-size="${font}" fill="${INK}">${s === 0 ? "현재" : `−${s / 60}분`}</text>`);
  }
  return out.join("");
};

const base = (extra) => `
@font-face { font-family: "Pre"; font-weight: 400; src: url("file:///Users/hesse/Library/Fonts/Pretendard-Regular.otf"); }
@font-face { font-family: "Pre"; font-weight: 500; src: url("file:///Users/hesse/Library/Fonts/Pretendard-Medium.otf"); }
@font-face { font-family: "Pre"; font-weight: 700; src: url("file:///Users/hesse/Library/Fonts/Pretendard-Bold.otf"); }
@font-face { font-family: "Neo"; src: url("../../apps/web/public/fonts/neodgm.woff2") format("woff2"); }
@page { size: ${W}mm ${H}mm; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${W}mm; height: ${H}mm; }
body { position: relative; overflow: hidden; color: ${INK}; font-family: "Pre", sans-serif; font-weight: 400; word-break: keep-all; print-color-adjust: exact; -webkit-print-color-adjust: exact;
  background: radial-gradient(ellipse 70% 55% at 68% 42%, rgba(255,255,255,.55), rgba(255,255,255,0) 70%), linear-gradient(180deg, #eceeec 0%, #d9dbd8 48%, #c3c6c3 100%); }
.abs { position: absolute; }
svg { overflow: visible; }
sup { font-size: .55em; vertical-align: top; position: relative; top: -.1em; font-weight: 500; }
.en { font-family: "Baskerville", "Times New Roman", serif; font-style: italic; }
.head { font-family: "Neo"; }
.notes .n { display: grid; grid-template-columns: 7mm 1fr; column-gap: 1mm; }
.notes .n + .n { margin-top: 2.4mm; }
.notes .n i { font-style: normal; font-weight: 700; }
.notes .n b { font-weight: 700; margin-right: 1.6mm; }
.notes .fig { margin: 1.6mm 0 .6mm; }
.credit { line-height: 1.5; }
${extra}`;

const layout = {};
const page = (name, css, body, img) => {
  layout[name] = img;
  writeFileSync(resolve(OUT, `${name}.html`), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>발견된 인류 ${name}</title><style>${base(css)}</style></head><body>${body}</body></html>`);
  console.log(`out/${name}.html`);
};

const notesHtml = (fs) =>
  TEXT.notes.map(([h, p, k], i) => `<div class="n"><i>${i + 1}</i><div><b>${h}</b>${p}${k ? `<div class="fig">${figure(k, fs)}</div>` : ""}</div></div>`).join("");

// ── E. 단면: text column left, the structure cut hard along the time axis, read top to bottom ─────────────────────────
{
  const cut = 318;
  const imgH = 1189 * 1.12;
  const imgY = -62;
  const imgX = cut - 215;
  const y0 = imgY + (imgH * (88 - 82.2)) / 83.4;
  const mmPerSec = (imgH / 83.4) * (1.2 / 20);
  const L = 26;
  const CW = cut - L - 22;
  page(
    "E",
    `
.t { left: ${L - 3}mm; top: 22mm; font-weight: 700; font-size: 86mm; line-height: .98; letter-spacing: -.06em; }
.en { left: ${L}mm; top: 206mm; font-size: 13mm; line-height: 1; }
.head { left: ${L}mm; top: 232mm; width: ${CW}mm; font-size: 7.4mm; line-height: 1.4; }
.body { left: ${L}mm; top: 284mm; width: ${CW}mm; font-size: 8.3mm; line-height: 1.55; letter-spacing: -.014em; }
.body p + p { margin-top: 4.6mm; }
.notes { left: ${L}mm; bottom: 52mm; width: ${CW}mm; font-size: 5.4mm; line-height: 1.5; letter-spacing: -.006em; border-top: .3mm solid ${INK}; padding-top: 3.4mm; }
.notes .n + .n { margin-top: 3mm; }
.credit { left: ${L}mm; bottom: 20mm; font-size: 4.9mm; }
`,
    `<div class="abs" style="left:${cut}mm;top:0;width:${W - cut}mm;height:${H}mm;overflow:hidden"><img src="../renders/${IMG}" style="position:absolute;left:${imgX - cut}mm;top:${imgY}mm;height:${imgH}mm;width:${imgH * COLUMN_RATIO}mm"></div>
<svg class="abs" style="left:0;top:0;font-family:Pre" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">${timeAxis({ x: cut, y0, mmPerSec, yEnd: H })}</svg>
<div class="abs t" data-text>${TEXT.title.join("<br>")}</div>
<div class="abs en" data-text>${TEXT.titleEn}</div>
<div class="abs head" data-text>${TEXT.head.join("<br>")}</div>
<div class="abs body" data-text>${TEXT.body.map((p) => `<p>${p}</p>`).join("")}</div>
<div class="abs notes" data-text>${notesHtml(8)}</div>
<div class="abs credit" data-text>${TEXT.credit.join("<br>")}</div>`,
    { imgX, imgY, imgH, img: IMG, clipX: cut },
  );
}

// ── F. 세로 제목: the title written downward along the left edge, like the time axis itself ───────────────────────────
{
  const cut = 372;
  const imgH = 1189 * 1.12;
  const imgY = -62;
  const imgX = cut - 215;
  const y0 = imgY + (imgH * (88 - 82.2)) / 83.4;
  const mmPerSec = (imgH / 83.4) * (1.2 / 20);
  const L = 24;
  const TX = 176; // the text column after the vertical title
  const CW = cut - TX - 22;
  page(
    "F",
    `
.t { left: ${L - 4}mm; top: 18mm; writing-mode: vertical-rl; text-orientation: upright; font-weight: 700; font-size: 136mm; line-height: 1; letter-spacing: -.1em; }
.en { left: ${TX}mm; top: 24mm; font-size: 13mm; line-height: 1; }
.head { left: ${TX}mm; top: 50mm; width: ${CW}mm; font-size: 6.8mm; line-height: 1.4; }
.body { left: ${TX}mm; top: 98mm; width: ${CW}mm; font-size: 6.4mm; line-height: 1.56; letter-spacing: -.012em; }
.body p + p { margin-top: 3.6mm; }
.notes { left: ${TX}mm; top: 636mm; width: ${CW}mm; font-size: 4.6mm; line-height: 1.5; letter-spacing: -.006em; border-top: .3mm solid ${INK}; padding-top: 3mm; }
.credit { left: ${TX}mm; bottom: 20mm; font-size: 4.6mm; }
`,
    `<div class="abs" style="left:${cut}mm;top:0;width:${W - cut}mm;height:${H}mm;overflow:hidden"><img src="../renders/${IMG}" style="position:absolute;left:${imgX - cut}mm;top:${imgY}mm;height:${imgH}mm;width:${imgH * COLUMN_RATIO}mm"></div>
<svg class="abs" style="left:0;top:0;font-family:Pre" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">${timeAxis({ x: cut, y0, mmPerSec, yEnd: H })}</svg>
<div class="abs t" data-text>발견된 인류</div>
<div class="abs en" data-text>${TEXT.titleEn}</div>
<div class="abs head" data-text>${TEXT.head.join("<br>")}</div>
<div class="abs body" data-text>${TEXT.body.map((p) => `<p>${p}</p>`).join("")}</div>
<div class="abs notes" data-text>${notesHtml(6.5)}</div>
<div class="abs credit" data-text>${TEXT.credit.join("<br>")}</div>`,
    { imgX, imgY, imgH, img: IMG, clipX: cut },
  );
}

// ── I. 발굴: sky and words above a surface line; below it the dark ground with the structure hanging from the present ─
{
  const traces = data("traces.json");
  const tracePaths = (scale, cx, cy, az = 36) => {
    const a = (az * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    return traces.map((t) => `<path d="M${t.pts.filter((_, i) => i % 2 === 0).map(([x, z]) => `${(cx + (x * ca - z * sa) * scale).toFixed(2)} ${(cy + (x * sa + z * ca) * scale).toFixed(2)}`).join("L")}"/>`).join("");
  };
  const EN = {
    head: ["Archaeologists of the future are excavating an extinct humanity.", "What will the present you leave behind?"],
    body: [
      "The Anthropocene names the idea that human activity has changed the Earth enough to be recorded in its strata. It is not a formal geological epoch, yet plastics, concrete and the fallout of nuclear tests are already found in sediments. The word asks us to see the present as a stratum to be discovered in a distant future.",
      "The philosopher Timothy Morton called things spread so widely across time and space that they cannot be grasped at once — climate change, for one — hyperobjects. The Anthropocene is one. Against its scale what a single person can do is very small, and no one can know all the effects of their own actions. Still, every life leaves traces, and together they become the landscape of the Anthropocene as it will be seen from the future. Having been born, one can only go on living.",
      "What, then, is the fossil of the Anthropocene? Palaeontology calls fossils of activity rather than of the body — footprints, burrows — trace fossils. This work reads humanity's trace fossils in the dwellings, waterways and paths of the city: the structures people made while living are the record that they lived.",
      "In Homo inventus the visitor lives a short life walking a virtual world. The personal screen shows only one's surroundings; the wall shows everything, every visitor's traces piled in the order of time. The gap between the two screens is the gap in scale between one person and the Anthropocene, and the wall's viewpoint is that of whoever excavates this stratum in the future.",
    ],
  };
  const sky = "#e7e8e6";
  const ink = "#121212";
  const dim = "#6f7072";
  const white = "#e6e6e2";
  const wdim = "#9b9c98";
  const SURF = 488; // the ground line
  const STRUCT_H = 560, STRUCT_TOP = 6, STRUCT_CX = 352;

  const y0 = SURF + STRUCT_TOP;
  const mmPerSec = (STRUCT_H / 83.4) * (1.2 / 20);
  const L = 24;
  const R = W - 24;
  const RC = 662; // the right column in the ground: callouts and figures
  const RW = R - RC;
  const meta = [["DATE", "2026.11.11 –"], ["VENUE", "KAIST Industrial Design"], ["AUTHOR", "Hayeon Park 20220875"], ["SUPERVISOR", "Yiyun Kang"], ["COURSE", "ID40009 Graduation Design Studio"], ["MEDIUM", "실시간 웹 · 3D · 공간 음향 · 2채널 디스플레이"]];
  const G = (dots, s) => glyph(dots, s).replace(`fill="${INK}"`, `fill="${white}"`);
  // ruler down the left of the ground (ref: the evolution plate), depth marks on the right (ref: the bath house section)
  const ground = () => {
    const out = [`<line x1="0" y1="${SURF}" x2="${W}" y2="${SURF}" stroke="${ink}" stroke-width=".5"/>`];
    for (let s = 0; y0 + s * mmPerSec <= H - 8; s += 10) {
      const y = y0 + s * mmPerSec;
      const minute = s % 60 === 0;
      out.push(`<line x1="${L}" y1="${y}" x2="${L + (minute ? 7 : 3)}" y2="${y}" stroke="${wdim}" stroke-width=".25"/>`);
      if (minute) out.push(`<text x="${L + 9}" y="${y + 1.5}" font-family="Mono,Neo" font-size="4" fill="${wdim}">${s === 0 ? "T+0" : `−${s / 60}′`}</text>`);
    }
    return out.join("");
  };
  // callouts in the ground, the plate's language: a slash name, a hairline to the thing
  const calls = [
    { y: 574, to: [560, 548], ko: "/콘크리트 concrete", en: "여럿이 오래 머문 자리. 혼자서는 서지 않는다. / Where several stayed. It never rises for one." },
    { y: 622, to: [606, 612], ko: "/배관 pipe", en: "덮인 땅의 빗물이 흐르는 관, 길을 따라 깔린다. / Rain off sealed ground, laid along the paths." },
    { y: 905, to: [590, 860], ko: "/뼈 bone", en: "삭아 엉긴 건물들. 더는 변하지 않는다. / Buildings fused by decay. They change no more." },
    { y: 960, to: [545, 1005], ko: "/화석 fossil", en: "가장 오래된 층. 발견되는 것. / The oldest layer. What gets found." },
  ];
  const callouts = () => calls.map((c) => `<line x1="${RC - 3}" y1="${c.y + 2.6}" x2="${c.to[0]}" y2="${c.to[1]}" stroke="${white}" stroke-width=".22"/><circle cx="${c.to[0]}" cy="${c.to[1]}" r="1" fill="${white}"/>`).join("");
  page(
    "I",
    `
@font-face { font-family: "Mono"; font-weight: 400; src: url("../fonts/IBMPlexMono-Regular.ttf"); }
@font-face { font-family: "Mono"; font-weight: 500; src: url("../fonts/IBMPlexMono-Medium.ttf"); }
body { background: linear-gradient(180deg, #eeeeec 0%, ${sky} 60%, #d4d5d3 100%); color: ${ink}; }
.mono, .meta, .head .e, .cap, .fig b, .credit, .call b, .call p { font-family: "Mono", "Neo", monospace; }
.ug { left: 0; top: ${SURF}mm; width: ${W}mm; height: ${H - SURF}mm; }
.t { left: ${L - 3}mm; top: 16mm; font-weight: 700; font-size: 92mm; line-height: .96; letter-spacing: -.035em; }
.en { left: ${L}mm; top: 212mm; font-family: "Pre"; font-style: normal; font-weight: 700; font-size: 26mm; line-height: 1; letter-spacing: -.02em; }
.head { left: ${L}mm; top: 250mm; width: 380mm; font-size: 7mm; line-height: 1.4; }
.head .e { font-size: 4.6mm; line-height: 1.45; color: ${dim}; margin-top: 2mm; }
.meta { left: 560mm; top: 18mm; display: grid; grid-template-columns: 34mm 1fr; column-gap: 4mm; row-gap: 1.2mm; font-size: 4.4mm; line-height: 1.3; }
.meta i { font-style: normal; color: ${dim}; }
.body { left: ${L}mm; top: 300mm; width: 400mm; font-size: 6.9mm; line-height: 1.52; }
.body p + p { margin-top: 3.4mm; }
.bodyen { left: 446mm; top: 300mm; width: ${R - 446}mm; font-size: 5.1mm; line-height: 1.5; color: #3a3b3c; }
.bodyen p + p { margin-top: 2.6mm; }
.surf { left: ${L}mm; top: ${SURF - 7}mm; font-family: "Mono", "Neo"; font-size: 4.2mm; color: ${dim}; }
.surf2 { right: 24mm; top: ${SURF - 7}mm; font-family: "Mono", "Neo"; font-size: 4.2mm; color: ${dim}; text-align: right; }
.call { left: ${RC}mm; width: ${RW}mm; color: ${white}; font-size: 4.2mm; line-height: 1.45; }
.call b { display: block; font-weight: 500; font-size: 5.2mm; color: ${white}; margin-bottom: .8mm; }
.call p { color: ${wdim}; font-size: 3.9mm; }
.figs { left: ${RC}mm; top: 676mm; width: ${RW}mm; color: ${white}; }
.fig { display: grid; grid-template-columns: 44mm 1fr; column-gap: 5mm; align-items: start; margin-bottom: 7mm; }
.fig b { display: block; font-size: 4.2mm; font-weight: 500; color: ${white}; }
.fig em { font-style: normal; font-weight: 700; display: block; margin: .4mm 0 1mm; font-size: 4.8mm; }
.fig p { font-size: 3.9mm; line-height: 1.45; color: ${wdim}; }
.staff { position: relative; } .staff > svg { position: absolute; left: 0; top: 0; }
.foot { left: ${RC}mm; top: ${SURF + 14}mm; width: ${RW}mm; }
.credit { left: ${L}mm; bottom: 12mm; width: ${R - L}mm; display: flex; justify-content: space-between; font-size: 4.2mm; color: ${wdim}; }
`,
    `<img class="abs ug" src="../renders/underground.jpg">
<svg class="abs" style="left:0;top:0" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">${ground()}${callouts()}</svg>
<div class="abs t" data-text>${TEXT.title.join("<br>")}</div>
<div class="abs en" data-text>${TEXT.titleEn}</div>
<div class="abs head" data-text>${TEXT.head.join("<br>")}<div class="e">${EN.head.join("<br>")}</div></div>
<div class="abs meta" data-text>${meta.map(([k, v]) => `<i>${k}</i><span>${v}</span>`).join("")}</div>
<div class="abs body" data-text>${TEXT.body.map((p) => `<p>${p}</p>`).join("")}</div>
<div class="abs bodyen" data-text>${EN.body.map((p) => `<p>${p}</p>`).join("")}</div>
<div class="abs surf" data-text>지표면 SURFACE · T+0 현재 NOW · 아래로 = 과거 DOWN = PAST · 1 mm = ${(1 / mmPerSec).toFixed(1)} s</div>
<div class="abs surf2" data-text>Fig. 5 — 단면 SECTION · 봇 19 · 23 MIN</div>
${calls.map((c) => `<div class="abs call" data-text style="top:${c.y}mm"><b>${c.ko}</b><p>${c.en}</p></div>`).join("")}
<div class="abs figs" data-text>
<div class="fig"><div class="staff" style="width:44mm;height:44mm"><svg viewBox="0 0 8 8" width="44mm" height="44mm" fill="none" stroke="${wdim}" stroke-width=".03">${Array.from({ length: 9 }, (_, i) => `<path d="M${i} 0V8M0 ${i}H8"/>`).join("")}</svg>${G(fig_a(), 44)}</div><div><b>Fig. 1</b><em>이름 Name</em><p>이름 대신 받는 멜로디, 8칸 악보에 적은 기호. 이것이 이름이다. / A melody instead of a name, written on an eight-step score.</p></div></div>
<div class="fig"><div class="staff" style="width:44mm;height:44mm"><svg viewBox="0 0 8 8" width="44mm" height="44mm" fill="none" stroke="${wdim}" stroke-width=".03">${Array.from({ length: 9 }, (_, i) => `<path d="M${i} 0V8M0 ${i}H8"/>`).join("")}</svg>${G(fig_w(), 44)}</div><div><b>Fig. 2</b><em>새 어휘 New word</em><p>곁에 오래 머문 뒤, 내 멜로디에 상대의 것이 섞인 것. / After long contact, one's melody with another's in it.</p></div></div>
<div class="fig"><div class="staff" style="width:44mm;height:44mm"><svg viewBox="0 0 8 8" width="44mm" height="44mm" fill="none" stroke="${wdim}" stroke-width=".03">${Array.from({ length: 9 }, (_, i) => `<path d="M${i} 0V8M0 ${i}H8"/>`).join("")}</svg>${chord(glyphs.slice(0, 19), 44, white, 0.34, 0.22)}</div><div><b>Fig. 3</b><em>저음 Low band</em><p>스피커에서는 모든 멜로디가 두 옥타브 아래의 한 덩어리로. / On the speakers every melody sinks two octaves into one mass.</p></div></div>
</div>
<div class="abs foot" data-text><div class="fig"><svg viewBox="-50 -50 100 100" width="44mm" height="44mm" fill="none" stroke="${white}" stroke-width=".12" stroke-linejoin="round">${tracePaths(1, 0, 0)}</svg><div style="color:${white}"><b class="mono" style="display:block;font-size:4.2mm;font-weight:500">Fig. 4</b><em style="font-style:normal;font-weight:700;display:block;margin:.4mm 0 1mm;font-size:4.8mm">걸음의 자취 Footprints</em><p class="mono" style="font-size:3.9mm;line-height:1.45;color:${wdim}">지표면에 남은 열아홉 존재의 23분. 선이 뭉친 자리마다 아래에 건물이 섰다. / Nineteen beings' 23 minutes on the surface; where lines bunch, buildings rose beneath.</p></div></div></div>
<div class="abs credit" data-text><span>Homo inventus — 발견된 인류</span><span>Hayeon Park · Supervised by Yiyun Kang</span><span>ID40009 Graduation Design Studio · KAIST · 2026</span></div>`,
    { imgX: 0, imgY: SURF, imgH: H - SURF, img: "underground_alpha.png" },
  );
}

// ── J. 발굴 II: the title alone in a thin sky; a long dark ground, the structure sinking from the surface; everything else
//    down in the ground, white, dense: the plate's apparatus (ruler, depth marks, callouts, legend, specimen cards) ─────
{
  const traces = data("traces.json");
  const tracePaths = (scale, cx, cy, az = 36) => {
    const a = (az * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    return traces.map((t) => `<path d="M${t.pts.filter((_, i) => i % 2 === 0).map(([x, z]) => `${(cx + (x * ca - z * sa) * scale).toFixed(2)} ${(cy + (x * sa + z * ca) * scale).toFixed(2)}`).join("L")}"/>`).join("");
  };
  const EN = {
    head: ["Archaeologists of the future are excavating an extinct humanity.", "What will the present you leave behind?"],
    body: [
      "The Anthropocene names the idea that human activity has changed the Earth enough to be recorded in its strata. It is not a formal geological epoch, yet plastics, concrete and the fallout of nuclear tests are already found in sediments. The word asks us to see the present as a stratum to be discovered in a distant future.",
      "The philosopher Timothy Morton called things spread so widely across time and space that they cannot be grasped at once — climate change, for one — hyperobjects. The Anthropocene is one. Against its scale what a single person can do is very small, and no one can know all the effects of their own actions. Still, every life leaves traces, and together they become the landscape of the Anthropocene as it will be seen from the future. Having been born, one can only go on living.",
      "What, then, is the fossil of the Anthropocene? Palaeontology calls fossils of activity rather than of the body — footprints, burrows — trace fossils. This work reads humanity's trace fossils in the dwellings, waterways and paths of the city: the structures people made while living are the record that they lived.",
      "In Homo inventus the visitor lives a short life walking a virtual world. The personal screen shows only one's surroundings; the wall shows everything, every visitor's traces piled in the order of time. The gap between the two screens is the gap in scale between one person and the Anthropocene, and the wall's viewpoint is that of whoever excavates this stratum in the future.",
    ],
  };
  const ink = "#121212", dim = "#6f7072";
  const white = "#ebebe7", wdim = "#a3a49f", wfaint = "#5f605c";
  const SURF = 236;
  const UG = H - SURF;
  const STRUCT_H = 1290, STRUCT_TOP = 2, STRUCT_CX = 300;
  const y0 = SURF + STRUCT_TOP;
  const mmPerSec = (STRUCT_H / 140) * (1.2 / 20);
  const L = 22, R = W - 22;
  const RC = 560; // the text column in the ground
  const RW = R - RC;
  const meta = [["DATE", "2026.11.11 –"], ["VENUE", "KAIST ID"], ["AUTHOR", "Hayeon Park 20220875"], ["SUPERVISOR", "Yiyun Kang"], ["COURSE", "ID40009 Graduation Design Studio"], ["MEDIUM", "실시간 웹 · 3D · 공간 음향 · 2채널"], ["SPECIMEN", "T−0 … T−25′ · 봇 10 · 35 MIN"], ["SCALE", `1 mm = ${(1 / mmPerSec).toFixed(1)} s`]];
  const G = (dots, s) => glyph(dots, s).replace(`fill="${INK}"`, `fill="${white}"`);
  const staff = (inner, s) => `<div class="staff" style="width:${s}mm;height:${s}mm"><svg viewBox="0 0 8 8" width="${s}mm" height="${s}mm" fill="none" stroke="${wfaint}" stroke-width=".035">${Array.from({ length: 9 }, (_, i) => `<path d="M${i} 0V8M0 ${i}H8"/>`).join("")}</svg>${inner}</div>`;
  const svgGround = () => {
    const out = [`<line x1="0" y1="${SURF}" x2="${W}" y2="${SURF}" stroke="${ink}" stroke-width=".6"/>`];
    // grass stubble on the surface
    for (let x = 0; x < W; x += 1.7) { const h = 1 + Math.random() * 2.6; out.push(`<line x1="${x.toFixed(1)}" y1="${SURF}" x2="${(x + (Math.random() - 0.5) * 1.2).toFixed(1)}" y2="${(SURF - h).toFixed(1)}" stroke="${ink}" stroke-width=".2"/>`); }
    // minute ruler, left
    for (let s = 0; y0 + s * mmPerSec <= H - 10; s += 10) {
      const y = y0 + s * mmPerSec, minute = s % 60 === 0;
      out.push(`<line x1="${L}" y1="${y}" x2="${L + (minute ? 7 : 3)}" y2="${y}" stroke="${wdim}" stroke-width=".25"/>`);
      if (minute) out.push(`<text x="${L + 9}" y="${y + 1.5}" font-family="Mono,Neo" font-size="4" fill="${wdim}">${s === 0 ? "T+0" : `−${s / 60}′`}</text>`);
    }
    out.push(`<line x1="${L}" y1="${y0}" x2="${L}" y2="${H - 10}" stroke="${wdim}" stroke-width=".25"/>`);
    // phase bands across the structure, dashed, with roman numerals
    for (const [n, sec] of [["I", 0], ["II", 330], ["III", 840]]) {
      const y = y0 + sec * mmPerSec;
      out.push(`<line x1="${L + 24}" y1="${y}" x2="${RC - 12}" y2="${y}" stroke="${wdim}" stroke-width=".22" stroke-dasharray="1.2 1.8"/><text x="${RC - 12}" y="${y - 2}" text-anchor="end" font-family="Mono,Neo" font-size="5.2" font-weight="500" fill="${white}">${n}</text>`);
    }
    // callout leaders
    calls.forEach((c, i) => out.push(`<circle cx="${c.to[0]}" cy="${c.to[1]}" r="3.2" fill="none" stroke="${white}" stroke-width=".3"/><text x="${c.to[0]}" y="${c.to[1] + 1.4}" text-anchor="middle" font-family="Mono" font-size="3.6" fill="${white}">${i + 1}</text>`));
    // a dimension line for the structure's width and the depth of the fossil band
    out.push(`<line x1="${STRUCT_CX - 120}" y1="${H - 22}" x2="${STRUCT_CX + 120}" y2="${H - 22}" stroke="${wdim}" stroke-width=".22"/><line x1="${STRUCT_CX - 120}" y1="${H - 25}" x2="${STRUCT_CX - 120}" y2="${H - 19}" stroke="${wdim}" stroke-width=".22"/><line x1="${STRUCT_CX + 120}" y1="${H - 25}" x2="${STRUCT_CX + 120}" y2="${H - 19}" stroke="${wdim}" stroke-width=".22"/><text x="${STRUCT_CX}" y="${H - 24}" text-anchor="middle" font-family="Mono,Neo" font-size="3.8" fill="${wdim}">54 WORLD UNITS · 세계 160 × 160 칸 중 일부</text>`);
    return out.join("");
  };
  const calls = [
    { y: 300, to: [420, 290], ko: "/콘크리트 concrete", en: "여럿이 오래 머문 자리에 선다. 혼자서는 서지 않는다. / Rises where several stayed. Never for one." },
    { y: 352, to: [430, 360], ko: "/배관 pipe", en: "덮인 땅의 빗물이 흐르는 관. 길을 따라 깔린다. / Rain off sealed ground; laid along the paths." },
    { y: 404, to: [415, 440], ko: "/부재 member", en: "기둥 · 보 · 슬래브. 쓰임이 끊기면 삭는다. / Columns, beams, slabs; they decay once unused." },
    { y: 600, to: [405, 640], ko: "/뼈 bone", en: "삭아 엉긴 건물들. 더는 변하지 않는다. / Buildings fused by decay. They change no more." },
    { y: 1010, to: [395, 1060], ko: "/화석 fossil", en: "가장 오래된 층. 발견되는 것. / The oldest layer. What gets found." },
  ];
  const specimen = (g, i) => `<div class="sp"><div class="spg">${staff(G(g.dots, 22), 22)}</div><div class="spt"><b>개체 ${g.no}</b><i>SPECIMEN ${String(i + 1).padStart(2, "0")}</i></div></div>`;
  page(
    "J",
    `
@font-face { font-family: "Mono"; font-weight: 400; src: url("../fonts/IBMPlexMono-Regular.ttf"); }
@font-face { font-family: "Mono"; font-weight: 500; src: url("../fonts/IBMPlexMono-Medium.ttf"); }
body { background: linear-gradient(180deg, #f1f1ef 0%, #e2e3e1 ${SURF - 40}mm, #cfd0cd ${SURF}mm); color: ${ink}; }
.mono, .meta, .head .e, .credit, .call b, .call p, .fig b, .fig p, .sp i, .leg, .big { font-family: "Mono", "Neo", monospace; }
.ug { left: 0; top: ${SURF}mm; width: ${W}mm; height: ${UG}mm; }
.t { left: ${L - 3}mm; top: 10mm; font-weight: 700; font-size: 100mm; line-height: .92; letter-spacing: -.04em; }
.en { left: ${L}mm; top: ${SURF - 48}mm; font-weight: 700; font-size: 30mm; line-height: 1; letter-spacing: -.025em; font-family: "Pre"; font-style: normal; }
.head { left: 468mm; top: 22mm; width: ${R - 468}mm; font-size: 7.2mm; line-height: 1.42; }
.head .e { font-size: 4.6mm; line-height: 1.45; color: ${dim}; margin-top: 2.4mm; }
.meta { left: 468mm; top: ${SURF - 72}mm; width: ${R - 468}mm; display: grid; grid-template-columns: 30mm 1fr 30mm 1fr; column-gap: 3mm; row-gap: 1mm; font-size: 3.9mm; line-height: 1.3; }
.meta i { font-style: normal; color: ${dim}; }
.surf { left: ${L}mm; top: ${SURF - 7.5}mm; font-family: "Mono", "Neo"; font-size: 4mm; color: ${dim}; }
.surf2 { right: 22mm; top: ${SURF - 7.5}mm; font-family: "Mono", "Neo"; font-size: 4mm; color: ${dim}; text-align: right; }
.col { left: ${RC}mm; top: ${SURF + 14}mm; width: ${RW}mm; color: ${white}; display: flex; flex-direction: column; gap: 7mm; }
.big { font-size: 4.2mm; line-height: 1.5; }
.big b { display: block; font-family: "Pre"; font-weight: 700; font-size: 9.4mm; line-height: 1.15; letter-spacing: -.02em; margin-bottom: 2.4mm; color: ${white}; }
.body { font-size: 5.6mm; line-height: 1.5; }
.body p + p { margin-top: 2.8mm; }
.bodyen { font-size: 4.1mm; line-height: 1.5; color: ${wdim}; }
.bodyen p + p { margin-top: 2mm; }
.calls { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8mm; row-gap: 4mm; }
.call { font-size: 4mm; line-height: 1.42; }
.call b { display: block; font-weight: 500; font-size: 5mm; margin-bottom: .6mm; }
.call p { color: ${wdim}; font-size: 3.7mm; }
.figs { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8mm; row-gap: 7mm; }
.fig { display: grid; grid-template-columns: 40mm 1fr; column-gap: 4mm; align-items: start; }
.fig b { display: block; font-size: 3.9mm; font-weight: 500; }
.fig em { font-style: normal; font-weight: 700; display: block; margin: .3mm 0 .8mm; font-size: 4.6mm; }
.fig p { font-size: 3.6mm; line-height: 1.42; color: ${wdim}; }
.staff { position: relative; } .staff > svg { position: absolute; left: 0; top: 0; }
.specs { display: grid; grid-template-columns: repeat(4, 1fr); column-gap: 5mm; row-gap: 5mm; color: ${white}; }
.sp { display: grid; grid-template-columns: 22mm 1fr; column-gap: 3mm; align-items: center; }
.sp b { display: block; font-size: 4mm; font-weight: 700; } .sp i { display: block; font-style: normal; font-size: 3.2mm; color: ${wdim}; margin-top: .6mm; }
.leg { color: ${wdim}; font-size: 3.6mm; line-height: 1.5; border-top: .25mm solid ${wfaint}; padding-top: 2.4mm; display: grid; grid-template-columns: 1fr 1fr; column-gap: 8mm; }
.leg b { color: ${white}; font-weight: 500; }
.card { color: ${white}; font-size: 3.8mm; line-height: 1.45; display: grid; grid-template-columns: 1fr 1fr 1fr; column-gap: 6mm; }
.card b { display: block; font-family: "Mono","Neo"; font-size: 3.4mm; color: ${wdim}; font-weight: 400; }
.card span { display: block; font-weight: 700; font-size: 4.6mm; margin-bottom: 2mm; }
.credit { left: ${L}mm; bottom: 9mm; width: ${R - L}mm; display: flex; justify-content: space-between; font-size: 3.9mm; color: ${wdim}; }
`,
    `<img class="abs ug" src="../renders/underground.jpg">
<svg class="abs" style="left:0;top:0" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">${svgGround()}</svg>
<div class="abs t" data-text>발견된<br>인류</div>
<div class="abs en" data-text>${TEXT.titleEn}</div>
<div class="abs head" data-text>${TEXT.head.join("<br>")}<div class="e">${EN.head.join("<br>")}</div></div>
<div class="abs meta" data-text>${meta.map(([k, v]) => `<i>${k}</i><span>${v}</span>`).join("")}</div>
<div class="abs surf" data-text>지표면 SURFACE · T+0 현재 NOW · 아래로 = 과거 DOWN = PAST</div>
<div class="abs surf2" data-text>Fig. 5 — 단면 SECTION · 지표면에서 25분 아래까지</div>
<div class="abs col" data-text><div class="big"><b>살아간 흔적이 곧 화석이다.<br>What was lived is what fossilises.</b>인류의 생흔화석은 몸이 아니라 도시의 주거, 수로, 길의 흔적이다. 아래 단면은 열 존재가 35분 동안 산 세계의 땅속이다. 위가 현재, 아래로 갈수록 과거. / Humanity's trace fossils are not bodies but the city's dwellings, waterways and paths. The section below is the ground of a world ten beings lived in for 35 minutes: the present on top, the past below.</div>
<div class="body">${TEXT.body.map((p) => `<p>${p}</p>`).join("")}</div>
<div class="bodyen">${EN.body.map((p) => `<p>${p}</p>`).join("")}</div>
<div class="calls">${calls.map((c, i) => `<div class="call"><b>${i + 1} ${c.ko}</b><p>${c.en}</p></div>`).join("")}</div>
<div class="figs">
<div class="fig">${staff(G(fig_a(), 40), 40)}<div><b>Fig. 1</b><em>이름 Name</em><p>이름 대신 받는 멜로디, 8칸 악보의 기호. / A melody instead of a name, on an eight-step score.</p></div></div>
<div class="fig">${staff(G(fig_w(), 40), 40)}<div><b>Fig. 2</b><em>새 어휘 New word</em><p>곁에 오래 머문 뒤 상대의 멜로디가 섞인 것. / One's melody with another's in it after long contact.</p></div></div>
<div class="fig">${staff(chord(glyphs.slice(0, 19), 40, white, 0.34, 0.22), 40)}<div><b>Fig. 3</b><em>저음 Low band</em><p>스피커에서는 모든 멜로디가 두 옥타브 아래의 한 덩어리로. / On the speakers every melody sinks two octaves into one mass.</p></div></div>
<div class="fig"><svg viewBox="-50 -50 100 100" width="40mm" height="40mm" fill="none" stroke="${white}" stroke-width=".14" stroke-linejoin="round">${tracePaths(1, 0, 0)}</svg><div><b>Fig. 4</b><em>걸음의 자취 Footprints</em><p>지표면에 남은 걸음. 선이 뭉친 자리 아래에 건물이 섰다. / Walks on the surface; buildings rose beneath where lines bunch.</p></div></div>
</div>
<div class="specs">${glyphs.slice(0, 8).map(specimen).join("")}</div>
<div class="card"><div><b>존속 LIFE</b><span>03:00</span><b>군집 GROUP</b><span>4개체 · 01:12</span></div><div><b>어휘 변화 WORDS</b><span>접촉 후 1종</span><b>구조물 BUILT</b><span>콘크리트 6칸</span></div><div><b>이동 MOVED</b><span>약 212 m</span><b>사인 CAUSE</b><span>과로 Overwork</span></div></div>
<div class="leg"><div><b>I 현재 Present</b> 건물이 서고 길이 다져진다.<br><b>II 작용 Action</b> 쓰임이 끊긴 부재가 삭는다.<br><b>III 화석 Fossil</b> 서로 엉겨 뼈가 된다.</div><div><b>기록표 RECORD CARD</b> 삶이 끝나면 한 장 남는다 (예).<br><b>SPECIMEN</b> 이 세계를 산 존재들의 이름.<br><b>봇 BOT</b> 상주 존재 · 관객과 같은 규칙.</div></div>
</div>
<div class="abs credit" data-text><span>Homo inventus — 발견된 인류</span><span>Hayeon Park · Supervised by Yiyun Kang</span><span>ID40009 Graduation Design Studio · KAIST · 2026</span></div>`,
    { imgX: 0, imgY: SURF, imgH: UG, img: "underground_alpha.png" },
  );
}

// ── K. 미니멀: the title in a thin sky; the long ground with the structure sinking in; four numbers; one short text ──
{
  const ink = "#121212", dim = "#7a7b78";
  const white = "#e9e9e5", wdim = "#8e8f8a";
  const SURF = 212;
  const UG = H - SURF;
  const STRUCT_H = 760, STRUCT_TOP = 2, STRUCT_CX = 300;
  const y0 = SURF + STRUCT_TOP;
  const mmPerSec = (STRUCT_H / 83.4) * (1.2 / 20);
  const L = 24, R = W - 24;
  const marks = [
    { at: [372, 262], ko: "콘크리트", en: "concrete", t: "여럿이 오래 머문 자리에 선다. / Rises where several stayed." },
    { at: [420, 340], ko: "배관", en: "pipe", t: "덮인 땅의 빗물이 흐르는 관. / Rain off sealed ground, piped." },
    { at: [380, 600], ko: "뼈", en: "bone", t: "삭아 엉긴 건물들. / Buildings fused by decay." },
    { at: [350, 905], ko: "화석", en: "fossil", t: "가장 오래된 층. 발견되는 것. / The oldest layer. What gets found." },
  ];
  const svg = () => {
    const out = [`<line x1="0" y1="${SURF}" x2="${W}" y2="${SURF}" stroke="${ink}" stroke-width=".5"/>`];
    for (let s = 0; y0 + s * mmPerSec <= H - 14; s += 60) {
      const y = y0 + s * mmPerSec;
      out.push(`<line x1="${L}" y1="${y}" x2="${L + 5}" y2="${y}" stroke="${wdim}" stroke-width=".25"/><text x="${L + 7.5}" y="${y + 1.4}" font-family="Mono,Neo" font-size="3.8" fill="${wdim}">${s === 0 ? "T+0" : `−${s / 60}′`}</text>`);
    }
    out.push(`<line x1="${L}" y1="${y0}" x2="${L}" y2="${H - 14}" stroke="${wdim}" stroke-width=".25"/>`);
    marks.forEach((m, i) => out.push(`<circle cx="${m.at[0]}" cy="${m.at[1]}" r="3.4" fill="#0c0c0c" stroke="${white}" stroke-width=".3"/><text x="${m.at[0]}" y="${m.at[1] + 1.5}" text-anchor="middle" font-family="Mono" font-size="4" fill="${white}">${i + 1}</text>`));
    return out.join("");
  };
  page(
    "K",
    `
@font-face { font-family: "Mono"; font-weight: 400; src: url("../fonts/IBMPlexMono-Regular.ttf"); }
@font-face { font-family: "Mono"; font-weight: 500; src: url("../fonts/IBMPlexMono-Medium.ttf"); }
body { background: linear-gradient(180deg, #f2f2f0 0%, #e4e5e3 ${SURF}mm); color: ${ink}; }
.mono { font-family: "Mono", "Neo", monospace; }
.ug { left: 0; top: ${SURF}mm; width: ${W}mm; height: ${UG}mm; }
.t { left: ${L - 3}mm; top: 14mm; font-weight: 700; font-size: 124mm; line-height: .92; letter-spacing: -.045em; white-space: nowrap; }
.en { left: ${L}mm; top: 146mm; font-weight: 700; font-size: 24mm; line-height: 1; letter-spacing: -.02em; }
.head { left: 500mm; top: 150mm; width: ${R - 500}mm; font-family: "Neo"; font-size: 6mm; line-height: 1.42; color: ${ink}; }
.head .e { font-family: "Mono", "Neo"; font-size: 3.9mm; color: ${dim}; margin-top: 1.4mm; line-height: 1.45; }
.surf { left: ${L}mm; top: ${SURF - 6.5}mm; font-family: "Mono", "Neo"; font-size: 3.8mm; color: ${dim}; }
.surf2 { right: 24mm; top: ${SURF - 6.5}mm; font-family: "Mono", "Neo"; font-size: 3.8mm; color: ${dim}; }
.marks { left: 600mm; top: ${SURF + 30}mm; width: ${R - 600}mm; color: ${white}; }
.mk { display: grid; grid-template-columns: 9mm 1fr; column-gap: 2mm; margin-bottom: 6mm; font-size: 4.2mm; line-height: 1.45; }
.mk i { font-style: normal; font-family: "Mono"; font-size: 4mm; color: ${wdim}; padding-top: .4mm; }
.mk b { display: block; font-weight: 700; font-size: 5.4mm; } .mk b span { font-family: "Mono"; font-weight: 400; font-size: 3.8mm; color: ${wdim}; margin-left: 1.4mm; }
.mk p { color: ${wdim}; font-family: "Mono", "Neo"; font-size: 3.6mm; }
.text { left: 600mm; top: 760mm; width: ${R - 600}mm; color: ${white}; font-size: 5.1mm; line-height: 1.55; }
.text p + p { margin-top: 3mm; }
.text .e { color: ${wdim}; font-size: 3.9mm; line-height: 1.5; margin-top: 5mm; }
.meta { left: 600mm; bottom: 44mm; width: ${R - 600}mm; display: grid; grid-template-columns: 26mm 1fr; column-gap: 3mm; row-gap: .8mm; font-family: "Mono", "Neo"; font-size: 3.6mm; line-height: 1.3; color: ${white}; }
.meta i { font-style: normal; color: ${wdim}; }
.credit { left: ${L}mm; bottom: 10mm; width: ${R - L}mm; display: flex; justify-content: space-between; font-family: "Mono", "Neo"; font-size: 3.6mm; color: ${wdim}; }
`,
    `<img class="abs ug" src="../renders/underground.jpg" style="clip-path: inset(0 ${W - 590}mm 0 0)"><div class="abs" style="left:590mm;top:${SURF}mm;width:${W - 590}mm;height:${UG}mm;background:linear-gradient(90deg, rgba(12,12,12,0), #0b0b0b 18mm)"></div>
<svg class="abs" style="left:0;top:0" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">${svg()}</svg>
<div class="abs t" data-text>발견된 인류</div>
<div class="abs en" data-text>${TEXT.titleEn}</div>
<div class="abs head" data-text>${TEXT.head.join("<br>")}<div class="e">Archaeologists of the future are excavating an extinct humanity.<br>What will the present you leave behind?</div></div>
<div class="abs surf" data-text>지표면 SURFACE · 아래로 = 과거 DOWN = PAST · 1 mm = ${(1 / mmPerSec).toFixed(1)} s</div>
<div class="abs surf2" data-text>단면 SECTION · 19 BEINGS · 23 MIN</div>
<div class="abs marks" data-text>${marks.map((m, i) => `<div class="mk"><i>${i + 1}</i><div><b>${m.ko}<span>${m.en}</span></b><p>${m.t}</p></div></div>`).join("")}</div>
<div class="abs text" data-text><p>인류세의 화석은 무엇일까. 고생물학에서는 발자국이나 굴처럼 몸이 아니라 활동의 자취가 남은 화석을 생흔화석이라고 부른다. 이 작품은 인간의 생흔화석을 도시의 주거, 수로, 길의 흔적에서 찾는다.</p><p>관객은 짧은 삶을 살며 가상의 세계를 걷는다. 개인 화면에는 자기 주변만 보이지만, 벽에는 모든 삶의 흔적이 시간 순서대로 쌓인다. 위가 현재, 아래가 과거다. 태어난 이상 살아가는 수밖에 없다.</p><div class="e">What is the fossil of the Anthropocene? Palaeontology calls fossils of activity rather than of the body — footprints, burrows — trace fossils. This work reads humanity's trace fossils in the dwellings, waterways and paths of the city. A visitor lives a short life walking a virtual world; the wall piles every life's traces in the order of time, the present on top, the past below. Having been born, one can only go on living.</div></div>
<div class="abs meta" data-text><i>DATE</i><span>2026.11.11 –</span><i>VENUE</i><span>KAIST Industrial Design</span><i>AUTHOR</i><span>Hayeon Park 20220875</span><i>SUPERVISOR</i><span>Yiyun Kang</span><i>COURSE</i><span>ID40009 Graduation Design Studio</span><i>MEDIUM</i><span>실시간 웹 · 3D · 공간 음향 · 2채널</span></div>
<div class="abs credit" data-text><span>Homo inventus — 발견된 인류</span><span>KAIST · 2026</span></div>`,
    { imgX: 0, imgY: SURF, imgH: UG, img: "underground_alpha.png" },
  );
}

// ── L. 도판: the evolution plate's language — one structure in the dark ground, white annotations floating around it
//    on hairlines, the work's own signs (name, new word, low band, footprints) inside those annotations, a ruler ────
{
  const traces = data("traces.json");
  const tracePaths = (scale, cx, cy, az = 36) => {
    const a = (az * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    return traces.map((t) => `<path d="M${t.pts.filter((_, i) => i % 2 === 0).map(([x, z]) => `${(cx + (x * ca - z * sa) * scale).toFixed(2)} ${(cy + (x * sa + z * ca) * scale).toFixed(2)}`).join("L")}"/>`).join("");
  };
  const ink = "#121212", dim = "#7a7b78";
  const white = "#ebebe7", wdim = "#9d9e99", wfaint = "#55564f";
  const SURF = 200;
  const UG = H - SURF;
  const STRUCT_H = 720, STRUCT_TOP = 2, STRUCT_CX = 300;
  const y0 = SURF + STRUCT_TOP;
  const mmPerSec = (STRUCT_H / 83.4) * (1.2 / 20);
  const L = 24, R = W - 24;
  const AX = 612; // annotations' left edge
  const AW = R - AX;
  const G = (dots, s) => glyph(dots, s).replace(`fill="${INK}"`, `fill="${white}"`);
  const staff = (inner, s) => `<div class="staff" style="width:${s}mm;height:${s}mm"><svg viewBox="0 0 8 8" width="${s}mm" height="${s}mm" fill="none" stroke="${wfaint}" stroke-width=".04">${Array.from({ length: 9 }, (_, i) => `<path d="M${i} 0V8M0 ${i}H8"/>`).join("")}</svg>${inner}</div>`;
  // each note: where it sits (y), what it points at, its sign (optional), its words
  const notes = [
    { y: 236, to: [470, 262], tag: "/콘크리트", en: "concrete", ko: "여럿이 오래 머문 자리에 선다. 혼자서는 서지 않는다.", e: "Rises where several stayed. Never for one." },
    { y: 296, to: [505, 348], tag: "/배관", en: "pipe", ko: "덮인 땅의 빗물이 흐르는 관. 길을 따라 깔린다.", e: "Rain off sealed ground, laid along the paths." },
    { y: 372, to: [482, 430], tag: "/이름", en: "name", sign: "a", ko: "이름 대신 받는 멜로디. 8칸 악보에 적은 이 기호가 곧 이름이고, 이름을 받으면서 세계 안의 존재가 된다.", e: "A melody instead of a name, on an eight-step score. With it one becomes a being in the world." },
    { y: 486, to: [520, 556], tag: "/새 어휘", en: "new word", sign: "w", ko: "다른 존재 곁에 오래 머문 뒤, 내 멜로디에 상대의 것이 섞인 것.", e: "One's melody with another's in it, after long contact." },
    { y: 620, to: [438, 700], tag: "/뼈", en: "bone", ko: "삭아 엉긴 건물들. 더는 변하지 않는다.", e: "Buildings fused by decay. They change no more." },
    { y: 700, to: [400, 850], tag: "/저음", en: "low band", sign: "c", ko: "전시장 스피커에서는 모든 멜로디가 두 옥타브 아래의 한 덩어리로 들린다.", e: "On the room's speakers every melody sinks two octaves into one mass." },
    { y: 816, to: [378, 1000], tag: "/화석", en: "fossil", ko: "가장 오래된 층. 발견되는 것.", e: "The oldest layer. What gets found." },
  ];
  const sign = (k) => (k === "a" ? staff(G(fig_a(), 30), 30) : k === "w" ? staff(G(fig_w(), 30), 30) : k === "c" ? staff(chord(glyphs.slice(0, 19), 30, white, 0.34, 0.22), 30) : "");
  const svg = () => {
    const out = [`<line x1="0" y1="${SURF}" x2="${W}" y2="${SURF}" stroke="${ink}" stroke-width=".5"/>`];
    for (let s = 0; y0 + s * mmPerSec <= H - 14; s += 10) {
      const y = y0 + s * mmPerSec, minute = s % 60 === 0;
      out.push(`<line x1="${L}" y1="${y}" x2="${L + (minute ? 6 : 2.5)}" y2="${y}" stroke="${wdim}" stroke-width=".25"/>`);
      if (minute) out.push(`<text x="${L + 8}" y="${y + 1.4}" font-family="Mono,Neo" font-size="3.8" fill="${wdim}">${s === 0 ? "T+0" : `−${s / 60}′`}</text>`);
    }
    out.push(`<line x1="${L}" y1="${y0}" x2="${L}" y2="${H - 14}" stroke="${wdim}" stroke-width=".25"/>`);
    for (const n of notes) out.push(`<line x1="${AX - 2}" y1="${n.y + 2.2}" x2="${n.to[0]}" y2="${n.to[1]}" stroke="${white}" stroke-width=".2"/><circle cx="${n.to[0]}" cy="${n.to[1]}" r="1.1" fill="${white}"/>`);
    return out.join("");
  };
  page(
    "L",
    `
@font-face { font-family: "Mono"; font-weight: 400; src: url("../fonts/IBMPlexMono-Regular.ttf"); }
@font-face { font-family: "Mono"; font-weight: 500; src: url("../fonts/IBMPlexMono-Medium.ttf"); }
body { background: linear-gradient(180deg, #f2f2f0 0%, #e3e4e2 ${SURF}mm); color: ${ink}; }
.ug { left: 0; top: ${SURF}mm; width: ${W}mm; height: ${UG}mm; }
.t { left: ${L - 3}mm; top: 12mm; font-weight: 700; font-size: 118mm; line-height: .92; letter-spacing: -.045em; white-space: nowrap; }
.en { left: ${L}mm; top: 138mm; font-weight: 700; font-size: 22mm; line-height: 1; letter-spacing: -.02em; }
.head { left: 520mm; top: 140mm; width: ${R - 520}mm; font-family: "Neo"; font-size: 5.6mm; line-height: 1.42; }
.head .e { font-family: "Mono", "Neo"; font-size: 3.7mm; color: ${dim}; margin-top: 1.4mm; line-height: 1.45; }
.surf { left: ${L}mm; top: ${SURF - 6.5}mm; font-family: "Mono", "Neo"; font-size: 3.7mm; color: ${dim}; }
.surf2 { right: 24mm; top: ${SURF - 6.5}mm; font-family: "Mono", "Neo"; font-size: 3.7mm; color: ${dim}; }
.n { left: ${AX}mm; width: ${AW}mm; color: ${white}; display: grid; grid-template-columns: auto 1fr; column-gap: 4mm; align-items: start; }
.n .tag { font-family: "Mono", "Neo"; font-weight: 500; font-size: 5mm; line-height: 1.2; white-space: nowrap; }
.n .tag span { font-weight: 400; color: ${wdim}; font-size: 3.8mm; margin-left: 1.4mm; }
.n p { font-size: 3.9mm; line-height: 1.45; margin-top: 1mm; }
.n p.e { font-family: "Mono", "Neo"; font-size: 3.4mm; color: ${wdim}; }
.staff { position: relative; margin-top: 1mm; } .staff > svg { position: absolute; left: 0; top: 0; }
.foot { left: 40mm; top: 980mm; width: 230mm; color: ${white}; display: grid; grid-template-columns: 110mm 1fr; column-gap: 6mm; align-items: end; }
.foot .tag { font-family: "Mono", "Neo"; font-weight: 500; font-size: 5mm; } .foot .tag span { font-weight: 400; color: ${wdim}; font-size: 3.8mm; margin-left: 1.4mm; }
.foot p { font-size: 3.9mm; line-height: 1.45; margin-top: 1mm; } .foot p.e { font-family: "Mono", "Neo"; font-size: 3.4mm; color: ${wdim}; }
.text { left: ${AX}mm; top: 930mm; width: ${AW}mm; color: ${white}; font-size: 4.6mm; line-height: 1.52; }
.text p + p { margin-top: 2.4mm; }
.text .e { font-family: "Mono", "Neo"; color: ${wdim}; font-size: 3.5mm; line-height: 1.5; margin-top: 3.5mm; }
.meta { left: ${AX}mm; bottom: 24mm; width: ${AW}mm; display: grid; grid-template-columns: 24mm 1fr; column-gap: 3mm; row-gap: .6mm; font-family: "Mono", "Neo"; font-size: 3.4mm; line-height: 1.3; color: ${white}; }
.meta i { font-style: normal; color: ${wdim}; }
.credit { left: ${L}mm; bottom: 9mm; width: ${R - L}mm; display: flex; justify-content: space-between; font-family: "Mono", "Neo"; font-size: 3.5mm; color: ${wdim}; }
`,
    `<img class="abs ug" src="../renders/underground.jpg">
<svg class="abs" style="left:0;top:0" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">${svg()}</svg>
<div class="abs t" data-text>발견된 인류</div>
<div class="abs en" data-text>${TEXT.titleEn}</div>
<div class="abs head" data-text>${TEXT.head.join("<br>")}<div class="e">Archaeologists of the future are excavating an extinct humanity.<br>What will the present you leave behind?</div></div>
<div class="abs surf" data-text>지표면 SURFACE · T+0 현재 NOW · 아래로 = 과거 · 1 mm = ${(1 / mmPerSec).toFixed(1)} s</div>
<div class="abs surf2" data-text>단면 SECTION · 19 BEINGS · 23 MIN</div>
${notes.map((n) => `<div class="abs n" data-text style="top:${n.y}mm">${n.sign ? sign(n.sign) : "<span></span>"}<div><div class="tag">${n.tag}<span>${n.en}</span></div><p>${n.ko}</p><p class="e">${n.e}</p></div></div>`).join("")}
<div class="abs foot" data-text><svg viewBox="-50 -50 100 100" width="110mm" height="110mm" fill="none" stroke="${white}" stroke-width=".09" stroke-linejoin="round">${tracePaths(1, 0, 0)}</svg><div><div class="tag">/걸음의 자취<span>footprints</span></div><p>지표면에 남은 열아홉 존재의 23분. 선이 뭉친 자리마다 아래에 건물이 섰다.</p><p class="e">Nineteen beings' 23 minutes on the surface; buildings rose beneath where the lines bunch.</p></div></div>
<div class="abs text" data-text><p>인류세의 화석은 무엇일까. 고생물학에서는 발자국이나 굴처럼 몸이 아니라 활동의 자취가 남은 화석을 생흔화석이라고 부른다. 이 작품은 인간의 생흔화석을 도시의 주거, 수로, 길의 흔적에서 찾는다. 관객은 짧은 삶을 살며 가상의 세계를 걷고, 벽에는 모든 삶의 흔적이 시간 순서대로 쌓인다. 태어난 이상 살아가는 수밖에 없다.</p><div class="e">What is the fossil of the Anthropocene? Palaeontology calls fossils of activity rather than of the body trace fossils. This work reads humanity's trace fossils in the dwellings, waterways and paths of the city. A visitor lives a short life walking a virtual world; the wall piles every life's traces in the order of time. Having been born, one can only go on living.</div></div>
<div class="abs meta" data-text><i>DATE</i><span>2026.11.11 –</span><i>VENUE</i><span>KAIST Industrial Design</span><i>AUTHOR</i><span>Hayeon Park 20220875</span><i>SUPERVISOR</i><span>Yiyun Kang</span><i>COURSE</i><span>ID40009 Graduation Design Studio</span></div>
<div class="abs credit" data-text><span>Homo inventus — 발견된 인류</span><span>KAIST · 2026</span></div>`,
    { imgX: 0, imgY: SURF, imgH: UG, img: "underground_alpha.png" },
  );
}
writeFileSync(resolve(OUT, "layout.json"), JSON.stringify(layout));

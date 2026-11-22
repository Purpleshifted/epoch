"use client";
/**
 * SpecimenCard — the end screen's card (lib/parliament/plate.ts): the one SVG the screen shows, the phone saves and
 * the printer prints. `saveCard` turns the same picture into a PNG (1080 × 1720 portrait or 1720 × 1080 landscape —
 * the printed card's 54 × 86 mm) with its face embedded, and hands it to the phone's share sheet when it takes files,
 * else downloads it. `printCard` prints the card on the gallery machine's card printer: through the print helper on that
 * machine (tools/card-printer — it hands a 300 dpi picture to the printer at the card's size, no dialog), else through
 * the browser's print at the card's size in millimetres.
 */

import { useMemo } from "react";
import { PLATE_FACE, glyphOf, plateSize, plateSvg, printTheme, type PlateInput, type PlateOrient, type PlateTheme } from "@/lib/parliament";

/** What the visitor does with the card: print it (the gallery machine), save it (a phone, a remote screen), post it. */
export type CardAct = "print" | "save" | "post";

/** How the card is set: its paper, which way it stands. */
export interface CardLook {
  theme: PlateTheme;
  orient: PlateOrient;
}

export function SpecimenCard({ plate, look, className = "", style }: { plate: PlateInput; look: CardLook; className?: string; style?: React.CSSProperties }) {
  const svg = useMemo(() => plateSvg(plate, glyphOf, look), [plate, look]);
  const { w, h } = plateSize(look.orient);
  return <div className={`[&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className}`} style={{ aspectRatio: `${w} / ${h}`, ...style }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

let faceCss: Promise<string> | null = null;

/** The face as a data URL inside an @font-face rule: an SVG drawn as an image loads nothing from outside. */
function embeddedFace(): Promise<string> {
  if (!faceCss) {
    faceCss = fetch(PLATE_FACE.file)
      .then((r) => r.blob())
      .then(
        (b) =>
          new Promise<string>((res, rej) => {
            const rd = new FileReader();
            rd.onload = () => res(`@font-face{font-family:"${PLATE_FACE.family}";src:url(${String(rd.result).replace(/^data:[^;]*;/, "data:font/woff2;")}) format("woff2");}`);
            rd.onerror = () => rej(rd.error);
            rd.readAsDataURL(b);
          }),
      );
    faceCss.catch(() => (faceCss = null));
  }
  return faceCss;
}

/** The card as a PNG blob, `scale` × its card units (1: 20 px a millimetre); `turn` stands a landscape card up (a quarter
 * turn clockwise), for a printer whose paper runs one way. */
export async function cardPng(plate: PlateInput, look: CardLook, opts: { scale?: number; turn?: boolean } = {}): Promise<Blob> {
  const fontCss = await embeddedFace().catch(() => "");
  const svg = plateSvg(plate, glyphOf, { ...look, fontCss });
  const { w, h } = plateSize(look.orient);
  const sc = opts.scale ?? 1;
  const W = Math.round(w * sc), H = Math.round(h * sc);
  const turn = !!opts.turn && W > H;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "sync";
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = turn ? H : W;
    c.height = turn ? W : H;
    const g = c.getContext("2d");
    if (!g) throw new Error("no 2d context");
    if (turn) {
      g.translate(H, 0);
      g.rotate(Math.PI / 2);
    }
    // Safari lays an SVG image's embedded face out a moment late: draw, wait a frame, draw again
    g.drawImage(img, 0, 0, W, H);
    await new Promise((r) => setTimeout(r, 120));
    g.clearRect(0, 0, W, H);
    g.drawImage(img, 0, 0, W, H);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Save the card: the share sheet when it takes files (a phone: into the photos), else a download. */
export async function saveCard(plate: PlateInput, look: CardLook, name: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await cardPng(plate, look);
  const file = new File([blob], `${name}.png`, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return "shared";
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return "cancelled";
      // a share that fails for another reason falls through to the download
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return "downloaded";
}

/** The gallery machine's print helper (tools/card-printer): on the machine itself; `?printer=<url>` names another. */
const PRINT_HELPER = "http://127.0.0.1:7313";
const DPI = 300;

function helperUrl(): string {
  if (typeof window === "undefined") return PRINT_HELPER;
  return new URLSearchParams(window.location.search).get("printer") || PRINT_HELPER;
}

/** Print the card on the gallery machine, in one ink (the paper the visitor picked, in its one-ink form): through the
 * print helper when it answers (a 300 dpi picture at the card's size, stood up, straight to the printer); else the
 * browser's print. "failed": the helper answered but could not print. */
export async function printCard(plate: PlateInput, look: CardLook): Promise<"printed" | "dialog" | "failed"> {
  const one = { ...look, theme: printTheme(look.theme) };
  const base = helperUrl();
  const up = await fetch(`${base}/status`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
  if (up) {
    // 54 mm at 300 dpi: 637.8 px — the PNG is printed as it is (ppi 300), so its size is the card's
    const png = await cardPng(plate, one, { scale: DPI / 25.4 / 20, turn: true });
    const r = await fetch(`${base}/print?w=54&h=86`, { method: "POST", headers: { "content-type": "image/png" }, body: png, signal: AbortSignal.timeout(20000) }).catch(() => null);
    return r?.ok ? "printed" : "failed";
  }
  await printInBrowser(plate, one);
  return "dialog";
}

/** The browser's print: the card alone on one 54 × 86 mm page, nothing else of the page — a landscape card stood up on
 * it (a quarter turn clockwise), as the helper does, so the printer needs the one paper size (tools/card-printer/
 * add-card-size.sh adds it to the label printer: "54mmx86mm"). Chrome with --kiosk-printing prints without the dialog.
 * The page's face is already loaded: the card is on the screen. */
async function printInBrowser(plate: PlateInput, look: CardLook): Promise<void> {
  const land = look.orient === "landscape";
  const box = document.createElement("div");
  box.id = "specimen-card-print";
  box.innerHTML = `<div class="card">${plateSvg(plate, glyphOf, look)}</div>`;
  const style = document.createElement("style");
  const card = land ? "width:86mm;height:54mm;transform-origin:0 0;transform:translateX(54mm) rotate(90deg)" : "width:54mm;height:86mm";
  style.textContent = `#specimen-card-print{display:none}@media print{@page{size:54mm 86mm;margin:0}html,body{margin:0!important;padding:0!important;background:#fff!important}body>*:not(#specimen-card-print){display:none!important}#specimen-card-print{display:block!important;width:54mm;height:86mm;overflow:hidden}#specimen-card-print .card{${card}}#specimen-card-print svg{display:block;width:100%;height:100%}}`;
  document.head.appendChild(style);
  document.body.appendChild(box);
  try {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    window.print();
  } finally {
    // the print dialog has returned (Chrome blocks on it); whatever is left goes after the next print event
    const done = () => {
      box.remove();
      style.remove();
    };
    if (typeof window.matchMedia === "function" && window.matchMedia("print").matches) window.addEventListener("afterprint", done, { once: true });
    else done();
  }
}

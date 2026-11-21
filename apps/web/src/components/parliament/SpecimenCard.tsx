"use client";
/**
 * SpecimenCard — the end screen's card (lib/parliament/plate.ts): the one SVG the screen shows, the phone saves and
 * the printer prints. `saveCard` turns the same picture into a PNG (1080 × 1720 portrait or 1720 × 1080 landscape —
 * the printed card's 54 × 86 mm) with its face embedded, and hands it to the phone's share sheet when it takes files,
 * else downloads it. `printCard` prints the card alone at its size in millimetres (the gallery machine's card printer;
 * Chrome with --kiosk-printing prints without the dialog).
 */

import { useMemo } from "react";
import { PLATE_FONTS, glyphOf, plateSize, plateSvg, type PlateFont, type PlateInput, type PlateOrient, type PlateTheme } from "@/lib/parliament";

/** What the visitor does with the card: print it (the gallery machine), save it (a phone, a remote screen), post it. */
export type CardAct = "print" | "save" | "post";

/** How the card is set: its face, its paper, which way it stands. */
export interface CardLook {
  font: PlateFont;
  theme: PlateTheme;
  orient: PlateOrient;
}

export function SpecimenCard({ plate, look, className = "", style }: { plate: PlateInput; look: CardLook; className?: string; style?: React.CSSProperties }) {
  const svg = useMemo(() => plateSvg(plate, glyphOf, look), [plate, look]);
  const { w, h } = plateSize(look.orient);
  return <div className={`[&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className}`} style={{ aspectRatio: `${w} / ${h}`, ...style }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

const faceCss = new Map<PlateFont, Promise<string>>();

/** The face as a data URL inside an @font-face rule: an SVG drawn as an image loads nothing from outside. */
function embeddedFace(font: PlateFont): Promise<string> {
  let p = faceCss.get(font);
  if (!p) {
    const f = PLATE_FONTS[font];
    p = fetch(f.file)
      .then((r) => r.blob())
      .then(
        (b) =>
          new Promise<string>((res, rej) => {
            const rd = new FileReader();
            rd.onload = () => res(`@font-face{font-family:"${f.family}";src:url(${String(rd.result).replace(/^data:[^;]*;/, "data:font/woff2;")}) format("woff2");}`);
            rd.onerror = () => rej(rd.error);
            rd.readAsDataURL(b);
          }),
      );
    p.catch(() => faceCss.delete(font));
    faceCss.set(font, p);
  }
  return p;
}

/** The card as a PNG blob. */
export async function cardPng(plate: PlateInput, look: CardLook): Promise<Blob> {
  const fontCss = await embeddedFace(look.font).catch(() => "");
  const svg = plateSvg(plate, glyphOf, { ...look, fontCss });
  const { w: PLATE_W, h: PLATE_H } = plateSize(look.orient);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "sync";
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = PLATE_W;
    c.height = PLATE_H;
    const g = c.getContext("2d");
    if (!g) throw new Error("no 2d context");
    // Safari lays an SVG image's embedded face out a moment late: draw, wait a frame, draw again
    g.drawImage(img, 0, 0, PLATE_W, PLATE_H);
    await new Promise((r) => setTimeout(r, 120));
    g.clearRect(0, 0, PLATE_W, PLATE_H);
    g.drawImage(img, 0, 0, PLATE_W, PLATE_H);
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

/** Print the card alone, at 54 × 86 mm (or turned), nothing else of the page: the browser's print, so the gallery
 * machine's printer (thermal transfer) takes it. The page's faces are already loaded: the card is on the screen. */
export async function printCard(plate: PlateInput, look: CardLook): Promise<void> {
  const [w, h] = look.orient === "landscape" ? ["86mm", "54mm"] : ["54mm", "86mm"];
  const box = document.createElement("div");
  box.id = "specimen-card-print";
  box.innerHTML = plateSvg(plate, glyphOf, look);
  const style = document.createElement("style");
  style.textContent = `#specimen-card-print{display:none}@media print{@page{size:${w} ${h};margin:0}html,body{margin:0!important;padding:0!important;background:#fff!important}body>*:not(#specimen-card-print){display:none!important}#specimen-card-print{display:block!important;width:${w};height:${h};overflow:hidden}#specimen-card-print svg{display:block;width:100%;height:100%}}`;
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

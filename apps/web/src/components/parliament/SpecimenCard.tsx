"use client";
/**
 * SpecimenCard — the end screen's card (lib/parliament/plate.ts): the one SVG the screen shows, the phone saves and
 * the printer prints. `saveCard` turns the same picture into a PNG (1080 × 1720, the printed card's 54 × 86 mm) with
 * its face embedded, and hands it to the phone's share sheet when it takes files, else downloads it.
 */

import { useMemo } from "react";
import { PLATE_FONTS, PLATE_H, PLATE_W, glyphOf, plateSvg, type PlateFont, type PlateInput, type PlateTheme } from "@/lib/parliament";

export function SpecimenCard({ plate, font, theme, className = "", style }: { plate: PlateInput; font: PlateFont; theme: PlateTheme; className?: string; style?: React.CSSProperties }) {
  const svg = useMemo(() => plateSvg(plate, glyphOf, { font, theme }), [plate, font, theme]);
  return <div className={`[&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className}`} style={{ aspectRatio: `${PLATE_W} / ${PLATE_H}`, ...style }} dangerouslySetInnerHTML={{ __html: svg }} />;
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
export async function cardPng(plate: PlateInput, font: PlateFont, theme: PlateTheme): Promise<Blob> {
  const fontCss = await embeddedFace(font).catch(() => "");
  const svg = plateSvg(plate, glyphOf, { font, theme, fontCss });
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
export async function saveCard(plate: PlateInput, font: PlateFont, theme: PlateTheme, name: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await cardPng(plate, font, theme);
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

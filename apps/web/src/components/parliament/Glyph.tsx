"use client";
/**
 * Glyph — a being's melody written down as a small score (lib/parliament/glyph.ts): the HUD's way of naming someone
 * without a word. `cell` is one step's size in pixels; `live` marks the step of the shared bar, in time with the blinking
 * squares in the frame; `playFrom` lights the notes as the melody sounds; `sounding` (the step the music is on) lights only
 * the note that sounds now, the rest dim: a melody ringing.
 */

import { useEffect, useState } from "react";
import { GLYPH_COLS, GLYPH_ROWS, STEP_MS, stepAt, type GlyphDot } from "@/lib/parliament";

export function Glyph({
  dots,
  cell = 2,
  live = false,
  playFrom,
  playEvery = Infinity,
  sounding,
  className = "",
}: {
  dots: readonly GlyphDot[];
  cell?: number;
  live?: boolean;
  /** Wall ms the melody starts (the name): its notes come on as they sound, instead of `live` … */
  playFrom?: number;
  /** … over again every this many ms. */
  playEvery?: number;
  /** The step of the bar the sound is on now: the note on it is lit, the others dim. */
  sounding?: () => number;
  className?: string;
}) {
  const [step, setStep] = useState(-1);
  useEffect(() => {
    if (!live && playFrom === undefined && !sounding) return;
    const id = setInterval(() => setStep(sounding ? sounding() : playFrom !== undefined ? Math.floor(Math.max(0, Date.now() - playFrom) % playEvery / STEP_MS) : stepAt(performance.now())), STEP_MS / 4);
    return () => clearInterval(id);
  }, [live, playFrom, playEvery, sounding]);
  const gap = cell > 2 ? 1 : 0;
  return (
    <svg width={GLYPH_COLS * cell} height={GLYPH_ROWS * cell} shapeRendering="crispEdges" className={`inline-block shrink-0 align-middle ${className}`} aria-hidden>
      {live && step >= 0 && <rect x={step * cell} y={0} width={cell} height={GLYPH_ROWS * cell} fill="currentColor" opacity={0.25} />}
      {dots.map((d, i) => (
        <rect key={i} x={d.col * cell} y={d.row * cell} width={d.len * cell - gap} height={cell - gap} fill="currentColor" opacity={sounding ? (step >= d.col && step < d.col + d.len ? 1 : 0.3) : playFrom !== undefined && step < d.col ? 0.2 : 1} />
      ))}
    </svg>
  );
}

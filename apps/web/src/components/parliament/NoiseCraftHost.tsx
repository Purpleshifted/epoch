"use client";
/**
 * NoiseCraftHost — the player tab's NoiseCraft instrument (sound wiring; docs/sound-logic.md §8b, v4 A2).
 *
 * The artist's patch (nc_noise_patch) in a hidden iframe, playing through its own output: a static machine that
 * receives the engine's MUSIC CLOCK and, every bar, the harmonic sequences of the bar's plan (noisecraftDriver.ts).
 * It plays while the session is LIVE and the headset is on (not muted); the Web Audio engine keeps the motif, the
 * others, the vegetation and the rooms, on the grid whose phase the patch's clock carries (setGridAnchor). A few of
 * the patch's knobs follow the interaction (v4 A5a, noisecraftKnobs.ts) — here only, never on the bench.
 */

import { useEffect, useRef } from "react";
import { NoiseCraftDriver, noteNcEvent } from "@/lib/sound/noisecraftDriver";
import { PULSES_PER_BAR, PULSES_PER_STEP } from "@/lib/sound/noisecraftMap";
import { DEFAULT_PATCH, loadPatchChoice } from "@/lib/sound/patchChoice";
import { touchDevice } from "@/lib/parliament/serverWorld";
import type { SoundSetup } from "./useSound";

/** The default patch; the bench's choice (patchChoice.ts) overrides it. */
export const NC_PATCH = DEFAULT_PATCH;

/**
 * `warm`: the frame before a life. The patch already runs there, unheard (the engine's master is shut until LIVE,
 * muffleSound): the first start stops an iPhone's page for seconds, and over the notices nobody is walking.
 */
export default function NoiseCraftHost({ sound, live, warm = false }: { sound: SoundSetup; live: boolean; warm?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const { engine } = sound;
  const liveRef = useRef(live);
  const warmRef = useRef(warm);
  const mutedRef = useRef(sound.muted);
  useEffect(() => {
    liveRef.current = live;
    warmRef.current = warm;
    mutedRef.current = sound.muted;
  }, [live, warm, sound.muted]);

  useEffect(() => {
    if (!host.current) return;
    const driver = new NoiseCraftDriver({
      planFor: (bar) => engine.planFor(bar),
      running: () => engine.running && (liveRef.current || warmRef.current || engine.inAfterlife) && !mutedRef.current,
      barSec: () => engine.musicBarSec(),
      onBar: (bar, wallMs) => engine.setGridAnchor(bar, wallMs),
      knobSources: () => engine.knobSources(),
      knobDepth: () => engine.currentParams.ncMapDepth,
    });
    // the patch plays into the engine (building dullness by ncDull, master, the lifespan's dulling)
    driver.bridge.onStream = (s) => {
      noteNcEvent(s ? "stream" : "streamEnd");
      engine.attachNoiseCraft(s);
    };
    // A PHONE ONLY (the artist, 2026-11-03: only the phone stutters, the others keep their sound as it was): the patch is
    // compiled in small functions and keeps its context from life to life (embedded.html). ?ncsplit=0 as one function: that
    // is what stopped an iPhone's page for 10-18 s (compiler.js splitSource), kept to compare on a real phone with ?perf=1
    const page = window as unknown as { __ncPhone?: boolean; __ncWhole?: boolean };
    page.__ncPhone = touchDevice();
    page.__ncWhole = new URLSearchParams(window.location.search).get("ncsplit") === "0";
    driver.mount(host.current, loadPatchChoice(), false, true);
    const id = setInterval(() => {
      const s = driver.status;
      const clock = s.clocked ? `${(s.pulseHz / PULSES_PER_STEP).toFixed(1)} steps/s · bar ${s.pulseHz > 0 ? (PULSES_PER_BAR / s.pulseHz).toFixed(2) : "–"} s (sent ${s.barSecSent.toFixed(2)})` : "no ClockOut: wall-clock bars";
      engine.ncStatus = `nc ${s.audio} (${s.patch.replace(/\.ncft$/, "")}) · ${clock} · bar ${s.bar} · ${s.mode}${s.knobs ? ` · 노브 ${s.knobs}` : ""}`;
    }, 500);
    return () => {
      clearInterval(id);
      engine.ncStatus = "";
      driver.bridge.onStream = undefined;
      engine.attachNoiseCraft(null);
      driver.dispose();
    };
  }, [engine]);

  return <div ref={host} />;
}

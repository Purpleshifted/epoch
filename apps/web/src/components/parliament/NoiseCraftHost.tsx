"use client";
/**
 * NoiseCraftHost — the player tab's NoiseCraft instrument (sound wiring; docs/sound-logic.md §8b, v4 A2).
 *
 * The artist's patch (nc_noise_patch) in a hidden iframe, playing through its own output: a static machine that
 * receives the engine's MUSIC CLOCK and, every bar, the harmonic sequences of the bar's plan (noisecraftDriver.ts).
 * It plays while the session is LIVE and the headset is on (not muted); the Web Audio engine keeps the motif, the
 * others, the vegetation and the rooms, on the grid whose phase the patch's clock carries (setGridAnchor).
 */

import { useEffect, useRef } from "react";
import { NoiseCraftDriver } from "@/lib/sound/noisecraftDriver";
import { PULSES_PER_BAR, PULSES_PER_STEP } from "@/lib/sound/noisecraftMap";
import type { SoundSetup } from "./useSound";

export const NC_PATCH = "nc_noise_patch.ncft";

export default function NoiseCraftHost({ sound, live }: { sound: SoundSetup; live: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const { engine } = sound;
  const liveRef = useRef(live);
  const mutedRef = useRef(sound.muted);
  useEffect(() => {
    liveRef.current = live;
    mutedRef.current = sound.muted;
  }, [live, sound.muted]);

  useEffect(() => {
    if (!host.current) return;
    const driver = new NoiseCraftDriver({
      planFor: (bar) => engine.planFor(bar),
      running: () => engine.running && liveRef.current && !mutedRef.current,
      barSec: () => engine.musicBarSec(),
      onBar: (bar, wallMs) => engine.setGridAnchor(bar, wallMs),
    });
    driver.mount(host.current, NC_PATCH, false);
    const id = setInterval(() => {
      const s = driver.status;
      const clock = s.clocked ? `${(s.pulseHz / PULSES_PER_STEP).toFixed(1)} steps/s · bar ${s.pulseHz > 0 ? (PULSES_PER_BAR / s.pulseHz).toFixed(2) : "–"} s (sent ${s.barSecSent.toFixed(2)})` : "no ClockOut: wall-clock bars";
      engine.ncStatus = `nc ${s.audio} · ${clock} · bar ${s.bar} · ${s.mode}`;
    }, 500);
    return () => {
      clearInterval(id);
      engine.ncStatus = "";
      driver.dispose();
    };
  }, [engine]);

  return <div ref={host} />;
}

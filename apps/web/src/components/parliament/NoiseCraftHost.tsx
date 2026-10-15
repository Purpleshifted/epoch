"use client";
/**
 * NoiseCraftHost — the player tab's NoiseCraft instrument (sound wiring; docs/sound-logic.md §8b).
 *
 * umwelt's way: the bridge's iframe sits hidden off-screen in this page and plays; the engine's bar plans and the
 * coded knob mapping drive it (noisecraftDriver.ts). The editor is NOT here — it is the manager page (/v2/sound),
 * which hears this tab through the bus and shows the same patch in its own iframe; while the manager holds the solo
 * this tab's instrument stays silent.
 */

import { useEffect, useRef, useState } from "react";
import { NoiseCraftDriver } from "@/lib/sound/noisecraftDriver";
import { PULSES_PER_BAR, PULSES_PER_STEP } from "@/lib/sound/noisecraftMap";
import { mutedBySolo } from "@/lib/sound/output";
import type { SoundSetup } from "./useSound";

export default function NoiseCraftHost({ sound }: { sound: SoundSetup }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  const { engine, params } = sound;
  const patch = sound.nc.patch;
  const master = params.master;

  useEffect(() => {
    if (!host.current) return;
    const driver = new NoiseCraftDriver(
      {
        signals: () => engine.signals,
        planFor: (bar) => engine.planFor(bar),
        running: () => engine.running && !mutedBySolo("mobile"),
        master: () => master,
        barSec: () => engine.params.barSec,
      },
      patch,
    );
    driver.mount(host.current, patch, false);
    const id = setInterval(() => {
      const s = driver.status;
      setStatus(`noisecraft ${s.patch} · ${s.audio} · ${s.clocked ? `${(s.pulseHz / PULSES_PER_STEP).toFixed(1)} steps/s · bar ${s.pulseHz > 0 ? (PULSES_PER_BAR / s.pulseHz).toFixed(1) : "–"} s` : "no ClockOut: wall-clock bars"} · bar ${s.bar} · ${s.mode}`);
    }, 500);
    return () => {
      clearInterval(id);
      driver.dispose();
    };
  }, [engine, patch, master]);

  return (
    <>
      <div ref={host} />
      <div className="pointer-events-none fixed bottom-4 right-4 z-40 select-none font-mono text-[9px] text-white/35">{status}</div>
    </>
  );
}

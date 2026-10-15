"use client";
/**
 * useSound — the player's headset sound (V2 only): the engine (lib/sound/engine.ts), started on the first user
 * gesture (mobile autoplay rules), with its controls taken from the DESK (lib/sound/desk.ts): the workspace at
 * /v2/sound holds every sound control and this tab follows it live (useDesk). No Leva here any more.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParliamentVersion } from "./version";
import { useDesk } from "./useDesk";
import { DEFAULT_SIGNALS, SoundEngine, mutedBySolo, readSolo, type SignalConfig, type SoundParams } from "@/lib/sound";
import { openBus, type BusState } from "@/lib/sound/bus";

export interface SoundSetup {
  engine: SoundEngine;
  params: SoundParams;
  sigCfg: SignalConfig;
  /** The NoiseCraft instrument (NoiseCraftHost.tsx): which patch file. */
  nc: { patch: string };
  /** One line for the screen: which window this is and whether it is playing (and why not). */
  status: string;
  /** Whether this window's sound is muted (ESC or the sound button), and the switch (SoundButton.tsx). */
  muted: boolean;
  toggleMute(): void;
  /** Patch knobs held by hand in the workspace (desk.ts). */
  overrides: Record<string, number>;
}

export function useSound(): SoundSetup | null {
  const isV2 = useParliamentVersion() === "v2";
  const desk = useDesk();
  const c = { on: desk.on, output: desk.output };
  const engine = useMemo(() => (isV2 && typeof window !== "undefined" ? new SoundEngine() : null), [isV2]);
  const onRef = useRef(c.on);
  useEffect(() => {
    onRef.current = c.on;
  }, [c.on]);

  // ESC mutes this window's sound (and un-mutes on the next ESC); the Leva switch is the other way to stop it;
  // another window's SOLO (output.ts) is the third
  const muted = useRef(false);
  const [mutedState, setMutedState] = useState(false);
  const soloed = useRef(false);
  const [status, setStatus] = useState("♪ 헤드셋");
  // the switch the ESC key and the sound button share
  const toggleMute = useMemo(
    () => () => {
      if (!engine) return;
      muted.current = !muted.current;
      setMutedState(muted.current);
      if (muted.current) engine.stop();
      else if (onRef.current) engine.start().catch(() => {});
    },
    [engine],
  );
  useEffect(() => {
    if (!engine) return;
    const start = () => {
      if (onRef.current && !muted.current && !soloed.current) engine.start().catch(() => {});
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        toggleMute();
        return;
      }
      start();
    };
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchend", start);
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchend", start);
      engine.dispose();
    };
  }, [engine, toggleMute]);

  useEffect(() => {
    if (!engine) return;
    if (c.on && !muted.current && !soloed.current) engine.start().catch(() => {}); // no-op until a gesture has unlocked the context
    else engine.stop();
  }, [engine, c.on]);

  // SOLO: every second obey another window's claim (the workspace decides who plays) and refresh the status line
  useEffect(() => {
    if (!engine) return;
    const id = setInterval(() => {
      const other = mutedBySolo("mobile");
      if (other !== soloed.current) {
        soloed.current = other;
        if (other) engine.stop();
        else if (onRef.current && !muted.current) engine.start().catch(() => {});
      }
      const who = readSolo();
      const why = !onRef.current ? "꺼짐 (작업실)" : muted.current ? "음소거 (ESC)" : other ? `음소거 (${who === "global" ? "글로벌" : who === "manager" ? "작업실" : "다른"} 창이 솔로)` : engine.running ? "재생 중" : "클릭하면 시작";
      setStatus(`♪ 헤드셋 (모바일 뷰) · ${why}${who === "mobile" ? " · 솔로" : ""}`);
    }, 1000);
    return () => clearInterval(id);
  }, [engine]);

  // THE BUS: twice a second this tab's state goes to the other windows (the manager page plans the same bars)
  useEffect(() => {
    if (!engine) return;
    const bus = openBus();
    if (!bus) return;
    const id = setInterval(() => {
      const sig = engine.signals;
      const d = engine.debug;
      if (!sig || !d.myId || !d.epochMs) return;
      const msg: BusState = { type: "state", myId: d.myId, sig, params: engine.params, epochMs: d.epochMs, yaw: d.yaw, at: Date.now() };
      bus.postMessage(msg);
    }, 500);
    return () => {
      clearInterval(id);
      bus.close();
    };
  }, [engine]);

  // OUTPUT DEVICE: the desk names it (the workspace lists the devices of this machine)
  useEffect(() => {
    if (!engine) return;
    engine.setSink(c.output ?? "default").catch(() => {});
  }, [engine, c.output]);

  const params: SoundParams = desk.headset;
  const nc = useMemo(() => ({ patch: desk.ncPatch || "nc_noise_patch.ncft" }), [desk.ncPatch]);
  const sigCfg = useMemo<SignalConfig>(() => ({ ...DEFAULT_SIGNALS, hearRadius: desk.headset.hearRadius, sealRadius: desk.sealRadius }), [desk.headset.hearRadius, desk.sealRadius]);
  const overrides = desk.overrides;
  return useMemo(() => (engine ? { engine, params, sigCfg, status, nc, muted: mutedState, toggleMute, overrides } : null), [engine, params, sigCfg, status, nc, mutedState, toggleMute, overrides]);
}

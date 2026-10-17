"use client";
/**
 * useTilt — the phone's orientation sensor as the walking input (lib/parliament/tilt.ts has the mapping).
 *
 * - Only on a phone-like device (coarse pointer, no fine one); on the iMac the ref stays inactive.
 * - iOS asks for permission, and only from inside a user gesture: the first tap on the page (there is always one
 *   before a life — the title screen) requests it; elsewhere the sensor is simply listened to.
 * - The front-back angle at which the life begins (LIVE) is the neutral one: the hand holds the phone wherever it
 *   likes, and walking is relative to that.
 * - Works only on a secure origin (https, or localhost on the phone itself): the deployed site, not a LAN address.
 */

import { useEffect, useRef, useState } from "react";
import { isCoarsePointer, tiltToInput, type TiltInput } from "@/lib/parliament";
import type { LifeSignal } from "./useLifeSession";

export interface TiltState extends TiltInput {
  /** Readings are coming in (the device has the sensor and, on iOS, gave permission). */
  active: boolean;
}

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

/**
 * @returns `tiltRef` (read per frame by the controller) and `coarse` (a phone-like device: no pointer lock, no keys)
 */
export function useTilt(enabled: boolean, lifeRef?: { readonly current: LifeSignal }): { tiltRef: React.MutableRefObject<TiltState>; coarse: boolean } {
  const [coarse] = useState(() => isCoarsePointer());
  const tiltRef = useRef<TiltState>({ fwd: 0, turn: 0, active: false });
  const neutral = useRef<number | null>(null);
  const wasLive = useRef(false);

  useEffect(() => {
    if (!enabled || !coarse || typeof window === "undefined") return;
    let listening = false;
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      // the neutral angle: taken when the life begins (and again at every new life)
      const live = lifeRef ? lifeRef.current.phase === "live" : true;
      if (live && !wasLive.current) neutral.current = e.beta;
      wasLive.current = live;
      if (neutral.current === null) neutral.current = e.beta;
      const inp = live ? tiltToInput(e.beta, e.gamma, neutral.current) : { fwd: 0, turn: 0 };
      tiltRef.current = { ...inp, active: true };
    };
    const listen = () => {
      if (listening) return;
      listening = true;
      window.addEventListener("deviceorientation", onOrientation);
    };
    const ctor = (typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : null) as OrientationCtor | null;
    if (!ctor) return;
    // iOS: permission from inside a gesture; the first tap on the page asks (and then the listener is attached)
    const ask = () => {
      window.removeEventListener("touchend", ask);
      window.removeEventListener("click", ask);
      if (typeof ctor.requestPermission === "function") {
        // granted: listen; refused or not answerable (a synthetic tap, an emulator): listen anyway — without the
        // permission no readings come, so nothing happens, and a later grant is not lost
        ctor
          .requestPermission()
          .then(() => listen())
          .catch(() => listen());
      } else listen();
    };
    if (typeof ctor.requestPermission === "function") {
      window.addEventListener("touchend", ask);
      window.addEventListener("click", ask);
    } else listen();
    return () => {
      window.removeEventListener("touchend", ask);
      window.removeEventListener("click", ask);
      window.removeEventListener("deviceorientation", onOrientation);
      tiltRef.current = { fwd: 0, turn: 0, active: false };
    };
  }, [enabled, coarse, lifeRef]);

  return { tiltRef, coarse };
}

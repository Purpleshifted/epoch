"use client";

import { useEffect } from "react";

/**
 * The exhibition screens (ui=0) run unattended: when the GPU drops the page's WebGL context (a driver reset, the GPU
 * overloaded), the canvas goes black and stays black. This reloads the page a moment later — the world lives in
 * localStorage, so nothing is lost. `webglcontextlost` does not bubble; a capture listener on window still sees it.
 */
export function useReloadOnContextLoss(enabled: boolean, delayMs = 2000): void {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onLost = () => {
      if (!timer) timer = setTimeout(() => window.location.reload(), delayMs);
    };
    window.addEventListener("webglcontextlost", onLost, true);
    return () => {
      window.removeEventListener("webglcontextlost", onLost, true);
      if (timer) clearTimeout(timer);
    };
  }, [enabled, delayMs]);
}

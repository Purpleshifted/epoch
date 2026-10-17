"use client";
/**
 * usePageLock — while the player view is up, the page is not a web page: nothing gets selected, no callout or loupe,
 * no pinch or double-tap zoom, no scrolling, no rubber-band bounce, no context menu. A phone held in the hand has
 * to answer only to the piece. (The Leva panel and inputs keep working, for tuning.)
 *
 * What a page cannot block on iOS: the swipe from the screen edge (back), the home indicator, Control Center.
 * For those: add the page to the home screen (it then runs without Safari's chrome — see app/mobile/layout.tsx),
 * or, at the exhibition, Guided Access.
 */

import { useEffect } from "react";

const LOCK_CLASS = "player-lock";

/** The Leva panel and form inputs are left alone. */
function exempt(t: EventTarget | null): boolean {
  const el = t as Element | null;
  if (!el?.closest) return false;
  return !!el.closest("[class*='leva-'], input, textarea, select");
}

export function usePageLock(on: boolean) {
  useEffect(() => {
    if (!on || typeof document === "undefined") return;
    const html = document.documentElement;
    html.classList.add(LOCK_CLASS);
    const stop = (e: Event) => {
      if (!exempt(e.target) && e.cancelable) e.preventDefault();
    };
    // a selection that got started anyway is dropped at once
    const clearSelection = () => {
      const sel = document.getSelection();
      if (sel && sel.rangeCount > 0 && !exempt(sel.anchorNode?.parentElement ?? null)) sel.removeAllRanges();
    };
    const opts: AddEventListenerOptions = { passive: false, capture: true };
    const kinds = ["touchmove", "gesturestart", "gesturechange", "gestureend", "selectstart", "contextmenu", "dblclick", "dragstart"];
    for (const k of kinds) document.addEventListener(k, stop, opts);
    document.addEventListener("selectionchange", clearSelection);
    return () => {
      html.classList.remove(LOCK_CLASS);
      for (const k of kinds) document.removeEventListener(k, stop, opts);
      document.removeEventListener("selectionchange", clearSelection);
    };
  }, [on]);
}

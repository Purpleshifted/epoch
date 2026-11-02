/**
 * sound/personalOpen.ts — whether a personal view is open in this browser (the artist, 2026-11-01): while working with the
 * two side by side, the test wall stays silent so its speakers' sound does not collide with the headset's. The personal
 * view says so on a channel every couple of seconds and when it closes. The silence allowed after the last word is long
 * because the browser slows the timers of a tab in the background.
 */

const CHANNEL = "anthropocene:personal-open";
const SAY_EVERY_MS = 2000;
const GONE_AFTER_MS = 75_000;

/** The personal view: says it is open until the returned function is called. */
export function announcePersonalOpen(): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(CHANNEL);
  const say = (open: boolean) => ch.postMessage({ open });
  say(true);
  const id = setInterval(() => say(true), SAY_EVERY_MS);
  const closing = () => say(false);
  window.addEventListener("pagehide", closing);
  return () => {
    clearInterval(id);
    window.removeEventListener("pagehide", closing);
    closing();
    ch.close();
  };
}

/** The wall: `on` hears whether a personal view is open, whenever that changes. */
export function watchPersonalOpen(on: (open: boolean) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(CHANNEL);
  let open = false;
  let last = 0;
  const set = (v: boolean) => {
    if (v !== open) {
      open = v;
      on(v);
    }
  };
  ch.onmessage = (e: MessageEvent<{ open: boolean }>) => {
    last = Date.now();
    set(e.data.open);
  };
  const id = setInterval(() => {
    if (open && Date.now() - last > GONE_AFTER_MS) set(false);
  }, 5000);
  return () => {
    clearInterval(id);
    ch.close();
  };
}

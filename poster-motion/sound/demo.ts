/**
 * poster-motion/sound/demo.ts — THE WORK'S OWN SOUND ENGINE ON THE SITE (PLAN.md item 8, 2026-11-04). The headset's
 * engine (apps/web/src/lib/sound/engine.ts) is bundled here unchanged and driven with synthetic signals: one situation
 * at a time, so a reader can hear what the headset does when the visitor walks, follows a path, stays beside someone,
 * stands on concrete or in grass. Not a recording — the engine plays. Built by tools/build-sound.sh into
 * assets/sound-demo.js; the page talks to window.HomoSound.
 */
import { DEFAULT_SOUND, SoundEngine, type SoundParams } from "../../apps/web/src/lib/sound/engine";
import { worldKey } from "../../apps/web/src/lib/sound/harmony";
import type { PersonalSignals } from "../../apps/web/src/lib/sound/signals";

export type Kind = "name" | "walk" | "path" | "stay" | "concrete" | "grass" | "places";
export const KINDS: Kind[] = ["name", "walk", "path", "stay", "concrete", "grass", "places"];

const EPOCH_MS = 1_762_000_000_000; // a past moment: the bar clock counts up from the epoch (a future one counted down)
const KEY = worldKey(String(EPOCH_MS));
const ME = "v_5051";
const OTHER = "v_5527";
const PARAMS: SoundParams = { ...DEFAULT_SOUND, magenta: false, dead: false } as SoundParams;
/** The page's own volume (0–1); 0 keeps the engine running silently (automated checks must not reach the speakers). */
export function setMaster(v: number): void { PARAMS.master = Math.max(0, Math.min(1, v)); }

const base = (): PersonalSignals => ({ x: 0, z: 0, speed: 0, stay: 1, neighbours: [], pathP: 0, sealed: 0, grass: 0.5, building: null, nearSlabs: [], coBuilders: [], myBuild: 0 });

/** The situation's signals at second t of the demo. */
function signalsOf(k: Kind, t: number): PersonalSignals {
  const s = base();
  switch (k) {
    case "name":
      return s;
    case "walk":
      return { ...s, x: t * 1.4, speed: 1.4, stay: 0, grass: 0.6 };
    case "path":
      return { ...s, x: t * 1.4, speed: 1.4, stay: 0, grass: 0.15, pathP: Math.min(0.9, 0.3 + t * 0.1) };
    case "stay": {
      // someone comes near and stays: the melodies lock (6 s), then the two of us are building — the hall opens
      const d = Math.max(1.3, 7 - t * 1.2);
      const together = t > 7;
      return { ...s, stay: 1, neighbours: [{ o: OTHER, dist: d, angle: 0.6, bot: true }], coBuilders: together ? [OTHER] : [], myBuild: together ? Math.min(60, (t - 7) * 5) : 0, sealed: t > 10 ? Math.min(1, (t - 10) / 6) : 0 };
    }
    case "concrete":
      return { ...s, speed: 0.3, stay: 0.7, grass: 0, sealed: 1, nearSlabs: ["0,0", "1,0"], building: { id: "0,0", x: 0, z: 0, dist: 1, radius: 8, mass: 40, who: [{ o: OTHER, amount: 30 }, { o: ME, amount: 12 }] } };
    case "grass":
      return { ...s, x: t * 0.6, speed: 0.6, stay: 0.2, grass: 1 };
    case "places": {
      // from one gathering to the next and back (a 48-second round): inside A (its key, chosen from who built it), out
      // across open ground (the world's own progression by place), into B (another key), and back
      const A = { id: "a", x: 0, z: 0, radius: 8, mass: 40, who: [{ o: "v_5527", amount: 30 }, { o: "v_6002", amount: 20 }] };
      const B = { id: "b", x: 34, z: 6, radius: 9, mass: 60, who: [{ o: "v_7310", amount: 40 }, { o: "v_8120", amount: 25 }, { o: "v_9004", amount: 10 }] };
      const u = (t % 48) / 48, half = u < 0.5 ? u * 2 : 2 - u * 2;   // 0 → 1 → 0
      const m = half < 0.2 ? 0 : half > 0.8 ? 1 : (half - 0.2) / 0.6; // stay at A, walk, stay at B
      const x = A.x + (B.x - A.x) * m, z = A.z + (B.z - A.z) * m;
      const dA = Math.hypot(x - A.x, z - A.z), dB = Math.hypot(x - B.x, z - B.z);
      const near = dA <= dB ? { ...A, dist: dA } : { ...B, dist: dB };
      const inside = near.dist <= near.radius;
      const moving = half > 0.2 && half < 0.8;
      return { ...s, x, z, speed: moving ? 1.6 : 0, stay: moving ? 0 : 1, grass: inside ? 0.1 : 0.6, sealed: inside ? 1 : 0, building: near.dist <= near.radius + 4 ? near : null, nearSlabs: inside ? [near.id] : [] };
    }
  }
}

const engine = new SoundEngine();
let kind: Kind | null = null;
let t0 = 0;
let timer = 0;
let yaw = 0;

function tick(): void {
  if (!kind) return;
  const t = (performance.now() - t0) / 1000;
  yaw = Math.sin(t * 0.15) * 0.6;
  engine.update(ME, signalsOf(kind, t), PARAMS, yaw, EPOCH_MS, KEY);
}

/** Play one situation (from a click: the browser unlocks audio on a gesture). */
export async function play(k: Kind): Promise<void> {
  // one situation at a time: whatever was playing stops (its voices, pad, name) before the next begins
  if (kind) { kind = null; engine.stop(); await new Promise((r) => setTimeout(r, 180)); }
  await engine.start();
  kind = k;
  t0 = performance.now();
  if (k === "name") engine.announce(ME, KEY, PARAMS.master);
  if (!timer) timer = window.setInterval(tick, 100);
  tick();
}

export function stop(): void {
  kind = null;
  if (timer) { clearInterval(timer); timer = 0; }
  engine.stop();
}

export function state(): { kind: Kind | null; t: number; running: boolean; debug: ReturnType<SoundEngine["debug"]> | null } {
  let debug: ReturnType<SoundEngine["debug"]> | null = null;
  try { debug = engine.debug; } catch { debug = null; }
  return { kind, t: kind ? (performance.now() - t0) / 1000 : 0, running: engine.running, debug };
}

(window as unknown as { HomoSound: unknown }).HomoSound = { play, stop, state, setMaster, KINDS, key: KEY };

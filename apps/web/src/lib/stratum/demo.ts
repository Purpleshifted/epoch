/**
 * stratum/demo.ts
 *
 * Seeded, deterministic "what the ground looks like after a crowd has walked here".
 * Used for screenshots, meetings and offline development: it replays a population of
 * wandering visitors through the same rules the live scene uses (step on a cell ->
 * StepRecord; every DROP_DIST of walking or DROP_IDLE of standing -> one deposit drawn
 * from what survives nearby), so the demo is the real model, not a mock-up.
 *
 * Pure. The browser-side seeding helper lives at the bottom and touches localStorage.
 */

import { mulberry32 } from "./rng";
import {
  GroundStore,
  cellKey,
  localSurvivors,
  makeDeposit,
  LS_DEPOSITS_KEY,
  LS_STEPS_KEY,
  LS_EPOCH_KEY,
  type DepositRecord,
  type StepRecord,
} from "./field";
import { INHERITANCE_ENABLED, drawItem } from "./sample";

export interface DemoOptions {
  visitors?: number;
  /** Length of the replayed exhibition, seconds. */
  span?: number;
  seed?: number;
  /** Items are drawn from survivors within this radius (matches DepositField). */
  poolRadius?: number;
  poolK?: number;
}

export interface DemoData {
  deposits: DepositRecord[];
  steps: StepRecord[];
  span: number;
}

const DT = 0.25;
const SPEED = 2.2;
const DROP_DIST = 1.0;
const DROP_IDLE = 1.5;
const DROP_MIN_GAP = 0.2;

interface Walker {
  id: string;
  t0: number;
  t1: number;
  x: number;
  z: number;
  heading: number;
  turn: number;
  cell: string;
  sinceDrop: number; // distance
  idle: number; // time
  lastDrop: number;
  seq: number;
  // pauses make the walk less uniform
  pauseLeft: number;
}

export function generateDemo(opts: DemoOptions = {}): DemoData {
  const visitors = opts.visitors ?? 24;
  const span = opts.span ?? 900;
  const rng = mulberry32(opts.seed ?? 20261006);
  const poolR = opts.poolRadius ?? 4;
  const poolK = opts.poolK ?? 20;

  const walkers: Walker[] = [];
  for (let i = 0; i < visitors; i++) {
    // lifetimes 10 s .. 3 min, log-uniform; starts spread over the first 85% of the span
    const life = Math.exp(Math.log(10) + rng() * (Math.log(180) - Math.log(10)));
    const t0 = rng() * span * 0.85;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 10;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    walkers.push({
      id: `demo${i}`,
      t0,
      t1: Math.min(span, t0 + life),
      x,
      z,
      heading: rng() * Math.PI * 2,
      turn: 0,
      cell: "",
      sinceDrop: 0,
      idle: 0,
      lastDrop: -1e9,
      seq: 0,
      pauseLeft: 0,
    });
  }

  const store = new GroundStore();
  const deposits: DepositRecord[] = [];
  const steps: StepRecord[] = [];

  const drop = (w: Walker, t: number) => {
    const survivors = INHERITANCE_ENABLED
      ? localSurvivors(store.resolveNear(w.x, w.z, poolR, t), w.x, w.z, poolR)
      : new Map<string, number>();
    const item = drawItem(rng(), survivors, poolK);
    const rec = makeDeposit({
      id: `${w.id}_${Math.floor(t * 1000)}_${w.seq++}`,
      u: 0,
      item,
      x: w.x,
      y: 0.02,
      z: w.z,
      t,
      owner: w.id,
    });
    if (store.addDeposit(rec)) deposits.push(rec);
    w.sinceDrop = 0;
    w.idle = 0;
    w.lastDrop = t;
  };

  for (let t = 0; t <= span; t += DT) {
    for (const w of walkers) {
      if (t < w.t0 || t > w.t1) continue;

      // random walk with a gentle pull toward the middle so paths overlap
      if (w.pauseLeft > 0) {
        w.pauseLeft -= DT;
        w.idle += DT;
      } else {
        w.turn += (rng() - 0.5) * 0.5;
        w.turn *= 0.85;
        w.heading += w.turn;
        const d = Math.hypot(w.x, w.z);
        if (d > 9) {
          const toCenter = Math.atan2(-w.z, -w.x);
          let diff = toCenter - w.heading;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          w.heading += diff * Math.min(1, (d - 9) / 10) * 0.35;
        }
        const step = SPEED * DT;
        w.x += Math.cos(w.heading) * step;
        w.z += Math.sin(w.heading) * step;
        w.sinceDrop += step;
        if (rng() < 0.006) w.pauseLeft = 1 + rng() * 3;
      }

      const c = cellKey(w.x, w.z);
      if (c !== w.cell) {
        w.cell = c;
        const s: StepRecord = { id: `${w.id}_${Math.floor(t * 1000)}_${c}`, c, t, o: w.id };
        if (store.addStep(s)) steps.push(s);
      }

      const due = w.sinceDrop >= DROP_DIST || w.idle >= DROP_IDLE;
      if (due && t - w.lastDrop >= DROP_MIN_GAP) drop(w, t);
    }
  }

  return { deposits, steps, span };
}

/**
 * Browser helper. `?demo=1` seeds localStorage once (when empty or the signature differs);
 * `?demo=reset` forces a re-seed. `?demo=<n>` uses n as the seed. Returns whether the page
 * is in demo mode. Safe to call on the server (returns false).
 */
export function seedDemoIfRequested(): boolean {
  if (typeof window === "undefined") return false;
  const q = new URLSearchParams(window.location.search).get("demo");
  if (q == null) return false;
  const seed = Number.isFinite(Number(q)) && q !== "1" ? Number(q) : 20261006;
  const sig = `demo:v2:${seed}`;
  const SIG_KEY = "anthropocene:demo-sig";
  try {
    if (q === "reset" || localStorage.getItem(SIG_KEY) !== sig || !localStorage.getItem(LS_DEPOSITS_KEY)) {
      const d = generateDemo({ seed });
      localStorage.setItem(LS_DEPOSITS_KEY, JSON.stringify(d.deposits));
      localStorage.setItem(LS_STEPS_KEY, JSON.stringify(d.steps));
    }
    // the clock is re-based on every load so "now" is always the end of the replay
    localStorage.setItem(LS_EPOCH_KEY, String(Date.now() - 900 * 1000));
    localStorage.setItem(SIG_KEY, sig);
  } catch {
    /* storage full / blocked: the views just stay empty */
  }
  return true;
}

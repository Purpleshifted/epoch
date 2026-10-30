import { it } from "vitest";
import { DEFAULT_BOXES, DEFAULT_FLOW, DEFAULT_FOLD, DEFAULT_FUSE, DEFAULT_WALK, DEFAULT_WATER, DEFAULT_WEATHER, SEAL_H, SpaceModel, botActor, botPlan, dueSamples, foldWorld, steerBot, type PEvent } from "./index";
it("probe", () => {
  const start = 1_800_000_000_000; const out: PEvent[] = []; let last = start - 1000;
  const fold = { ...DEFAULT_FOLD, flow: DEFAULT_FLOW };
  let ground: { level: Map<string, number>; built: Set<string> } | null = null; const routes = new Map<string, number[]>();
  const flock = { groups: 3, spread: 20 };
  for (let now = start; now <= start + 1200_000; now += 1000) { const due = dueSamples(last, now, 1000); if (due.length) last = due[due.length - 1];
    if ((now - start) % 5000 === 0) { const snap = foldWorld(out, (now - start) / 1000 + 60, fold); const level = new Map<string, number>(); for (const pc of snap.paths) level.set(pc.key, -DEFAULT_FLOW.unit * Math.log(1 - Math.min(0.999, pc.p))); const built = new Set<string>(); for (const sl of snap.slabs) if (sl.h >= SEAL_H) built.add(sl.key); ground = { level, built }; }
    for (const w of due) for (let i = 0; i < 13; i++) { let a = botActor(i, "worker", w, start, start, 60, flock);
      if (ground) { const g = ground; const [x, z] = steerBot(a.o, botPlan(i, w, start, start, 60, flock), { level: (k) => g.level.get(k) ?? 0, built: (k) => g.built.has(k) }, DEFAULT_FLOW, routes); a = { ...a, x, z }; }
      out.push({ id: `${a.o}:${w}`, o: a.o, r: a.r, k: "p", x: a.x, z: a.z, s: a.s }); } }
  const box = { ...DEFAULT_BOXES, secPerUnit: 20, width: 0.8, density: 1.4 };
  const lod = { camera: [0, 0, 0] as [number, number, number], near: 1e9, farFactor: 0.25 };
  const run = (label: string, wear: boolean, fuse: typeof DEFAULT_FUSE) => {
    const m = new SpaceModel(); m.add(out);
    const r = m.computeParts({ fold, box, wear, weather: DEFAULT_WEATHER, fuse, water: DEFAULT_WATER, walk: DEFAULT_WALK, edges: false, lod })!;
    const pts: number[][] = [];
    for (const [kind, mat] of Object.entries(r.matrices)) for (let i = 0; i < r.counts[kind as keyof typeof r.counts]; i++) pts.push([mat[i * 16 + 12], mat[i * 16 + 13], mat[i * 16 + 14]]);
    const walks = (m as unknown as { walks: { layers: { k: number; drawn: string[]; resurfaced: string[]; lines: Float32Array[] }[] } }).walks;
    let ends = 0, bare = 0; const bareAt: string[] = [];
    for (const l of walks.layers) for (const line of l.lines) for (const o of [0, line.length - 3]) {
      ends++;
      const [x, y, z] = [line[o], line[o + 1], line[o + 2]];
      const near = pts.some(([px, py, pz]) => Math.hypot(px - x, pz - z) < 1.8 && Math.abs(py - y) < box.unit * 1.0);
      const nearAny = pts.some(([px, py, pz]) => Math.hypot(px - x, pz - z) < 1.8 && Math.abs(py - y) < box.unit * 6);
      if (!near) { bare++; bareAt.push(`k${l.k} y${y.toFixed(1)} ${o === 0 ? "start" : "end"} ${nearAny ? "parts-near-other-slots" : "no-parts"} ${l.resurfaced.length ? "R" : ""}`); }
    }
    console.log(label, "walk layers", walks.layers.length, "ends", ends, "bare", bare, "\n  " + bareAt.join("\n  "));
  };
  run("as now (wear + fusion)", true, DEFAULT_FUSE);
  run("no wear", false, DEFAULT_FUSE);
}, 600_000);

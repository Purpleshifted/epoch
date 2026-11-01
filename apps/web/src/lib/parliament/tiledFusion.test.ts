import { expect, it } from "vitest";
import { DEFAULT_BOXES, DEFAULT_FOLD, DEFAULT_FUSE, DEFAULT_NATURE, DEFAULT_WATER, DEFAULT_WEATHER, SpaceModel } from "./index";
import { DEFAULT_STUDY } from "./fuse";
import { buildTestColumn } from "./testColumn";
import preset from "../../../presets/baseline-2026-11-01-local.json";

const P = "parliament.leva:/v2/global/space:";
const g = (name: string) => (preset as Record<string, Record<string, unknown>>)[P + name];
const fu = g("엉김 · 융합 · 레진") as Record<string, number & string & boolean>;
const wx = g("풍화 · 지층") as Record<string, number>;
const fr = g("생성 규칙 (회사원 시공간 밀집)") as Record<string, number>;

it("TILED FUSION: a wide world (moving flocks, the artist's local values) still gets its fused mass", () => {
  const box = { ...DEFAULT_BOXES, secPerUnit: 20, unit: 1.2, timeJitter: 0.35, width: 0.8, density: 1.4 };
  const weather = { ...DEFAULT_WEATHER, ...wx } as typeof DEFAULT_WEATHER;
  const fold = { ...DEFAULT_FOLD, ...fr, emptyGapSec: 20 } as typeof DEFAULT_FOLD;
  const study = { ...DEFAULT_STUDY, ...(fu as object) };
  const fuse = { ...DEFAULT_FUSE, ...(fu as object), enabled: true, accretion: 0, resinShare: -1, study } as unknown as typeof DEFAULT_FUSE;
  const all = buildTestColumn({ seconds: 1400, bots: 19, flock: { groups: 5, spread: 49, timeSpread: 110, stayMin: 3.5, character: 0.75, overlapSec: 60 } as never, sampleSec: 2 });
  all.sort((a, b) => a.s - b.s);
  const m = new SpaceModel();
  m.add(all);
  m.setNow(1400);
  const lod = { camera: [0, 0, 0] as [number, number, number], near: Infinity, mid: Infinity, farFactor: 1 };
  const kNow = Math.floor(1400 / 20);
  m.computeParts({ fold, box, wear: true, weather, fuse, water: DEFAULT_WATER, edges: false, lod, steady: true });
  m.computeNature({ fold, box, weather, fuse, nature: DEFAULT_NATURE, perSlot: 6, window: 120, focusK: kNow, margin: 5, budget: 600000, burialSlots: 9, lod, density: { cut: 0.25, fade: 25 } });
  let mesh = null;
  for (let i = 0; i < 6; i++) {
    m.computeParts({ fold, box, wear: true, weather, fuse, water: DEFAULT_WATER, edges: false, lod, steady: true });
    mesh = m.computeFuse({ box, weather, fuse, tauReclaimYears: 300, focusK: kNow, oneClock: true, tauSlabYears: fold.tauSlabYears, perCall: 12, bake: false }) ?? mesh;
  }
  const priv = m as unknown as { history: { nx: number; nz: number } | null; fuseChunks: Map<number, { mesh: { index: ArrayLike<number> } }> };
  const h = priv.history;
  const vs = fuse.voxel;
  const oldN = h ? Math.round(((h.nx * 1.2) / vs) * ((h.nz * 1.2) / vs) * ((10 * 1.2) / vs + 30)) : 0;
  const per = [...priv.fuseChunks.entries()].map(([c0, ch]) => `${c0}:${ch.mesh.index.length / 3}`).join(" ");
  // the whole ground in one grid would pass fuseChunk's limit (the empty mesh of 2026-11-01); tiled, the mass is there
  expect(oldN).toBeGreaterThan(6e6);
  expect(mesh ? mesh.index.length / 3 : 0).toBeGreaterThan(10000);
  void per;
}, 1_800_000);

it("PER-CHUNK OUTPUT: only the chunks that changed are handed out, and the set adds up to the merged mass", () => {
  const all = buildTestColumn({ seconds: 600, bots: 8, flock: { groups: 2, spread: 10, timeSpread: 60 }, sampleSec: 2 });
  all.sort((a, b) => a.s - b.s);
  const m = new SpaceModel();
  m.add(all);
  m.setNow(900);
  const box = { ...DEFAULT_BOXES };
  const weather = { ...DEFAULT_WEATHER, timeScale: 0.5, gatherStart: 0, rotDose: 0 };
  const lod = { camera: [0, 0, 0] as [number, number, number], near: Infinity, mid: Infinity, farFactor: 1 };
  const input = { box, weather, fuse: DEFAULT_FUSE, tauReclaimYears: 300, oneClock: true, tauSlabYears: DEFAULT_FOLD.tauSlabYears, perCall: 99, bake: false };
  m.computeParts({ fold: DEFAULT_FOLD, box, wear: true, weather, fuse: DEFAULT_FUSE, water: DEFAULT_WATER, edges: false, lod });
  const merged = m.computeFuse(input);
  m.computeParts({ fold: DEFAULT_FOLD, box, wear: true, weather, fuse: DEFAULT_FUSE, water: DEFAULT_WATER, edges: false, lod });
  m.computeFuse({ ...input, chunked: true, perCall: 99, rebake: true } as never);
  const d1 = m.fuseDelta();
  expect(d1).not.toBeNull();
  const tris = d1!.set.reduce((n, c) => n + c.mesh.index.length / 3, 0);
  expect(tris).toBe(merged ? merged.index.length / 3 : 0);
  // nothing changed since: nothing to hand out
  expect(m.fuseDelta()).toBeNull();
}, 1_800_000);

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
  m.computeNature({ fold, box, nature: DEFAULT_NATURE, window: 120, focusK: kNow, margin: 5 });
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

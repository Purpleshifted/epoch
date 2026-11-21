/**
 * parliament/water.ts
 *
 * WATER as what the ground can no longer take: rain runs off where people sealed it (buildings, paved paths) —
 * the rational method's Q = C · i · A, with C ≈ 0.9 on roofs and paving and ≈ 0.1 on vegetation — and urban
 * streams respond to the SEALED SHARE of their surroundings (the Impervious Cover Model: impacted from ~10 %, past
 * ~25 % buried in pipes; "urban stream burial").
 *
 *   CHANGES      the drainage is laid anew when the quarter CHANGES (a building comes into use or leaves, a quarter
 *                gets dense enough to pipe, or the sealed ground changes by `change`), at most every `minGapSlots` —
 *                so the layers of pipes differ where something happened, not at a fixed beat
 *   SEALED       a cell is sealed at t when a building stands on it (its seed was born by t) or a path is paved on
 *                it (path strength ≥ `pathAt`, flow.ts); its SEALED SHARE is the sealed fraction within
 *                `imperviousRadius` cells
 *   SOURCES      every building in use at t (used within `persistSec`) sheds its runoff (its area), from the edge of
 *                its block
 *   NETWORK      dense buildings within `quarterGap` of each other form a QUARTER with one sewer network: a TRUNK
 *                from the quarter's nearest building to the outfall, then LATERALS from every other building to the
 *                network (nearest to the outfall first) — so the pipes join the buildings into one tree
 *   ROUTE        a route drains to the nearest OPEN ground (trunk) or to the network (laterals) (sealed share < `openShare`, not sealed): the cheapest
 *                way over the grid — along the paths (sewers run under streets), joining the pipes already laid,
 *                never through a building that stands (past buildings are gone round). Right angles only, or 45°
 *                too (`diagonal`); straight runs, bends at the cells where the direction changes. (2026-11-20) A bend
 *                costs PIPE_TURN steps, a pipe leaves a building straight out of the middle of a face and comes down
 *                that face from its foot (a DROP), goes round what stands at the height it lies at, joins the network
 *                only where it runs straight, and comes up at its outfall to the ground its stream runs on
 *   PIPE / OPEN  a building in a sealed quarter (the mean sealed share over its cells ≥ `burial`) drains through a
 *                PIPE all the way to the outlet (a storm sewer and its outfall): buried, drawn as straight grey
 *                conduits — the whole network each time it is laid, a little below that slot (`pipeDepth`: buried
 *                under the ground of its present), so the layers show the sewers of their time beside their
 *                buildings and keep them (a technofossil). From the outfall — or right
 *                from its edge, for a building in open land — the water runs as an OPEN stream (a clear channel in
 *                the vegetation, lined with wetland) for `streamLength` before it soaks away
 *   SIZE         a pipe's or stream's flow is the runoff of everything upstream: trunks thicker than branches
 *   IN USE       a new network reuses the pipes of the one in use (their cells keep their pipe and height; only the
 *                stretches that leave them are drawn, joined by MANHOLE shafts) — but only pipes laid within `reach`
 *                slots (older ones are past: nothing joins them, a network there is laid anew) and out of use for at
 *                most `grace`. RE-LAYING: a network in use older than `relay` is laid again (as the walkways are
 *                re-surfaced, walkways.ts), so a long-used sewer stays in time as networks stacked at that interval.
 *
 * The open water is not drawn itself: its course is a channel in the vegetation (no points within `channel`/2),
 * lined with WETLAND vegetation (waterField → natureHistory.waterBoost, waterDistance → naturePoints.water), and
 * parts near it corrode faster (WearConfig.water). Pure and deterministic.
 */

import { CELL_SIZE } from "@/lib/stratum/field";
import { cellKey, flowP, flowTracks, stayShares, type FlowConfig, type Track } from "./flow";
import { hash2 } from "./nature";
import type { Seed } from "./seeds";
import type { PEvent } from "./types";
import { nearestOnBorder, villageBorders, type Border } from "./villageBorders";
import { wrapDist } from "./world";

export interface WaterConfig {
  enabled: boolean;
  /** Seeds within this many cells belong to the same building. */
  join: number;
  /** The drainage is laid anew when the sealed ground changed by this share of itself (or a building came or went,
   * or a quarter got dense enough to pipe or no longer is). */
  change: number;
  /** …but not more often than every this many slots. */
  minGapSlots: number;
  /** Pipes are buried: they lie this many slots below the slot they were laid in (deeper = older ground). */
  pipeDepth: number;
  /** Cells around a cell over which its sealed share is taken. */
  imperviousRadius: number;
  /** Sealed share from which water runs in a pipe. */
  burial: number;
  /** Sealed share below which the ground takes the water again (an outlet). */
  openShare: number;
  /** Path strength from which a path counts as paved (sealed). */
  pathAt: number;
  /** 0 = right angles only; > 0 = 45° steps allowed, costing 1 + (1 − diagonal) more. */
  diagonal: number;
  /** World length an open stream runs on beyond its outlet. */
  streamLength: number;
  /** A POOL WHERE A STREAM ENDS (the artist, 2026-11-18: "물길 가닥 끝부분에는 웅덩이가 생기도록 — 지금은 한 가닥으로 그냥
   *  끝나서"): where a stream soaks away it spreads into a pool of this radius (world) — drawn as rings round its end,
   *  so its channel in the vegetation is a round clearing. 0 = none. */
  endPool?: number;
  /** THE BED REMEMBERS (the artist, 2026-11-18: "물줄기는 알고리즘상으로 손볼 방법 없는지?" — the water jumped to a new
   *  course whenever its network was laid anew): an open stream laid anew keeps to the bed the water ran in before,
   *  as water does (a channel cut into the ground draws the flow back into it, and a stream leaves it — avulsion —
   *  only where it is blocked). 0 = every course found afresh; 1 = held hard to the old bed. */
  bed?: number;
  /** How many slots a bed no longer used is still remembered (it silts up). */
  bedSlots?: number;
  /** Seconds a building keeps shedding water after it was last used. */
  persistSec: number;
  /** How far an open stream bends sideways (× cell). */
  meander: number;
  /** Width of the clear channel an open stream keeps in the vegetation (world). */
  channel: number;
  /** Reach of an open stream's influence on vegetation and parts (world). */
  radius: number;
  /** Vegetation density added right at the water (fades to 0 at `radius`). */
  vegBoost: number;
  /** Share of the vegetation at the water that is wetland (coloured as such), fading to 0 at `radius`. */
  wetShare: number;
  /** Parts at the open water age × (1 + corrode) while exposed (fades with distance). */
  corrode: number;
  /** Radius (world) of a pipe carrying one building's runoff; × √(flow / that). */
  pipeRadius: number;
  /** Dense buildings within this distance (world) share one sewer network and outfall (a quarter). */
  quarterGap: number;
  /**
   * PIPES IN VILLAGES ONLY (the artist, 2026-11-15: "배관은 마을 안에서만 생겨야 하지 않나?"): the bots' village sites
   * ([x, z, from s, to s, its own radius], lifecycle.ts villageSites) and the radius of those without one. A dense building belongs to the village alive
   * at its slot whose middle is nearest, within 1.5 radii; quarters are made inside each village only (never across
   * two), and a building in no village gets no pipe — its water runs off in the open. Absent = as before.
   */
  villages?: { sites: ([number, number, number, number] | [number, number, number, number, number])[]; radius: number };
  /** How far back (slots) a new network may reuse the pipes below (and join them by manholes); 0 = the present
   *  thickness (DrainageOptions.present). Older pipes are past: a network there is laid anew. */
  reach: number;
  /** A pipe out of the network for at most this many slots is still in use; longer, it is gone for good. */
  grace: number;
  /** RE-LAYING: a network in use whose pipes are older than this (slots; 0 = `reach`) is laid again; off when < 0. */
  relay: number;
  /** An elbow's centreline radius, × the pipe radius (1 = as tight as the pipe allows; bigger = a softer bend). */
  elbow: number;
  /** How much a pipe thickens as water collects: radius × flow^flowGain (0 = all the same, 0.5 = √). */
  flowGain: number;
  /** A manhole shaft's radius, × pipeRadius; its cover's radius × the shaft's and height × the shaft's radius. */
  shaftRadius: number;
  coverRadius: number;
  coverHeight: number;
  /** A collar's (tee fitting's) radius × the pipe's, and its half-length × the pipe's radius. */
  collarRadius: number;
  collarLength: number;
  /** CORROSION: the pipes' life × the steel life of the parts (1 = as bare steel); ≤ 0 = pipes do not corrode. */
  pipeLife: number;
  /** How much of its radius a pipe loses as it decays fully (the wall thins before the holes take it). */
  thin: number;
  /**
   * THE BLOCK, CALMER (the artist, 2026-11-15: "배관도 너무 복잡하게 얽히는데"): a building of fewer cells than this
   * (in the slot) sheds no water — a speck beside a quarter gets no lateral of its own. 0 / absent = every building.
   */
  minCells?: number;
  /**
   * HOW MUCH A PIPE KEEPS UNDER THE PATHS (the artist, 2026-11-15: "배관이 거의 길 따라가는데"). A route has always
   * been cheaper under a path (sewers run under streets: a step there costs 0.3 of a step over open ground) — so
   * where there are paths the pipes are drawn right under them and read as the same lines again. 1 / absent = that
   * (as it was); 0 = a path is no cheaper than any ground: the pipes go their own shortest way to the outfall.
   * BELOW 0 THE PIPES KEEP AWAY FROM THE PATHS (the artist, 2026-11-15: "길이랑 배관 로직 아예 별개로 가져가고 싶음.
   * 지금은 거의 그냥 길 아래에 배관이 생김"): at 0 they still ran under the paths — both join the same houses by the
   * shortest line. At −1 a step on a path costs PATH_AVOID times a step over open ground, and a step right beside
   * one half of that: a pipe crosses a path where it must and never runs along one; it goes round the back of the
   * houses and through the open middle instead. In between: that much of it.
   */
  pathPull?: number;
}

export const DEFAULT_WATER: WaterConfig = {
  enabled: true,
  join: 1,
  change: 0.15,
  minGapSlots: 2,
  pipeDepth: 1.5,
  imperviousRadius: 3,
  burial: 0.25,
  openShare: 0.1,
  pathAt: 0.35,
  diagonal: 0,
  streamLength: 8,
  endPool: 1.2,
  bed: 0.7,
  bedSlots: 30,
  persistSec: 300,
  meander: 0.18,
  channel: 0.9,
  radius: 2.5,
  vegBoost: 1,
  wetShare: 1,
  corrode: 1.5,
  pipeRadius: 0.035,
  quarterGap: 40,
  reach: 0,
  grace: 3,
  relay: 0,
  elbow: 1,
  flowGain: 0.5,
  shaftRadius: 1.6,
  coverRadius: 1.6,
  coverHeight: 0.4,
  collarRadius: 1.35,
  collarLength: 1.1,
  pipeLife: 1,
  thin: 0.35,
};

export interface Building {
  id: number;
  seeds: Seed[];
  /** First birth and last use of its seeds (exhibition seconds). */
  t0: number;
  lastS: number;
}

/** Seeds grouped into buildings: those within `join` cells of each other (union–find). */
export function buildingsOf(seeds: readonly Seed[], cfg: Pick<WaterConfig, "join">): Building[] {
  const cellOf = (s: Seed) => [Math.floor(s.x / CELL_SIZE), Math.floor(s.z / CELL_SIZE)] as const;
  const parent = seeds.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const at = new Map<string, number[]>();
  seeds.forEach((s, i) => {
    const [cx, cz] = cellOf(s);
    const key = cellKey(cx, cz);
    const l = at.get(key);
    if (l) l.push(i);
    else at.set(key, [i]);
  });
  const J = Math.max(1, Math.round(cfg.join));
  seeds.forEach((s, i) => {
    const [cx, cz] = cellOf(s);
    for (let dx = -J; dx <= J; dx++) {
      for (let dz = -J; dz <= J; dz++) {
        for (const j of at.get(cellKey(cx + dx, cz + dz)) ?? []) {
          const a = find(i), b = find(j);
          if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        }
      }
    }
  });
  const groups = new Map<number, Seed[]>();
  seeds.forEach((s, i) => {
    const r = find(i);
    const l = groups.get(r);
    if (l) l.push(s);
    else groups.set(r, [s]);
  });
  const out: Building[] = [];
  for (const list of groups.values()) {
    out.push({ id: Math.min(...list.map((s) => s.id)), seeds: list, t0: Math.min(...list.map((s) => s.t0)), lastS: Math.max(...list.map((s) => s.t1)) });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** A pipe run: straight from a to b (world x, z), laid in slot k, carrying `flow` (buildings' runoff, in cells). */
export interface PipeRun {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  k: number;
  flow: number;
  /** A RISER (a manhole shaft): vertical at (ax, az) from the network laid in slot k0 up to the one laid in k. */
  k0?: number;
  /**
   * A DROP (2026-11-20, "억지스러운 연결부나 건물과의 상대 포지셔닝"): vertical at (ax, az) from the network laid in slot k
   * (buried `pipeDepth` below it) up to the ground of slot k (y = k × unit) — where a building's water comes down the
   * face it leaves from into its pipe, and where the sewer comes up at its outfall to the ground its stream runs on.
   * So no pipe begins or ends in the air below the thing it serves.
   */
  drop?: true;
  /** The route (trunk or lateral) this run belongs to, and its place along it: runs of one route join end to end. */
  route?: number;
  seq?: number;
}

/** The water of the whole history. */
export interface Drainage {
  /** Open streams per slot: their courses (polylines [x, z, …] in world). */
  streams: Map<number, Float32Array[]>;
  /** Every pipe run, at the slot it was laid. */
  pipes: PipeRun[];
}

export const NO_DRAINAGE: Drainage = { streams: new Map(), pipes: [] };

export interface DrainageOptions {
  secPerUnit: number;
  /** How stays are told from moves when paths are read from the movement (flow.ts). */
  flow: FlowConfig;
  /** Present (exhibition seconds): the last epoch ends here. */
  tNow: number;
  /**
   * What was laid before and must not change: its pipes and streams up to slot `upToK` are kept as they are (only
   * later layers are laid by this call, joining the kept pipes).
   */
  frozen?: { pipes: readonly PipeRun[]; streams: ReadonlyMap<number, Float32Array[]>; upToK: number };
  /** The present thickness (slots): `reach` = 0 means this (default 18). */
  present?: number;
  /**
   * THE BLOCK (the redesign's wall, density.ts: one fixed piece of spacetime; the artist, 2026-11-15: "배관 먼저").
   * A building is not something that is born and then stands for good: it is the cell-slots that are built. So the
   * ground is read per slot from what STANDS IN THAT SLOT — a cell is sealed in slot k when its seed has a span
   * there, and a building sheds water in slot k when some of its cells stand in it (with those cells only;
   * `persistSec` is not read: a building that is not there sheds nothing). The slots run from the lowest to the
   * highest one built, whatever the clock says (`tNow` is not read), and the whole is laid again at every call —
   * anybody may write at any depth, so nothing is `frozen`.
   */
  block?: boolean;
}

/** The slots a seed stands in, as [first, last] runs (its spans; one span t0 … t1 when it has none). */
function slotRuns(s: Seed, spu: number): [number, number][] {
  const spans = s.spans && s.spans.length ? s.spans : [[s.t0, s.t1] as [number, number]];
  return spans.map(([a, b]) => [Math.floor(Math.max(a, s.t0) / spu), Math.floor(Math.min(b, s.t1) / spu)] as [number, number]);
}

/** Cells of room around everything (sources, buildings) in which routes may run. */
const MARGIN = 10;
/** Walking costs over the grid: under a path, along an existing pipe, elsewhere. */
const COST_PATH = 0.3;
const COST_PIPE = 0.12;
const COST_GROUND = 1;
/** WaterConfig.pathPull −1: a step on a path costs this many steps over open ground (beside one: half of it). */
const PATH_AVOID = 6;
/**
 * A BEND COSTS (2026-11-20, "억지스러운 연결부"): turning a pipe through a right angle costs as much as this many steps
 * over open ground (45° in proportion; turning back is never allowed). On the bare grid every staircase of one-cell
 * steps was as short as one L, and the heap's order picked among them — so a route came out as elbow after elbow a cell
 * apart, and a jog round a corner as a dogleg. Now a route bends only where bending saves more than this.
 */
const PIPE_TURN = 3;

/**
 * The drainage of the history: per epoch, the sealed ground, each source's route to open ground (cheapest over the
 * grid, along paths and existing pipes, round standing buildings), split into PIPE runs (sealed share ≥ burial) and
 * OPEN streams (the rest, and `streamLength` beyond the outlet). Pipes, once laid, stay (they are reused and cheap).
 */
export function drainage(events: readonly PEvent[], seeds: readonly Seed[], cfg: WaterConfig, opts: DrainageOptions): Drainage {
  if (!cfg.enabled || !seeds.length) return NO_DRAINAGE;
  const spu = opts.secPerUnit;
  // paths from the movement (the same rule for V1 and V2: water reads paths, it does not make them)
  const pres = events.filter((e) => e.r === "worker" && e.k === "p");
  pres.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const tracks: Map<string, Track> = pres.length ? flowTracks(pres, stayShares(pres, opts.flow)) : new Map();

  // the grid: everything any building touches, with margin
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of seeds) {
    const cx = Math.floor(s.x / CELL_SIZE), cz = Math.floor(s.z / CELL_SIZE);
    minX = Math.min(minX, cx);
    maxX = Math.max(maxX, cx);
    minZ = Math.min(minZ, cz);
    maxZ = Math.max(maxZ, cz);
  }
  const x0 = minX - MARGIN, z0 = minZ - MARGIN;
  const nx = maxX - minX + 1 + 2 * MARGIN, nz = maxZ - minZ + 1 + 2 * MARGIN;
  const n = nx * nz;
  const idx = (cx: number, cz: number) => (cz - z0) * nx + (cx - x0);
  const centre = (c: number): [number, number] => [(x0 + (c % nx) + 0.5) * CELL_SIZE, (z0 + Math.floor(c / nx) + 0.5) * CELL_SIZE];

  const buildings = buildingsOf(seeds, cfg);
  // THE BLOCK: what stands in a slot (a seed's runs of slots, worked out once)
  const inBlock = !!opts.block;
  const runsOf = new Map<Seed, [number, number][]>();
  if (inBlock) for (const s of seeds) runsOf.set(s, slotRuns(s, spu));
  const stands = (s: Seed, k: number): boolean => {
    for (const [a, b] of runsOf.get(s)!) if (a <= k && k <= b) return true;
    return false;
  };
  const piped = new Uint8Array(n); // cells a pipe has been laid through (persist)
  const inGrid = (cx: number, cz: number) => cx >= x0 && cz >= z0 && cx < x0 + nx && cz < z0 + nz;
  // the kept pipes are there already: new routes join them
  for (const p of opts.frozen?.pipes ?? []) {
    const steps = Math.max(1, Math.round(Math.hypot(p.bx - p.ax, p.bz - p.az) / CELL_SIZE));
    for (let i = 0; i <= steps; i++) {
      const cx = Math.floor((p.ax + ((p.bx - p.ax) * i) / steps) / CELL_SIZE), cz = Math.floor((p.az + ((p.bz - p.az) * i) / steps) / CELL_SIZE);
      if (inGrid(cx, cz)) piped[idx(cx, cz)] = 1;
    }
  }
  // the pipes in use (cell → the slot its pipe was laid in, the last slot it was in use): a new network reuses them
  // and joins them by manhole shafts — only those laid within `reach` and out of use for at most `grace`
  let lastNet = new Map<number, { k: number; seen: number }>();
  let usedK = -Infinity; // the last slot the network laid last was in use (some building shed water)
  let netK = -Infinity; // the slot the network in use was laid (its cells are seen then; kept ones earlier)
  const reach = cfg.reach > 0 ? cfg.reach : (opts.present ?? 18);
  const grace = Math.max(0, cfg.grace);
  const relayEvery = cfg.relay < 0 ? 0 : cfg.relay > 0 ? cfg.relay : reach;
  let routeSeq = (opts.frozen?.pipes ?? []).reduce((m, p) => Math.max(m, (p.route ?? -1) + 1), 0);

  const streams = new Map<number, Float32Array[]>();
  const pipes: PipeRun[] = [];

  const kFirst = Math.floor(Math.min(...buildings.map((b) => b.t0)) / spu);
  // (the block is read as high as it is built, not up to the clock)
  const kLast = inBlock ? Math.floor(Math.max(...buildings.map((b) => b.lastS)) / spu) : Math.floor(opts.tNow / spu);
  // paths, read slot by slot: each track's decayed sum carried forward (one pass over its treads)
  const trackList = [...tracks].filter(([key]) => {
    const [cx, cz] = key.split(",").map(Number);
    return cx >= x0 && cz >= z0 && cx < x0 + nx && cz < z0 + nz;
  });
  const trackCell = trackList.map(([key]) => {
    const [cx, cz] = key.split(",").map(Number);
    return idx(cx, cz);
  });
  const tGc = new Float64Array(trackList.length), tGq = new Float64Array(trackList.length), tAt = new Float64Array(trackList.length), tNext = new Int32Array(trackList.length);
  const tau = opts.flow.tauSec;
  // the state the network was last laid for (laid anew only when it changes enough)
  let laidSealed: Uint8Array | null = null;
  // (one set of buffers for every slot: the block is read over a few hundred slots at every call)
  const sealed = new Uint8Array(n), path = new Uint8Array(n), laidBuf = new Uint8Array(n);
  const block = new Int32Array(n); // building on the cell (impassable)
  // (the pipes: what stands at the height they lie at and on the way up to the slot they serve; the cells this slot's
  // networks already run through)
  const pipeBlockBuf = inBlock ? new Int32Array(n) : block, taken = new Uint8Array(n);
  const sat = new Float64Array((nx + 1) * (nz + 1));
  const share = new Float32Array(n);
  let laidDense = "";
  let laidIds = new Set<number>();
  let laidK = -Infinity;
  let courses: Float32Array[] = [];
  // THE BED: the last slot each cell carried an open stream (WaterConfig.bed) — how strongly it still draws the water,
  // 1 just used … 0 after bedSlots
  const bedLast = new Float64Array(n).fill(-Infinity);
  const bedW = Math.max(0, Math.min(1, cfg.bed ?? 0)), bedSlots = Math.max(1, cfg.bedSlots ?? 30);
  let bedK = 0;
  const bedAt = (c: number): number => (bedW > 0 ? bedW * Math.max(0, 1 - (bedK - bedLast[c]) / bedSlots) : 0);
  // (the cells the courses in use run through: marked as the bed up to the slot they are laid anew)
  let courseCells: number[] = [];
  const bed: CourseBed = { at: bedAt, cells: [] };
  // THE BORDERS between the villages alive in slot k (villageBorders.ts), the same for every slot with the same villages
  const borderCache = new Map<string, Border[]>();
  const groundR = cfg.villages ? Math.max(1, ...cfg.villages.sites.map((q) => Math.hypot(q[0], q[1]) + Math.max(1, q[4] ?? cfg.villages!.radius) * 1.3)) : 0;
  const bordersAt = (k: number): Border[] => {
    const vs = cfg.villages;
    if (!vs) return [];
    const tm = (k + 0.5) * spu;
    const alive: { i: number; x: number; z: number }[] = [];
    vs.sites.forEach((q, i) => q[2] <= tm && tm < q[3] && alive.push({ i, x: q[0], z: q[1] }));
    const key = alive.map((a) => a.i).join(",");
    let bs = borderCache.get(key);
    if (!bs) borderCache.set(key, (bs = alive.length >= 2 ? villageBorders(alive, groundR) : []));
    return bs;
  };
  for (let k = kFirst; k <= kLast; k++) {
    const t = k * spu;
    // sealed ground at t: standing buildings and paved paths
    sealed.fill(0);
    block.fill(-1);
    for (const b of buildings) {
      for (const s of b.seeds) {
        if (inBlock ? !stands(s, k) : s.t0 > t) continue;
        const c = idx(Math.floor(s.x / CELL_SIZE), Math.floor(s.z / CELL_SIZE));
        sealed[c] = 1;
        block[c] = b.id;
      }
    }
    path.fill(0);
    for (let i = 0; i < trackList.length; i++) {
      const tr = trackList[i][1];
      const dec = Math.exp(-(t - tAt[i]) / tau);
      tGc[i] *= dec;
      tGq[i] *= dec;
      tAt[i] = t;
      while (tNext[i] < tr.s.length && tr.s[tNext[i]] <= t) {
        const j = tNext[i]++;
        const w = tr.a[j] * Math.exp(-(t - tr.s[j]) / tau);
        tGc[i] += w * tr.c[j];
        tGq[i] += w * tr.q[j];
      }
      if (flowP(Math.hypot(tGc[i], tGq[i]), opts.flow) >= cfg.pathAt) {
        path[trackCell[i]] = 1;
        sealed[trackCell[i]] = 1;
      }
    }
    // sealed share (box sum over the radius, via a summed-area table)
    const R = Math.max(1, Math.round(cfg.imperviousRadius));
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) sat[(j + 1) * (nx + 1) + i + 1] = sealed[j * nx + i] + sat[j * (nx + 1) + i + 1] + sat[(j + 1) * (nx + 1) + i] - sat[j * (nx + 1) + i];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = Math.max(0, i - R), b = Math.min(nx - 1, i + R), c = Math.max(0, j - R), d = Math.min(nz - 1, j + R);
      const sum = sat[(d + 1) * (nx + 1) + b + 1] - sat[c * (nx + 1) + b + 1] - sat[(d + 1) * (nx + 1) + a] + sat[c * (nx + 1) + a];
      share[j * nx + i] = sum / ((b - a + 1) * (d - c + 1));
    }
    // sources: buildings in use
    // (the block: a building is, in this slot, the cells of it that stand here — and it is a source only if some do)
    const live = (
      inBlock
        ? buildings.map((b) => ({ ...b, seeds: b.seeds.filter((s) => stands(s, k)) })).filter((b) => b.seeds.length > 0)
        : buildings.filter((b) => b.t0 <= t && b.lastS + cfg.persistSec >= t)
    )
      .filter((b) => b.seeds.length >= (cfg.minCells ?? 0))
      .sort((p, q) => q.seeds.length - p.seeds.length || p.id - q.id);
    if (!live.length) {
      courses = [];
      continue;
    }
    usedK = k;
    const isOpen = (c: number) => !sealed[c] && share[c] < cfg.openShare;
    const meanShare = (b: Building) => b.seeds.reduce((a, s) => a + share[idx(Math.floor(s.x / CELL_SIZE), Math.floor(s.z / CELL_SIZE))], 0) / b.seeds.length;
    let dense = live.filter((b) => meanShare(b) >= cfg.burial);
    const sparse = live.filter((b) => meanShare(b) < cfg.burial);
    // VILLAGES: which village each building is in (at this slot); a dense one outside every village gets no pipe
    const villageOfB = new Map<number, number>();
    const vs = cfg.villages;
    const tMid = (k + 0.5) * spu;
    const aliveSite = (i: number) => !!vs && vs.sites[i][2] <= tMid && tMid < vs.sites[i][3];
    if (vs) {
      for (const b of live) {
        const cx = b.seeds.reduce((a, q) => a + q.x, 0) / b.seeds.length, cz = b.seeds.reduce((a, q) => a + q.z, 0) / b.seeds.length;
        // (the nearest by distance over its own reach: 1.5 of its radius)
        let best = -1, bd = 1;
        vs.sites.forEach((q, i) => {
          if (!aliveSite(i)) return;
          const d = wrapDist(cx, cz, q[0], q[1]) / (Math.max(1, q[4] ?? vs.radius) * 1.5);
          if (d <= bd) [best, bd] = [i, d];
        });
        if (best >= 0) villageOfB.set(b.id, best);
      }
      dense = dense.filter((b) => {
        if (villageOfB.has(b.id)) return true;
        sparse.push(b);
        return false;
      });
    }
    // CHANGE: laid anew only when the quarter changed — a building came into use or left, a quarter got dense
    // enough to pipe (or no longer is), or the sealed ground changed by `change` of itself — and not more often
    // than every `minGapSlots`; between changes the last network stands and its streams keep running
    const denseKey = dense.map((b) => b.id).join(",") + "|" + sparse.map((b) => b.id).join(",");
    let diff = 0, tot = 0;
    for (let c = 0; c < n; c++) {
      tot += sealed[c];
      // (the block: only ground newly sealed counts — a network laid for more ground than there is now still serves)
      if (laidSealed && laidSealed[c] !== sealed[c] && (!inBlock || sealed[c])) diff++;
    }
    // RE-LAYING: the network in use has grown older than `relay` (a sewer relaid in its time)
    let stale = false;
    if (relayEvery > 0) for (const v of lastNet.values()) if (v.seen === netK && k - v.k >= relayEvery) stale = true;
    // (THE BLOCK, CALMER: buildings come and go slot by slot there — a network is laid anew for a building that was
    // not in it, not for one that left: its lateral is just no longer used)
    let arrived = false;
    if (inBlock) {
      for (const b of dense) if (!laidIds.has(b.id)) arrived = true;
    }
    const changed = !laidSealed || (inBlock ? arrived : denseKey !== laidDense) || diff / Math.max(1, tot) >= cfg.change || stale;
    if (!changed || k - laidK < cfg.minGapSlots) {
      if (courses.length) streams.set(k, courses);
      continue;
    }
    // (the courses in use until now are the bed the new ones are laid by)
    for (const c of courseCells) bedLast[c] = k - 1;
    bedK = k;
    bed.cells = [];
    laidBuf.set(sealed);
    laidSealed = laidBuf;
    laidDense = denseKey;
    laidIds = new Set(dense.map((b) => b.id));
    laidK = k;
    const e = k;
    courses = [];
    const pipeEdges = new Set<string>(); // this epoch's runs "a>b" (cell indices), each drawn once
    // the old network still reusable: in use until lately (the last one until `usedK`), laid within `reach`, and
    // younger than `relay`
    for (const v of lastNet.values()) if (v.seen === netK) v.seen = Math.max(v.seen, Math.min(usedK, e));
    const oldK = new Map<number, number>();
    for (const [c, v] of lastNet) if (e - v.seen <= grace && e - v.k <= reach && (relayEvery <= 0 || e - v.k < relayEvery)) oldK.set(c, v.k);
    const net = new Map<number, { k: number; seen: number }>();
    const risen = new Set<number>();

    // QUARTERS: dense buildings near each other share one sewer network and one outfall
    // (in villages: quarters inside each village only)
    const outfallOf = new Map<number, number>(); // village → the cell its water comes out at
    const groups = new Map<number, Building[]>();
    for (const b of dense) {
      const g = villageOfB.get(b.id) ?? -1;
      const l = groups.get(g);
      if (l) l.push(b);
      else groups.set(g, [b]);
    }
    // WHERE A PIPE CAN LIE (2026-11-20, "건물과의 상대 포지셔닝"): a network laid in slot e lies `pipeDepth` slots below
    // it — in the block that is among the buildings of THOSE slots, and its drops rise through the slots between to the
    // building's foot. It was routed round the buildings of slot e only, and so ran through the buildings standing
    // where it was drawn. Now it goes round every cell built in any slot from the one it lies in up to e.
    let pipeBlock = block;
    if (inBlock) {
      pipeBlock = pipeBlockBuf;
      pipeBlock.fill(-1);
      const lo = Math.floor(e - Math.max(0, cfg.pipeDepth) - 0.25);
      for (const b of buildings) {
        for (const s of b.seeds) {
          for (const [a, z] of runsOf.get(s)!) {
            if (a <= e && z >= lo) {
              pipeBlock[idx(Math.floor(s.x / CELL_SIZE), Math.floor(s.z / CELL_SIZE))] = b.id;
              break;
            }
          }
        }
      }
    }
    // (THE NETWORKS DO NOT RUN THROUGH EACH OTHER: a cell a network of this slot runs through is closed to every other
    // route — a lateral may only end on it, where it joins)
    taken.fill(0);
    for (const quarter of [...groups.values()].flatMap((g) => quartersOf(g, cfg.quarterGap))) {
      const down = new Int32Array(n).fill(-2); // network: the next cell towards the outfall (−1 = the outfall)
      const inNet = (c: number) => down[c] !== -2;
      // JOINS ONLY WHERE THE NETWORK RUNS STRAIGHT (2026-11-20, "억지스러운 연결부"): a lateral used to end on the first
      // network cell it met — a building's entry, the outfall, the corner of an elbow, or the very cell another lateral
      // had joined at — and there the fittings piled into a knot. Those cells are no place to join (unless nothing else
      // can be reached).
      const knot = new Uint8Array(n);
      const markKnots = (cells: number[]) => {
        knot[cells[0]] = 1;
        knot[cells[cells.length - 1]] = 1;
        for (let i = 1; i + 1 < cells.length; i++) if (!straightAt(cells, i, nx)) knot[cells[i]] = 1;
        for (const c of cells) taken[c] = 1;
      };
      const routes: { cells: number[]; back: number; mouth: boolean }[] = [];
      const entry = new Map<number, number>(); // building → the cell its water enters the network at
      // the trunk: from the quarter's nearest building edge to open ground
      const trunk = routeOut(quarter, pipeBlock, path, piped, nx, nz, idx, cfg, isOpen, taken);
      if (!trunk) continue;
      // the sewer ends at the edge of the sealed quarter (its OUTFALL: the last cell still sealed to `burial`, one
      // past it); from there the water runs on in the open — a pipe does not run out across open ground
      let cut = 0;
      for (let i = 0; i < trunk.cells.length; i++) if (share[trunk.cells[i]] >= cfg.burial) cut = i;
      trunk.cells = trunk.cells.slice(0, Math.min(trunk.cells.length, cut + 2));
      for (let i = 0; i < trunk.cells.length; i++) down[trunk.cells[i]] = i + 1 < trunk.cells.length ? trunk.cells[i + 1] : -1;
      routes.push({ cells: trunk.cells, back: trunk.back, mouth: true });
      markKnots(trunk.cells);
      entry.set(trunk.from, trunk.cells[0]);
      // laterals: every other building to the network, nearest to the outfall first
      const [ox, oz] = centre(trunk.cells[trunk.cells.length - 1]);
      const rest = quarter
        .filter((b) => b.id !== trunk.from)
        .map((b) => ({ b, d: Math.min(...b.seeds.map((s) => Math.hypot(s.x - ox, s.z - oz))) }))
        .sort((p, q) => p.d - q.d || p.b.id - q.b.id);
      for (const { b } of rest) {
        const lat = routeOut([b], pipeBlock, path, piped, nx, nz, idx, cfg, (c) => inNet(c) && !knot[c], taken) ?? routeOut([b], pipeBlock, path, piped, nx, nz, idx, cfg, inNet, taken);
        if (!lat) continue;
        for (let i = 0; i + 1 < lat.cells.length; i++) down[lat.cells[i]] = lat.cells[i + 1];
        routes.push({ cells: lat.cells, back: lat.back, mouth: false });
        markKnots(lat.cells);
        entry.set(b.id, lat.cells[0]);
      }
      // flow: every building's runoff, down the network to the outfall
      const flowAt = new Float32Array(n);
      for (const b of quarter) {
        let c = entry.get(b.id) ?? -1;
        for (let guard = 0; c >= 0 && guard < n; guard++) {
          flowAt[c] += b.seeds.length;
          c = down[c];
        }
      }
      for (const { cells: r, back, mouth } of routes) {
        // cells of the network laid before and still in it keep their pipe (and its height): only the stretches
        // that leave it are new — each with the old cell it branches from, joined there by a manhole shaft
        for (const c of r) {
          piped[c] = 1;
          net.set(c, { k: oldK.get(c) ?? e, seen: e });
        }
        const isOld = (c: number) => oldK.has(c);
        // THE FACE (2026-11-20, "건물과의 상대 포지셔닝"): a building's water leaves it from the middle of the face it is
        // routed out of — the pipe began at the middle of the free cell beside it, half a cell off the wall and
        // pipeDepth below its foot, in the air — and comes down that face from the building's foot (a DROP)
        let face: [number, number] | null = null;
        if (back >= 0 && !isOld(r[0])) {
          const [ax, az] = centre(r[0]), [bx, bz] = centre(back);
          face = [(ax + bx) / 2, (az + bz) / 2];
          if (cfg.pipeDepth > 0) pipes.push({ ax: face[0], az: face[1], bx: face[0], bz: face[1], k: e, flow: Math.max(flowAt[r[0]], 1), drop: true });
          // (a building right beside the network: half a cell from its face to the pipe it joins)
          if (r.length === 1) {
            const [cx, cz] = centre(r[0]);
            pipes.push({ ax: face[0], az: face[1], bx: cx, bz: cz, k: e, flow: Math.max(flowAt[r[0]], 1), route: routeSeq++, seq: 0 });
          }
        }
        for (let i = 0; i < r.length; ) {
          if (isOld(r[i])) {
            i++;
            continue;
          }
          let j = i;
          while (j + 1 < r.length && !isOld(r[j + 1])) j++;
          const stretch = r.slice(Math.max(0, i - 1), Math.min(r.length, j + 2));
          i = j + 1;
          if (stretch.length < 2) continue;
          const routeId = routeSeq++;
          let seq = 0;
          for (const [a2, z2] of straightRuns(stretch, nx)) {
            const key = `${a2}>${z2}`;
            if (pipeEdges.has(key) || pipeEdges.has(`${z2}>${a2}`)) continue;
            pipeEdges.add(key);
            const [ax, az] = face && a2 === r[0] ? face : centre(a2), [bx, bz] = centre(z2);
            pipes.push({ ax, az, bx, bz, k: e, flow: Math.max(flowAt[a2], flowAt[z2], 1), route: routeId, seq: seq++ });
          }
          // THE MOUTH: the sewer comes up at its outfall to the ground its stream runs on (it ended in the air below it)
          if (mouth && j === r.length - 1 && cfg.pipeDepth > 0) {
            const [cx, cz] = centre(r[j]);
            pipes.push({ ax: cx, az: cz, bx: cx, bz: cz, k: e, flow: Math.max(flowAt[r[j]], 1), drop: true });
          }
          // MANHOLES: where the new stretch meets the old network (at its ends), a shaft from the old pipe up to it
          for (const c of [stretch[0], stretch[stretch.length - 1]]) {
            const old = oldK.get(c);
            if (old === undefined || old >= e || risen.has(c)) continue;
            risen.add(c);
            const [cx, cz] = centre(c);
            pipes.push({ ax: cx, az: cz, bx: cx, bz: cz, k: e, k0: old, flow: Math.max(flowAt[c], 1) });
          }
        }
      }
      // the outfall: the water comes out into the open and runs on (in a village: the village's one stream, below)
      const vq = villageOfB.get(quarter[0].id);
      if (vq !== undefined) {
        if (!outfallOf.has(vq)) outfallOf.set(vq, trunk.cells[trunk.cells.length - 1]);
      } else courses.push(openCourse([trunk.cells[trunk.cells.length - 1]], share, nx, nz, centre, cfg, quarter[0].id, bed));
    }
    // buildings in open land: an open stream from their edge (in a village: its stream starts at the largest one when it
    // has no sewer)
    for (const b of sparse) {
      const vb = villageOfB.get(b.id);
      if (vb !== undefined && outfallOf.has(vb)) continue;
      const r = routeOut([b], block, path, piped, nx, nz, idx, cfg, isOpen);
      if (!r) continue;
      if (vb !== undefined) outfallOf.set(vb, r.cells[r.cells.length - 1]);
      else courses.push(openCourse(r.cells, share, nx, nz, centre, cfg, b.id, bed));
    }
    // A VILLAGE'S WATER GOES TO ITS BORDER (the artist, 2026-11-16: "권역 나누기"): from its outfall the shortest way
    // to the nearest of its borders, where the border's stream takes it on (below: bordersAt); a village with no
    // neighbour runs on as an open stream
    if (vs)
      for (const [vi, start] of outfallOf) {
        const [sx, sz] = centre(start);
        let best: { x: number; z: number; d: number } | null = null;
        for (const b of bordersAt(k)) {
          if (b.i !== vi && b.j !== vi) continue;
          const q = nearestOnBorder(b, sx, sz);
          if (!best || q.d < best.d) best = q;
        }
        courses.push(best ? towardCourse(start, best.x, best.z, block, nx, nz, centre, cfg, vi + 1, bed) : openCourse([start], share, nx, nz, centre, cfg, vi + 1, bed));
      }
    courseCells = bed.cells;
    // the network in use now; cells it no longer uses stay known for `grace` (a pipe briefly out of use is still there)
    if (net.size) {
      for (const [c, v] of lastNet) if (!net.has(c) && e - v.seen <= grace) net.set(c, { ...v });
      lastNet = net;
      netK = e;
    }
    if (courses.length) streams.set(k, courses);
  }
  // THE POOLS AT THE STREAMS' ENDS (WaterConfig.endPool): rings round each course's last point, from its rim in to
  // its middle, as close as half a channel — a slot's list shared by several slots gets them once
  const endPool = Math.max(0, cfg.endPool ?? 0);
  if (endPool > 0) {
    const done = new Map<Float32Array[], Float32Array[]>();
    const step = Math.max(0.2, cfg.channel * 0.45);
    for (const [k, list] of streams) {
      let out = done.get(list);
      if (!out) {
        out = list.slice();
        for (const line of list) {
          if (line.length < 4 || !SOAKS.has(line)) continue;
          const ex = line[line.length - 2], ez = line[line.length - 1];
          for (let r = endPool; r > step * 0.3; r -= step) {
            const n = Math.max(6, Math.round((2 * Math.PI * r) / Math.max(0.15, step))), ring = new Float32Array((n + 1) * 2);
            for (let i = 0; i <= n; i++) ring.set([ex + Math.cos((i / n) * Math.PI * 2) * r, ez + Math.sin((i / n) * Math.PI * 2) * r], i * 2);
            out.push(ring);
          }
          out.push(Float32Array.from([ex, ez, ex + 0.01, ez]));
        }
        done.set(list, out);
      }
      streams.set(k, out);
    }
  }
  // THE BORDERS' STREAMS (the artist, 2026-11-16: "권역 나누기"): in every slot, water runs along every border between
  // two living villages — a stream the length of the border, meandering by its own noise and the slot — so the
  // villages are each in a ground of their own, walled by water; their own outfalls run into it (above)
  if (cfg.villages)
    for (let k = kFirst; k <= kLast; k++) {
      const bs = bordersAt(k);
      if (!bs.length) continue;
      const list = streams.get(k)?.slice() ?? [];
      for (const b of bs) list.push(borderCourse(b, cfg, k));
      streams.set(k, list);
    }
  // what was laid before stays as it was: only the later layers are new
  const fz = opts.frozen;
  if (!fz) return { streams, pipes };
  const kept = new Map(fz.streams);
  for (const [k, c] of streams) if (k > fz.upToK) kept.set(k, c);
  return { streams: kept, pipes: [...fz.pipes, ...pipes.filter((p) => p.k > fz.upToK)] };
}

/** routeOut's scratch, grown as needed and never cleared: a state's entries count only when its stamp is the route's. */
let rDist = new Float64Array(0), rPrev = new Int32Array(0), rSeen = new Int32Array(0), rDone = new Int32Array(0);
let rStamp = 0;

/** Whether a route runs straight through its i-th cell (the step in and the step out the same). */
function straightAt(cells: readonly number[], i: number, nx: number): boolean {
  const a = cells[i - 1], b = cells[i], c = cells[i + 1];
  return (b % nx) - (a % nx) === (c % nx) - (b % nx) && Math.floor(b / nx) - Math.floor(a / nx) === Math.floor(c / nx) - Math.floor(b / nx);
}

/**
 * A building's way out to open ground: Dijkstra from the free cells around its block (multi-source) to the first
 * cell that is open (sealed share < openShare, not sealed) — cheap under paths and along laid pipes, never through
 * a standing building (nor through a cell in `taken`, unless it is the goal); right angles, or also 45° (`diagonal`
 * > 0). Cell indices from the building's edge outwards; `back` = the building's cell it leaves from.
 * (2026-11-20) Over the cell AND the way it is heading: every bend costs PIPE_TURN, and the first step goes straight out
 * of the face it leaves from — so a pipe leaves a building at right angles to its wall and bends only where it must.
 */
function routeOut(
  from: readonly Building[],
  block: Int32Array,
  path: Uint8Array,
  piped: Uint8Array,
  nx: number,
  nz: number,
  idx: (cx: number, cz: number) => number,
  cfg: WaterConfig,
  isGoal: (c: number) => boolean,
  taken?: Uint8Array,
): { cells: number[]; from: number; back: number } | null {
  const n = nx * nz;
  const steps: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];
  if (cfg.diagonal > 0) {
    const d = Math.SQRT2 * (1 + (1 - Math.min(1, cfg.diagonal)));
    steps.push([1, 1, d], [1, -1, d], [-1, 1, d], [-1, -1, d]);
  }
  const D = steps.length;
  // (a bend's cost by its angle: 90° = PIPE_TURN, 45° in proportion; turning back never)
  const turn = new Float64Array(D * D);
  for (let a = 0; a < D; a++) {
    for (let b = 0; b < D; b++) {
      const [ai, aj] = steps[a], [bi, bj] = steps[b];
      const cos = (ai * bi + aj * bj) / (Math.hypot(ai, aj) * Math.hypot(bi, bj));
      const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
      turn[a * D + b] = ang > Math.PI * 0.6 ? Infinity : (PIPE_TURN * ang) / (Math.PI / 2);
    }
  }
  const S = n * D;
  if (rDist.length < S) {
    rDist = new Float64Array(S);
    rPrev = new Int32Array(S);
    rSeen = new Int32Array(S);
    rDone = new Int32Array(S);
    rStamp = 0;
  }
  const stamp = ++rStamp;
  const dist = (s: number) => (rSeen[s] === stamp ? rDist[s] : Infinity);
  const heap: number[] = [];
  const push = (v: number) => {
    heap.push(v);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (rDist[heap[p]] <= rDist[heap[c]]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1, r = l + 1;
        let m = c;
        if (l < heap.length && rDist[heap[l]] < rDist[heap[m]]) m = l;
        if (r < heap.length && rDist[heap[r]] < rDist[heap[m]]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  const open = (c: number) => block[c] < 0 && (!taken || !taken[c] || isGoal(c));
  // the block's edge: free cells next to it, each with the way straight out of the face it lies against — those on a
  // path (or touching one) if any: a building drains into the sewer under its street, not out of its back
  const edge: [number, number][] = []; // [cell, direction]
  const owner = new Map<number, number>(); // the building's cells → the building
  for (const b of from) for (const s of b.seeds) owner.set(idx(Math.floor(s.x / CELL_SIZE), Math.floor(s.z / CELL_SIZE)), b.id);
  for (const b of from) {
    for (const s of b.seeds) {
      const cx = Math.floor(s.x / CELL_SIZE), cz = Math.floor(s.z / CELL_SIZE);
      for (let d = 0; d < 4; d++) {
        const c = idx(cx + steps[d][0], cz + steps[d][1]);
        if (c < 0 || c >= n || !open(c)) continue;
        edge.push([c, d]);
      }
    }
  }
  const nearPath = (c: number) => {
    if (path[c]) return true;
    const i = c % nx, j = (c - i) / nx;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => {
      const ii = i + di, jj = j + dj;
      return ii >= 0 && jj >= 0 && ii < nx && jj < nz && path[jj * nx + ii] === 1;
    });
  };
  const onStreet = edge.filter(([c]) => nearPath(c));
  for (const [c, d] of onStreet.length && (cfg.pathPull ?? 1) > 0.5 ? onStreet : edge) {
    const s = c * D + d;
    rSeen[s] = stamp;
    rDist[s] = 0;
    rPrev[s] = -1;
    push(s);
  }
  // (how a path weighs on a pipe's step: cheaper under it — pull > 0 — or dearer on it and beside it — pull < 0)
  const pull = Math.max(-1, Math.min(1, cfg.pathPull ?? 1));
  const onPath = pull >= 0 ? COST_GROUND - (COST_GROUND - COST_PATH) * pull : COST_GROUND * (1 + (PATH_AVOID - 1) * -pull);
  const byPath = pull >= 0 ? COST_GROUND : COST_GROUND * (1 + (PATH_AVOID / 2 - 1) * -pull);
  const besidePath = (i: number, j: number) => (i > 0 && path[j * nx + i - 1] === 1) || (i + 1 < nx && path[j * nx + i + 1] === 1) || (j > 0 && path[(j - 1) * nx + i] === 1) || (j + 1 < nz && path[(j + 1) * nx + i] === 1);
  let goal = -1;
  while (heap.length) {
    const s = pop();
    if (rDone[s] === stamp) continue;
    rDone[s] = stamp;
    const u = Math.floor(s / D), du = s - u * D;
    if (isGoal(u)) {
      goal = s;
      break;
    }
    const ui = u % nx, uj = (u - ui) / nx;
    for (let dv = 0; dv < D; dv++) {
      const bend = turn[du * D + dv];
      if (bend === Infinity) continue;
      const [di, dj, len] = steps[dv];
      const vi = ui + di, vj = uj + dj;
      if (vi < 0 || vj < 0 || vi >= nx || vj >= nz) continue;
      const v = vj * nx + vi, sv = v * D + dv;
      if (rDone[sv] === stamp || !open(v)) continue;
      // no corner cutting past a building on a diagonal
      if (di && dj && (block[uj * nx + vi] >= 0 || block[vj * nx + ui] >= 0)) continue;
      // (a pipe already laid is cheap to join wherever it lies — but not one that lies on a path the pipes keep off)
      const cost = path[v] ? (piped[v] && pull >= 0 ? COST_PIPE : onPath) : piped[v] ? COST_PIPE : pull < 0 && besidePath(vi, vj) ? byPath : COST_GROUND;
      const dd = rDist[s] + len * cost + bend;
      if (dd < dist(sv)) {
        rSeen[sv] = stamp;
        rDist[sv] = dd;
        rPrev[sv] = s;
        push(sv);
      }
    }
  }
  if (goal < 0) return null;
  const states: number[] = [];
  for (let s = goal; s >= 0; s = rPrev[s]) states.push(s);
  states.reverse();
  const cells = states.map((s) => Math.floor(s / D));
  // (the building's cell the route leaves from: one step back from its first cell, against its first heading)
  const d0 = states[0] - cells[0] * D;
  const i0 = cells[0] % nx, j0 = (cells[0] - i0) / nx;
  const back = (j0 - steps[d0][1]) * nx + (i0 - steps[d0][0]);
  return { cells, from: owner.get(back) ?? from[0].id, back: owner.has(back) ? back : -1 };
}

/** Dense buildings grouped into QUARTERS: those whose seeds come within `gap` (world) of each other. */
function quartersOf(bs: readonly Building[], gap: number): Building[][] {
  const parent = bs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      let near = false;
      for (const p of bs[i].seeds) {
        for (const q of bs[j].seeds) if (Math.hypot(p.x - q.x, p.z - q.z) <= gap) {
          near = true;
          break;
        }
        if (near) break;
      }
      if (near) {
        const a = find(i), b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const groups = new Map<number, Building[]>();
  bs.forEach((b, i) => {
    const r = find(i);
    const l = groups.get(r);
    if (l) l.push(b);
    else groups.set(r, [b]);
  });
  return [...groups.values()];
}

/** A cell route as straight runs: [first cell, last cell] of every stretch in one direction. */
export function straightRuns(route: readonly number[], nx: number): [number, number][] {
  const runs: [number, number][] = [];
  if (route.length < 2) return runs;
  const dir = (a: number, b: number) => `${(b % nx) - (a % nx)},${Math.floor(b / nx) - Math.floor(a / nx)}`;
  let start = route[0];
  let d = dir(route[0], route[1]);
  for (let i = 1; i < route.length - 1; i++) {
    const dn = dir(route[i], route[i + 1]);
    if (dn !== d) {
      runs.push([start, route[i]]);
      start = route[i];
      d = dn;
    }
  }
  runs.push([start, route[route.length - 1]]);
  return runs;
}

/** What a course is laid by: how strongly a cell is the old bed (0 … 1), and the cells the courses laid now run through. */
type CourseBed = { at: (c: number) => number; cells: number[] };

/** A cell's world cell (the grid's own index moves as the ground it covers grows: never a seed of anything). */
const worldCell = (centre: (c: number) => [number, number], c: number): [number, number] => {
  const [x, z] = centre(c);
  return [Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE)];
};
/** A smooth noise over the ground (value noise on a lattice `scale` cells apart), 0 … 1 — the same at the same place. */
function noisePlace(x: number, z: number, scale: number, seed: number): number {
  const u = x / (CELL_SIZE * scale), v = z / (CELL_SIZE * scale), i = Math.floor(u), j = Math.floor(v), fu = smooth(u - i), fv = smooth(v - j);
  const a = hash2(i, j, seed), b = hash2(i + 1, j, seed), c = hash2(i, j + 1, seed), d = hash2(i + 1, j + 1, seed);
  return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
}
/** The sideways swing of a course at a point: by the place, not by how far along the course it is — so a stretch that
 *  runs where it ran before lies where it lay (two noises, x and z, of the stream's own seed). */
const swing = (x: number, z: number, id: number, amp: number): [number, number] => [(noisePlace(x, z, 2.5, (id % 100003) * 2 + 1) * 2 - 1) * amp, (noisePlace(x, z, 2.5, (id % 100003) * 2 + 2) * 2 - 1) * amp];

const smooth = (t: number) => t * t * (3 - 2 * t);
function noise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const a = hash2(i, seed, 211), b = hash2(i + 1, seed, 211);
  return a + (b - a) * smooth(t - i);
}

/**
 * An open stream: the open part of a route, then on down the falling sealed share for `streamLength` (it soaks
 * away), as a meandering polyline through the cell centres (corners rounded).
 */
function openCourse(route: number[], share: Float32Array, nx: number, nz: number, centre: (c: number) => [number, number], cfg: WaterConfig, id: number, bed: CourseBed): Float32Array {
  const cells = route.slice();
  // on, away from the sealed ground
  let cur = cells[cells.length - 1];
  let left = cfg.streamLength / CELL_SIZE;
  const seen = new Set(cells);
  while (left > 0) {
    const ci = cur % nx, cj = Math.floor(cur / nx);
    let best = -1, bs = Infinity;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const vi = ci + di, vj = cj + dj;
      if (vi < 0 || vj < 0 || vi >= nx || vj >= nz) continue;
      const v = vj * nx + vi;
      if (seen.has(v)) continue;
      // (down the falling sealed share — and into the old bed, where there is one; the ties broken by the place)
      const [wx, wz] = worldCell(centre, v);
      const s = share[v] + hash2(wx, wz, 5) * 0.02 - bed.at(v) * 0.3;
      if (s < bs) {
        bs = s;
        best = v;
      }
    }
    if (best < 0) break;
    cells.push(best);
    seen.add(best);
    cur = best;
    left -= 1;
  }
  for (const c of cells) bed.cells.push(c);
  const pts: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    const [x, z] = centre(cells[i]);
    const [bx, bz] = swing(x, z, id, cfg.meander * CELL_SIZE * 2);
    pts.push(x + bx, z + bz);
  }
  // round the corners (Chaikin, once), ends kept
  if (pts.length < 6) return soaks(Float32Array.from(pts));
  const q: number[] = [pts[0], pts[1]];
  for (let k = 0; k + 3 < pts.length; k += 2) q.push(0.75 * pts[k] + 0.25 * pts[k + 2], 0.75 * pts[k + 1] + 0.25 * pts[k + 3], 0.25 * pts[k] + 0.75 * pts[k + 2], 0.25 * pts[k + 1] + 0.75 * pts[k + 3]);
  q.push(pts[pts.length - 2], pts[pts.length - 1]);
  return soaks(Float32Array.from(q));
}

/** The courses that end by soaking away (an open stream's), told apart from those that end by joining another — only they
 *  get a pool at their end (WaterConfig.endPool). */
const SOAKS = new WeakSet<Float32Array>();
function soaks(line: Float32Array): Float32Array {
  SOAKS.add(line);
  return line;
}

/**
 * The stream along a border: a point every cell from one end to the other, swung sideways by a smooth noise of its own
 * (the two villages) and of the slot (`k`: it shifts a little from slot to slot) — up to `meander` × 6 cells.
 */
function borderCourse(b: Border, cfg: WaterConfig, k: number): Float32Array {
  const ex = b.bx - b.ax, ez = b.bz - b.az, L = Math.hypot(ex, ez);
  const n = Math.max(1, Math.ceil(L / CELL_SIZE));
  const px = -ez / (L || 1), pz = ex / (L || 1);
  const seed = b.i * 1009 + b.j;
  const amp = cfg.meander * CELL_SIZE * 6;
  const pts: number[] = [];
  for (let q = 0; q <= n; q++) {
    const u = q / n;
    // (the ends stay put: where borders meet, their streams join)
    const off = (noise1(q * 0.12 + k * 0.03, seed % 100003) * 2 - 1) * amp * Math.sin(Math.PI * u);
    pts.push(b.ax + ex * u + px * off, b.az + ez * u + pz * off);
  }
  return Float32Array.from(pts);
}

/**
 * A stream from cell `start` to the world point (tx, tz): step by step to the neighbouring cell nearest the target
 * (never through a standing building), swung a little by noise so it meanders; at most 160 cells. A polyline [x, z, …],
 * corners rounded as an open course's.
 */
function towardCourse(start: number, tx: number, tz: number, block: Int32Array, nx: number, nz: number, centre: (c: number) => [number, number], cfg: WaterConfig, id: number, bed: CourseBed): Float32Array {
  const cells = [start];
  const seen = new Set(cells);
  let cur = start;
  for (let guard = 0; guard < 160; guard++) {
    const [cx, cz] = centre(cur);
    if (Math.hypot(tx - cx, tz - cz) <= CELL_SIZE * 1.5) break;
    const ci = cur % nx, cj = Math.floor(cur / nx);
    let best = -1, bs = Infinity;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const vi = ci + di, vj = cj + dj;
      if (vi < 0 || vj < 0 || vi >= nx || vj >= nz) continue;
      const v = vj * nx + vi;
      if (seen.has(v) || block[v] >= 0) continue;
      const [vx, vz] = centre(v);
      // (towards the border — and along the old bed, where there is one; swung by the place, not by the slot it is laid in)
      const [wx, wz] = worldCell(centre, v);
      const s = Math.hypot(tx - vx, tz - vz) + (hash2(wx, wz, 9 + (id % 1009)) - 0.5) * CELL_SIZE * 1.2 - bed.at(v) * CELL_SIZE * 1.6;
      if (s < bs) {
        bs = s;
        best = v;
      }
    }
    if (best < 0) break;
    cells.push(best);
    seen.add(best);
    cur = best;
  }
  for (const c of cells) bed.cells.push(c);
  const pts: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    const [x, z] = centre(cells[i]);
    const [bx, bz] = swing(x, z, id, cfg.meander * CELL_SIZE * 2);
    pts.push(x + bx, z + bz);
  }
  if (pts.length < 6) return Float32Array.from(pts);
  const q: number[] = [pts[0], pts[1]];
  for (let k = 0; k + 3 < pts.length; k += 2) q.push(0.75 * pts[k] + 0.25 * pts[k + 2], 0.75 * pts[k + 1] + 0.25 * pts[k + 3], 0.25 * pts[k] + 0.75 * pts[k + 2], 0.25 * pts[k + 1] + 0.75 * pts[k + 3]);
  q.push(pts[pts.length - 2], pts[pts.length - 1]);
  return Float32Array.from(q);
}

/**
 * Nearness to open water per (cell, slot) within [k0, k1]: 1 at a course, 0 at `radius`. Returns a lookup
 * (ix, iz, k) → 0..1.
 */
export function waterField(d: Drainage, k0: number, k1: number, cfg: WaterConfig): (ix: number, iz: number, k: number) => number {
  const key3 = (ix: number, iz: number, k: number) => (k * 4096 + (ix + 2048)) * 4096 + (iz + 2048);
  const m = new Map<number, number>();
  const R = Math.max(0.1, cfg.radius);
  const r = Math.ceil(R / CELL_SIZE);
  for (const [k, courses] of d.streams) {
    if (k < k0 || k > k1) continue;
    for (const c of courses) {
      for (let p = 0; p < c.length; p += 2) {
        const x = c[p], z = c[p + 1];
        const cx0 = Math.floor(x / CELL_SIZE), cz0 = Math.floor(z / CELL_SIZE);
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            const ix = cx0 + dx, iz = cz0 + dz;
            const dd = Math.hypot((ix + 0.5) * CELL_SIZE - x, (iz + 0.5) * CELL_SIZE - z);
            if (dd >= R) continue;
            const key = key3(ix, iz, k);
            const w = 1 - dd / R;
            if (w > (m.get(key) ?? 0)) m.set(key, w);
          }
        }
      }
    }
  }
  return (ix, iz, k) => m.get(key3(ix, iz, k)) ?? 0;
}

/**
 * Distance (world) from (x, z) to the nearest open stream in slot k, within [k0, k1]; Infinity where none is near.
 * Courses are sampled every ~0.25 and bucketed, so a lookup checks only nearby samples.
 */
export function waterDistance(d: Drainage, k0: number, k1: number, cfg: WaterConfig): (x: number, z: number, k: number) => number {
  const B = Math.max(CELL_SIZE, cfg.radius);
  const key3 = (bx: number, bz: number, k: number) => (k * 4096 + (bx + 2048)) * 4096 + (bz + 2048);
  const buckets = new Map<number, number[]>();
  for (const [k, courses] of d.streams) {
    if (k < k0 || k > k1) continue;
    for (const c of courses) {
      for (let p = 0; p + 2 < c.length; p += 2) {
        const xa = c[p], za = c[p + 1], xb = c[p + 2], zb = c[p + 3];
        const steps = Math.max(1, Math.ceil(Math.hypot(xb - xa, zb - za) / 0.25));
        for (let s = 0; s <= steps; s++) {
          const x = xa + ((xb - xa) * s) / steps, z = za + ((zb - za) * s) / steps;
          const key = key3(Math.floor(x / B), Math.floor(z / B), k);
          const list = buckets.get(key);
          if (list) list.push(x, z);
          else buckets.set(key, [x, z]);
        }
      }
    }
  }
  return (x, z, k) => {
    const bx = Math.floor(x / B), bz = Math.floor(z / B);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = buckets.get(key3(bx + dx, bz + dz, k));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 2) {
          const dd = Math.hypot(list[i] - x, list[i + 1] - z);
          if (dd < best) best = dd;
        }
      }
    }
    return best;
  };
}

/** The pipes' PRE-LAYER as line segments [ax, ay, az, bx, by, bz] × n — each run, and each manhole shaft upright —
 * buried `pipeDepth` slots below the slot they were laid in. `live` = laid from slot `fromK` (within the present). */
export function pipeLines(pipes: readonly PipeRun[], unit: number, cfg: WaterConfig, fromK: number): { live: Float32Array; kept: Float32Array } {
  const live: number[] = [], kept: number[] = [];
  for (const p of pipes) {
    const to = p.k >= fromK ? live : kept;
    const y = (p.k - cfg.pipeDepth) * unit;
    if (p.drop) to.push(p.ax, y, p.az, p.ax, p.k * unit, p.az);
    else to.push(p.ax, p.k0 !== undefined ? (p.k0 - cfg.pipeDepth) * unit : y, p.az, p.bx, y, p.bz);
  }
  return { live: Float32Array.from(live), kept: Float32Array.from(kept) };
}

/** Pipe runs as cylinders: [ax, ay, az, bx, by, bz, radius] × n, buried `pipeDepth` slots below the slot they were
 * laid in (under the ground of their present). */
export function pipeSegments(pipes: readonly PipeRun[], unit: number, cfg: WaterConfig): Float32Array {
  const out = new Float32Array(pipes.length * 7);
  pipes.forEach((p, i) => {
    const y = (p.k - cfg.pipeDepth) * unit;
    if (p.k0 !== undefined) {
      // a manhole shaft: from the older network up to this one
      out.set([p.ax, (p.k0 - cfg.pipeDepth) * unit, p.az, p.bx, y, p.bz, cfg.pipeRadius * 1.6], i * 7);
      return;
    }
    if (p.drop) {
      // a drop: up from the pipe to the ground of its slot
      out.set([p.ax, y, p.az, p.ax, p.k * unit, p.az, cfg.pipeRadius * Math.sqrt(Math.max(1, p.flow))], i * 7);
      return;
    }
    out.set([p.ax, y, p.az, p.bx, y, p.bz, cfg.pipeRadius * Math.sqrt(Math.max(1, p.flow))], i * 7);
  });
  return out;
}

/**
 * The pipes as PARTS to instance: straight cylinders [ax, ay, az, bx, by, bz, r] × n (runs, manhole shafts and covers,
 * and the COLLARS of the joints) and ELBOWS (a quarter torus joining two horizontal runs at a right angle)
 * [cx, cy, cz, ax, ay, az, bx, by, bz, r] × m — centre of the bend, the unit directions of its two arms seen from the
 * centre, the pipe radius (the bend's radius is `elbow` × r).
 */
export interface PipeParts {
  /** [ax, ay, az, bx, by, bz, r, decay] × n */
  cylinders: Float32Array;
  /** [cx, cy, cz, ax, ay, az, bx, by, bz, r, decay] × m */
  elbows: Float32Array;
}

/**
 * The pipes as PLUMBING: every run a straight OPEN cylinder along its axis (right angles kept). Where exactly two
 * horizontal runs meet at a right angle, both are cut short by the bend's radius and a quarter-torus ELBOW joins them
 * (a pipe fitting). Where a run or a manhole shaft ends ON another pipe (a lateral joining the trunk, a manhole's
 * foot or head), a short wider COLLAR around that pipe marks the tee; a free end (a building's entry, the outfall)
 * stays open. Every manhole an upright cylinder (wider) with a flat COVER on top. Radius `pipeRadius` × flow^flowGain.
 * CORROSION: `decayOf(k)` (0 fresh … 1 gone, from the parts' weathering clock) is carried on every part of a layer;
 * the wall thins by `thin` × decay, and the material eats holes with it.
 */
export function pipeParts(pipes: readonly PipeRun[], unit: number, cfg: WaterConfig, fromK: number, decayOf: (k: number, run: PipeRun) => number = () => 0): { live: PipeParts; kept: PipeParts } {
  const y = (k: number) => (k - cfg.pipeDepth) * unit;
  // (a run's decay: by the slot it was laid in — and, where the caller reads it so, by where the run lies)
  const dec = (p: PipeRun) => Math.max(0, Math.min(1, decayOf(p.k, p)));
  const thin = (p: PipeRun) => 1 - Math.max(0, Math.min(0.9, cfg.thin)) * dec(p);
  const rad = (p: PipeRun) => cfg.pipeRadius * Math.pow(Math.max(1, p.flow), cfg.flowGain) * thin(p);
  type V = [number, number, number];
  type Cyl = { a: V; b: V; r: number; live: boolean; shaft: boolean; decay: number };
  const cyls: Cyl[] = [];
  // the ends of every run, per point
  const ends = new Map<string, { at: V; of: { c: number; end: 0 | 1 }[] }>();
  const end = (c: number, which: 0 | 1) => {
    const p = which ? cyls[c].b : cyls[c].a;
    const key = `${Math.round((p[0] / CELL_SIZE) * 2)},${Math.round((p[1] / unit) * 4)},${Math.round((p[2] / CELL_SIZE) * 2)}`;
    const e = ends.get(key);
    if (e) e.of.push({ c, end: which });
    else ends.set(key, { at: p, of: [{ c, end: which }] });
  };
  const elb: { live: number[]; kept: number[] } = { live: [], kept: [] };
  for (const p of pipes) {
    const live = p.k >= fromK;
    if (p.k0 !== undefined) {
      const r = cfg.pipeRadius * cfg.shaftRadius * thin(p), d = dec(p);
      cyls.push({ a: [p.ax, y(p.k0), p.az], b: [p.ax, y(p.k), p.az], r, live, shaft: true, decay: d }); // the shaft, old pipe to new
      cyls.push({ a: [p.ax, y(p.k) + r * 0.8, p.az], b: [p.ax, y(p.k) + r * (0.8 + cfg.coverHeight), p.az], r: r * cfg.coverRadius, live, shaft: true, decay: d }); // the cover
      end(cyls.length - 2, 0);
      end(cyls.length - 2, 1);
      continue;
    }
    if (p.drop) {
      // a DROP: up from the pipe to the ground of its slot — its foot meets its run at a right angle (an elbow); its
      // head is at the building's foot or the outfall's mouth (no fitting there)
      cyls.push({ a: [p.ax, y(p.k), p.az], b: [p.ax, p.k * unit, p.az], r: rad(p), live, shaft: false, decay: dec(p) });
      end(cyls.length - 1, 0);
      continue;
    }
    cyls.push({ a: [p.ax, y(p.k), p.az], b: [p.bx, y(p.k), p.bz], r: rad(p), live, shaft: false, decay: dec(p) });
    end(cyls.length - 1, 0);
    end(cyls.length - 1, 1);
  }
  const runs = cyls.length; // the collars come after
  const dirFrom = (c: Cyl, which: 0 | 1): V => {
    // the unit direction from this end into the run
    const from = which ? c.b : c.a, to = which ? c.a : c.b;
    const d: V = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / L, d[1] / L, d[2] / L];
  };
  /** The run (not a shaft) on whose body — not its ends — the point lies, if any. */
  const onBody = (p: V): Cyl | null => {
    for (let i = 0; i < runs; i++) {
      const c = cyls[i];
      if (c.shaft || Math.abs(c.a[1] - p[1]) > 1e-3) continue;
      const dx = c.b[0] - c.a[0], dz = c.b[2] - c.a[2], L2 = dx * dx + dz * dz || 1e-9;
      const t = ((p[0] - c.a[0]) * dx + (p[2] - c.a[2]) * dz) / L2;
      if (t <= 0.05 || t >= 0.95) continue;
      const px = c.a[0] + dx * t, pz = c.a[2] + dz * t;
      if (Math.hypot(px - p[0], pz - p[2]) < CELL_SIZE * 0.3) return c;
    }
    return null;
  };
  const collar = (at: V, along: V, r: number, live: boolean, decay: number) => {
    const h = r * cfg.collarLength;
    cyls.push({ a: [at[0] - along[0] * h, at[1] - along[1] * h, at[2] - along[2] * h], b: [at[0] + along[0] * h, at[1] + along[1] * h, at[2] + along[2] * h], r: r * cfg.collarRadius, live, shaft: true, decay });
  };
  for (const e of ends.values()) {
    const live = e.of.some((o) => cyls[o.c].live);
    const r = Math.max(...e.of.map((o) => cyls[o.c].r));
    const decay = Math.min(...e.of.map((o) => cyls[o.c].decay));
    if (e.of.length === 1) {
      // a lone end: on another pipe's body it is a TEE (a collar around that pipe); otherwise open
      const host = onBody(e.at);
      if (host) collar(e.at, dirFrom(host, 0), Math.max(r, host.r), live || host.live, Math.min(decay, host.decay));
      continue;
    }
    const two = e.of.length === 2 && e.of.every((o) => !cyls[o.c].shaft);
    if (two) {
      const [o1, o2] = e.of;
      const u = dirFrom(cyls[o1.c], o1.end), v = dirFrom(cyls[o2.c], o2.end);
      const cosang = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      if (Math.abs(cosang) < 0.05) {
        // a right-angle bend: cut both arms by the bend radius, put the elbow between
        const R = Math.max(0.5, cfg.elbow) * r;
        for (const [o, d] of [[o1, u], [o2, v]] as const) {
          const c = cyls[o.c];
          const p = o.end ? c.b : c.a;
          const len = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]);
          const cut = Math.min(R, len * 0.45);
          const q: V = [p[0] + d[0] * cut, p[1] + d[1] * cut, p[2] + d[2] * cut];
          if (o.end) c.b = q;
          else c.a = q;
        }
        const centre = [e.at[0] + (u[0] + v[0]) * R, e.at[1] + (u[1] + v[1]) * R, e.at[2] + (u[2] + v[2]) * R];
        (live ? elb.live : elb.kept).push(...centre, -u[0], -u[1], -u[2], -v[0], -v[1], -v[2], r, decay);
        continue;
      }
      if (Math.abs(cosang) > 0.95) continue; // straight on: nothing to join
    }
    // several ends, or a shaft meeting a pipe's end: a collar along the pipe that runs through (the first non-shaft)
    const through = e.of.find((o) => !cyls[o.c].shaft);
    collar(e.at, through ? dirFrom(cyls[through.c], through.end) : [0, 1, 0], r, live, decay);
  }
  const cyl: { live: number[]; kept: number[] } = { live: [], kept: [] };
  for (const c of cyls) (c.live ? cyl.live : cyl.kept).push(...c.a, ...c.b, c.r, c.decay);
  const pack = (w: "live" | "kept"): PipeParts => ({ cylinders: Float32Array.from(cyl[w]), elbows: Float32Array.from(elb[w]) });
  return { live: pack("live"), kept: pack("kept") };
}

/**
 * parliament/futureVillage.ts
 *
 * THE INFERRED VILLAGE (the artist, 2026-11-16): above the column — apart from it — a layer of what is to come, two
 * or three slots of it, in 3D and standing on a ground of its own: "재배치되는 건물, 길이나 마을 변경, 수로변화를
 * 통시적으로 반영해서 추론된 마을 … 한 2-3단 정도의. 근데 이제 땅에서 붙은", "아, 식생변화도", "꼭대기는 지금 기둥에서
 * 분리된 형태여야 해". The window is the present made thick; this is read OFF it: how the buildings, the paths, the
 * water and (as what they leave free) the plants have changed over its latest slots, carried on a little further.
 *
 * WHAT THE LAYER IS (the artist, later the same day): "미래도시는 '인류가 멸망한 후 남겨져서 발견될 모습'임" — what is LEFT
 * and FOUND after the people are gone, not where the village is heading. So the rules below are read as: what of
 * the buildings remains (by how long each stood: `left`), which paths remain (the frame), where the water goes when
 * nobody keeps it, and how the plants take the rest. The growth at the edge is off by default.
 *
 * FIRST RULES (Claude's reading, to be changed as the artist and the literature say — docs/world-review §29):
 *  - the latest `band` slots are halved into BEFORE and LATELY;
 *  - A BUILDING stands where a cell has been built lately and is not being left: presence lately + gain × (lately −
 *    before) ≥ ½; the higher that is (and the denser the cell), the taller — 1 … `maxH` slots. A cell being left
 *    (built before, hardly lately) is empty;
 *  - THE VILLAGE GROWS AT ITS EDGE: a free cell beside two cells that are growing, or beside one and on a path's
 *    side, gets a low building;
 *  - A PATH that is walked now stays; one whose end is new is carried on two cells the way it was going; no path
 *    under a building;
 *  - WATER keeps its latest course, but NOT THROUGH WHAT STANDS ("아래 건물이 있으면 거기 물 흐름이 원활하진 않을 거
 *    아니야"): where the course meets a building (inferred, or standing in the column's top) it is cut, and the
 *    water stands before it — a pool as large as the stretch that is blocked;
 *  - PLANTS come as CLOUDS in the layer's own space (as the column's do): along the water and its pools, where a
 *    building was left, along an edge of the village that has stood, a few anywhere within the margin of where
 *    anybody has been — none on trodden ground;
 *  - THE BUILDINGS ARE MADE BY THE GENERATOR THE COLUMN'S ARE MADE BY (the caller: seeds.ts boxesOfSeed, from the built
 *    cell each is carried on from) — not plain boxes.
 * Nothing here is fused, eroded or kept: it is made again as the top rises, and so goes on varying.
 */

import { CELL_SIZE } from "@/lib/stratum/field";

const CELL = CELL_SIZE;
// (FuturePlan: the buildings come back as a list, and the caller generates their parts)

export interface FutureConfig {
  on: boolean;
  /** Slots of the window's top the change is read from (halved into before / lately). */
  band: number;
  /** How far the change of late is carried on (0 = what stands lately, as it is). */
  gain: number;
  /** The tallest inferred building (slots). */
  maxH: number;
  /** Whether the village grows at its edge. */
  edge: boolean;
  /** Cells round what anybody built or walked in which plants stand; plants per free cell. */
  margin: number;
  vegPer: number;
  /**
   * WHAT HAS STOOD LONG STAYS, WHAT IS NEW GOES ON CHANGING (stage 1 of the plan of 2026-11-16; docs/world-review
   * §29-2 A, B): a path walked for half the band or more is the layer's frame and is not built over; a building that
   * has stood as long stands for sure, taller, and in the same shape for as long as it does — one that has only
   * just come is low, and its shape is drawn anew whenever the column's top comes a slot further. Off = every cell
   * by the one rule, as the first version.
   */
  persist?: boolean;
  /** How far gone what is found is, 0 (as it stood) … 1 (little but the foundations of the longest-standing). */
  ruin?: number;
  /**
   * WHAT STANDS ON THE GROUND GOES FIRST, WHAT IS UNDER IT STAYS (stage 1 of the order of 2026-11-17; docs/world-review
   * §29-7, the literature's T5, T4): a building's parts go from its top down — its body, its slabs, its beams, its
   * columns — its plinth nearly never, and what it has under the ground (basement, piles) not at all. Off = the parts
   * go in the order the column's own erosion takes them. The rule is the caller's (SpaceModel.computeFuture).
   */
  under?: boolean;
  /**
   * THE DEPOSIT OF A PLACE (stage 2; the literature's T1, T2, T3, T6, S7, T8): for how many slots a ground cell must
   * have been built — in all that the block keeps, not the band only; every time it was built anew counts as half
   * of this again — to leave a mound. Less leaves dark earth.
   */
  moundAt?: number;
  /**
   * LIVED IN TO THE END, OR LEFT BEFORE IT (stage 3; the literature's T9, S6, T7): a building that stood when the
   * end came is found with its own material — what has gone from it lies at its foot, nothing was carried off (the
   * people left all at once and far); one left before the end was stripped by those who lived on — its body, slabs
   * and beams taken for use elsewhere, the longer ago the more — and stands as columns and footings. Off = what has
   * gone from a building is gone, whichever it was. The rule is the caller's (SpaceModel.computeFuture).
   */
  fate?: boolean;
  /** HOW FAR A BUILDING LEFT BEFORE THE END WAS STRIPPED (the artist, 2026-11-17: "건물 부재 왜 땅 위로는...? 안 올라오는
   *  거야" — it was stripped to the foundations after three slots, whatever the decay): 0 = not at all … 1 = all of its
   *  body, slabs and beams; reached over half the band after it was left. Absent = 0.4. */
  strip?: number;
  /** STONES BY THE WATER (the artist, the same evening: "물가 근처에는 돌 같이 보이도록 추가 점 배열"): points along the
   *  watercourse, in its gap — `dense` how many, `wide` how far from the course (cells). Absent = none. */
  stones?: { dense: number; wide: number };
  /**
   * THE ORDER IN WHICH THE PLANTS TAKE IT (stage 4; the literature's V4, V5, V8, V2, V3): grass first, then scrub,
   * trees late — sooner where the place was left earlier, by the water and over the pipes, later on a roof; scrub
   * along the frame of ways and the runs of pipe; a tree beside the frame breaks it. Off = every cloud the one soft
   * ball it was.
   */
  succession?: boolean;
  /**
   * THE GROUND REMEMBERS WHAT IT WAS USED FOR (stage 5; the literature's V9): on ground that was built on for long
   * other plants grow, the more of them the harder it was used, and thicker — and such ground has its clouds
   * wherever it lies. Off = the plants are the same everywhere.
   */
  soil?: boolean;
  /**
   * HOW A TREE OF THE LAYER LOOKS (the artist, 2026-11-17: "나무 비주얼이랑 사이즈 조절하는 옵션 추가하고(레바)") —
   * every one optional, 1 = as it was: `at` how far along a place must be to carry a tree (1.05; lower = trees
   * sooner and more of them, never under scrub's 0.6); `height` its stem, `crown` its crown's width, `stem` its
   * stem's thickness, `dense` its points (multipliers); `stemShare` the share of its points that are its stem (0.1).
   * (Trees in the column of the present were tried the same day and taken out again — the artist: "걍 지금 구름대로
   * 두고": the present keeps its clouds. docs/world-review §29-14, §29-15.)
   */
  tree?: {
    at?: number;
    height?: number;
    crown?: number;
    stem?: number;
    stemShare?: number;
    dense?: number;
    /** THE CROWN'S SHAPES AND THEIR SHARES (the artist, 2026-11-17: "기둥모양 나무는 아예 빼버리고 모양 비율도 정할 수
     *  있게 해줘"): a ball, a cone (a conifer), an umbrella (wide and flat) — each tree takes one, by these weights
     *  (only their ratio counts; all 0 or absent = every tree a ball). */
    weights?: { ball?: number; cone?: number; umbrella?: number };
    /** (the artist, the same day: "나무 모양이나 사이즈 지터도 옵션 넣어줘") How much one tree's SIZE differs from
     *  another's: 0 = every tree the same height and width, 1 = as it was, more = wilder. */
    sizeJitter?: number;
    /** How much a crown's own proportion (its height against its width) differs from tree to tree: 0 = none. */
    shapeJitter?: number;
    /** ("밀도 지터도") How much the number of a tree's points differs from tree to tree: 0 = none … 1 = from a
     *  sixth of them to nearly twice. */
    denseJitter?: number;
    /** The trees' points come APART from the other plants' (FutureResult.vegTree), with a line of what each tree
     *  is (treeStems) — for a drawer that gives them a point size and a stem of their own. Absent = among `veg`. */
    apart?: boolean;
    /** YOUNG TREES ROUND A BIG ONE (the artist, 2026-11-17: "'큰'나무 옆에는 작은 나무 거리 두고 자라지 않나?"): how many
     *  young trees each big tree has round it (0 = none), how far out (in the big tree's crown radii: never under its
     *  crown, where its shade and its own kind's enemies keep them down — the Janzen–Connell pattern, a ring of
     *  recruits at a distance), and how big they are against it. */
    kin?: number;
    kinFar?: number;
    kinSize?: number;
  };
  /** GRASS AND SCRUB, EACH WITH ITS OWN LOOK (the artist, 2026-11-17: "어떤 스탭으로 덤불에서 나무 되는 건지는 모르겠는데
   *  걔들도 형태 차별화 하려면 요소별 레바 다 따로 있어야 할 듯"). A place's plants are grass while how far along it is
   *  stays under `scrub.at` (0.6), scrub under `tree.at` (1.05), a tree above. Each: `wide` its width, `high` its
   *  height, `dense` its points (multipliers, 1 = as it was); `flat` 0 … 1 how the points lie — 0 a dome thick at its
   *  middle, 1 a flat carpet (grass) / an open, ragged spread (scrub); `jitter` how much one differs from the next. */
  grass?: { wide?: number; high?: number; dense?: number; flat?: number; jitter?: number };
  scrub?: { at?: number; wide?: number; high?: number; dense?: number; flat?: number; jitter?: number };
  /**
   * THE WATER AS A BELT OF PLANTS (the artist, 2026-11-17: "물길은 그냥 선 말고 식생 띠로 보이게 해줘"): `belt` = the
   * course is given as points along it (FutureResult.vegWater) and its line is not; `wide` the band's width, `dense`
   * its points (multipliers, 1 = as meant). Absent = the line, as it was.
   */
  water?: {
    belt: boolean;
    wide?: number;
    dense?: number;
    /** THE WATER AS EMPTINESS (the artist, 2026-11-17: "물길은 '비움'으로 나타내자고, 그 경계에 식생이 더 빽빽하게 자라게
     *  해서"): no line and no belt — the ground within `gap` cells of the course carries no plants, and the `edge`
     *  cells beyond that carry them thickest. Needs the plants everywhere (`ground`), or there is nothing to be empty of. */
    gap?: number;
    edge?: number;
  };
  /** PLANTS OVER THE WHOLE GROUND ("애초에 전역에 식생이 있어야"): clouds on the ground anywhere, not only round what was
   *  built or walked; `density` 0 … 1 how thick (0 = none beyond the margin, as before). */
  ground?: { density: number };
  /** THE BUILDINGS' PARTS BY THEIR KIND (the artist, 2026-11-17: "건축물 부재 비중도 간단하게 조절 가능하도록 해줘"): the
   *  share 0 … 1 of each kind of part that is kept (absent = 1). The rule is the caller's (SpaceModel.computeFuture). */
  partShare?: Record<string, number>;
  /** HOW LONG STEEL AND PILES LAST (the artist, 2026-11-17: "철골이랑 말뚝만 관리하는 것도 추가해줘. 걔들은 오래 남을 것
   *  같아서"): 0 … 1, how far the steel (columns, beams, braces) and the piles hold against the layer's decay — and the
   *  steel against being stripped — 0 = as every other part, 1 = they stand whatever else has gone. */
  last?: { steel?: number; pile?: number };
  /** The ways as the walk worker's own smooth lines (the caller's, SpaceModel.waysLinesAt); false = cell by cell. */
  smoothRoads?: boolean;
  /** HOW FAR THINGS SPREAD from their cell (the artist, 2026-11-17: "흙이든 둔덕이든 식생이든 '퍼진 정도' 조절할 수 있게
   *  해줘, 권역별 딱딱 나뉘는 느낌에서"): 0 = each cloud, mound and patch of earth at its own cell and every edge (the
   *  water's gap, the margin) sharp; 1 = each wanders up to two cells and the edges are soft; more = further. */
  spread?: number;
}

export const DEFAULT_FUTURE: FutureConfig = { on: true, band: 12, gain: 1, maxH: 3, edge: false, margin: 3, vegPer: 3, persist: true, ruin: 0.5, under: true, moundAt: 12, fate: true, succession: true, soil: true };

/** A building of the inferred village: its ground cell, its height in slots, and the built cell it is carried on from. */
export interface FutureBuilding<C> {
  cx: number;
  cz: number;
  h: number;
  grown: boolean;
  /** (unused since the layer is what is found, not what is to be built: nothing there is drawn anew) */
  fresh: boolean;
  /** How much of it is left, 0 … 1 (its parts are taken away by it, in the order the column's erosion takes them). */
  left: number;
  /** For how many slots it had been left when the end came (0 = it stood to the end). Absent = 0. */
  since?: number;
  from: C;
}

export interface FutureResult {
  /** The newest slot it was read from. */
  k: number;
  /** THE BUILDINGS AS PARTS, made by the generator the column's own are made by (seeds.ts boxesOfSeed): per kind of
   *  part its matrices (16 a part) and tones (1 a part). */
  parts: Record<string, Float32Array>;
  tones: Record<string, Float32Array>;
  /** [x0, z0, x1, z1] per stretch of path — `roadsOld`: of those walked for half the band or more (the frame) — and
   *  of water (the pools' rims among them). */
  roads: Float32Array;
  roadsOld: Float32Array;
  water: Float32Array;
  /** [x0, z0, x1, z1] per run of pipe laid under the ground up to the slot read — carried for the rules of what is
   *  left under the ground (not drawn yet). */
  pipes: Float32Array;
  /**
   * WHAT A PLACE'S WHOLE OCCUPATION LEAVES IN THE GROUND (stage 2): `mounds` [x, z, score ≥ 1, a number 0..1 of its
   * own] per ground cell built for long or again and again — its heap of rubble, the thicker the higher the score;
   * `stains` [x, z, share 0..1 of the score a mound begins at, a number of its own] per ground cell that was only
   * lightly built and of which little stands — a patch of dark earth.
   */
  mounds: Float32Array;
  stains: Float32Array;
  /** [x, y (slots above the ground), z, shade 0..1] per plant. */
  veg: Float32Array;
  /** The same per plant of the OTHER kind — what grows on ground that was built on for long (stage 5): drawn in
   *  colours of its own. Absent in a result of a worker started before it was written. */
  vegOld?: Float32Array;
  /** THE TREES' POINTS, apart (FutureConfig.tree.apart): [x, y (slots above the ground), z, shade 0..1, 1 = of the
   *  other plants (ground that was used) else 0] per point. Absent = they are among `veg` / `vegOld`. */
  vegTree?: Float32Array;
  /** THE WATER'S BELT OF PLANTS (FutureConfig.water.belt): [x, y (slots above the ground), z, shade 0..1] per point.
   *  With it `water` is empty. */
  vegWater?: Float32Array;
  /** THE WILD FOREST's plants that are not trees (FutureConfig.ground — ground nobody kept, by region): [x, y, z,
   *  shade] per point, apart from `veg` (the inferred plants) so it can be shown or not on its own. */
  vegWild?: Float32Array;
  /** THE STONES BY THE WATER (FutureConfig.stones): [x, y (slots above the ground), z, size 0..1, shade 0..1] each. */
  stones?: Float32Array;
  /** …and what each tree is: [x, z, its foot (slots above the ground), its stem's height (slots), its crown's
   *  radius (world), where its crown begins and where it ends (slots above its foot), a number 0..1 of its own]. */
  treeStems?: Float32Array; // + [shape: 0 ball, 1 cone, 2 umbrella, wild: 1 = of the wild forest] (10 a tree)
  /** The ground it stands on: [minX, minZ, maxX, maxZ] (world), or empty when nothing is inferred. */
  ground: Float32Array;
  /** How much of each there is (the readout). */
  n: { stand: number; left: number; grown: number; road: number; blocked: number; lasting?: number; roadOld?: number; pipe?: number; mound?: number; stain?: number; grass?: number; shrub?: number; tree?: number; cracked?: number; used?: number; kin?: number };
}

/** What inferFuture gives: everything of FutureResult but the buildings' parts — those are generated by the caller. */
export type FuturePlan<C> = Omit<FutureResult, "parts" | "tones"> & { buildings: FutureBuilding<C>[] };

export interface FutureInput<C> {
  /** The newest whole slot of the window. */
  k: number;
  /** Every built cell with its level per slot. */
  cells: Iterable<C>;
  pathAt: (cx: number, cz: number, k: number) => boolean;
  /** The open water's courses per slot ([x, z, …] polylines) and the buried runs as stretches [x0, z0, x1, z1, slot]. */
  streams: ReadonlyMap<number, readonly Float32Array[]>;
  /** The runs of pipe laid (world; `k` = the slot a run was laid in, `k0` set = a riser, which is no run of the plan). */
  pipes?: Iterable<{ ax: number; az: number; bx: number; bz: number; k: number; k0?: number }>;
  /** The villages alive at the slot read: [x, z, radius] (world) — the regions the wild forest is told apart by. */
  regions?: readonly [number, number, number][];
  cfg: FutureConfig;
}

const hash = (a: number, b: number, c = 0) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const cellOf = (v: number) => Math.floor(v / CELL);
const key = (cx: number, cz: number) => cx * 65536 + cz;

export function inferFuture<C extends { x: number; z: number; levels?: ReadonlyMap<number, number> }>(input: FutureInput<C>): FuturePlan<C> {
  const { k: K, cfg } = input;
  const band = Math.max(4, Math.round(cfg.band)), half = Math.floor(band / 2);
  const maxH = Math.max(1, Math.min(4, Math.round(cfg.maxH)));
  // every built cell: how much of BEFORE and of LATELY it stood, and how dense it was lately
  // …and (stage 1) for how many slots on end it has stood up to now (`run`), how many slots of all that is kept it was
  // built in (`total`), and how long ago it last was (`since`; 0 = it stands now)
  const cells = new Map<number, { cx: number; cz: number; a: number; b: number; lv: number; from: C; fb: number; run: number; total: number; since: number }>();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const dep = new Map<number, { cx: number; cz: number; total: number; ep: number }>();
  for (const s of input.cells) {
    if (!s.levels) continue;
    // (stage 2) ITS WHOLE OCCUPATION, whenever in what the block keeps: the slots it was built in, and how many times
    // it was built anew (a run of slots after three or more slots in which it was not)
    {
      const ks: number[] = [];
      for (const [kk, l] of s.levels) if (l >= 1 && kk <= K) ks.push(kk);
      if (ks.length) {
        ks.sort((p, q) => p - q);
        let ep = 1;
        for (let i = 1; i < ks.length; i++) if (ks[i] - ks[i - 1] > 3) ep++;
        const dx = cellOf(s.x), dz = cellOf(s.z), dq = key(dx, dz), d = dep.get(dq);
        if (d) {
          d.total += ks.length;
          d.ep += ep;
        } else dep.set(dq, { cx: dx, cz: dz, total: ks.length, ep });
      }
    }
    let a = 0, b = 0, lv = 0;
    for (let i = 0; i < band; i++) {
      const l = s.levels.get(K - i) ?? 0;
      if (l < 1) continue;
      if (i < half) {
        b++;
        lv += l;
      } else a++;
    }
    if (!a && !b) continue;
    let run = 0, total = 0, last = -Infinity;
    while (run < band && (s.levels.get(K - run) ?? 0) >= 1) run++;
    for (const [kk, l] of s.levels) {
      if (l < 1 || kk > K) continue;
      total++;
      if (kk > last) last = kk;
    }
    const since = K - last;
    const cx = cellOf(s.x), cz = cellOf(s.z);
    const e = cells.get(key(cx, cz));
    // (a ground cell can be several buildings in time: together)
    if (e) {
      e.a = Math.min(1, e.a + a / (band - half));
      e.lv = Math.max(e.lv, b ? lv / b : 0);
      e.b = Math.min(1, e.b + b / half);
      // (what stands there latest is what is carried on)
      if (b > e.fb) [e.from, e.fb] = [s, b];
      e.run = Math.max(e.run, run);
      e.total += total;
      e.since = Math.min(e.since, since);
    } else cells.set(key(cx, cz), { cx, cz, a: a / (band - half), b: b / half, lv: b ? lv / b : 0, from: s, fb: b, run, total, since });
    if (cx < x0) x0 = cx;
    if (cx > x1) x1 = cx;
    if (cz < z0) z0 = cz;
    if (cz > z1) z1 = cz;
  }
  // ── the deposit (stage 2) ──
  // A PLACE BUILT FOR LONG, OR AGAIN AND AGAIN, LEAVES A MOUND; ONE ONLY LIGHTLY BUILT, DARK EARTH. A town stands on
  // and in its own rubble, the thicker the longer the place was lived in (Zalasiewicz et al. 2017, Price et al. 2011:
  // 지층 T2, T3); a house built anew on the stumps of the last leaves a layer each time (Brami et al. 2016, Dueppen &
  // Gallagher 2023, Hodder 2016: T1, T6, 정주 S7); light buildings that fell leave a dark soil without layers
  // (Macphail & Courty 1985: T8). Read from ALL that the block keeps of a ground cell — a deposit gathers over the
  // whole of a place's time — while what still stands is read from the band, as before.
  const deposit = (standLeft: (q: number) => number | undefined): { mounds: Float32Array; stains: Float32Array } => {
    const at = Math.max(1, cfg.moundAt ?? 12);
    const mounds: number[] = [], stains: number[] = [];
    for (const [q, d] of dep) {
      const score = d.total / at + 0.5 * (d.ep - 1);
      const sp = Math.max(0, cfg.spread ?? 0);
      const x = (d.cx + 0.5 + (hash(d.cx, d.cz, 73) - 0.5) * 4 * sp) * CELL, z = (d.cz + 0.5 + (hash(d.cx, d.cz, 74) - 0.5) * 4 * sp) * CELL;
      if (score >= 1) mounds.push(x, z, score, hash(d.cx, d.cz, 71));
      // (dark earth where little or nothing of a building stands: under one that stands it is not seen)
      else if ((standLeft(q) ?? 0) < 0.5) stains.push(x, z, score, hash(d.cx, d.cz, 72));
    }
    return { mounds: Float32Array.from(mounds), stains: Float32Array.from(stains) };
  };
  const empty: FuturePlan<C> = { k: K, buildings: [], roads: new Float32Array(0), roadsOld: new Float32Array(0), water: new Float32Array(0), pipes: new Float32Array(0), ...deposit(() => undefined), veg: new Float32Array(0), ground: new Float32Array(0), n: { stand: 0, left: 0, grown: 0, road: 0, blocked: 0 } };
  if (!cells.size) return empty;
  const M = Math.max(1, Math.round(cfg.margin));
  x0 -= M;
  z0 -= M;
  x1 += M;
  z1 += M;
  // (a square of the ground no larger than the world: a guard against a stray cell far off)
  if ((x1 - x0 + 1) * (z1 - z0 + 1) > 200 * 200) return empty;
  const n = { stand: 0, left: 0, grown: 0, road: 0, blocked: 0 };

  // ── buildings ──
  const keep = cfg.persist !== false;
  const pathNow = (cx: number, cz: number) => input.pathAt(cx, cz, K) || input.pathAt(cx, cz, K - 1);
  // THE FRAME (stage 1; Whitehand 2001 on the Conzenian tradition: the street plan outlasts the plots, and the plots
  // the buildings — docs/future-village-literature.md 정주 S1): a path walked for half the band on end.
  const pathAge = (cx: number, cz: number): number => {
    let a = 0;
    while (a < band && (input.pathAt(cx, cz, K - a) || (a === 0 && input.pathAt(cx, cz, K - 1)))) a++;
    return a;
  };
  // THE LAYER IS WHAT IS FOUND AFTER THE PEOPLE ARE GONE (the artist, 2026-11-16, as the growth rules were being
  // written: "아!!!!! 참고로 미래도시는 '인류가 멸망한 후 남겨져서 발견될 모습'임") — not where the village is heading.
  // Nobody builds there. EVERY cell that was built in the band leaves something, and how much of it is LEFT (0 … 1)
  // is read off its past: what stood long on end leaves most (a place built again and again — Hodder 2016, Brami et
  // al. 2016: 정주 S7, 지층 T1); what had only just come leaves little; what had already been left for a while before
  // the end, less still (it has been falling for longer). The caller takes parts away by it, in the order the
  // column's own erosion takes them (SpaceModel.computeFuture).
  const stand = new Map<number, { cx: number; cz: number; h: number; grown: boolean; rising: boolean; fresh: boolean; left: number; from: C }>();
  let lasting = 0;
  for (const [q, c] of cells) {
    const persist = Math.min(1, c.run / band), away = Math.min(1, c.since / band);
    const left = keep ? Math.max(0.05, Math.min(1, (0.2 + 0.8 * persist) * (1 - 0.7 * away) * (0.6 + 0.4 * c.b))) : 0.6;
    // (the longer it stood and the denser it was, the taller what is left of it)
    const h = Math.max(1, Math.min(maxH, Math.round(1 + (maxH - 1) * Math.min(1, persist * 0.7 + Math.max(0, c.lv - 1) * 0.25 + c.a * 0.2))));
    stand.set(q, { cx: c.cx, cz: c.cz, h, grown: false, rising: c.b - c.a > 0.2, fresh: false, left, from: c.from });
    if (c.run >= half) lasting++;
    else if (c.since > 0) n.left++;
    n.stand++;
  }
  // (GROWTH AT THE EDGE — off by default now: it was written while the layer was read as where the village is
  // heading; nobody builds in what is found. Kept as a knob.)
  if (cfg.edge) {
    // (…and, as the cellular models of urban growth have it — Clarke, Hoppen & Gaydos 1997, SLEUTH's edge growth: a
    // free cell with three or more of its eight neighbours built is filled, by chance: docs/future-village-literature.md S2)
    const grown: { cx: number; cz: number; from: C }[] = [];
    const seen = new Set<number>();
    for (const s of stand.values()) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const cx = s.cx + dx, cz = s.cz + dz, q = key(cx, cz);
        if (stand.has(q) || seen.has(q) || pathNow(cx, cz)) continue;
        seen.add(q);
        let rising = 0, built = 0, byPath = false;
        for (let ez = -1; ez <= 1; ez++) {
          for (let ex = -1; ex <= 1; ex++) {
            if (!ex && !ez) continue;
            const nb = stand.get(key(cx + ex, cz + ez));
            if (nb) built++;
            if (!ex || !ez) {
              if (nb?.rising) rising++;
              if (pathNow(cx + ex, cz + ez)) byPath = true;
            }
          }
        }
        if (rising >= 2 || (rising >= 1 && byPath) || (built >= 3 && hash(cx, cz, 17) < 0.2 + 0.12 * (built - 3))) grown.push({ cx, cz, from: s.from });
      }
    }
    for (const g of grown) {
      stand.set(key(g.cx, g.cz), { cx: g.cx, cz: g.cz, h: 1, grown: true, rising: false, fresh: false, left: 0.3, from: g.from });
      n.grown++;
    }
  }

  // ── paths ──
  const road = new Set<number>();
  const roadCells: [number, number][] = [];
  const addRoad = (cx: number, cz: number) => {
    const q = key(cx, cz);
    if (road.has(q) || stand.has(q)) return;
    road.add(q);
    roadCells.push([cx, cz]);
  };
  const ends: [number, number, number, number][] = [];
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (!pathNow(cx, cz)) continue;
      addRoad(cx, cz);
      // a new end: one neighbour on the path, and not walked half a band ago
      if (input.pathAt(cx, cz, K - half)) continue;
      let nb = 0, nx = 0, nz = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (pathNow(cx + dx, cz + dz)) {
          nb++;
          nx = dx;
          nz = dz;
        }
      }
      if (nb === 1) ends.push([cx, cz, -nx, -nz]);
    }
  }
  for (const [cx, cz, dx, dz] of ends) for (let s = 1; s <= 2; s++) addRoad(cx + dx * s, cz + dz * s);
  // (the frame: the cells of a path walked for half the band on end — a stretch between two of them is the frame's)
  const oldRoad = new Set<number>();
  if (keep) for (const [cx, cz] of roadCells) if (pathAge(cx, cz) >= half) oldRoad.add(key(cx, cz));
  const roads: number[] = [], roadsOld: number[] = [];
  // (laid again once the plants are known — stage 4: where a tree's roots have broken the frame, `cracked`, a stretch
  // of it is no longer the frame's)
  const layRoads = (cracked: ReadonlySet<number> | null) => {
    roads.length = 0;
    roadsOld.length = 0;
    const whole = (q: number) => oldRoad.has(q) && !cracked?.has(q);
    for (const [cx, cz] of roadCells) {
      const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL, q = key(cx, cz);
      let any = false;
      for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
        const q2 = key(cx + dx, cz + dz);
        if (road.has(q2)) {
          (whole(q) && whole(q2) ? roadsOld : roads).push(x, z, x + dx * CELL, z + dz * CELL);
          any = true;
        }
      }
      if (!any && !road.has(key(cx - 1, cz)) && !road.has(key(cx, cz - 1))) (whole(q) ? roadsOld : roads).push(x - CELL * 0.3, z, x + CELL * 0.3, z);
    }
  };
  layRoads(null);
  n.road = roadCells.length;
  Object.assign(n, { lasting, roadOld: oldRoad.size });

  // ── water: its latest course, cut where something stands, standing before it ──
  let course: readonly Float32Array[] = [];
  for (let k = K; k > K - band && !course.length; k--) course = input.streams.get(k) ?? [];
  const water: number[] = [];
  const wet = new Set<number>();
  const pools: [number, number, number][] = [];
  const pool = (x: number, z: number, r: number) => {
    pools.push([x, z, r]);
    const SEG = 14;
    for (let i = 0; i < SEG; i++) {
      const t0 = (i / SEG) * Math.PI * 2, t1 = ((i + 1) / SEG) * Math.PI * 2;
      water.push(x + Math.cos(t0) * r, z + Math.sin(t0) * r, x + Math.cos(t1) * r, z + Math.sin(t1) * r);
    }
    const rc = Math.ceil(r / CELL);
    for (let dz = -rc; dz <= rc; dz++) for (let dx = -rc; dx <= rc; dx++) wet.add(key(cellOf(x) + dx, cellOf(z) + dz));
  };
  for (const line of course) {
    let blocked = 0, lastX = NaN, lastZ = NaN;
    for (let i = 0; i + 3 < line.length; i += 2) {
      const ax = line[i], az = line[i + 1], bx = line[i + 2], bz = line[i + 3];
      const hit = stand.has(key(cellOf((ax + bx) / 2), cellOf((az + bz) / 2)));
      if (hit) {
        blocked += Math.hypot(bx - ax, bz - az);
        continue;
      }
      if (blocked > 0 && !Number.isNaN(lastX)) {
        pool(lastX, lastZ, Math.min(CELL * 2.5, CELL * 0.6 + blocked * 0.35));
        n.blocked++;
      }
      blocked = 0;
      water.push(ax, az, bx, bz);
      wet.add(key(cellOf(ax), cellOf(az)));
      wet.add(key(cellOf(bx), cellOf(bz)));
      lastX = bx;
      lastZ = bz;
    }
    if (blocked > 0 && !Number.isNaN(lastX)) {
      pool(lastX, lastZ, Math.min(CELL * 2.5, CELL * 0.6 + blocked * 0.35));
      n.blocked++;
    }
  }

  // ── plants: CLOUDS in the layer's own space, as the column's are — not a row of points on every free cell ──
  // (the artist, 2026-11-16, of the first version: "식생도 건물 주변에 저렇게 있는 게 맞나? … 유기적이지가 않아서 이질감이
  // 든다"). A cloud is a soft ball of points, some with a second lobe, as tall as it is wide (it stands in the layer's
  // two or three slots, among the buildings and over them). Where the clouds begin is read off what the literature
  // says of where plants come first (docs/future-village-literature.md): thickest along the water and its pools
  // (riparian corridors: V6), where a building was left (V4, V8), and along an edge of the village that has stood
  // (V7); none on trodden ground (V1); and a few anywhere within the margin.
  const near = new Set<number>();
  const mark = (cx: number, cz: number) => {
    for (let dz = -M; dz <= M; dz++) for (let dx = -M; dx <= M; dx++) if (dx * dx + dz * dz <= M * M + 1) near.add(key(cx + dx, cz + dz));
  };
  for (const c of cells.values()) mark(c.cx, c.cz);
  for (const [cx, cz] of roadCells) mark(cx, cz);
  //
  // THE ORDER IN WHICH THEY TAKE IT (stage 4 of the order of 2026-11-17; the artist: "4단계 진행"; FutureConfig
  // .succession). Left land is grass for long, then scrub, and trees late — sooner where there is something to
  // spread from (Matsala et al. 2021, Broughton et al. 2022: V4); on a building the first are what needs least, in
  // its cracks and where dust and water gather (Cozzolino et al. 2022: V5); it gathers along the unmanaged edges of
  // the ways and on left plots (Del Tredici 2010: V8); roots lift and crack what is paved within a few metres of a
  // tree that has stood for years (Randrup et al. 2003: V2), and grow towards the damp, along the pipes (Randrup et
  // al. 2001: V3). So every cloud is of one of three KINDS — a low carpet of grass, a dome of scrub, a tree (a stem
  // and a crown) — by HOW FAR ALONG its place is: the layer's decay is the time since the end (`ruin`); a place left
  // before the end has had longer; by the water and over the pipes it goes faster; on a roof slower. Scrub lines the
  // frame of ways and the runs of pipe; a tree beside the frame breaks it there (`cracked`: that stretch is drawn as
  // a faint path, and plants stand on it).
  const succ = cfg.succession !== false;
  const ruinT = Math.max(0, Math.min(1, cfg.ruin ?? 0.5));
  // (how a tree looks: FutureConfig.tree — the knobs)
  const tk = cfg.tree ?? {};
  const pos = (v: number | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  const treeAt = Math.max(0.6, pos(tk.at, 1.05)), treeH = pos(tk.height, 1), treeC = pos(tk.crown, 1), treeS = pos(tk.stem, 1), treeN = pos(tk.dense, 1);
  const stemShare = Math.min(0.9, pos(tk.stemShare, 0.1));
  const sizeJ = pos(tk.sizeJitter, 1), shapeJ = pos(tk.shapeJitter, 0), denseJ = Math.min(1, pos(tk.denseJitter, 0));
  // (the crown's three shapes by their shares: a number 0 … 1 of the tree's own picks one)
  const wBall = pos(tk.weights?.ball, 1), wCone = pos(tk.weights?.cone, 0), wUmb = pos(tk.weights?.umbrella, 0), wAll = wBall + wCone + wUmb;
  const shapeOf = (u: number): "ball" | "cone" | "umbrella" => (wAll <= 0 || u * wAll < wBall ? "ball" : u * wAll < wBall + wCone ? "cone" : "umbrella");
  const apart = tk.apart === true;
  // (grass and scrub: FutureConfig.grass / .scrub)
  const gk = cfg.grass ?? {}, sk = cfg.scrub ?? {};
  const scrubAt = Math.max(0.05, pos(sk.at, 0.6));
  const spread = Math.max(0, cfg.spread ?? 0);
  // (a wander of up to 2 × spread cells, by two numbers of the thing's own)
  const wander = (a: number, b: number, salt: number): [number, number] => [(hash(a, b, salt) - 0.5) * 4 * spread, (hash(a, b, salt + 1) - 0.5) * 4 * spread];
  // (damp: the water's cells, and less so the cells two round them; piped: the cells a run of pipe passes under)
  const damp = new Map<number, number>();
  const piped = new Set<number>();
  if (succ) {
    for (const q of wet) {
      const cx = Math.floor(q / 65536 + 0.5), cz = q - cx * 65536;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (!damp.has(key(cx + dx, cz + dz))) damp.set(key(cx + dx, cz + dz), 0.5);
    }
    for (const q of wet) damp.set(q, 1);
    for (const p of input.pipes ?? []) {
      if (p.k0 !== undefined || p.k > K) continue;
      const len = Math.hypot(p.bx - p.ax, p.bz - p.az), steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
      for (let s = 0; s <= steps; s++) piped.add(key(cellOf(p.ax + ((p.bx - p.ax) * s) / steps), cellOf(p.az + ((p.bz - p.az) * s) / steps)));
    }
  }
  /** 0 = grass, 1 = scrub, 2 = a tree; −1 = as the clouds were before the kinds (the knob off). */
  const kindAt = (cx: number, cz: number, salt: number): number => {
    if (!succ) return -1;
    const q = key(cx, cz), st = stand.get(q);
    // (the wild forest: ground nobody kept is further along — scrub and trees)
    const wildBoost = wildCells.has(q) ? 0.45 : 0;
    // (a place built only before the band was left longest of all)
    const cq = cells.get(q);
    const away = cq ? Math.min(1, cq.since / band) : dep.has(q) ? 1 : 0;
    const v = wildBoost + 0.15 + 0.9 * ruinT + 0.35 * away + 0.35 * (damp.get(q) ?? 0) + (piped.has(q) ? 0.2 : 0) - (st && st.left > 0.45 ? 0.35 : 0) + (hash(cx, cz, salt + 9) - 0.5) * 0.3;
    return v < scrubAt ? 0 : v < treeAt ? 1 : 2;
  };
  // THE GROUND REMEMBERS WHAT IT WAS USED FOR (stage 5 of the order of 2026-11-17; the artist: "5단계 진행";
  // FutureConfig.soil). Land farmed under Rome and forest ever since still carries other plants, by how hard it was
  // used — the soil was changed for good (Dupouey et al. 2002: 식생 V9). So the plants of ground that was built on
  // for long are OTHER PLANTS: `used` (0 … 1) is the place's deposit (the score a mound is read from, stage 2: half
  // of it at the mound's threshold, all of it at twice that), and that share of a cloud's points are of the other
  // kind (FuturePlan.vegOld — drawn in colours of their own), and it is the thicker for it. And such ground gets its
  // clouds wherever it lies, also where nothing has stood for longer than the band: when the buildings are gone, the
  // village is still read in what grows there.
  const soil = cfg.soil !== false;
  const usedAt = (cx: number, cz: number): number => {
    const d = soil ? dep.get(key(cx, cz)) : undefined;
    return d ? Math.min(1, (d.total / Math.max(1, cfg.moundAt ?? 12) + 0.5 * (d.ep - 1)) / 2) : 0;
  };
  const clouds: { x: number; z: number; r: number; tall: number; n: number; kind: number; used: number; shape?: string; asp?: number; wild?: boolean }[] = [];
  const wildCells = new Set<number>();
  const clouded = new Set<number>();
  const per = Math.max(0, cfg.vegPer);
  const kinds = [0, 0, 0];
  const cloud = (cx: number, cz: number, r: number, salt: number) => {
    const [wx, wz] = wander(cx, cz, salt + 30);
    const x = (cx + hash(cx, cz, salt) + wx) * CELL, z = (cz + hash(cx, cz, salt + 1) + wz) * CELL;
    const kind = kindAt(cx, cz, salt), u = hash(cx, cz, salt + 2), used = usedAt(cx, cz);
    if (kind >= 0) kinds[kind]++;
    clouded.add(key(cx, cz));
    // (grass: wide and low; scrub: a dome; a tree: `tall` is its stem, its crown stands on that)
    // (a tree's size: its stem 0.9 … 2.2 slots and its crown by the place's rule, as it was, at a jitter of 1; at 0
    // every tree the mean of those — 1.55 slots, a crown of 1.3; more than 1 = further from the mean)
    const treeR = Math.max(0.4, 1.3 + (Math.max(0.9, r * 0.85) - 1.3) * sizeJ), treeT = Math.max(0.3, 1.55 + (u - 0.5) * 1.3 * sizeJ);
    // (grass and scrub, each by its own knobs and jitter: one plant wider or narrower than the next by its own number)
    const jg = 1 + (hash(cx, cz, salt + 15) - 0.5) * 2 * pos(gk.jitter, 0), js = 1 + (hash(cx, cz, salt + 16) - 0.5) * 2 * pos(sk.jitter, 0);
    const [rk, tall, nk] = kind === 0 ? [r * 1.25 * pos(gk.wide, 1) * Math.max(0.2, jg), (0.1 + 0.12 * u) * pos(gk.high, 1), pos(gk.dense, 1)] : kind === 1 ? [r * pos(sk.wide, 1) * Math.max(0.2, js), (0.4 + 0.7 * u) * pos(sk.high, 1) * Math.max(0.3, js), pos(sk.dense, 1)] : kind === 2 ? [treeR * treeC, treeT * treeH, 1.3 * treeN] : [r, 0.4 + 1.6 * u, 1];
    // (…and how thick with points: of a tree, its own share more or fewer — the knob's jitter)
    const thick = nk * (1 + 0.5 * used) * (kind === 2 ? Math.max(0.15, 1 + (hash(cx, cz, salt + 14) - 0.5) * 1.7 * denseJ) : 1);
    // (a tree's shape: one of the three by their shares; and its crown's own proportion)
    const shape = kind !== 2 ? undefined : shapeOf(hash(cx, cz, salt + 12));
    const asp = kind !== 2 ? 1 : Math.max(0.3, 1 + (hash(cx, cz, salt + 13) - 0.5) * 1.4 * shapeJ);
    const wild = wildCells.has(key(cx, cz));
    clouds.push({ x, z, r: rk, tall, n: Math.round(per * 5 * r * r * thick), kind, used, shape, asp, wild });
    // (some are two-lobed)
    if (hash(cx, cz, salt + 3) < 0.3) {
      const t = hash(cx, cz, salt + 4) * Math.PI * 2, u5 = hash(cx, cz, salt + 5);
      clouds.push({ x: x + Math.cos(t) * r * CELL * 0.9, z: z + Math.sin(t) * r * CELL * 0.9, r: rk * 0.7, tall: kind < 0 ? 0.3 + u5 : tall * (0.6 + 0.4 * u5), n: Math.round(per * 2.5 * r * r * thick), kind, used, shape, asp, wild });
    }
  };
  // THE WATER AS EMPTINESS and PLANTS EVERYWHERE (FutureConfig.water.gap, .ground): how far each cell near the
  // course lies from it (in cells, up to gap + edge)
  const gapR = Math.max(0, Math.round(cfg.water?.gap ?? 0)), edgeR = Math.max(0, Math.round(cfg.water?.edge ?? 0));
  const waterDist = new Map<number, number>();
  if (gapR + edgeR > 0) {
    const R = gapR + edgeR;
    for (let i = 0; i + 1 < water.length; i += 2) {
      const cx = cellOf(water[i]), cz = cellOf(water[i + 1]);
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const d = Math.round(Math.hypot(dx, dz));
        if (d > R) continue;
        const qq = key(cx + dx, cz + dz);
        if ((waterDist.get(qq) ?? Infinity) > d) waterDist.set(qq, d);
      }
    }
  }
  const everywhere = Math.max(0, Math.min(1, cfg.ground?.density ?? 0));
  // (the wild forest's weight at a cell, 0 … 1: by the nearest village — its own character — how far from its middle,
  // and whether the cell lies on the seam between two regions)
  const regs = input.regions ?? [];
  const wildAt = (cx: number, cz: number): number => {
    if (!regs.length) return 0.5;
    const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
    let i1 = -1, d1 = Infinity, d2 = Infinity;
    regs.forEach(([rx, rz], i) => {
      const d = Math.hypot(x - rx, z - rz);
      if (d < d1) [d2, d1, i1] = [d1, d, i];
      else if (d < d2) d2 = d;
    });
    const r = Math.max(CELL, regs[i1][2]);
    const t = Math.max(0, Math.min(1, (d1 - r * 0.6) / Math.max(1e-6, r * 1.2)));
    const away = t * t * (3 - 2 * t);
    const own = 0.35 + 0.9 * hash(i1, 7, 91);
    const seam = d2 - d1 < CELL * (1.5 + spread * 2) ? 0.3 : 1;
    return Math.min(1, (0.15 + 0.85 * away) * own * seam);
  };
  const HALF = 80;
  const [gx0, gx1, gz0, gz1] = everywhere > 0 ? [-HALF, HALF - 1, -HALF, HALF - 1] : [x0, x1, z0, z1];
  for (let cz = gz0; cz <= gz1; cz++) {
    for (let cx = gx0; cx <= gx1; cx++) {
      const q = key(cx, cz);
      const inNear = near.has(q);
      if (!inNear && everywhere <= 0) continue;
      // (only the frame — a path walked long — stays clear; a path that had only just been walked is grown over)
      if (keep ? oldRoad.has(q) : road.has(q)) continue;
      const c = cells.get(q), free = !stand.has(q);
      const h1 = hash(cx, cz, 41);
      // (the water's emptiness, and its thick edge)
      // (a soft edge: the distance read with a wander of its own)
      const wd0 = waterDist.get(q), wd = wd0 === undefined ? undefined : wd0 + (hash(cx, cz, 77) - 0.5) * 2 * spread * 1.5;
      if (wd !== undefined && gapR + edgeR > 0) {
        if (wd <= gapR) continue;
        if (free && h1 < 0.9) {
          cloud(cx, cz, 0.9 + 1.1 * hash(cx, cz, 43), 100);
          continue;
        }
      }
      if (!inNear) {
        // THE WILD FOREST (the artist, 2026-11-17: "물길과 무관하게 자라는 식생이라는 게 … 사람 없이 놔두면 자라는 숲 같은
        // 느낌으로 권역 구분도 느껴질 겸 조성하라는 거였음"): ground nobody kept turns to forest — the thicker the further
        // from where a village lived (its core stays open longest), each REGION (the ground nearest one village) with a
        // forest of its own density, and the seam between two regions a thinner strip — so the regions read in it
        if (!free) continue;
        const w = wildAt(cx, cz);
        if (w > 0 && h1 < everywhere * w * 0.55) {
          wildCells.add(q);
          cloud(cx, cz, 1.0 + 1.6 * hash(cx, cz, 45), 900);
        }
        continue;
      }
      // THE PLANTS TAKE WHAT IS LEFT: the less is left of a building, the surer a cloud begins on it
      const st = stand.get(q);
      if (st && h1 < (1 - st.left) * 0.75) cloud(cx, cz, 0.8 + 1.6 * (1 - st.left) * hash(cx, cz, 47), 500);
      else if (wet.has(q) && free && gapR === 0 && h1 < 0.55) cloud(cx, cz, 1.2 + 1.6 * hash(cx, cz, 43), 100);
      else if (c && c.a > 0.3 && free && h1 < 0.8) cloud(cx, cz, 0.9 + 1.2 * hash(cx, cz, 44), 200);
      else if (free && h1 < 0.06) cloud(cx, cz, 1 + 2.4 * hash(cx, cz, 45), 300);
      else if (free && h1 < 0.3) {
        // an edge that has stood: free, beside a building that stood before as well as lately
        let edge = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nb = cells.get(key(cx + dx, cz + dz));
          if (nb && nb.a > 0.5 && nb.b > 0.5) edge = true;
        }
        if (edge) cloud(cx, cz, 0.7 + 0.9 * hash(cx, cz, 46), 400);
      } else if (succ && free && h1 < 0.62) {
        // (stage 4) THE VERGE OF THE FRAME and THE LINE OF A PIPE: free ground beside a way walked long, or over a run
        // of pipe — narrow clouds, so they read as lines along them
        let verge = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (oldRoad.has(key(cx + dx, cz + dz))) verge = true;
        if (verge) cloud(cx, cz, 0.55 + 0.5 * hash(cx, cz, 48), 700);
        else if (piped.has(q) && h1 < 0.5) cloud(cx, cz, 0.6 + 0.6 * hash(cx, cz, 49), 600);
      }
    }
  }
  // (stage 5) GROUND THAT WAS BUILT ON, WHEREVER IT LIES: a cloud on every such cell that has none yet — the surer
  // the more it was used; not on the frame, not where a building still mostly stands
  if (soil) {
    for (const [q, d] of dep) {
      if (clouded.has(q) || (keep ? oldRoad.has(q) : road.has(q)) || (stand.get(q)?.left ?? 0) > 0.45) continue;
      const used = usedAt(d.cx, d.cz);
      if (used >= 0.1 && hash(d.cx, d.cz, 51) < 0.3 + 0.6 * used) cloud(d.cx, d.cz, 0.8 + 1.1 * used * hash(d.cx, d.cz, 52), 800);
    }
  }
  // YOUNG TREES ROUND A BIG ONE (FutureConfig.tree.kin): the bigger half of the trees each get a few young ones in a
  // ring outside the crown — not under it (its shade, and the pests and seed-eaters that gather at a parent, keep
  // its own young away close by: the Janzen–Connell pattern; recruits stand thickest at a distance) — smaller, of
  // the same kind or of another, on free ground only
  const kinN = Math.max(0, Math.round(tk.kin ?? 0));
  if (succ && kinN > 0) {
    const kinFar = Math.max(1, tk.kinFar ?? 2.2), kinSize = Math.max(0.1, Math.min(1, tk.kinSize ?? 0.45));
    const big = clouds.filter((c) => c.kind === 2);
    const sizes = big.map((c) => c.r * c.tall).sort((p, q) => p - q), cut = sizes[Math.floor(sizes.length * 0.5)] ?? Infinity;
    const added: typeof clouds = [];
    big.forEach((c, bi) => {
      if (c.r * c.tall < cut) return;
      for (let j = 0; j < kinN; j++) {
        const th = (j / kinN) * Math.PI * 2 + hash(bi, j, 81) * 1.4, d = c.r * CELL * (kinFar + (hash(bi, j, 82) - 0.3) * kinFar * 0.6);
        const x = c.x + Math.cos(th) * d, z = c.z + Math.sin(th) * d, q = key(cellOf(x), cellOf(z));
        if (stand.has(q) || (keep ? oldRoad.has(q) : road.has(q))) continue;
        const f = kinSize * (0.6 + 0.8 * hash(bi, j, 83));
        added.push({ ...c, x, z, r: Math.max(0.35, c.r * f), tall: Math.max(0.3, c.tall * f), n: Math.max(4, Math.round(c.n * f * f)), shape: hash(bi, j, 84) < 0.6 ? c.shape : shapeOf(hash(bi, j, 85)), asp: c.asp });
      }
    });
    for (const c of added) clouds.push(c);
    Object.assign(n, { kin: added.length });
  }
  // (stage 4) WHERE THE ROOTS HAVE BROKEN THE FRAME: its cells within a cell of a tree
  const cracked = new Set<number>();
  if (succ && keep) {
    for (const c of clouds) {
      if (c.kind !== 2) continue;
      const cx = cellOf(c.x), cz = cellOf(c.z);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (oldRoad.has(key(cx + dx, cz + dz))) cracked.add(key(cx + dx, cz + dz));
    }
    if (cracked.size) layRoads(cracked);
  }
  Object.assign(n, { grass: kinds[0], shrub: kinds[1], tree: kinds[2], cracked: cracked.size });
  const veg: number[] = [], vegOld: number[] = [], vegTree: number[] = [], treeStems: number[] = [], vegWild: number[] = [];
  // (the cap on the points: the trees' apart from the rest — the artist, 2026-11-17: "나무에 달리는 점 양 조절은 또 왜 안
  // 됨": with plants over the whole ground the one cap thinned the trees with everything else, and their knob did nothing)
  const CAP = 60000, TREE_CAP = 40000;
  let all = 0, allTrees = 0;
  for (const c of clouds) if (c.kind === 2) allTrees += c.n; else all += c.n;
  const thin = all > CAP ? CAP / all : 1, thinTrees = allTrees > TREE_CAP ? TREE_CAP / allTrees : 1;
  clouds.forEach((c, ci) => {
    const nPts = Math.round(c.n * (c.kind === 2 ? thinTrees : thin));
    // (a tree, told apart: where it stands — on the roof of what still stands there — its stem, its crown's width,
    // and from where to where above its foot its crown reaches, by its shape)
    if (apart && c.kind === 2) {
      const sb = stand.get(key(cellOf(c.x), cellOf(c.z))), a = c.asp ?? 1;
      const [lo, hi] = c.shape === "cone" ? [c.tall * 0.45, c.tall * 0.45 + c.r * 1.7 * a] : c.shape === "umbrella" ? [c.tall, c.tall + c.r * 0.3 * a] : [c.tall - c.r * 0.06 * a, c.tall + c.r * 0.54 * a];
      treeStems.push(c.x, c.z, sb && sb.left > 0.45 ? sb.h : 0, c.tall, c.r * CELL * (c.shape === "umbrella" ? 1.3 : 1), lo, hi, hash(ci, 7, 8), c.shape === "cone" ? 1 : c.shape === "umbrella" ? 2 : 0, c.wild ? 1 : 0);
    }
    for (let i = 0; i < nPts; i++) {
      // (thick in its middle, thinning to its edge)
      const u1 = hash(ci, i, 1), u2 = hash(ci, i, 2), u3 = hash(ci, i, 3), u4 = hash(ci, i, 4);
      const th = u2 * Math.PI * 2;
      // (a tree: one point in ten is of its stem; the rest of its crown, a ball standing on the stem)
      const stem = c.kind === 2 && hash(ci, i, 5) < stemShare, crown = c.kind === 2 && !stem, v = 2 * u3 - 1;
      // THE CROWN'S SHAPE: how far out a point is (a share of the crown's radius) and how high (slots) — a ball on
      // the stem; a cone from half way up the stem, wide below and to a point; an umbrella, a wide flat cap on the
      // stem's top. (A fourth, a narrow column, was taken out: "기둥모양 나무는 아예 빼버리고".)
      let cr = 0, cy = 0;
      if (crown) {
        // (its own shape and proportion: `asp` stretches the crown's height)
        const s1 = Math.sqrt(u1), sh = c.shape ?? "ball", a = c.asp ?? 1;
        if (sh === "cone") [cr, cy] = [s1 * (1 - u3) * 0.95, c.tall * 0.45 + u3 * c.r * 1.7 * a];
        else if (sh === "umbrella") [cr, cy] = [s1 * 1.3, c.tall + ((1 - u1) * 0.22 + u3 * 0.08) * c.r * a];
        else [cr, cy] = [s1 * Math.sqrt(1 - v * v), c.tall + (v * 0.5 + 0.4) * c.r * 0.6 * a];
      }
      // (grass: a carpet as flat as its knob says; scrub: a dome — or, flatter, an open ragged spread)
      const flatG = Math.min(1, pos(gk.flat, 0.5)), flatS = Math.min(1, pos(sk.flat, 0));
      const spreadP = c.kind === 0 ? 0.75 - 0.45 * flatG : c.kind === 1 ? 0.75 - 0.5 * flatS : 0.75;
      const rr = stem ? c.r * CELL * 0.07 * treeS * u1 : crown ? c.r * CELL * cr : c.r * CELL * Math.pow(u1, spreadP);
      const x = c.x + Math.cos(th) * rr, z = c.z + Math.sin(th) * rr;
      const q = key(cellOf(x), cellOf(z));
      // (not on trodden ground — but through a stretch of the frame the roots have broken; and inside a building's
      // cell only above its roof)
      if (keep ? oldRoad.has(q) && !cracked.has(q) : road.has(q)) continue;
      const b = stand.get(q);
      // (through what is mostly gone, from the ground up; over what still stands, on its roof)
      const roof = b && b.left > 0.45 ? b.h : 0;
      const lift = c.kind === 0 ? 1 - 0.7 * flatG : c.kind === 1 ? 1 - 0.5 * flatS * hash(ci, i, 9) : 1;
      const y = stem ? roof + u3 * c.tall : crown ? roof + cy : roof + u3 * c.tall * (1 - Math.pow(u1, 2)) * (roof ? 0.5 : 1) * lift;
      // (the shade: grass the lighter of the two colours, a tree the darker, scrub between; before the kinds, any)
      // (stage 5: of ground that was used, that share of the points are the other plants)
      const other = c.used > 0 && hash(ci, i, 6) < c.used;
      // (a tree's points apart, when the drawer asks for them so: FutureConfig.tree.apart)
      // (the trees' own colours: no longer the other plants' of used ground; 2 = of the wild forest)
      if (apart && c.kind === 2) vegTree.push(x, y, z, 0.4 * u4, c.wild ? 2 : 0);
      else if (c.wild) vegWild.push(x, y, z, c.kind === 0 ? 0.55 + 0.45 * u4 : 0.25 + 0.5 * u4);
      else (other ? vegOld : veg).push(x, y, z, c.kind === 0 ? 0.55 + 0.45 * u4 : c.kind === 1 ? 0.25 + 0.5 * u4 : c.kind === 2 ? 0.4 * u4 : u4);
    }
  });
  Object.assign(n, { used: vegOld.length / 4 });

  // THE WATER AS A BELT OF PLANTS, NOT A LINE (the artist, 2026-11-17, twice asking what the lines of the layer were:
  // "물길은 그냥 선 말고 식생 띠로 보이게 해줘"; FutureConfig.water). Along a watercourse the ground is fed from below
  // and carries plants of its own in a band (Richardson et al. 2005: 식생 V6) — so the course is drawn as that band:
  // points all along it, thickest at the water and thinning to the band's edge, low at the edge and taller at the
  // water; where the water stands (a pool before what blocks it) a round stand of them. The line itself is not given.
  // STONES BY THE WATER: along every stretch of the course, a scatter of them — most at the water, fewer further out
  const stones: number[] = [];
  if (cfg.stones && cfg.stones.dense > 0) {
    const wideS = Math.max(0.2, cfg.stones.wide) * CELL, per1 = Math.max(0, cfg.stones.dense);
    for (let i = 0; i + 3 < water.length && stones.length < 40000 * 5; i += 4) {
      const ax = water[i], az = water[i + 1], bx = water[i + 2], bz = water[i + 3];
      const len = Math.hypot(bx - ax, bz - az), nS = Math.round((len / CELL) * 6 * per1 * (0.5 + hash(i, 3, 61)));
      const nx = len > 1e-6 ? -(bz - az) / len : 0, nz = len > 1e-6 ? (bx - ax) / len : 0;
      for (let q = 0; q < nS; q++) {
        const f = hash(i, q, 62), side = (hash(i, q, 63) - 0.5) * 2, off = Math.sign(side) * Math.pow(Math.abs(side), 1.6) * wideS;
        stones.push(ax + (bx - ax) * f + nx * off, hash(i, q, 64) * 0.04, az + (bz - az) * f + nz * off, Math.pow(hash(i, q, 65), 2.2), hash(i, q, 66));
      }
    }
  }
  const belt = cfg.water?.belt === true && gapR + edgeR === 0;
  const vegWater: number[] = [];
  if (belt) {
    const wide = Math.max(0.2, cfg.water?.wide ?? 1), dense = Math.max(0, cfg.water?.dense ?? 1);
    const put = (x: number, z: number, r: number, count: number, salt: number) => {
      for (let i = 0; i < count && vegWater.length < 30000 * 4; i++) {
        const u1 = hash(salt, i, 21), th = hash(salt, i, 22) * Math.PI * 2, rr = r * Math.pow(u1, 0.8);
        vegWater.push(x + Math.cos(th) * rr, hash(salt, i, 23) * (0.15 + 0.75 * (1 - u1)), z + Math.sin(th) * rr, hash(salt, i, 24));
      }
    };
    let s = 0;
    // (every stretch of the course — the pools' rims among them: `water` holds both — a stand of points every half
    // cell along it)
    for (let i = 0; i + 3 < water.length; i += 4) {
      const ax = water[i], az = water[i + 1], bx = water[i + 2], bz = water[i + 3];
      const len = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.round(len / (CELL * 0.5)));
      for (let q = 0; q < steps; q++) {
        const f = (q + hash(i, q, 25)) / steps;
        put(ax + (bx - ax) * f, az + (bz - az) * f, CELL * (0.6 + 0.5 * hash(i, q, 26)) * wide, Math.round(per * 2.2 * dense), ++s + 5000);
      }
    }
    for (const [x, z, r] of pools) put(x, z, r * 1.15 * wide, Math.round(per * 14 * dense * Math.max(1, (r / CELL) * (r / CELL))), ++s + 5000);
  }

  // ── pipes: every run laid up to the slot read lies under this ground (carried, not drawn yet — stage 0 of the order
  // of 2026-11-17: the rules of what is left under the ground read them) ──
  const pipes: number[] = [];
  for (const p of input.pipes ?? []) if (p.k0 === undefined && p.k <= K) pipes.push(p.ax, p.az, p.bx, p.bz);
  const left = deposit((q) => stand.get(q)?.left);
  Object.assign(n, { pipe: pipes.length / 4, mound: left.mounds.length / 4, stain: left.stains.length / 4 });

  const buildings: FutureBuilding<C>[] = [];
  for (const [q, b] of stand) buildings.push({ cx: b.cx, cz: b.cz, h: b.h, grown: b.grown, fresh: b.fresh, left: b.left, since: b.grown ? 0 : (cells.get(q)?.since ?? 0), from: b.from });
  return { k: K, buildings, roads: Float32Array.from(roads), roadsOld: Float32Array.from(roadsOld), water: belt || gapR + edgeR > 0 ? new Float32Array(0) : Float32Array.from(water), ...(belt ? { vegWater: Float32Array.from(vegWater) } : {}), stones: Float32Array.from(stones), pipes: Float32Array.from(pipes), ...left, vegOld: Float32Array.from(vegOld), vegWild: Float32Array.from(vegWild), ...(apart ? { vegTree: Float32Array.from(vegTree), treeStems: Float32Array.from(treeStems) } : {}), veg: Float32Array.from(veg), ground: Float32Array.from([x0 * CELL, z0 * CELL, (x1 + 1) * CELL, (z1 + 1) * CELL]), n };
}

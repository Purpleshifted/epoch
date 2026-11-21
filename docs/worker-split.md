# Splitting the wall's CPU work (2026-11-20, branch `claude/worker-split-1d978c`)

Goal: the redesign wall can run with **건물 단순화 off** without the fossil falling behind, without lowering any
picture setting (the 렌더 defaults are untouched).

## What runs where now

| Thread | Work |
|---|---|
| main | React / Leva, bots, applying worker results; the fossil's chunks put on the screen **a few MB a frame** |
| `space.worker.ts` | `SpaceModel`: parts, simplification, what each ground is made of (fuse jobs), vegetation, future layer |
| `side.worker.ts` "walk" | the ways (`walkways.ts`) |
| `side.worker.ts` "fuse" | **the coordinator of the fossil** (`FuseUnits`): which pieces exist, which are done / held / still to do, their order, the chunks sent to the view |
| `side.worker.ts` "helper" × N | **make pieces** (`fuseUnits.makePiece` = `fuseTilesOf` + `turnBack` + `growData`), one at a time each |

## 1. The fossil's pool (commit c7092e3)

- The model sends one unit per **district angle** (`ground:<angle>`), not per building — with one angle there is one
  unit. Splitting the units between workers would give no parallelism, so the split is by **piece**: the coordinator
  stays the only owner of the state and hands the making of each piece to a helper.
- A piece's mesh is a pure function of what it is made from (no module state, no randomness in `fuse.ts`), so a
  helper's mesh is the one the coordinator would have made. The order pieces are chosen in is the same function
  (`pick`). A piece that comes back for a job that has moved on is kept only if its signature and settings still
  hold (as a piece made just before the new job would have been kept).
- The job's context (vegetation history, sediment, look, fusion config) goes to a helper once per job serial; the
  helper keeps the last 16, the coordinator assumes the last 8.
- A helper that fails is dropped, its pieces go back to be made. With N = 1 there are no helpers and the coordinator
  makes the pieces itself, exactly as before. If the coordinator fails, the model's worker makes the mass (as before).
- Knob: **렌더 › 작업 분담 (CPU · 그림은 같음) › 화석 워커 수**. 자동 = `navigator.hardwareConcurrency`: ≥ 10 cores → 3
  (show Mac mini M2 Pro), ≥ 8 → 2 (the artist's M2 laptop), else 1. Changing it lets the old helpers go (their pieces
  are queued again) and starts new ones; nothing already on the screen changes.

## 2. Chunked uploads (commit c7092e3)

`applyChunks` queues each message's work in order (drops, sets, and for a reset the let-go of everything not set
again — after its sets, so nothing stands empty), and the frame loop puts chunks on the screen up to
**렌더 › 작업 분담 › 화석 올리기** MB of new geometry a frame (default 6; at least one chunk a frame; 0 = all at
once, the old behaviour). A chunk set again before its turn is set once. A chunk on the screen stays until its new
geometry replaces it. The GPU upload follows (three.js uploads a geometry the frame it is first drawn).

## 3. Simplification off (commit 135d49f)

Before: `lodOn` off made `lodSec` 0, which turned `assetsOnly` off, which turned **the seeded fossil off entirely**
(the model's own old per-building fusion took over, in the model's worker), and the wall's `uGrowAfter` fell to one
slot.

Now:
- The seeded mass no longer requires assets. With 건물 단순화 off, or 융합 › 덩어리가 자라는 곳 = 모든 부재에, every part
  goes in (steel — column, beam, brace — and drips are still left out, as before: the thin members stay standing as
  parts), each with **its cell-slot's clock** (`bornT`: the top and the stood clock when it was built — the clock an
  asset would have taken from it).
- `erode.fossilSec` carries 건물 단순화's seconds even when it is off; everything that times the fossil's start
  (`uGrowAfter`, the dead fossil's `after`, the pieces' order, the status line) reads `fossilWaitSec`. The seconds
  knob stays visible when the simplification is off.
- When the clock is new and when it starts over (`computeParts`, `bornT`): a cell-slot gets a clock when it is first
  built; it starts over when somebody stands in it again (`takeLived`) or it is built higher (its level rises);
  it is deleted when the building no longer has that slot, when the building is gone, when the rising window lets
  go of it (`floorNow`), and when the world is emptied. Building again in the same place at a later time is a
  higher slot: its own new clock. Since 930429e a part's age is part of its piece's signature, so a clock that starts
  over with the same boxes makes the fossil piece again (before, the old age stayed baked in the mesh).
- With the defaults (단순화 on, 단순화된 것에만) nothing changes.
- Cost to expect: without the simplification there are many more parts per piece, and `voxelTie` (the grid no finer
  than the simplified bodies) does not apply — pieces are slower; that is what the pool is for. Measure on the Mac mini.

## 3b. Nothing stays: the rest goes with its fossil, the place is let go (commit after 84f74dc)

The artist (2026-11-20): "남는 몫 0으로 해. 창 안 올리기로 했잖아. 계속 변화하는 모습이어야 해, 강 바닥의 구성처럼."
With the window standing nothing leaves at its foot, so before this the share the erosion leaves (1 − 다 깎였을 때
사라지는 몫, 25% by default) stood for good and the block only filled up.

- A part whose fossil is surely gone (the same life computeFuse lets the fossil go by — FuseInput.dead: the clock, the
  spread, the depth) goes too, shrinking at its own moment within the next step, as eroded parts do.
- Once a cell-slot's slowest part has gone and shrunk (a step + LEAVE_KEEP_S), the place is let go:
  `DensityField.release` forgets what was put in and drops the cell-slot; its clock, its asset and its parts go with
  it. Whoever stands there later builds anew on a new clock.
- Only while the fossil has a life (융합 › 화석에 수명 on, the seeded fossil); with it off nothing changes.
- Not yet: the ways and the pipes keep their own rules (they are not part of a place's life).
- Readout stages: "places let go, their life over", "places whose life is over, their last parts going".

## 3c. The clock is the log's, not this tab's (step 1 of docs/fusion-agreement-2026-11-20.md §7)

The artist (2026-11-20): "어긋남이 발생하면 안 되지… 깊은 곳도 시간이 더 흐른 게 아니라 더 빨리 흐르는 것처럼 보이게 할 뿐이고."
Before: a cell-slot's clock (`bornT`) began when THIS model first saw it built, and a reload estimated every standing
slot's age from its depth — wrong in a fixed block, where a deep slot may be new.

- `PEvent.w`: when an event was written — seconds of the world's clock since the epoch (the clock the window rises
  by; `useGlobalBots` and `botWorld` write it; the log stores it as it stores the rest). Events before 11/20 have none.
- `DensityField`: each cell-slot keeps `w0` (the sample that built it, or the latest that stood in it at its own
  time) and `wRise` (the latest sample that raised its level — its own, or its building's below it, read by
  `settleLevels` → `noteRises` against the levels as last read). Both go out on the `Seed` (`w0`, `wRise`); an origin
  change rebuilds the column's Seed (the parts' cache is keyed by content, so nothing is regenerated).
- `spaceModel`: `PartsInput.clock` (`WallClock`: now, the rise's stop, standing) from `botGround.window()`; for every
  slot with an origin, `bornT`'s born/top/stood are read back off that time (top+stood is linear in the clock), the
  rise ignored where an asset stands (as before). Slots without an origin keep the old estimate. On a load, the
  density's levels are read every 5 s of the log (`REPLAY_PASS_S`) so a rise gets its time from then.
- Checked (jiti, scratchpad): the field fed tick by tick vs. the whole log in one batch → identical `w0` on all 89
  cell-slots, rises within the 5 s step; two `SpaceModel`s (ticked vs. reloaded) → identical clocks except 14
  rise-based ones 2 s apart. Not yet seen on a real wall.
- Still memory-only (step 2): the asset's copied clock, `tubeSeen` (pipe hardening), `erodeSeen`, `overSince`.
- Still lost on reload: cell-slots whose samples the log has already dropped (`keepWindowSec`) — the field keeps them
  live (`keepBuilt`) but cannot rebuild them; a snapshot of the field (IndexedDB, as `bakeStore`) would fix that.

## 3d. The coordinator chat's list of 11/21 (the artist: "그렇게 하라고 전해")

1. **Where a piece's time goes** (5b5ae6f): `fuseChunk` laps its stages into `FuseChunkInput.stages` — field, blur,
   shell, nets, quads, smooth, finish — plus merge, grow (place values) and a helper piece's transfer (epoch clock:
   the workers' `performance.now()` differ); the view times a message's way, `setFused` per chunk and the first
   draw of a new geometry (its upload: onBefore/AfterRender + onBefore/AfterShadow, once). Status line: 조각 단계(ms)
   …, 화면: 청크 · 정점 · △ · 조각, 올리기: 전송 · 적용 · 첫 그리기. Measured here with the artist's values (voxel 0.25,
   shell · foam · pits · fill · envelope; 487k grid samples a piece): blur ≈ 30 %, shell ≈ 22 %, nets ≈ 23 %, quads
   ≈ 8 %, grow ≈ 6 %, Taubin ≈ 2 % — the cost is the sample count, not one stage. (The shares held over three runs;
   the absolute ms went 650 ms → 25 s a piece as the laptop's load rose: the Mac mini measures.)
   Trimmed without a change to the picture (dc64906): the blur's inner loop unclamped, the blur of no growths and of
   the shell's young thickness skipped. Bigger savings need the artist's knobs (voxel) — or the pool.
2. **The dead fossil's flow** holds (checked with scripts): parts gone from a job → their pieces held until the
   neighbours are remade (≤ HOLD_MAX_MS 4 min) → shown dissolving (FUSE_BLEND_S 6 s, fusion-look) → `sweep` → the
   chunk's `drop` → the view's `let_go` disposes the geometry (`setFused` disposes a replaced one; the view disposes all
   on unmount). Helpers keep one job context per ground (not 16 serials) and forget a dropped ground. Readout counts
   from the meshes themselves: 화면: 청크 N · 정점 · △ · 조각. Bound: pieces standing = pieces whose parts stand.
3. **Fewer triangles for settled chunks** (3738a77): `compactFuseMesh` at the end of `fuseChunk` drops the vertices
   no face uses — **65 % of a chunk's vertices were padding** carried for nothing (now 0 %; picture identical).
   `simplifyMesh` + `FuseUnits.settleSimplify` (knob 렌더 › 작업 분담 › 굳은 화석 조각의 삼각형 줄이기, default 0): one
   chunk per idle turn whose pieces have all stood 3 min, meshoptimizer (three's `meshopt_simplifier.module.js`,
   WASM) with LockBorder + ErrorAbsolute (half a voxel) + a lock on every vertex sharing its place (the seams between
   pieces); index-only, compacted — the shader's per-vertex values stay. Tested: 50 % triangles, all border vertices
   kept, no vertex with another's values. Not done: "far chunks" (the worker does not know the camera).
4. **BatchedMesh — assessment, not built.** The chunks are 42 cells × 30 slots; the world is 160 cells → at most
   4 × 4 ground chunks × 2 slot bands ≈ 32 chunks for the artist's 45-slot block (+ a few at seams), each 2 draw
   calls (stone / resin groups) per pass (colour, shadow, AO depth) ≈ 200 draw calls a frame — not hundreds of
   chunks, and the wall is pixel-bound (10/29). Not worth it now; revisit if the readout shows > 100 chunks. If ever:
   one material per BatchedMesh → two batched meshes (stone / resin) or a per-vertex material switch; the custom
   attributes (anchor, growA/B, late, blend) must share one layout (they do) with vertex/index capacity reserved up
   front (chunks vary 10×); `onBeforeCompile` patches must keep `batching_pars_vertex` / `batching_vertex`; the
   custom depth material needs the batching define; `perObjectFrustumCulled` off (the shader moves vertices); no
   per-chunk uniforms are needed (stamps and blends are per vertex).

## 4. Future layer in its own worker — not done

Left for later: it is computed in the model's worker on `SpaceRequest.future`; moving it needs the model's parts,
ways and pipes sent across (or computed there), which is a larger change than the time allowed.

## 5. SharedArrayBuffer (note only — not built)

Each helper now holds its own copy of a job's context (mostly the vegetation history), and every mesh is copied
into the view by transfer (no copy) — so the duplication is the context, a few MB per helper per job. Sharing it
through `SharedArrayBuffer` needs the page to be **cross-origin isolated**: `Cross-Origin-Opener-Policy: same-origin`
and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`, Chrome only — Safari supports only
`require-corp`). What that would touch:

- **Next.js / Vercel**: headers set in `next.config.ts` `headers()` (only on `/v2/*` and `/exhibition/*` would be
  safest). Vercel's preview toolbar / comments (vercel.live, an iframe and script from another origin) would be
  blocked under `require-corp` on previews.
- **Fonts**: `next/font/google` self-hosts them on our origin — fine.
- **Relay / bot server**: the marker relay and the bot server are WebSockets (`wss://…workers.dev`) — COEP does not
  apply to WebSockets; any `fetch` to them must be CORS (`mode: "cors"`) with `Access-Control-Allow-Origin`, and
  any image or script loaded from them needs a `Cross-Origin-Resource-Policy: cross-origin` header.
- **Sound**: Magenta checkpoints are fetched from storage.googleapis.com (CORS — should pass); NoiseCraft is served
  from our own origin.
- **Images**: the sprite / photo layers proxy Wikimedia through `/api/sprites/image` (same origin — fine); any
  `<img>` or texture loaded straight from another origin without CORS would fail.
- **Popups**: `EntryGroup` opens the views with `window.open`; under COOP `same-origin` a same-origin popup keeps
  its opener only if it is isolated too — check if anything talks across `window.opener`.
- **Safari / iPhone visitors**: `/exhibition/personal` on phones — isolation is supported (Safari 15.2+), but every
  third-party resource on those pages must pass.

Recommendation: not before the show; if the helpers' memory turns out to matter on the Mac mini, isolate
only the wall's route first.

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

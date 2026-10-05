# Performance notes — deposit field

> Numbers below were measured in **Node 22 on a desktop**, not on a phone or in a browser.
> They are a cost model, not a confirmed diagnosis of the on-device stutter.

## 1. Cost model (before the fix)

Per 0.25 s tick (3000 deposits, 20,000 steps):

| Operation | Cost |
|---|---|
| `resolveField` of all deposits | ~7 ms |
| `resolveNatural` | ~9 ms |
| `naturalItemsAround` | ~1.6 ms |
| every 1 s: `JSON.parse` deposits + steps | ~12 ms |
| every 1 s: `JSON.stringify` | ~8 ms |

A phone is plausibly 3–5× slower, so a hitch every 0.25 s is plausible.
Not yet ruled out: Bloom/Vignette chain, ocean shader, Leva.
A/B tests: `botCount` 0 vs 5, Bloom off, Chrome Performance panel.

## 2. Changes (client)

- `GroundStore` (in `lib/stratum/field.ts`): per-cell sorted deposit times and step times; incremental, no full rebuild.
- Resolve only the cells within `VIEW_RADIUS` (24) of the viewer, every 0.5 s.
- Natural stock window cached per player cell.
- localStorage written every 3 s and only when dirty. No polling; reads only on the `storage` event.

After (Node, same data): `resolveNear` r=16 ≈ 5 ms, `resolveNaturalIn` ≈ 1.5 ms, `naturalItemsAround` ≈ 1.2 ms, add one event ≈ 0.

## 3. Exhibition server design (not built yet)

1. **Authoritative server** keeps per-cell timelines (deposit times, step times). Not individual footsteps.
2. **Interest management**: a phone receives only the cells around it, as deltas.
3. **Aggregate views** (top, side, timespace) receive per-cell aggregates, not raw events.
4. **Pruning**: vanished items can be dropped from the render list, but their times stay in the per-cell timeline. They still bury other items and still count as wear.
5. **Incremental, low-frequency resolve** (0.5–1 Hz).
6. **Deterministic recompute**: all fates derive from hashes of event ids, so clients can recompute from the same events.
7. GPU draw is cheap (one `Points` draw). CPU and network are the bottleneck.

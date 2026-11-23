# Mobile view lab

The personal view's assets, one page each, tuned against the references, then run together. Started 2026-11-23 from the
joined branch 8a06b37 (street-feel + future-presence) on top of the redesign 74d9e64. Branch
`claude/future-view-lab-reference-b7bdc2`, dev server `web-mobilelab` **:3029**. The artist approves **locally**:
`http://localhost:3029/lab/mobile`.

## Hierarchy

- Home: EXHIBITION · REHEARSAL (Global, Future, Personal, Personal · gallery) · **LAB** (Visual lab, **Mobile view lab**, Management).
- `/lab/mobile` → five buttons:

| page | address | asset | its Leva group (file) | test scene put on the address |
|---|---|---|---|---|
| scan (future) | `/lab/mobile/scan-future` | the future's place: 겹침 as thin lines on white | `scan (future) · 미래의 장소` (`labKnobsScanFuture.ts`) | `botserver=0` |
| scan (present) | `/lab/mobile/scan-present` | the present place: paper, exposure, ground, grass, buildings, view; later the lidar rings | `scan (present) · 현재의 장소` (`labKnobsScanPresent.ts`) | `botserver=0` |
| bot (present) | `/lab/mobile/bot-present` | the others: body, walk, window in the long exposure, the asker | `bot (present) · 현재의 사람` (`labKnobsBotPresent.ts`) | `botserver=0&crowd=24` |
| bot (future) | `/lab/mobile/bot-future` | the future's observers: body-shaped window, windows left behind, fill when near | `bot (future) · 미래 발굴자` (`labKnobsBotFuture.ts`) | `botserver=0&futurefix=1` |
| action preview | `/lab/mobile/preview` | everything, like the rehearsal, on the lab's values | none listed | bar: 리허설 세계 / 시험 장면 |

Every asset page also lists the shared ground `바탕 · 종이와 노출` (`labKnobsBase.ts`: the white paper switch, the long
exposure, the photograph's finish). Nothing else is listed there (`installLabPanelFilter`). `/v2/mobile` (rehearsal and
exhibition) lists none of these, nor the black look's detail folders (`?knobs=all` lists everything).

## How the values travel

- The five groups are stored under the page `/lab/mobile` whatever page reads them (`levaSave.ts pinLevaGroup`,
  `mobileLab.ts`): key `parliament.leva:/lab/mobile:<group>`.
- Every personal page (`/v2/mobile`, `/v2/lab/mobile/*`) pulls `/lab/mobile` from the server before Leva mounts
  (`ServerPresetsGate`).
- A save goes to `/api/presets`; without a database here (dev, branch previews) the lab's keys only are read from and
  written to the redesign production's database (`app/api/presets/route.ts labUpstream`). So a save on the local lab is
  what any machine reads. Production's `/v2/mobile` reads them once this branch is merged into the redesign.
- **A saved value beats the code default.** After a group has been saved once, changing its default in code changes
  nothing on screen until the group is saved again (or a `SavedMigration` is added to its `savable`). Asset sessions:
  say so when a default changes.

## Scene on a lab page

`ParliamentScene lab={page}`: the life begins at once (no title, notices, consent or name; `useLifeSession quick`) and
lasts an hour. Asset pages show their asset alone: people only on bot (present), the future's place only on scan
(future), its observers only on bot (future); scan (present) is the place without people. The place and the
observers now run side by side (`FuturePresenceVisual.overlayOn` / `encounterOn`). The references (local only,
`/api/dev-refs`) are listed per page in `mobileLab.ts LAB_INFO.refs`.

## Files per asset (who edits what)

| asset | owns |
|---|---|
| scan (present) | `labKnobsBase.ts`, `labKnobsScanPresent.ts`, `InkPaper.tsx`, `longExposure.ts`, `paperLook.ts`, `streetLook.ts`, `DitherGround.tsx`, `NatureCloud.tsx`, `Marks.tsx`, `PathLines.tsx`, `StreetHud.tsx`, a new ring-scan file |
| bot (present) | `labKnobsBotPresent.ts`, `PointPeople.tsx`, `bodySheet.ts`, `lib/parliament/pointPeople.ts`, `walkCycles.json` |
| scan (future) | `labKnobsScanFuture.ts`, `FuturePresence.tsx` (drawing), `lib/parliament/futurePresence.ts` |
| bot (future) | `labKnobsBotFuture.ts`, `FutureEncounter.tsx`, `futureWindows.ts`, `futureFrames.ts`, `excavators.ts`, `futureSound.ts` |
| shared (small edits, re-read first) | `usePersonalVisuals.ts` (assembly), `FuturePresence.tsx useFuturePresenceControls` (assembly), `ParliamentScene.tsx`, `RoleField.tsx`, `mobileLab.ts` (refs lists) |

## Per asset (to be filled by each asset's session)

### scan (future)
### scan (present)
### bot (present)
### bot (future)

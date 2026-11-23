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

**Status (2026-11-23): PAUSED by the coordinator (machine overloaded) after the reference study; nothing built, no
question put to the artist yet.** Code untouched (`FuturePresence.tsx`, `futurePresence.ts`, `labKnobsScanFuture.ts` =
HEAD). Resume = put the three directions below to her and build her pick.

**What is on the page now** (headless capture 1080×1920, local bots ticked via `?knobs=all`, 100 s in): the layer is
read (28 buildings, 177 parts kept, 2124 edges, 33 plant clouds) but **the screen is blank white** — the remains are 1 px
`lineBasicMaterial` #8c8c8c, which InkPaper's depth rule (near blur mix 0.35, far blur 10.5 px, far pale) dissolves on
the paper; the mounds are white points (invisible on white); only the visitor's own trace squares show (dark grey at
the screen's sides). With `?botserver=0` alone the page has **no buildings at all** (0 for minutes: the field needs
others) — the page needs a test scene of its own (a fixed future round the visitor, e.g. `?futuredemo=1`) before the
artist can judge anything.

**References and what they do** (`LAB_INFO["scan-future"]` + the folder):

| still | what the line does |
|---|---|
| IMG_1601 | the one thin-line-on-white picture: hairlines (≈0.5–1 px, near black) unravel out of the masses as a **tangle of many near-parallel strokes** — density makes the tone (more strokes = darker), nothing has a fill; loose ends trail past the form; a straight thin grid behind, much lighter; green only for the moss |
| IMG_1579 | one long pencil hairline on white, mid grey, slightly wavering, crossing everything — the line as a record, not a contour |
| IMG_1586 / 1587 | the scan line: ONE straight line across the whole picture (red there, **white** by her decision 11/22); the only moving element |
| IMG_1589 / 1597 / 1599 | disappearance: columns of the picture **drip down** (pixel-sorted vertical streaks) or break into blocks — her pick 11/22: "세로로 흘러내림이 흥미로움" |
| IMG_1594 / 1567 | the transparent box: thin edges of a volume seen through, no faces |

Common: hairlines, no fills, tone from **how many** lines cross (not from a grey colour); depth = fewer/lighter
strokes far away; appearance by a sweep, disappearance by dripping.

**Directions to put to her** (common to all: screen-space hairlines 0.6–1.0 px antialiased, graphite near the eye →
paper at the fog's far by the exposure's own depth rule, steel/piles heavier, stripped parts broken; mounds as grey
stipple or contour rings, dark earth as light stipple, own traces as thin-line squares; plants green points; the 2 s
re-read eased ≥ 200 ms, never a pop):

- **A · 도면** (1601's grid, 1579): one clean hairline per edge; new lines draw themselves end to end (≈0.4 s), gone
  ones erase back. Quiet and architectural; risk: reads as CAD.
- **B · 얽힌 선** (1601's unravelling — recommended): each re-read lays the edge once more, a hair off, and old strokes
  fade over a few seconds — the long exposure of the re-reads. What lasts (steel, piles) piles up dark and tangled,
  what is stripped keeps one or two strands; what goes **drips down** (1589/1597). Time accumulated, not a filter.
- **C · 스캔 선** (1586/1587): every re-read a white scan line (a white gap with a faint grey hairline, so it reads on
  paper) sweeps the view top to bottom (≈1.2 s) and develops the lines behind it; they fade until the next sweep — the
  place breathes with the scan; going = drip.

Build plan once picked: own instanced screen-space segment shader (LineSegments2/LineMaterial-style, per-segment
birth/death/kind attributes for draw-on, drip and weight), fog-aware; knobs only colour, weight, fade, effect,
animation in `labKnobsScanFuture.ts`; captures against 3 stills into `docs/img/mobile-view-lab/scan-future/`.
### scan (present)

**ANNOUNCEMENT to every asset (2026-11-23): the paper is now NEUTRAL WHITE and the white reaches 255.** The artist:
"배경이 계속 깔끔한 화이트가 아니라 누렇게 보임" ("누르죽죽").

- Measured (headless, her saved `바탕` values, demo world): the paper came out at (248,247,243), a cream with a yellow
  cast (R−B +5), never above ~250; the references' ground (IMG_1580/1575/1576/1582) is neutral 255, 67–79 % of
  the frame ≥ 250.
- Causes, in order: ① `PAPER` `#f4f2ec` (the yellow cast); ② `exposeTone`'s shoulder `1 − e^(−x·1.6)` compressed
  the highlights, so even the paper (l = 1) ended at 0.96 linear, a dull cap. The long-exposure feedback adds nothing
  on scan-present (nothing on `EXPOSURE_LAYER` there). The building smudges are local grey patches, not the cast.
  Not measured (the machine was overloaded): the observer's near-fill film `paper × 0.84` (futureWindows, bot-future),
  which now follows the neutral paper.
- Fix: `streetLook.ts PAPER = #ffffff` (`paperLook.paper` too); `exposeTone` shoulder is now `g(x) = x + x² − x³`
  above the knee 0.8. It leaves the knee at slope 1, never darkens, and reaches white with slope 0, so highlights
  BLOW OUT into the white (the `밝은 쪽이 부드럽게 날아감` knob = how much of that lift). The grain is off on the blown
  white (`blownGrain`), so the paper stays a clean 255. After: (255,255,255), R−B 0, 97 % of the frame ≥ 250.
  Code constants, not Leva values: they show without a re-save. **Approved by the artist on her local page
  (2026-11-23: "깔끔해졌어").**
- Capture: `docs/img/mobile-view-lab/scan-present/paper-before-after.png` (before · after · IMG_1580).
- Left, for the asset sessions: `MobileLabStage.tsx` loading placeholder still `bg-[#f4f2ec]` (a brief cream before
  the canvas). The artist also said the long exposure meant the LOOK, not a feedback run in the browser (bot-present
  is moving the people off `EXPOSURE_LAYER`); once nothing uses the layer, InkPaper's feedback pass and its knobs
  (잔상, 쌓인 것의 최대 어두움, 빛 번짐, 노출 과다, 손떨림, 노출) can go. bot-future's windows still use it.
- Paused (artist, 11/23: only the paper and the exposure for now): the place's reference study, then the lidar rings.
  Her scan reference (pasted in this chat, not on disk): lidar rings round the sensor coloured by distance, each
  object in a coloured 3D box (edges + translucent fill), a label, black ground. Open questions for when she turns to
  it: black or white ground, the reference's colours vs "colour only for vegetation", which objects get boxes and
  what the label says.

### bot (present)

**State: paused 2026-11-23 (machine load) before anything was built — the page is as the lab's first commit left it.**
Work in progress (not in the repo, nothing live): `side-session-notes/local_90c2440b-…/bot-present-wip/` — a patch of
`bodySheet.ts` + `PointPeople.tsx` and a new `bodyArchetypes.ts`, with a hand-over note.

**The artist's direction (2026-11-23, in this asset's chat), which replaces the stage-by-stage notes in `street-feel.md` §12–15:**
- "지금 플리커링 있어 보이는 거 끔찍하고" (future too) — no sample jumps, no per-sample shake or stretch pulses, no
  melody blink on the window. Motion is continuous: the body walks at the record's pace between samples (dead reckoning
  with a gentle correction), never surging every half second.
- "'장노출'을 하라는 건 그 효과를 말하는 거였지 억지로 브라우저에서 장노출을 돌리라는 게 아니었음. 걸어가는 모습을 잔흔으로 남겨서
  그게 마치 '동세의 시공간 덩어리'로 보이게" — the people do not go through InkPaper's feedback any more. A walk leaves
  **afterimages**: the body at past moments, each left where it was (a chronophotograph's stamps), fading and softening
  with age, overlapping into one mass of the movement; the body now crisper and denser (rear-curtain flash); standing,
  they coincide into one solid figure.
- "future bot 은 그 사이로 미래가 비쳐 보이는 대신 현재는 옷 색이나 여튼 다채로운 블러 효과" — present = the clothes'
  colours, a colourful blur in the traces; the future bot shows the future through the same mass (bot-future's).
- "배경이 계속 깔끔한 화이트가 아니라 누렇게 보임" — scan (present)'s paper (`paperLook.paper` is `#f4f2ec`); relayed.
- "골격이나 움직이는 것들도 레바로 세세하게 조절해보고, 체형 아키타입도 present 에서 만들고 싶음 … 커스텀이나 다양화를 하려고
  이 세션을 만든 것" — knobs for the skeleton and the motion, and body ARCHETYPES the artist makes herself.

**The plan, ready in the WIP (to build on resume, her check after each):**
1. Afterimages + no flicker: `makeBodyMaterial(poses, "paper")` draws each body and trace straight into the scene as a
   coloured filter multiplied on the white (layer 0, depth-tested at the body's real surface via `gl_FragDepth`), a
   `"depth"` pass writes the bodies' depth for the scene's near-sharp/far-soft rule; per-instance strength, saturation
   and edge softness (`iBody2`). Trail knobs: length (s), count, the body now, the traces' ink, fall-off, softness now/old
   (cm), the old traces' saturation. Windows follow the smooth body and stretch over the trace span; no shake, no blink.
2. Archetypes (`bodyArchetypes.ts`, five slots in their own saved folder `bot (present) · 현재의 사람.체형 아키타입`):
   share in the crowd, height, legs/torso/shoulders/hips/arms (the height kept), trunk/waist/limbs/head girth, lean, hunch,
   head down, which CMU walk, stride, arm swing, bounce, sway, foot lift, pace, arms (swing · pockets · behind the back ·
   phone · crossed), hem, hair, fixed top/trouser colours. First slots: 보통 · 키 큰 코트 · 다부진 · 구부정한 · 폰 보는.
   A lab-only view knob shows one archetype alone.

**Interface for bot-future (when it lands):** `bodySheet.ts` grows three texels a row (girth; own top colour; own
trousers colour) — `POSE_TEXELS` 18 → 21, `BodyPoses.write(row, J, build, code, girth?, colours?)`; rows written the old
way read as before (zeros = defaults). `BODY_GLSL` gains globals `bSoft` (0 unless set after `loadPose`), `bLimb`,
`bGirth`, `bBelly`, `bHeadS`, `bTop`, `bPants`, `bOwnCol`; `marchBody`'s signature is unchanged. `standOf(cycle)` exported.

### bot (future)

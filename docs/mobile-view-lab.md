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

## Test browser and load (the artist, 2026-11-23)

- **Captures use Chrome for Testing, never `/Applications/Google Chrome.app`.** A test Chrome launched from the artist's
  own app (headless or not) is the running "Google Chrome" to macOS, so her Dock click went to a windowless instance and
  no window opened. Chrome for Testing is another app (`com.google.chrome.for.testing`), already on the machine:
  `$HOME/.cache/puppeteer/chrome/mac_arm-148.0.7778.97/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
  — `--headless=new --mute-audio --no-first-run --user-data-dir=<own temp dir> --remote-debugging-port=<free port>`.
- "헤드리스 크롬 필요할 때는 쓰는데, 지금 안 쓰는 건 닫아": close it as soon as a capture is done; one at a time.
- One asset in focus at a time; the others stay paused (no captures, no builds) until the artist turns to them.

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

**Study 2 (2026-11-27, the artist: "스캔뷰 어떻게 보여줄건지 스터디") — the future inside the LIDAR view.** Read as: the
present is now scan (present)'s lidar point cloud on black (distance colours mint → green-yellow → peach → pink), so how
does the future's place (remains, mounds, plants) show in that view. The white-paper line study below (11/23, A·B·C) no
longer fits the black ground; its line idea lives on as direction C here.

- State: wherever the lidar runs (scan (present), the action preview) the future is not drawn at all (107bc5c, her
  "레이더 돌릴 때는 가려줘") — so the joined picture has no future now. The scan (future) page itself is still the old
  white paper + grey 1 px lines. No capture today (load average 59–71).
- References: the lidar ones (3Dpc, 5d1736, her pasted photo) — the place exists as far as the scanner reached, hidden =
  empty, found objects get thin boxes and a label; `gaussian splatting/7cznystu6zhh1.png` — an old, drifted capture:
  white walls smeared along the view ray, black, a faint grid (a record from another time); `interaction_blob.jpeg` —
  white point masses tied by mint boxes on orbits; IMG_1601/1594/1567 — hairlines, no faces, seen through;
  1589/1597/1599 + pointclouds #14 — leaving = dripping down (her pick). The present owns the colour ramp; the future
  keeps the old rule (human remains achromatic, only life green), so colour alone tells the two times apart.
- Directions put to her:
  - **A · the scanner reads the future**: the same rays read the future's ground (remains, mounds, plants) — white/grey
    points (steel and piles brighter and denser), plants green; while a button / F is held, or on a cycle, the scanner
    switches time: the present's readings die out on their own decay while the future's come in (no pop; one thing at a
    time, as her radar decision says). Dots round like the present's, or stretched along the ray like the splat capture.
  - **B · the scan's residue becomes the future (recommended)**: the scanner keeps reading the present; a reading that
    falls where something will REMAIN (inside a future part's volume; where plants will cover) does not fade — it stays
    and pales to white (green for plants). Looking round leaves the ruin as an achromatic afterimage among the present's
    passing colours: the visitor is the scanner (ACM 2021), looking deposits the future. Leaving, the residue drips down
    over tens of seconds. Where future and present do not overlap (piles of a building already gone), a small share of
    rays (10–20 % of the budget) reads the future alone.
  - **C · found-object boxes**: each remain as the lidar viewer's detection box — 0.75 px white wireframe on black, no
    faces, a small label (철골 · 말뚝 · how much is left); drawn when the scan's points touch it, dripping when gone.
    Lightest and most legible, but scan (present) planned "coloured 3D boxes + label" for present objects next: one box
    language to settle with that asset.
  - Common: mounds as a dome of white points (they read on black as they are), dark earth as sparse grey points, own
    traces as thin-line squares; the 2 s re-read lets points come in and go one by one.
- Needed for any of them: the lidar + black ground on the scan (future) page too (`lidarActive()` is scan (present) and
  the preview only); a small hook in `LidarScan.tsx` (scan (present)'s file — to be agreed with it) for a second world to
  read or a "lasting" test per reading; a test future on the page (with `?botserver=0` alone it has no buildings).

**Her pick (2026-11-27): B, "있을 때만" — and "미래 관찰자가 사라지면 이전 pointcloud 흩날려 사라지듯이".** Built as v1 (7f037f3),
not yet seen on screen by her or by a capture (load average 250+ at the time):
- `FutureResidue.tsx`: every `미래를 다시 읽는 간격` the future round the visitor (lidar range + 4) is read as before
  (`futurePresence`, the 미래 읽기 knobs) and turned into one pool of points, part by part: the parts' faces (`surface`
  density; `futurePresence` now says which part each point is on and whether it is steel or a pile), the trees, the
  plant clouds (a low dome, `식생 점 밀도`), the mounds (a pale dome), the dark earth (grey, flat). Nothing is drawn
  until FOUND.
- Found: while an observer is within `관찰자가 있다고 보는 거리` (excavatorsAt with bot (future)'s 관찰자 knobs; on the
  page `?futurepass=1` gives one that comes from 18 ahead to 3.5 (6 s), stands (12 s), walks off sideways (6 s) and is
  gone (8 s)), a lidar reading within `스캔이 부재를 찾는 거리` of a part finds the WHOLE part: it develops from the touch
  outwards (`번지는 속도`), first in the lidar's colour for its range, then over `하얗게 바래는 시간` to its own (white ×
  `남은 부재의 색`; concrete × `콘크리트 밝기`; plants the 식생 색) — and stays (`남는 시간`, 0 = until the observer leaves).
  The lidar's readings come through `LidarScan.lidarTap` (read only); 240 rays a frame of its own onto the ground find
  what lies there whatever the ground radar draws (lines leave no readings).
- Let go: when the observer leaves the reach (or is gone), every held part blows away the way it walked (standing: away
  from me), each point after its own delay (`흩날림 엇갈림`), spread ±40°, rising (`위로 뜨는 정도`), swaying, smaller and
  fainter over `흩날리는 시간` (`흩날리는 거리`).
- A part that leaves the future's reading (the slot moved on) fades in a second where it was; one blowing away finishes.
- Where: the scan (future) page (now with the lidar and its black ground, the 전시 세계 / 시험 장면 switch); the action
  preview and the experiment when `개인뷰에 켜기` is on. The old overlay (lines on paper) shows only with the lidar off.
- Known: the observer itself is still not drawn under the lidar (bot (future)'s, 107bc5c), so the residue comes and goes
  without the observer being seen; on 시험 장면 the remains need buildings in this browser's stored world (the wild plants
  round the visitor are there anyway); `__residue` in the console (parts, points, held, present, observer distance).
- 5ba87cf: far off the residue is as sparse as the lidar's far readings ((lod/d)²) and gone at its reach (the far plants
  had piled into a green band along the horizon); plant density 8.

**The dream's colours (2026-11-27, "미래 색을 좀 더 꿈처럼 다채롭게" → her pick A + C; 53c638a, type check only — a headless
look hung at load 230):**
- A · the plants as the night gardens of IMG_1586/1587: each plant cloud and tree its own colour family (`식생 팔레트`:
  정원 1586 = sage, olive, lavender, grey-green, yellow-green, mint-grey with coral, dusty pink, butter, rose, violet
  flowers; 밤 숲 1587 = deep greens, moss, olive grey, teal, dry with poppy, delphinium, peach, red, yellow; 초록 하나 = the
  old 식생 색), a little of a neighbour's family in it; a meadow's points flower by its own flower share × `꽃 비율`; tree
  stems a birch's near-white. What is left stays pale (white × concrete), the human-traces rule kept. `식생 채도`.
- The grain, apart from the present's crisp even dots: `점 크기 편차` (most small, a few large), `점 부드러움` (0 = the
  lidar's one-pixel edge … 1 = a soft round glow, drawn a little larger), `겹치면 밝아짐` (additive on the black).
- C · blowing away, each point takes its bloom colour (a petal's from the palette for plants, a pale pollen of the whole
  palette for what is left) and swells a little before shrinking (`흩날릴 때 피는 색`).

**Her palette, threads, a natural blowing away, fuller trees (2026-11-27, 8a6b1c9):** "색 팔레트 내가 고를 수 있게",
"퍼질 때 점들이 연속적으로 이어져 보였으면", "흩날림 더 자연스러워야하고, 나무는 더 풍성해보여야".
- `식생 팔레트 — 직접 고르기`: 잎 1–6 and 꽃 1–5 pickers (default the garden), three buttons load 정원 1586 / 밤 숲 1587 /
  the old single green into them (then save as ever). The palette select is gone.
- Threads: each point that had appeared draws a line (additive) from where it was `실의 길이` seconds ago to where it is
  (`흩날릴 때 실처럼 이어짐`, 0 = points only).
- The blowing away: a gust sweeps through from upwind along the observer's way (`바람이 훑고 지나가는 시간`, was
  흩날림 엇갈림); plants lift and drift far (`식생이 떠오르는 정도`), what is left sinks a little as dust before the
  wind takes it; one swirling flow shared by neighbouring points (`흩날림 소용돌이`); each point its own flight time,
  an eased start and a drag at the end.
- Trees: the crown filled with leaf clumps round its own points (`나무 풍성함 ×`, 4), the stem drawn whole from the
  ground with a birch's dark marks.
- The residue writes its depth again (with the glow on it had not, and the photograph's pass gave it the far blur) and
  shows within `보이는 거리` (14 world, fading from about half of it): far points had made a glowing band.
- Headless check (Chrome for Testing, `?botserver=0&futurepass=1`): no errors; at the release the points rise in
  their bloom colours as soft lights and are gone in about 2 s. Not yet seen by her (her Chrome could not load :3029
  until the dev server was restarted at her word — it had grown to ~5 GB on the 8 GB Mac).

**The threads out, the future's own long exposure in the world (2026-11-27):**
- "억지로 실 적용하는 건 별로고... 미래 스캔 레이어에만 선택적으로 장노출 못 남기나" → 7558d06: the threads and their knobs
  removed; the residue alone drawn into a screen-space feedback buffer of its own (four moments a frame), laid over
  the picture — the present's lidar crisp.
- "장노출 내가 움직이는 거 따라서는 적용되지 말고 실제로 점이 변하거나 움직일 때만" → 56a2321: the screen buffer is gone (it
  smeared with the visitor's turning). Each point that blows away draws a ribbon in the WORLD — a little wider than the
  dot, along the very path it took over the last `움직인 점의 잔상 길이` seconds (eight pieces, following the swirl),
  strongest at the point, fading to the oldest end, in its bloom colour (`잔상 진하기`). A point that stands leaves
  nothing; turning the head smears nothing. Ribbons only exist while a release runs (instanced, a ring of 40 000).
- 1b4b6bf: default 0.25 s / 0.45 — at 0.8 s (headless) the blown points drew long straight streaks across the sky, the
  threads' look again. Held, the plants read as a garden of coloured points; no horizon band.

**The long exposure is of the READINGS, not the blowing (2026-11-27, d5fa717):** "이 노출은 흩날리는 거 강조용보다는 실제
읽어오는 점 위치가 바뀌었을 때 그걸 겹쳐보이게 하려는 목적이 더 큰데 그게 안 느껴짐". Every `다시 읽어 겹치는 간격` (0.5 s) the
residue is laid down anew, each point off by a scan's error (`읽을 때마다 어긋남`, 4 cm), and the layer shown until then stays
where it was as an earlier layer (a ring of 8 Points, ≤ 40 000 points each), fading over `이전 읽기가 남는 시간` (3 s) at
`이전 읽기의 진하기` (0.45). The future's reading (every 2 s) lays one too before it replaces the pool, and a part it changed
is matched to the found one it replaces (same kind, boxes overlapping) and stays found. Earlier layers go within 0.6 s
when the observer leaves. The blowing smear became an option, off (`흩날릴 때 번짐`).

**Glitch, bleed, size and density; the blowing per kind (c0768d6):** "글리치나 번짐효과 같은 것도 넣고 싶음 (점 크기나
밀도 포함)", "줄기 / 잎/ 건물부재가 fade out 되는 방식을 따로 정하고 싶음 뭐 떠오르는 정도나 등등 레바로".
- On the earlier layers only, more as they age: `번짐` (dots larger and softer), `가로 찢김` (screen bands torn sideways,
  each layer its own), `세로 흘러내림` (columns sliding down), `블록` (screen blocks dropping out or their dots grown),
  `오래될수록 성겨짐` (thinning).
- `흩날림 — 건물 부재 (둔덕 · 흙 포함)` / `— 잎 (풀 · 꽃 포함)` / `— 줄기`: each its flight time, distance, rise (below 0 it
  falls), swirl, bloom colour. Stems are their own kind (they lift late, as if uprooted); dust dips first. The shared
  blowing knobs are gone; `바람이 훑고 지나가는 시간` stays shared.
- Checked: type check only. The headless look did not start (load 110–140, swap 7.4/8 GB); the :3029 server had grown
  to 2.5 GB again an hour after its restart — restart it when the page drags.

**Everything per kind (08cb230):** "그 모든 효과를... 부재 / 줄기 / 식생 따로 정하게 해달라니깐 애초에 레바를...", "점 크기도
그렇고 걍 전부 다". Leva = `잔류 — 공통` (observer distance, finding distance, how long it stays, reach, layer interval,
gust sweep) + three folders `건물 부재 (둔덕 · 흙 포함)` (colour, concrete) / `줄기` (colour) / `식생 (잎 · 풀 · 꽃)` (palette,
saturation, flowers, density, tree fullness), each with `· 점` (size, size spread, softness), `· 나타남` (spread,
develop), `· 장노출 · 글리치 (이전 읽기)` (scan error, earlier layers' strength and time, bleed, tear, drip, blocks,
thinning), `· 흩날림` (time, distance, rise, swirl, bloom colour, smear, smear strength). Keys kp* / ks* / kl*; the
programs read each per kind (vec3: parts, plants, stems); earlier layers carry the kind. Shared effect keys removed;
the palette and the shared knobs kept their keys.

**Her colour profiles (f3388dd):** `visual_reference_images/color_profiles/` (IMG_0637, 1970–1976): electric nature —
cobalt/violet against vermilion/red/hot pink, acid chartreuse and mint accents, olive and brown beneath, lavender
white. Seven buttons in the plants' palette (`프로파일 · …`), each read off its picture by k-means and lifted to shine
on black; each sets the six leaves, five flowers, the parts' and the stems' colours (`FutureResidue.tsx
COLOUR_PROFILES`). Not yet seen on screen. The :3029 server was restarted at 3 GB (standing rule); cold compile 56 s.

**The plants' colours flow (acdcf74):** "컬러팔레트가 시간에 따라 유기적으로 변하게 … 다채롭고 꿈같은 느낌 … 식생에 대해서만",
"컬러팔레트 몇개에 대비되는 색 있는 게 좋은데 그게 마지막에만 확 번져서". `FLOW_GLSL`: a slow field (sines out of step, bent by
one another) moving through space and time carries each plant point round her palette — leaves through the six leaf
colours, flowers (marked kind 1.25) through the five flower colours — and patches of the flower colours drift through
the leaves, so the contrast lives with them instead of only bursting at the blowing away. The layer of now and the
earlier layers flow alike; stems and parts keep theirs. `식생 · 색의 흐름 (시간)`: 흐르는 정도 0.6, 팔레트 한 바퀴 14 s,
색 물결의 크기 6, 대비 색이 번지는 정도 0.35. Relayed to the main chat: her "한 데까지 푸시하고 redesign 에 넣으라고" — take the
branch's current head. (The main chat put 750462d on the redesign's production; acdcf74 and after wait for the next 올려.)

**When the future shows; Leva tidied; still letting go (ec7077a):** relayed from the main chat, her words: "모바일 랩에서 scan
future 할 때 관찰자랑 연결 안 돼있지? 돼있다면 일단 디폴트로는 미래가 항상 보이게, 다른 모드에서는 F 누를 때마다 관찰자랑 겹쳤다고
가정하고 볼 수 있게, 또다른 모드에서는 실제 관찰자 지나갈 때만 동작하게 스위치 넣고 불필요한 레바 정리해줘"; here: "떠오르는 정도,
흩날리는 거리, 소용돌이는 다 디폴트로 0으로 둬줘".
- `잔류 — 공통 › 미래가 보일 때`: 늘 (default; no observer needed — what the scan reads is found and stays) / F 누를 때
  (each F — a phone: the 미래와 겹치기 button, ParliamentScene — counts as an observer standing a few steps ahead: the
  future is findable for `F 한 번에 미래가 머무는 시간` (6 s), then lets go as when an observer leaves) / 관찰자가 지나갈 때만
  (as before: excavatorsAt with bot (future)'s knobs, or the page's `?futurepass=1` test observer, read only here).
  The observers' hold (344d9f5) only stops them being drawn; the residue computes them itself, so this way works on the
  preview/experiment too, unseen.
- Listed only where read: the press time in F mode, the observer distance in observer mode. The old lidar-off overlay's
  knobs (방식, 렌즈 반경, 남은 부재 · 식생 · 둔덕 · 내 흔적, 선 색, 식생 색) hidden, saved values kept; `미래를 다시 읽는 간격`
  moved into 잔류 — 공통 (same key).
- Every kind's 떠오르는 정도 / 흩날리는 거리 / 소용돌이 default 0 (letting go = fading where they stand, with the bloom colour),
  plus a one-time SavedMigration (`scan-future-blow-still-2026-11-27`) over saves made before.

**남는 시간 after the overlap; the dark rims (3be5e8d):** relayed, her words: "왜 현재 redesign 에서 남는 시간 늘려도
금방금방 사라지지... 진짜 겹칠 때에만 잠깐 생기는 거 같고 (랩 말하는 거)" and "점이 부드럽게 번진다기보단 뭔가... 검정 모서리가
간간이 보이는 요소가 있음" (her screenshot: the crowns at 부드러움 1.0 as heaps of bubbles with dark outlines).
- `남는 시간` (key resLife kept): it had only capped how long a found part lived while the overlap lasted; the blowing
  away fired the moment it ended, so raising it did nothing. Now (F and observer ways) it is how long everything found
  stays after the overlap ends, then it blows away (0 = at once; default 3 s); a new overlap before then keeps it; not
  listed with 늘. Her saved number now means seconds after the overlap.
- Dark rims: each soft dot wrote depth over its whole disc, so a near dot's faint rim hid the dots behind and the black
  showed through. Now a depth-only child pass (`CORE_FRAG`, opaque, no colour) writes only the cores (alpha ≥ 0.5) and
  the colour pass writes no depth: rims only blend, cores still occlude, the photograph's pass still softens by real
  distance. Earlier layers and smears write no depth. Headless at her saved values: no errors, but no tree came into
  view from the headless spot — the crowns are for her to check.

**Each kind's point count (90adb1b):** "각 레바별로 점 수나 밀도 정할 수 있게 해줘". Every kind's `· 점` folder has
`점 수 (×)` (0 … 4, 1 = as before, 0 = none of that kind): under 1 a steady share is left out (the same points every
rebuild), over 1 more are made the same way — 부재: the faces (× 겉면 점 밀도, futurePresence's per-part and per-reading
caps raised with it), mounds and dark earth; 줄기: along each stem; 식생: leaf clumps in the crowns and points in the
meadows. The absolute knobs moved beside it, keys and saves kept: `겉면 점 밀도` (from 미래 읽기) in 부재 · 점,
`풀숲 점 밀도` and `나무 수관 풍성함` in 식생 · 점 (the stem's count still follows 수관 풍성함 too). The stem is now drawn
whenever a tree has a crown. Pool 200k points; an earlier layer over 40k takes an even share of every kind.
`window.__residue` counts part / leaf / stem. Not seen on screen by me (load 8, build check only).

**Both intervals move with performance (4462dae):** "미래 다시 읽는 간격이랑 다시 읽어 겹치는 간격 성능 따라 유동적으로
범위 안에서". `두 간격을 성능 따라 자동으로` (on): each interval is a range — its saved number is now the shortest, with
a longest (6 s / 1.5 s). The frame weighs frames against the fastest this screen lately did (a 30 Hz screen is not
slow; twice as slow = the longest) and what a reading / a layer costs (≤ 2 % / 3 % of the time); longer within ~0.7 s,
shorter again over ~4 s. Readout `지금 간격 (읽기 · 겹침 · 느려짐)`. At most 8 earlier layers: 남는 시간 ÷ 간격 above 8
cuts them short.

**The future's far and near, its own (01b0a34):** "미래랑 현재는 거리 따라 lod/흐림/뭉침 적용하는 정도 따로". The residue
is on its own layer (`futureLayer.ts`, FUTURE_LAYER 6): under the photograph it is left out of the depth softening and
drawn over the composed frame, dropped where the present's depth is nearer. Headless (load 13): no shader errors; the
look not judged by me.
- **One set each (c66e39a):** "부재나 종류마다 정하지 말고 그냥 미래/현재만 따로". The future: one folder, `거리 효과 —
  미래` — 시작 거리 (12), 성기게 정도 (1 = the present's (lod/d)²), 뭉치기 정도 (0; 1 = the present's ×d/lod), 또렷한
  거리 (4), 흐림 가까이 (0) / 멀리 (0.6, at the reach); the per-kind folders of 01b0a34 are gone. The present: scan
  (present) › 먼 점 뭉치기 시작 거리 plus 먼 점 성기게 — 정도 / 먼 점 뭉치기 (커짐) — 정도 (1 · 1 = as before), and the
  base's 가까운 / 먼 흐림 (the photograph's softening — now the present's alone).

- **Softened as the present is (b22b822):** "또렷한 거리는 없어야 하고... 멀수록 흐려 보이는 게 맞아?", "'현재' 점의
  거리 효과랑은 너무 다르게", "이것봐, 너무 또렷하잖아" (her screenshot on the redesign: the future's dots crisp
  beside the present's softened ones). The per-dot blur (focus / near / far) is gone. InkPaper draws the future
  into a frame of its own and softens it with the present's own rule: narrow blur everywhere, wide by distance, at
  the future's radii `가까운 흐림` / `먼 흐림` (1.2 / 6 px). The frame keeps its own depth and is hidden behind the
  present where that is nearer, then laid over premultiplied. Also as the present: `너무 가까운 점 성기게` (2), and far
  clumping defaults to 1. On the answer to her question: far = softer is the photograph's rule (the present's); a
  scan's own far readings are sparser, not softer — both are now hers to set, the same way for each.

**The glitch only as it blows away (1947aba):** "글리치는 녹아내릴(흩날릴) 때만 적용되도록 해". While held, the earlier layers are a
clean exposure that only fades. Once let go, the points glitch along their flight and the earlier layers melt over
the flight (bleed, thin, blocks, tear, drip at their flight / melt share). In 늘 nothing lets go, so nothing glitches.
Folders: `· 장노출 (이전 읽기) · 글리치 (흩날릴 때만)`. Also kept as she chose: the palette bleeding onto the parts through
the softening ("근데 뭐 느낌이 엄청 이상하진 않네" → "지금대로 둬"). Too-near thinning (b22b822) answers "가까이 갔을 때
버퍼링".

**The present thinner while the future shows (c66e39a):** "미래가 나타났을 때 현재 렌더에 점 덜 쓰는 방식으로 성능
조절". `LidarScan.lidarThin.scale` (the view's rays × it, the ring's directions skipped; life unchanged). The residue
counts the future's points on the screen and brings the present down to `미래가 보일 때 현재 점 비율` (0.5) once
`미래 점이 이만큼 보이면 다 줄임` (3 000) show — within ~1 s, back over ~2 s; readout `지금 현재 점 비율 · 보이는 미래
점`. Fewer present readings also means fewer chances to find the future: it develops a little slower.

**A reading spread over frames (8c92330):** the coordinator measured the redesign's action preview lagging, the
residue span up to 523–817 ms. The cause was building the pool, not reading the future: ~200k points (the CAP) in one
frame. Now `buildPoolSteps` yields every 512 points into one of two buffers made once. The frame runs the reading
as a job within 3 ms (points, then carried, then the GPU arrays staged a part at a time); the next frame swaps them
in (copies; parts whose state changed meanwhile are staged again). The read radius is min(lidar range, 보이는 거리) + 4
(nothing past 보이는 거리 was drawn): the preview's pool fell from 200k to ~109k. Headless at load 30–80: span max
330–1076 → 12–58 ms; a reading's worst frame 3.4 ms when quiet, 10–36 ms under load (the swap). `__residue.phases`.
futurePresence itself still runs in one frame (~1–8 ms here; the exhibition's world not measured).

**The one crossing (2026-11-28):** "몸 모양 창은 이제 안 쓸 거잖아, 잔류를 왜 따로 계산하고 있지? 어떻게 연결하면 돼
그럼?" The guide's lines "미래가 당신을 응시합니다…" / "미래가 당신의 삶을 발견했습니다" had hung only on
FutureEncounter's crossing, which no longer runs on any page. Now the residue's arrival is the crossing.
- **When it counts:** the future arrives when nothing is held and an observer comes within `관찰자가 있다고 보는 거리`
  (or F). An overlap again before its 남는 시간 is spent only keeps it, as before.
- **What it writes:** `FutureResidue.residueMeet` = { id, found }. found = the visitor's own cells within 5 of where they
  stand (FutureEncounter's rule); else it is the gaze line. RoleField hands it to the witness wherever the residue runs
  (witness.ts future.found / future.gaze, one line an id); `window.__residueMeet` keeps the last one.
- **The gap:** `다시 찾아오기까지 최소` (observer mode; 60 s) means no new arrival for that long after one. Readout:
  `지금 — 다음 도착 (관찰자 모드)`.
- **The sound follows:** the daydream's arrive and leave (futureCue.futureFrame) are told the future is held (with me,
  or kept until let go). So the sound arrives once with each arrival, at the same gap as the line.
- **bot (future):** the lidar and the residue run on that page too (LidarScan.lidarActive, residueActive), so she can
  watch the observers (bot (future)'s ObserverMarkers) cross and what they bring.

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
- Later the same day (bot-present's chat, the artist: "장노출 효과 좀 꺼봐 흐릿해서 비주얼 제대로 보기 어렵네"): bot-present
  set her SAVED `바탕` values to no softening: inkNarrow 0, inkWide 0, inkFade 0, inkHalo 0, inkGrain 0 (shake was 0;
  rolloff 0.5, burn 1.75, decay 0.88, density 0.97, exposure 0.75 kept). No code changed; the code defaults are still
  the old softened ones, so a fresh browser without the server would differ — align the defaults if this stays.
- Capture: `docs/img/mobile-view-lab/scan-present/paper-before-after.png` (before · after · IMG_1580).
- Left, for the asset sessions: `MobileLabStage.tsx` loading placeholder still `bg-[#f4f2ec]` (a brief cream before
  the canvas). The artist also said the long exposure meant the LOOK, not a feedback run in the browser (bot-present
  is moving the people off `EXPOSURE_LAYER`); once nothing uses the layer, InkPaper's feedback pass and its knobs
  (잔상, 쌓인 것의 최대 어두움, 빛 번짐, 노출 과다, 손떨림, 노출) can go. bot-future's windows still use it.
- Her scan reference (pasted in this chat, not on disk): lidar rings round the sensor coloured by distance, each
  object in a coloured 3D box (edges + translucent fill), a label, black ground.

**Lidar scan v1 (2026-11-23, the artist: "스캔비주얼 아까 준 사진에 맞춰서 포인트클라우드로 시작").** `LidarScan.tsx` (new),
mounted from `ConcreteOutline` (Marks.tsx), knobs `scan (present) › 라이다 스캔`. **Shown on the scan (present) page only**
(`lidarActive()`); no other page's picture changes.
- A rotating sensor at the walker's eye: 32 beams from −24° to +6°, 720 readings a turn, 5 turns/s. Each beam stops at the
  first building cell it meets (wall, or the top of a low one) or at the ground. Nothing behind a wall is reached
  (empty shadow), the cell I stand in is ignored, and my feet are an empty circle (the lowest beam). Rings come from the
  beam angles, not drawn. Points stay in the world and fade over 1.5 s (walking leaves the last turns' rings), in a
  ring buffer with only the new readings uploaded. Colour by distance as in the photo (mint → pale yellow-green →
  pink), or white / grey.
- On: the photo's black ground (`ParliamentScene`: background + fog black, the log not inverted); the grass cloud
  and the grey building smudges are hidden (the scan is the place).
- The sensor sits `뒤로` ahead of the camera at `눈높이`, so raising and setting back the eye (shared eye knobs, not
  changed) gives the photo's view from above-behind with the rings still round me.
- Cost: `lidar` ≤ 6 ms in the slowest frame of a minute on the loaded M2 (perf line).
- Captures: `docs/img/mobile-view-lab/scan-present/lidar-v1-eye.png` (eye height, standing inside a concrete block of the
  demo world), `lidar-v1-above.png` (eye set back 8 m, up 5 m — headless only).
- Next, one at a time with her check: the coloured 3D boxes + label on objects; people as obstacles; fibre + scatter
  when points leave (§6 decision); whether the scan replaces the paper elsewhere.

**Points refined (2026-11-24, the artist: "점부터 다듬어").**
- The smear was the paper's compose: the points write no depth, so it read them as far and gave them the wide
  softening and the fade. While the scan is on (`lidarActive()`) the compose takes the scene as it is (`InkPaper.tsx`
  `uSharp`); other pages unchanged.
- A dot is round with a one-pixel edge at any size (no soft blob); one size on screen, a little larger right by the eye.
- A reading holds full strength for 55 % of its life and fades only at the end, so the last turns stand as crisp
  rings rather than a haze of half-faded ones.
- The distance ramp has four stops, brighter: mint `#5ff0c8` → green-yellow `#c6f06a` → peach `#ffb86b` → pink
  `#ff7eb0` at the reach.
- The sensor follows the shared eye height, now 1.1 m (bot (present), 2f97f8b).

**A dome, not a band (2026-11-24, the artist: "위아래도 좀 현재 덩어리 읽을 수 있으려면 나한테서 반구가 날아가야 하지 않나 /
그럼 연산량 너무 크나?").** Defaults 64 beams from −60° to +85° (was 32 from −24° to +6°), so the buildings read up to
their tops and the ground closes in round my feet. Knob ranges widened (beams ≤ 128, −89° … +89°). Colour now by the range
the beam travelled (a high wall reads as far as it is). Cost: the expensive part, walking the ray through the grid, runs
once per direction, not per beam; each beam only checks the few cells already found — so doubling the beams costs little
CPU. The real cost is the number of live points (64 × 720 × 5/s × 1.5 s ≈ 346k, buffer 420k, ~8 MB) and drawing them;
"한 바퀴 점 수" or "점이 남는 시간" bring it down if a phone struggles. (She HAS saved her own: 64 beams, −2° … 29°, 848 a
turn, 8.5 turns/s, 4.2 s — those win over these defaults on her page.)

**Which world the scan reads (2026-11-24, the artist: "이거 global 에서 읽어오는 게 아닌 거지...?" → "그렇게 붙여봐").** An
asset page always has `?botserver=0`, so the scan read this browser's own stored world on localhost:3029, not the wall's.
The scan (present) page's bar now has 「리허설 세계」 (`?botserver=1`: the bot server's world — the wall's buildings now;
this window joins as a visitor, so the wall sees it and bots may come to it) and 「시험 장면」 (`?botserver=0`, as before).
Sessions test only with `?botserver=0`.
- **Then (same day): the preview's world was empty.** On a branch preview (and localhost) the bot server's world is
  "rehearsal", which was off with 0 events; only the exhibition's world ("redesign") runs (26 bots, 18k events, read
  from `/state/` GET). The artist: "봇 받아오게 해 그냥". The link is now 「전시 세계」 = `?botserver=1&watch=1`:
  `useBotServer.ts` `watchExhibition()` makes the personal view's server link join "redesign" as a plain VIEW — the
  whole world on joining (held until this tab has joined the epoch; 4 s at most) and the bots as they walk — and send
  NOTHING (no visitor, no people, no knobs, no clear), so the wall never sees the tab. Not tried by a session (rule:
  sessions never join the live bot server); she checks it.
- **Background (same day, "배경 색은 또 왜이래 이거").** With 흰 바탕 off, the old black mode's ground showed under the
  scan: the green grass face and the grey worn paths (DitherGround) and the path lines. While the scan is on: the
  background is pure black whatever the paper switch says, and DitherGround and PathLines draw nothing.
- **Two scan axes to compare (same day).** It works on the exhibition's world (her screen: events 23 166, slabs 22).
  She then said what she meant by 반구: "나를 중심으로 진행방향에 수직한 원들이 날아가서 표면을 읽어야" — and, liking
  the first look too, "비교를 해볼 수 있었으면". Knob 스캔 축: 진행방향 축 (default) — the sensor spins about my
  heading; circles at right angles to it, from 가장 앞 원 (8°, far ahead) to 90° (the cross-section where I stand), read
  the ground, the walls on both sides and what is above: the hemisphere in front. Rays go any way, so they march
  through a height map of the cells round me (one number a cell, rebuilt each frame; a few halvings find the surface).
  세로축 is the first version, unchanged.
- **Where the lag is (her perf line, 29 fps on the exhibition's world):** the slowest frame of a minute had fold 412 ms
  and ledger 179 ms — the personal view folding and reading a 25k-event world — against lidar 11 ms. The world, not the
  points. The heading axis also wastes less: the vertical spin throws about ¾ of its points behind and beside me, off
  screen; the heading one puts all of them in the half in front.
- **A third: 시야 (same day, now the default).** The artist: "원이 보이는 게 아쉽거든... 레퍼런스보면 '내가 보는 표면'
  레이트레이싱처럼 … 시야각 정해서 그렇게 점으로 보여주면 안 되나 … 내 시야 밖으로는 버퍼 구간만 조금 더". No
  spinning sensor: rays leave the camera, scattered evenly over the screen (an R2 sequence: even, never a grid) and a
  margin round it (시야 밖 여유, 0.15 of the half-width), `시야: 초당 점 수` a second (120k); each kept where it meets a
  wall, a roof or the ground, fading as before. No rings, no scan lines — a depth camera's reading. Shares the height
  map and the ray march with the heading axis. All three stay on 스캔 축 to compare.
- **Density by the surface's angle (same day, "내 시야에서 면 각도 따라 밀도 다르게 보여야 하지 않나?").** Rays spread
  evenly over the screen made every surface equally dense on screen — flat. Now a reading is kept with the chance
  cos(angle between ray and surface)^`면 각도 → 밀도` (default 1): a wall facing me full, the ground far off and a wall I
  look along sparse. The surface's normal comes from the ray march (the face of the cell it crossed into; a roof or the
  ground = up). View and heading axes; the vertical spin unchanged.

**Lag and look, one batch (2026-11-24, the artist: "랙 줄일 방법 검토좀 … 여튼 진행", with her ideas along the way).**
- World (the real cost: fold 412 ms, ledger 179 ms in the slowest frame of a minute, against lidar 11 ms):
  - 전시 세계 now puts in the log only the world within 56 units of the walker, as a phone hears only what is near its
    visitor (the server's NEAR 40); the rest waits beside it and goes in when the walker comes near
    (`useBotServer.ts` `watchCentre`, set each frame by RoleField).
  - The fold and the ledger wait longer after a long reading (RoleField `foldEvery`/`ledgerEvery`: the fold at most
    ~6 % of the time, the ledger ~4 %, never shorter than the old 0.5 s / 2 s — a light world reads as before). This
    is in the personal view itself, every page.
- Points:
  - 프레임당 스캔 시간 예산 (4 ms): what is left goes to the next frame.
  - 시야: 가운데 집중 (1): a reading kept with the chance 1/(1 + fovea·r²) — the middle of the view densest.
  - 시야: 멈춰 있을 때 새로 읽는 몫 (0.3): the refresh term — standing still, fewer new readings, and what is read
    lives longer by as much (eased over a second), so the density holds.
  - 먼 점 뭉치기 (12 world): past it a reading is kept with the chance (lod/d)² and drawn d/lod times larger (≤ 4×).
  - 너무 가까운 점 성기게 (2 world, "건물 부재속에 있을 때 렉이 심해지는데"): within it kept with (d/near)², ≥ 3 %.
  - The ground by the ring radar only ("땅은... 원 레이더로만"): with 시야, the view's rays mark walls and roofs; the
    vertical spin's downward beams draw the ground (one walk through the cells per direction for all of them).
- Colours: 거리 색 1–4, her own (defaults the photo's mint → green-yellow → peach → pink).
- Blur ("여기엔 왜 흐림 적용이 안 되지"): the points write their depth, so 사진 › 가까운/먼 흐림 soften them by
  distance like everything else; only the fade to white stays off on the scan (it would grey the black).
- **"전시 세계 클릭해도 아무것도 안 보여"**: her saved `시야: 초당 점 수` was 2000 — the view drew, but too few to see
  (test scene: 4 348 readings in 15 s). Not a fault; she raises it.
- **Then (same hour):** the ground's ring radar on a small budget of its own ("땅 그리는 데에는 너무 많이 쓰지 마"):
  고리 수 (땅, default 10) apart from 빔 수 (the buildings: above the horizon for the vertical spin, the circles for
  the heading axis) ("빔수랑 고리수는 따로"); 땅 고리 한 바퀴 점 수 (360). Ground and buildings each have their own four
  colours ("땅이랑 건물 색 셰이더도 따로") — a per-reading kind picks the ramp. 땅 레이더: 점 / 선 ("아예 선으로 해도 되고
  (선택 가능하게)"): lines = every ring round the sensor drawn anew ten times a second, one march a direction for all
  rings, a segment wherever two neighbouring directions both reach the ground (broken behind what stands).

### bot (present)

**New slot `/lab/mobile/frames` — `frames · 사람 프레임 배치` (`FrameLab.tsx`, 2026-11-23).** The artist: "나와의 상대 각도
고려해서 프레임이 움직임에 따라 늘어져서 옆에서 보면 동세 덩어리로 보이도록 … 랩에 아예 다른 슬랏을 추가해서 거기는 아무런 요소도
없이, 순수하게 사람 프레임을 어떻게 늘어놓을 건지 결정하게". White space, no ground or scan, only cut-out people (the
sheet: her Gemini clip `gemini-D839B006_front` — a man in a dark coat walking towards the camera — and the Pexels back
view; the pipeline's static-prop removal now only with a `_props` tag). Orbit with the mouse; buttons 옆·뒤·앞·위·눈높이.
Each walker leaves copies (at each sample "슉", or at a time spacing), fading; a card stands facing the eye, along the
path, or across it; each card STRETCHES towards the copy before it by the move's part across the view (the relative
angle) — from behind they pile into one, from the side they run into a mass — as a streak of the silhouette's middle
pulled sideways or as the frame itself widened; a slit keeps only the middle of each frame (slit-scan in space);
multiply or normal overlap. Its own Leva group (saved under /lab/mobile like the others). The personal view is untouched
by it; what she decides here goes into `PointPeople`'s 2D people after.

**Where the frames study stands (night, 2026-11-23).**
- Clips: one strip file a clip (`public/people/clips/<id>.png` + `people.json`), packed on the GPU into one texture that
  fits the device (a phone may stop at 4096 px; the old single sheet was 6400 px). Each clip: a state (walk · brisk · run ·
  stand · talk · none = unused), its walk set (distance a frame, frame hold), playback ×, ping-pong, height, ink, colour,
  a name of her own (`cn_`; the file keeps its name so the saved set stays). Leva shows one clip / one state / one colour
  combination at a time.
- Which clip (her rules): walking across my view → a walking profile clip, near too ("3번하자"; threshold 0.8, a profile
  card always stands along its own way — no moonwalk); far off and still → its stand / talk clip, played or held on one
  frame; near and talking → the talk clip plays; profile clips only from walking clips.
- Filling the side view: a front shot seen side-on has no shape — the width-profile face and the squeezed silhouette were
  rejected ("모양이 다 죽어", "실루엣 눌러 펴는 건 진짜 별론데"); kept as options: drag (the silhouette turned square at the card,
  the body's middle dragged in lines to the copy before) and a least angle to my line of sight (off; large angles read as
  running sideways).
- Budget: an on-screen readout (cards, people, fps; a warning past 500) and in-between caps by distance tier (12 · 6 · 2).
  Phone target ~300–500 cards.
- The colour flowing inside: every knob by state (strength, combination, direction, wave size, speed, waver).
- Pending: talking tied to the melody of someone speaking to me ("소통은 나중에 말 거는 멜로디랑도 연동하고 싶음"); carrying the
  study's sets into `PointPeople` (the personal view still uses the old row choice).

**A part of it in the OLD view (2026-11-27, the artist: "이전버전의 리허설에서 봇을 상자가 아니라 픽토그램+그것과의 인터랙션
되도록 부분도입해봐 (레바로 끄고 켤 수 있게)").** `개인뷰 비주얼 › 봇: 픽토그램 + 인터랙션 (부분 도입)` (`botPicto`, off by
default; `봇 픽토그램 크기 ×` beside it) — in the old black personal view (`/v2/mobile` outside `newLook()`), the others
as the moving pictograms with what happens between them and me (brackets round whoever the record counts as near, the
asker's bold box beating on its melody with a line to my mark, its head hopping, the melody over its head, held while we
talk, my heading turning its way) in place of the squares. Nothing else of the lab's look: no paper, no long exposure,
no eye camera, no lidar, no new record lines. Its look is its own (`usePersonalVisuals` `street.partialLook`, none of the
lab's saved values) and it is seen from the old camera (`FramePeopleLayer` `orbit`: near and far counted from where I
stand, nobody thinned or cut for being close to the camera). The rehearsal and the exhibition share this group's saved
values: saved ON, it is on in `/exhibition/personal` too.

**Evening, 2026-11-23 — 2D PEOPLE from real video become the default (`그리기 = 2D 사람`, mode `"sprites"`,
`spritePeople.ts`).** The artist: "걍 3d 몸 버려야하나 … 후져 … 한계가 있어보여 … 2d 실루엣" → "Pexels 클립으로 먼저
시험해봐" → "내가 찾을게". Pipeline: clips in `visual_reference_images/people_clips/` (gitignored; one person head to foot,
green screen or plain backdrop; the name ends with the view `_back` / `_front` / `_side` / `_stand`) →
`python3 -I tools/people-sheet/people_sheet.py <clips> apps/web/public/people` (key the backdrop, keep the largest body,
drop what never moves near the feet, find one stride by the legs' rhythm, 16 frames in one box) → `people.png` +
`people.json` (a row a clip, with its source). The app: a card a person facing the eye, the row by how they are seen
(away/towards/across, mirrored), the frame by their stride; at each 슉 a few afterimages along the sweep, fading; clothes
turned to another hue per person (coloured parts only), width by the archetype's girth, height by its height. Folder
`2D 사람` (진하기, 키 ×, 잔상 수, 잔상 시간, 잔상 진하기, 옷 색 바꾸기, 채도); 움직임 applies. First row: Pexels 31899051 (a woman in a
red dress walking on a treadmill, from behind; Pexels licence — free use, modification allowed). Checked: type check;
headless text run (Chrome for Testing) — no errors, 60 fps at 540×960 with 24 people.

**Later the same day — the POINT BODY with FIBERS becomes the default (`그리기 = 점 몸`, mode `"fibers"`, `fiberBody.ts`).**
The artist: lag ("생각보다 랙이 심해서") → "3d 몸을 점으로 하면 td 랑도 비슷해지고 … 흩날리는 효과 … 잔흔 계산해서 다 남길필요
없이 점 자체에 fiber 효과도"; "봇 속도 일정 이상이면 뛰어가야 … 경공술"; "제스처 다양하게"; "방향 돌거나 하는 것도 어색해서,
사이사이 위치 들어오는 간격은 그냥 보간하지 말고 그때그때 장노출 사진처럼 슉슉 남는 게"; "보간은 껐다 켤 수 있게" (she is not
sure yet whether points + fibers or the 3D body gives "각자의 몸이 점한 시공간 덩어리" / a transparent-collage feel — both stay
switchable); "안 쓰는 노브는 다 지워가고 새로운 건 추가해가면서"; the long exposure's blur was switched off in her saved
`바탕` values at her word (inkNarrow/Wide/Fade/Halo/Grain 0; scan-present told).
- Points sampled once on the body's shapes (trunk, coat, hips, limbs, shoulders, neck, head, hands, shoes, long hair), each
  remembering its bone, place along it and angle round it; the GPU places them on each person's archetype pose (BodyPoses
  rows: girth, cut, own colours — the archetypes and clothes are wired in). Each point is a round-ended thread through three
  moments (now, a little ago, longer ago): standing a dot, moving a fiber; its tail fades and scatters; a share of the
  points drift off (흩날림). Multiplied on the white, depth-tested, one draw.
- `움직임` folder: 보간 끄기 (default on = "슉": at each sample the body sweeps there in `dashSec` and holds; the fibers carry
  the sweep and draw back over the fiber time; off = continuous walking with dead reckoning), run above `runFrom` m/s
  (longer reach, high knees, bent elbows, lean; the cadence cap lifts — no gliding), standing gestures every
  `gestureSec` (주머니 · 팔짱 · 폰 · 뒷짐 · 허리에 손 · 머리 긁기 · 둘러보기 · 앞에 손 모음 · 턱 괴기), eased over 1.2 s, with a slow
  weight shift. `점 몸 · 섬유` folder: points a person, size, least px, ink, fiber time, tail ink, scatter, loose share,
  distance, speed, saturation. Folders show only for their mode (잔흔 for the 3D body, 옛 노브 for the old point body).

**State (2026-11-23, after the resume): built — afterimages, continuous motion, archetypes, their knobs — awaiting the
artist's eye.** Checks: type check; one headless text run per change (no captures — the artist: "비주얼은 내가 보고
피드백할테니까 캡처해서 … 토큰 최소화"): no shader errors (one found and fixed: `projectionMatrix` undeclared in the
fragment stage). **The afterimages and archetypes draw only with `그리기 = 3D 몸 + 잔흔 + 체형 아키타입`**; the artist's
save of 15:55 has `그리기 = 점 몸` (her look at the point bodies) — her choice is left as it is; switch to see the new.
On the point bodies the motion is continuous too (no jumps), the rest as it was.

Knobs (all under `bot (present) · 현재의 사람`): folder **잔흔 — 동세의 시공간 덩어리** (own saved set): on, time a trace
stays (1.2 s), how many in that time (8), the body now (0.6 of the ink), the traces together (0.85 — where they pile up,
one body's worth), fall-off (1.4), edge softness now / oldest (0.5 / 6 cm), the old traces' saturation (×1.35). Folder
**체형 아키타입** (own saved set): 보기 (this lab page only: all by share, or one slot alone), then 아키타입 1–5, each:
이름, 비중, 키, 몸 비례 (다리·상체·어깨·골반·팔), 두께 (몸통·허리·팔다리·머리), 자세 (기울기·구부정함·고개), 걸음 (캡처 1–4 or each
their own, 보폭·팔 흔들기·출렁임·좌우·발 들기·빠르기), 팔과 옷 (팔: 흔들며·주머니·뒷짐·폰·팔짱, 윗옷 길이, 머리, 옷 색 지정 +
윗옷·바지 색). Hidden (values kept): 표본마다 점프, 표본이 올 때 떨림. Relabelled: 그리기's two options, 창이 잔흔만큼 늘어남,
사라질 때 옅어지는 시간. Console: `__bodyTuning` (live values), `__street.traces`.

Cost: each trace is a ray-marched body (cheaper than the body now: fewer, longer steps; colour by height; a phone draws
half as many). Measured once, on a machine at load average ~30 (other sessions and the artist's tabs; headless 540×960
dpr 1, `?crowd=24&presets=default`): 24 bodies + 192 traces ≈ 8 fps. That number says little about the traces' own share
(the on/off comparison did not take: the knobs' hook rewrites `__bodyTuning` each render) — to be measured again on a
quiet machine before the show; the knobs (잔흔 수, 남는 시간, 잔흔 켜기) are the levers meanwhile.

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

**What was built (the plan as it was written at the pause; her check after each):**
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

**Interface for bot-future (landed with this commit):** `bodySheet.ts` grows three texels a row (girth; own top colour; own
trousers colour) — `POSE_TEXELS` 18 → 21, `BodyPoses.write(row, J, build, code, girth?, colours?)`; rows written the old
way read as before (zeros = defaults). `BODY_GLSL` gains globals `bSoft` (0 unless set after `loadPose`), `bLimb`,
`bGirth`, `bBelly`, `bHeadS`, `bTop`, `bPants`, `bOwnCol`; `marchBody`'s signature is unchanged. `standOf(cycle)` exported.
`makeBodyMaterial` takes `"paper"` and `"depth"` too (both define `BODY_FRAGDEPTH` and write `gl_FragDepth`); `iBody2.w`
is the edge softness (metres) in the vertex stage's box — 0 keeps the box as before. The archetypes' joints come from
`bodyArchetypes.shapePose(pose, standPose, archetype, moving)` — bot-future may dress its observers in them too.

### bot (future)

Page `http://localhost:3029/lab/mobile/bot-future` (`?botserver=0&futurefix=1`: one observer pacing 3.2 ahead). Group
`bot (future) · 미래 발굴자` (`labKnobsBotFuture.ts`). History of the observer before the lab: `docs/future-presence.md`
§7.2–7.13. Captures: `docs/img/mobile-view-lab/bot-future/`.

#### Reference study (2026-11-23)

| still | what it says for the observer |
|---|---|
| GIF `EDEFE77C` (silhouette window) | Two bodies are **holes** in the grass. Through them the sky that would be behind continues the sky around them, registered: another layer shown only in a body's shape, not a picture stuck on a body. **No outline**: a soft edge dusted with tiny white glints; above the shoulders the body is only glints, rising and thinning. The body is simple; it reads as a person by its size and walk. Outside the holes the present is untouched. |
| `IMG_1575` (long-exposure walkers) | White is **light that overflowed**, never a grey film. Colour comes in garment blocks dragged vertically; faces, hands and feet are eaten by the light; between bodies, pure white. |
| `IMG_1401 2` (Claire Harvey, *Overlaps*) | A sheet of acetate is barely darker than the wall. It is read by its **straight edge**, the **one step darker** where two overlap, the tape — not by a tint over everything. |
| `IMG_1585` (Claire Harvey, *When what was when*) | Projected sheets in layers, each told by a **thin dark frame line**, with another time inside each. Grey comes only where sheets pile up. |

Shared rule: **the other time shows through a shape, and the shape is told by its edge** (glints, a thin line, a straight
edge), never by a grey laid over the whole picture. White stays white.

Where it stood when the lab opened:
- The default drawn body (`winShape: body`) was on the scene layer, so InkPaper gave it the far blur: grey blobs.
- The near-fill (`FILL_FRAG`) lays a film of `paper × 0.84` plus the grey-toned future at 0.85 over the whole present:
  the grey cast (her 누르죽죽). Still to do.

#### While the lidar scan runs (2026-11-24)

The artist: "현재의 '선' 레이더 돌릴 때는 가려줘", then, asked which lines, "미래의 선". While `lidarActive()`, the
future is not drawn at all — neither its place nor its observers (`ParliamentScene`, 107bc5c). On the scan (present)
page it was already off, so nothing there changed; it holds wherever the scan runs later.

#### The observer as a real person, cut out (2026-11-27)

The artist: "미래 관찰자 모양은 이전에 frame 에서 쓰던 실제 프레임 누끼딴 걸로" (after 11/24, relayed by bot-present: "원래
있던 클립은 소수만 추려서 미래관찰자 봇에 쓰면 되겠다").

- `창 › 창의 모양` has a new option, now the default: `실제 사람 — frames의 누끼 클립` (`winShape: "clip"`; `?body=clip` on
  the address does the same). The window's shape is the alpha of one frame of a cut-out clip (`people/clips`, packed by
  `spritePeople.loadSpriteSheet` — only these clips). Through it the future shows as through the other shapes: the
  captured picture, each pixel where it belongs on the screen.
- The few clips (`futureWindows.ts OBSERVER_CLIPS`) are the ones she set to "이동 중" in the frames study on 11/24:
  - from the front: `vecteezy-33199516#8`, `gemini-D839B006_front`;
  - from the side: `vecteezy-33199516#9 #11 #12 #15 #16`.
  Each observer keeps one front clip and one side clip, chosen by its number. `누끼 클립` pins one clip for all.
- Which view: an observer coming at me or going away shows its front clip. One walking across (more than 45° off)
  shows its side clip, mirrored to the way it walks (people.json `faces`).
- Which frame: the stride's phase at the clip's own pace (`strideSec`). Standing, it shows the frame where both feet
  are down (`ds[0]`). A window left behind keeps the frame it had.
- Height: `사람의 키` (`winPersonH`, now shown for the cut-out too) is the body's own height (the cell's height ÷ `fill`).
- It is drawn on the pictograms' layer (`PICTO_LAYER`), which InkPaper lays over the finished frame. So it is not
  far-blurred into a grey blob, as the drawn body was.
- Capture `clip-v1.jpg` (phone 430 × 932, headless Chrome for Testing; beside the GIF and IMG_1575): the silhouette
  reads as a real person walking, crisp. Inside, above the horizon it is a flat light grey (the window's back,
  `paper × 0.86`); only the legs carry the future's ink. That is not yet the GIF's registered other time with a glinting
  edge, nor 1575's colour.
- Not changed yet:
  - the near-fill (the grey film over the whole screen when I am near a window);
  - what shows inside: still the frames' ink picture on a grey back, not yet scan-future's line language.
- **The lab's look only** (coordinator, 2026-11-27): the exhibition's personal view reads this group's defaults, so the
  cut-out (and its smear) is drawn only where `mobileLab.newLook()` is true — the lab's pages and the experiment
  address. Elsewhere `clip` falls back to the drawn body it had.

#### Smeared behind its way (2026-11-27)

The artist: "움직이는 방향 뒤로 번져 보이는 건?" — `창 › 움직이는 방향 뒤로 번짐` (`winTrail`, of the cell's width, default
0.8; 0 = none).
- In the window's shader: sixteen moments behind the body, each where the body was a moment ago and at the stride it
  had then (about seven frames a cell width), fainter the longer ago. The sample offset differs per pixel, so the drag
  is continuous, not a row of copies. Drawn as it is each frame: no feedback, so nothing flickers.
- Only the part of its way across my view smears (coming at me or going away it hardly does, as in a photograph). The
  card is widened by the length on both sides to hold it. A window left behind keeps the smear it had.
- The future shows through the smear as through the body.
- Capture `trail-v1.jpg` (before · after · IMG_1575): the side clip drags back over about a body's width, the legs
  as several strides. That capture had twelve moments (the row of copies showed at the head); now sixteen with the
  per-pixel offset, not captured again.

#### On hold outside its own page (2026-11-27)

The artist: "일단 해당 랩 말고는 걍 다 안 보이게 해놔 … 보류 차원에서". The observers walk only on the bot (future) lab
page. On the action preview, the experiment address and a `?future=` address they are not drawn (ParliamentScene's
future gating; the future's place stays as it was there). The wall's own observers (`FutureExcavatorsWall`, white
strokes and light pillars) are not touched. Lifting the hold = return `futureKnobs` again for `!lab || preview`.

Open (her call): how the observer shows under the lidar. Proposed 11/27:
- **A · read by the scan (recommended)**: the beams land on the cut-out too, in the future's colour; the scan's own
  decay leaves the smear.
- **B · a hole in the scan**: no readings where the observer stands; the residue only inside the hole.
- **C · the cut-out window laid over the scan**: two languages side by side.

(Superseded 2026-11-28: the observers are never drawn — see below.)

#### The page of the invisible observers (2026-11-28)

The artist: "몸 모양 창은 이제 안 쓸 거잖아, 잔류를 왜 따로 계산하고 있지? 어떻게 연결하면 돼 그럼?" — then, to the
coordinator's plan, "Yes, join them". The future's crossing becomes one: the scan residue's (scan (future),
`FutureResidue.tsx`). When an observer comes within reach, the residue appears, the guide line shows and the daydream
sound plays, together.
- **No encounter of its own**: no lab page mounts `FutureEncounter` any more (ParliamentScene's future gating:
  `encounterOn` false everywhere; with the 11/27 hold, nowhere at all). So no body windows, no near-fill, no
  `futureMeet` record, and none of its passing sound (glitter, river, the bell when found) — the residue's daydream cue
  is the sound now. The code stays, for the old `?future=` trial, which the hold also keeps off.
- **The observers** are `lib/parliament/excavators` (a pure function of the world's epoch and clock). The residue reads
  only this group's `관찰자 수`, `도는 땅의 반경` and `한 구간 걷고 서는 시간`. Those three are the only knobs left in
  the group (folder open). Everything else is hidden, with its saved value kept: `on`, `look`, `마주치는 거리`, the
  cooldown, the passing sound's level, and the folders 창, 날아오는 판, 그림, 스캔, 점구름, 나타남 · 사라짐.
- **Where they are** (`ObserverMarkers.tsx`, mounted by RoleField when `mobileLab() === "bot-future"` only — never the
  experiment address or the action preview):
  - a ring on the ground for each observer now, a dot at its middle, a tick the way it walks; fainter while it stands;
  - one faint ring round me at the residue's reach (`residueLook.gateR`): an observer inside it is what makes the
    residue appear.
  - On the pictograms' layer (over the finished frame, crisp): black on the white paper, white on the scan's black.
- The page's line in the lab list: "보이지 않는 미래 관찰자 — 지금 어디 있는지 · 수 · 도는 반경 · 걸음"; its address no
  longer carries `futurefix=1` (that test scene was the encounter's).
- Not captured (the machine's load was 90 when it was built); type check clean, the page compiles.

#### Pages taken down (2026-11-28)

The artist: "어차피 이 랩에서 더이상 할 게 없다면 frame, future bot 버튼이랑 페이지도 날려". The bot (future) page and the
frames study are gone from the lab's list, the bar and the route (`mobileLab.ts RETIRED_PAGES`; `/lab/mobile/frames` and
`/lab/mobile/bot-future` answer "no such page").
- Deleted with them: `ObserverMarkers.tsx` (the observers' rings, that page's only content) and `FrameLab.tsx` (the
  frames study page).
- Kept: both groups' saved values are still read.
  - The frames study's clips and states: `FramePeopleLayer` (the present people), through `savedGroup`.
  - bot (future)'s observers: the scan residue, which reads count, roam and pace.
- The observers' three knobs are now listed on the scan (future) page, beside the residue they make appear (the lab
  panel filter lets that page show the `bot (future) · 미래 발굴자` group too).
- Left for the sessions that own them: `"bot-future"` still sits in `LidarScan.lidarActive` and
  `FutureResidue.residueActive` (scan (future)'s), where it is now never true; and the frames comments in
  `framePeople.ts` / `FramePeopleLayer.tsx` (bot (present)'s).

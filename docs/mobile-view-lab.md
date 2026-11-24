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

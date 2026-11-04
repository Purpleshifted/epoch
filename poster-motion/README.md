# 발견된 인류 — 발표 도해 · 사이트 (poster-motion)

졸업심사 발표 대본(「발견된 인류 — 졸업심사 발표 구성과 대본」, Claude 문서)의 도입과 일곱 구간을 **구간마다 한 장의 도해**로 보여주는 키로 넘기는 웹 페이지. 16:9 (1920 × 1080).
각 도해는 작품의 실제 규칙(`docs/world-logic.md`, `sound-logic.md`, `session-logic.md`, `lib/parliament/fold.ts`·`water.ts`)을 그대로 그린다. 큰 글과 설명은 영어, 한국어는 작게(작가 요청 11/04). 참고 자료 페이지도 영어.

## 발표 때

```
node poster-motion/tools/serve.mjs 3018      # http://localhost:3018/  (아무 정적 서버든 된다; file:// 는 JSON fetch가 막힘)
```

브라우저에서 열고 `f`로 전체 화면. 구간은 멈춰 있고 키를 눌러야 넘어간다. 각 구간의 움직임은 들어갈 때 한 번 재생되고 멈춘다(④의 네 판은 11초마다 되풀이).

| 키 | 동작 |
|---|---|
| → · 스페이스 · Enter · PageDown · 화면 오른쪽 클릭 | 다음 구간 |
| ← · Backspace · PageUp · 화면 왼쪽 20 % 클릭 | 이전 구간 |
| 0–7 | 그 구간으로 바로 (0 = 제목) |
| r | 지금 구간의 움직임 다시 재생 |
| f | 전체 화면 · h: 시간 표시 |

`?step=3`으로 열면 그 구간부터. 시연(라이브 앱)은 제목 화면(0)에서 앱으로 갔다가 돌아와 →를 누르면 ①로 이어진다.

## 구간과 도해

| 단계 | 도해 | 대본 |
|---|---|---|
| 0 | 제목 + 작품의 두 문장이 타자로 | 도입 · 시연은 라이브 |
| 1 | 지층 단면에 1952 · Pu 황금못 한 줄 → 투표 16칸(4 흰 : 12 빈) → `4 : 12` → 줄이 점선이 되고 REJECTED → 인용 | ① 부결된 지질시대 |
| 2 | 개체 5051의 실제 궤적을 따라 걷는 픽셀 몸이 발자국을 남기고, 끝에서 몸은 흩어지고 발자국만 남는다 (체화석 ✕ · 생흔화석) | ② 생흔화석 |
| 3 | 위에서 본 땅: 15명이 세 곳에 모여 콘크리트, 오가며 길, 봉인된 땅 밑으로 배관(하수구 트리) — 옆의 단면에 슬래브·다져진 길·배관 | ③ 인류의 생흔화석 |
| 4 | 네 판: 머물면(창 안의 존재가 문턱에 닿으면 슬래브) · 걸으면(밟을수록 p, 0.3이면 길) · 덮으면(봉인 비율 → 빗물 유출 → 배관) · 떠나면(풀 회복) + 오른쪽 벽: 0.9초마다 지층 한 겹(= 20 s), 현재 9단 → 과정 띠(식생→부패→융합→레진) → 불변선 | ④ 생성 로직 |
| 5 | 위: 시간축이 화면 밖으로 뻗음(산업화 ← 지금 → 수만 년 뒤) · 왼쪽: 전지적 평면도에 ✕ · 오른쪽: 어둠 속 작은 시야, 소리 닿는 범위 안에서만 남의 기호가 보임, 수명 카운트다운 | ⑤ 하이퍼객체 |
| 6 | 왼쪽: 내 이름 기호(시퀀서) 곁으로 타인이 다가와 커서가 맞물림 = 화음, 응답하면 새 어휘 기호가 터짐 · 오른쪽: 벽의 같은 단에 콘크리트 한 칸, 아래 저음(19 기호를 눌러 한 덩어리) | ⑥ 사운드 |
| 7 | 개체 기록표(§11 항목 그대로, 예시 값) + 발자국 지도 → 「기록은 남습니다…」 → 「현재의 당신은 무엇을 남기시겠습니까?」 | ⑦ 의의 |

시각·문구는 index.html 안: `HOLD`(자동 모드 초), `SEC`(머리 제목), `KEY`(아래 핵심 문장), 각 `s1()…s7()` 함수가 한 장. 지난 시안(포스터를 움직인 것)은 `poster.html`에 남겨 둠.

## 첫 페이지 — 벽 (베이크 영상 · 라이브 · 정지)

제목 아래 벽의 시공간은 세 가지 중 하나로 뜬다.
- **기본 = 베이크 영상** `assets/wall.mp4`(+ 포스터 `wall.jpg`): 배포된 작품의 작업실 뷰(`/v2/global/lab`, 20분·18존재 시험 기둥)를 `tools/bake.mjs`로 2026-11-04에 한 바퀴(180초) 찍어 24 fps mp4로 구운 것. 바로 뜬다.
- **`?live=1` = 라이브 iframe** `https://anthropocene-mu.vercel.app/v2/global/lab?ui=0&sound=mute` — 실제 앱이 돌지만 첫 화면까지 수십 초. `?rate=4`(랩 시계), `?minutes=5&bots=8&dpr=0.6`(경량 세계 — 작은 시험 기둥, 거친 캔버스; 전시 기본값은 그대로)은 `apps/web`의 작은 변경이 main에 배포된 뒤에만 먹는다.
- 순서: 베이크 영상(`assets/wall.mp4`) → 영상이 없으면 **라이브 iframe** → 그것도 안 되면(12 s) 정지 렌더(`assets/structure.webp`). 화면이 좁거나(760 px 미만) 움직임 줄이기 설정이면 바로 정지 렌더. `?baked=0`이면 베이크를 건너뛰고, `?live=0`이면 라이브를 건너뛴다. ③의 평면도 패널도 같은 순서(`top.mp4` → Top 뷰 iframe).
- 입력: 창 전체 `pointerdown`(캡처 단계)과 키(캡처 단계)로 진행한다 — 포인터 아래에 무엇이 있든 삼킬 수 없다. REFERENCES 띠는 구간이 바뀔 때만 다시 만든다(매 프레임 다시 만들면 링크가 클릭되지 않았다). `render()`는 try/catch. `?debug=1`이면 좌하단에 이벤트 로그.

다시 굽기: `node poster-motion/tools/bake.mjs <url> <이름> [초] [워밍업초] [폭] [높이] [출력폭]` — 헤드리스 Chrome(음소거)으로 실제 시각을 기록하며 프레임을 찍고 ffmpeg로 mp4·jpg를 `assets/`에 쓴다. 벽: `node tools/bake.mjs "https://anthropocene-mu.vercel.app/v2/global/lab?ui=0&sound=mute" wall 180 70 1920 860 1280`. 평면도: `node tools/bake.mjs "https://anthropocene-mu.vercel.app/v2/global/top?demo=1&ui=0&at=0&look=footprint" top 60 25 900 660 900` (look=footprint는 main 배포 뒤).

## 구간 ③의 라이브 평면도

③(모여 살기)의 위에서 본 땅 패널은 도해가 다 그려진 뒤(14초) 베이크 영상 `assets/top.mp4`로 바뀐다(`?live=1`이면 배포된 작품의 **Top 뷰** iframe) `https://anthropocene-mu.vercel.app/v2/global/top?demo=1&ui=0&look=footprint`로 바뀐다 — 시범 군중을 심고 작품의 접기 규칙 그대로 봇이 땅을 만든다. `look=footprint`는 개인 뷰 발자국 지도의 문법(검정 바탕, 회색 판, 흰 윤곽)으로 그리는 새 URL 파라미터(`apps/web` 커밋, main 배포 뒤에 먹음; 그 전엔 기본 종이 재질로 뜸). `?demo=1`은 그 iframe 출처의 localStorage에 시범 사건을 쓰므로 전시 기계의 Chrome에서는 이 사이트를 열지 않는다.

## 참고 자료 페이지 — `references.html`

인류세·황금못·크로포드 호수·2024년 3월의 결정·사건으로서의 인류세·하이퍼객체·생흔화석을 백과 항목으로, 작품의 규칙(콘크리트·길·배관·식생·지층·상속·소리·기록표)이 기댄 문헌을 가지별 마인드맵(SVG, 잎을 누르면 항목으로)과 항목 목록으로. 각 구간 화면의 오른쪽 아래 `REFERENCES ↗` 줄이 이 페이지의 항목으로 이어진다. 문헌 데이터는 `references.html` 안의 `B` 배열 한 곳. **사운드** 절(`#sound`)은 엔진·NoiseCraft·Magenta·웹사운드로서의 의의를 구조도(SVG)와 함께 자세히 쓴다.

## 배포 (Vercel, 정적) — 2026-11-04 배포됨

Vercel 프로젝트 **`homo-inventus`**(팀 Hesse Park's projects, 루트 `poster-motion`, 프레임워크 없음, 빌드 없음). 공개 주소 **https://homo-inventus.vercel.app** (프로젝트 기본 도메인; 긴 별칭 `homo-inventus-hesse-parks-projects.vercel.app`은 팀의 배포 보호 때문에 Vercel 로그인을 요구하므로 쓰지 않는다). 첫 프로덕션 배포는 이 브랜치의 커밋 6e24900에서 API로 만들었다(`create_deployment`, gitSource = 이 브랜치). 프로젝트의 프로덕션 브랜치는 저장소 기본값(main)이라 **이 브랜치에 푸시해도 자동 프로덕션 배포는 안 된다** — 대시보드 Settings → Git → Production Branch를 `claude/motion-poster-creation-c6e4e1`로 바꾸거나, 바꿀 때마다 같은 API 호출로 다시 배포한다. 배포 보호(Vercel Authentication)는 팀 기본값(custom domain 외 모두 보호)이지만 프로젝트 기본 도메인은 열려 있다; 긴 별칭과 미리보기 주소만 로그인을 요구한다. 완전히 끄려면 Settings → Deployment Protection.

### 처음 만들 때의 절차 (기록)

이 폴더가 그대로 사이트다(빌드 없음). Vercel 대시보드에서 **New Project → Import `Purpleshifted/epoch` → Root Directory `poster-motion` → Framework Preset: Other → Production Branch `claude/motion-poster-creation-c6e4e1`**. `vercel.json`이 `/references` 같은 깨끗한 주소와 폰트 캐시를 정한다. 기존 `anthropocene` 프로젝트(apps/web, main)와는 별개 프로젝트로 두어 main을 건드리지 않는다.
CLI라면: `npx vercel --cwd poster-motion` (처음엔 로그인·프로젝트 연결을 묻는다).

## 영상으로 (비상 플랜)

```
node poster-motion/tools/render.mjs                  # out/motion-poster.mp4 — 구간을 HOLD 초씩 자동으로 넘긴 100초, 1920×1080 30 fps
STILLS=17,45.5 node poster-motion/tools/render.mjs    # 그 시각의 PNG만 (out/still_<t>.png)
PAGE=poster.html node poster-motion/tools/render.mjs  # 지난 시안
```

`?auto=1`로 열어도 같은 자동 진행. 헤드리스 Chrome(음소거)으로 프레임을 하나씩 찍고 ffmpeg로 묶는다. `out/`은 git에 넣지 않는다.

## 재료

- `assets/plan.webp`: 위에서 본 건물·배관 렌더(`poster-a0/renders/plan.png`)를 무채색 900 px로 — ⑤의 전지적 평면도. `assets/structure.webp`는 `poster.html`만 쓴다.
- `data/glyphs.json` `figure.json` `traces.json`: 작품 코드가 만든 이름 기호, 이름 a·상대 b·새 어휘, 18 존재의 궤적(3점마다 하나). ②·⑦의 궤적은 bot7 = 개체 5051.
- `fonts/`: Pretendard Bold·Regular(OFL, 한글 전체 + 라틴 서브셋 woff2), Neo둥근모(`apps/web/public/fonts/neodgm.woff2`).

## 아직 정하지 않은 것

- ⑦ 기록표의 값은 예시. 실제 시연 뒤의 기록표 화면을 캡처해 바꿔도 된다.
- ④ 벽의 과정 띠는 9단→30단으로 줄여 그렸다(실제 불변선 60단).
- 영문 문장은 대본의 굵은 문장 그대로, 작은 설명 줄은 대본을 줄인 것 — 작가 검수 전. 날짜·장소 없음.

## 2026-11-04 오후 — 바뀐 것

- **룩**: 최신 A0 포스터(B/B_K .ai)대로 종이 흰색(#fff) + 땅 검정(#000), 종이와 땅의 경계는 침식된 픽셀(`erode()`: 양쪽으로 떨어져 나간 셀, 몇 개는 깜빡임), 랜딩의 제목은 우하단 픽셀 서체(Neo) 흰색에 슬라이스·침식 글리치(`glitchTitle()`) + *Homo inventus*(IBM Plex Mono Italic, `fonts/`). 종이 띠 왼쪽은 스튜디오 표기, 오른쪽은 KAIST · 링크(REFERENCES · GALLERY · THE WALL) · **QR**(`assets/qr-personal.svg` → /exhibition/personal).
- **새 구간 ①′ "An epoch is interpreted spacetime"**(`s1b`): 원통 = 시대 — 아랫면 현재(평면도 + 행위하는 사람들, actable 고리), 덩어리는 현재에서 위로 쌓이는 지층, 윗면 미래(내려다보는 다섯 시선), imagined ↑ / interpreted ↓, EPOCH 괄호, 왼쪽 future / ?? → the epoch / present. 구간은 9개(0–8), HOLD `[8,12,14,13,14,16,11,13,13]`, 숫자키 0–8, ③(모여 살기)은 이제 step 4.
- **⑤ 바로잡음**: "refuses the omniscient view" → "Partial sight, and the whole": 왼쪽 패널은 전체(벽, 안의 한 사람 위치 표시), 오른쪽은 안에서, 가운데 ↔ MOVING BETWEEN.
- **gallery.html**: 글램샷 3컷(`assets/gallery/shotN-2560.webp` 표시, `-1280` 모바일, `-full.jpg` 다운로드), 라이트박스(←/→/ESC).
- 대본 Doc(〈발견된 인류 — 졸업심사 발표 구성과 대본〉)에 ①′ 문단, ⑤ 교체, 타임라인 행, 사이트 주소를 같이 넣었다.
- 베이크: `GPU=1 node tools/bake.mjs …` — swiftshader 대신 GPU(ANGLE Metal). 900×660 기준 12 fps.
- **읽는 화면(간지)**: 각 구간 뒤에 → 한 번 더 누르면 흰 종이 한 장 — 인용, 그린 도판, 출처 4개(references 항목으로 링크). 다음 →로 다음 구간. `INTER` 표와 `fig…()` 빌더(SVG 문자열), `?nointer=1`이면 건너뜀, `?step=N&still=1&inter=1`로 한 장 렌더(`tools/shot.mjs`).
- **references.html**: 마인드맵이 힘 기반 라이브 레이아웃(반발·스프링·라벨 충돌·느린 드리프트, 드래그, 가지 hover, 클릭 → 항목), 사운드 구조도는 상자 너비에 맞춰 글자를 압축(textLength); 새 섹션 **Trace fossils — ichnology**(Seilacher 행동 분류·ichnofacies·Treptichnus pedum 경계·technofossil·human bioturbation·artificial ground·taphonomy, 도판 2)와 **Hyperobjects**(5속성 도판, 부분↔전체 phasing 애니메이션 도판, 속성↔장치 표, Chakrabarty·Latour·Haff·Tsing), 새 참고문헌 10편.

## 2026-11-04 13:40 — 작가 피드백 반영

- 랜딩: 구조물의 픽셀 셀은 회색(밝기에 따라 70–180)으로 경계의 검정 셀 앞에 오고, 띠는 건축 부재 구간까지만(화석 시작 전, y 316).
- **①′ 새로 그림 = 발굴 현장**(`s1b`): 앞 벽을 잘라낸 구덩이 — 바닥 = 현재(평면도 + 행위하는 사람들 + actable), 벽 = 쌓이는 지층, 위 = 미래의 지표면(흰 평면, 구덩이 뒤로 넓어짐)과 그 가장자리를 걷다 멈춰 들여다보는 픽셀 고고학자 다섯(시선은 회색 점선, 바닥에 흰 표식). imagined ↑ / interpreted ↓ / EPOCH 괄호. 왼쪽 아래 **제목의 뜻**(Homo sapiens·faber·ludens → inventus = found, 미래의 시선이 이름 짓는 인류, u ≥ 9.6 s). REFS에 Linnaeus 1758·Huizinga 1938.
- **노트 화면**(구 '읽는 화면'): 슬라이드와 같은 검정 테마 — 헤더(흰 띠·침식 경계)는 그대로 두고 그 아래만 덮음, 요소가 순서대로 떠오름(`rise`), 도판은 종이 팔레트를 검정 팔레트로 치환(`toDark`), 세리프 없음(발표 자료 어디에도 Homo inventus 서체를 쓰지 않음). 플레이트 ②에 제목 노트 + Linnaeus·Huizinga 출처.
- 헤더의 "발견된 인류"를 누르면 홈(0), 링크(a)를 누르면 덱이 넘어가지 않음.
- references: 마인드맵 = **바퀴**(가지마다 부채꼴, 잎은 테두리에 방사형 라벨, hover 시 부채꼴이 넓어짐, 숨쉬듯 흔들림, 클릭 → 항목) — 자유 힘 레이아웃은 읽기 어려워 교체. 제목 계보 참고문헌 4편(Linnaeus 1758, Bergson 1907, Huizinga 1938, Arendt 1958).
- 대본 Doc: ①′에 제목 문단, 노트 화면 표시 8개로 이름 변경.

## 2026-11-04 14:10 — 홈·겹침·대본·모바일

- 홈은 덱이 아니다: 홈에서 클릭해도 넘어가지 않고, **▶ START THE PRESENTATION** 줄(또는 → 키)로 시작. 링크는 링크로만 동작. 상단 제목 → 홈.
- 겹침 수정: ③ /path·/concrete 라벨이 길 선 위에 있던 것, ⑤ "one person's reach"가 그림 위에 있던 것(패널 제목 줄로), ⑥ "ONE PERSON" 라벨이 HARMONY 줄과 겹치던 것. 전 구간 끝 시점 스틸로 확인(`STILLS=19.5,33.5,46.5,60.5,76.5,87.5,100.5,113.5`).
- ⑦ 끝에 제목 회귀: "HOMO INVENTUS — THE HUMANITY THAT IS FOUND" + 한 줄. 대본 ⑦ 마지막에도 같은 문장(Thank you 앞).
- **모바일(760 px 미만)**: `#stage`를 숨기고 `#mobile`을 보인다 — 흰 제목 띠 + 침식 캔버스, 랜딩 스틸(`assets/slides/s0.jpg`), 두 문장, 링크 4개(이 폰으로 작품 입장), 발표 8장을 카드로(`assets/slides/s1–8.jpg` 1280 px + 제목·핵심 문장·REFS 링크, SEC/KEY에서 생성). 스틸은 `tools/render.mjs`의 구간 끝 프레임을 ffmpeg로 줄인 것 — 슬라이드를 고치면 다시 만들 것. references는 720 px 미만에서 헤더 고정 해제·표 가로 스크롤.

## 2026-11-04 14:40 — 3차: 실제 3D 시연 (듀얼) · 돌아가는 랜딩

- **이 브랜치의 앱을 따로 배포**: Vercel 프로젝트 **homo-inventus-lab**(prj_fHkp2JTzy8hg5bvYuD9TEMqEjA4W, root `apps/web`, Next 16, Node 24, build `next build --webpack`, install `npm install --prefix=../..`; Turbopack 빌드는 새 프로젝트에서 next/font/google 오류로 실패). 전시 배포(anthropocene, main)는 손대지 않는다. 주소 `LAB_ORIGIN` = https://homo-inventus-lab.vercel.app.
- **앱 쪽(`apps/web`, 이 브랜치)**: `lib/parliament/scenario.ts` — 대본 군중 `?scenario=slab|path|pipe|veg` (랩, 빈 땅): slab 넷이 한 자리(9초면 문턱 36, 15마다 한 단), path 둘이 왕복(13초/한 구간), pipe 세 무리 + 두 보행자(밀봉률 25 % 넘으면 배관), veg 여섯이 한 뙈기를 밟다가 떠남(200초 주기). `useGlobalBots`의 `opts.script`가 봇 대신 대본 좌표를 그대로 사건으로 낸다. 카메라 `?cam=close`(가까이, 90초 한 바퀴) · `?cam=turn`(저장된 시점, 60초 한 바퀴). `?snap=1`이면 iframe 안에서 160 px 비트맵을 0.2초마다 부모 창에 postMessage(픽셀만).
- **사이트 쪽**: 랜딩 `LIVE_URL` = 랩 `cam=turn&snap=1&minutes=8&bots=10&dpr=0.6` — 실제 3D 기둥이 돌고, 픽셀 침식 띠가 그 스냅샷을 셀로 받아 **같이 움직인다**(`sampleLive`; 스냅이 2.5초 끊기면 정지 렌더로 복귀). ③의 평면도도 랩 출처(`look=footprint`가 거기엔 있음). **④ 듀얼**: 12초 뒤 오른쪽에 `#live4` iframe — 대본 군중을 실제 규칙으로 접는 라이브, 40초마다 slab → path → pipe → veg(`V` 키로 다음), 아래 배지에 규칙 이름. `?live=0`이면 모두 끔.

## 2026-11-04 15:00 — 홈 키 시작 · ①′ 화살표 · 폰 스크롤 발표

- 홈에 START 줄 없음: **→ 키**로 발표 시작, 홈의 클릭은 전부 내비게이션(링크). 덱 안에서는 클릭/→ 진행, 상단 제목 → 홈.
- ①′: 화살표를 구덩이 가까이(x 760·1600), 굵게(4 px, 머리 20), 라벨은 화살표 **위/아래**에 중앙 정렬 — 옆의 상자·괄호와 겹치지 않음.
- **폰(터치 기기 760 px 미만 또는 520 px 미만)**: 스크롤로 발표를 읽는 형식 — 살아 있는 덱(`#stage`)을 `.hero`에 넣어 폭에 맞춰 축소하고 **sticky**로 상단에 고정; 아래 섹션 글(제목·핵심 문장·한국어·노트의 인용·도판·출처·REFS)을 읽어 내려가면 IntersectionObserver가 그 섹션으로 덱을 넘긴다(`go(i)`). 가로로 돌리면 전체 덱. 노트 플레이트는 폰에서 건너뜀(글로 대신). 좁은 데스크톱 창은 덱을 축소해 보임(폰 레이아웃 아님).

## 2026-11-04 15:45 — 클릭 버그의 진짜 원인

- ②(생흔화석)의 `s2`가 걷는 사람의 위치를 `pts[idx]`로 읽는데 `idx`가 소수(예: 22.2)라 0.6–7.8 s 사이에 매 프레임 `undefined[0]`로 던졌고, try/catch 이전에는 그 예외가 rAF 루프를 죽여 **그 슬라이드부터 클릭·키가 모두 멈췄다.** 헤드리스 재현이 안 됐던 이유: 테스트는 ②를 0.3 s 만에 지나갔거나(idx 0) 끝 시점(idx 400)만 찍었다. 이제 이웃 두 점 사이를 보간한다. 배포 사이트에서 `__seek(36/40/45)`로 확인(오류 없음).

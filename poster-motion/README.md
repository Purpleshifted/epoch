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

## 첫 페이지 — 라이브 벽

제목 아래에 배포된 작품의 작업실 뷰 `https://anthropocene-mu.vercel.app/v2/global/lab?ui=0&sound=mute`를 iframe으로 띄운다: 20분·18 존재의 시험 기둥이 3분에 한 바퀴 돈다(소리 없음). 12초 안에 안 뜨거나, 화면이 좁거나(760 px 미만), 움직임 줄이기 설정이면 정지 렌더(`assets/structure.webp`)로 대신한다.
`?live=0`으로 열면 처음부터 정지 렌더(발표 기계가 약할 때). `?rate=4`를 붙이면 랩의 시계를 ×4로 돌려 기둥이 **생성 중**인 채로 보인다 — 이 값은 `apps/web`의 작은 변경(랩의 `?rate=` 파라미터)이 main에 배포된 뒤에만 먹는다.
구간으로 넘어가면 iframe은 내려가고(`about:blank`) 제목으로 돌아오면 다시 뜬다.

## 구간 ③의 라이브 평면도

③(모여 살기)의 위에서 본 땅 패널은 도해가 다 그려진 뒤(14초) 배포된 작품의 **Top 뷰** `https://anthropocene-mu.vercel.app/v2/global/top?demo=1&ui=0&look=footprint`로 바뀐다 — 시범 군중을 심고 작품의 접기 규칙 그대로 봇이 땅을 만든다. `look=footprint`는 개인 뷰 발자국 지도의 문법(검정 바탕, 회색 판, 흰 윤곽)으로 그리는 새 URL 파라미터(`apps/web` 커밋, main 배포 뒤에 먹음; 그 전엔 기본 종이 재질로 뜸). `?demo=1`은 그 iframe 출처의 localStorage에 시범 사건을 쓰므로 전시 기계의 Chrome에서는 이 사이트를 열지 않는다.

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

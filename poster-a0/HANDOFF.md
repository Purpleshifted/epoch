# A0 졸전 포스터 — 핸드오프 (2026-11-03 01:20 기준)

다른 세션이 이어받기 위한 정리. 작가 = Hayeon Park. 보고는 한국어, 코드·커밋은 영어.
이 폴더(`poster-a0/`)가 포스터의 전부다. 브랜치 `claude/a0-poster-design-89bf0a`, 워크트리 `.claude/worktrees/a0-poster-design-89bf0a`, 개발 서버 설정 `web-poster` :3016 (워크트리의 `.claude/launch.json`). main·통합 브랜치에 올릴 것은 없다 (`ParliamentSpace.tsx`의 `PosterHook`은 캡처용이라 이 브랜치에만).

## 1. 규격

| 항목 | 값 | 상태 |
|---|---|---|
| 크기 | A0 세로, 841 × 1189 mm (PDF `@page` 동일; Chrome printToPDF로 2383.9 × 3370.4 pt 확인) | 확정 |
| 여백 | 좌우 22–24 mm, 위 10–14 mm(제목), 아래 9–12 mm(크레딧) | 시안 값, 인쇄소 확인 전 |
| 도련 | 없음 | 인쇄소·마감일 미정 (작가가 아직 안 알려줌) |
| 해상도 | 벽 이미지 약 150 dpi (타일 캡처 5967 × 5400 px). 더 올리려면 `capture.mjs` 타일 수를 늘림 | |
| 검정 | 땅 배경 `#0b0b0b` 계열. 인쇄는 리치 블랙(C40 M30 Y30 K100) 권장 | 제안만 |
| 언어 | 한/영 병기 (작가 요청 11/03). 영문은 내가 번역 — 작가 검수 전 | |

## 2. 들어갈 문구 (확정 / 미확정)

**확정**
- 제목: **발견된 인류**
- 영문 제목: **Homo inventus** (작가 "마음에 들어", 11/03). 학명처럼 두 단어를 항상 붙이고 이탤릭 또는 굵은 글씨로. 뜻: 발견된 인간 (invenire의 과거분사; 영어 invent의 어원이라 "지어낸 인간"으로도 읽힘).
- 작품 첫 두 문장 (작가 원고, `apps/web/src/lib/parliament/script.ts`의 notice):
  `미래의 고고학자들이 멸망한 인류를 발굴 중입니다.` / `현재의 당신은 무엇을 남기시겠습니까?`
  영문(내 번역): Archaeologists of the future are excavating an extinct humanity. / What will the present you leave behind?
- 작가명·학번·지도교수·과목 (6월 Umwelt 포스터 그대로): Hayeon Park 20220875 · Supervised by Yiyun Kang · ID40009 Graduation Design Studio · 2026
- 설명글 본문: `poster-a0/text.md` 3차 초안. 작가가 넣으라고 한 문장 "태어난 이상 살아가는 수밖에 없다."는 둘째 문단 **끝**, 셋째 문단은 "인류세의 화석은 무엇일까."로 시작("그렇다면" 삭제). 4문단: 인류세 정의 → 하이퍼객체(모턴) → 생흔화석 → 작품의 두 화면.
- 주석(각주) 소재: 이름(멜로디 기호), 새 어휘, 합주/저음, 걸음의 자취(발자국 지도), 거주=콘크리트, 이동=길, 물=수로·배관, 화석. 문안은 `text.md` "주석" 절과 `build.mjs`의 `TEXT.notes`/`sound`.

**미확정 (작가에게 물을 것)**
- 날짜: `2026.11.11 –` 로만 넣음 (종료일 모름). 장소: `KAIST Industrial Design`은 내 추정. 필수 항목은 "딱히 없다"고 했음(로고 등 없음).
- 영문 본문·캡션 번역 검수.
- 인쇄 마감일.

## 3. 타이포

- 제목·본문: **Pretendard** (Bold 700 제목, Regular/Medium 본문) — `~/Library/Fonts/Pretendard-*.otf`. 자간: 제목 −0.035~−0.045em, 본문은 기본(작가: "자간 애매" 피드백 뒤 트래킹 제거).
- 영문 제목: Pretendard Bold (레퍼런스가 전부 그로테스크라 Baskerville 이탤릭은 버림). 크기 22–30 mm.
- 기술 표기(치수·눈금·메타·캡션·슬래시 라벨): **IBM Plex Mono** (OFL, `poster-a0/fonts/`, gitignore — 새 세션은 `curl`로 다시 받거나 다른 모노 사용). 모노 줄의 한글은 **Neo둥근모**(`apps/web/public/fonts/neodgm.woff2`)로 폴백 — 작품의 기록 장치 말투와 이어짐.
- 작품의 두 문장은 Neo둥근모.
- 레퍼런스 폰트 조사: `adobe-fonts` 스킬은 인증 필요라 안 씀.

## 4. 색

- 작품 규칙 그대로: 인간 흔적은 무채색, 색은 식생에만. **포스터에서는 식생을 뺌**(작가: "식생 별로임") → 전체 무채색.
- 현재 방향: 위(하늘) 밝은 회백 `#f2f2f0 → #e3e4e2`, 지표면 선 검정, 아래(땅) `#0b0b0b` 어두운 지층 질감, 글은 흰색 `#ebebe7` / 흐린 회색 `#9d9e99`.
- 버린 색: 형광 연두 바탕(C안), 은회색 그라데이션 단독(E·F — 땅속 인상이 없어서 버린 게 아니라 "누끼 느낌"과 함께 밀려남).

## 5. 레이아웃 방향 (현재 = L)

작가가 보낸 두 레퍼런스(`poster-a0/refs-chat/`)의 합:
1. **ref-1 (목욕탕 단면)**: 종이를 가로지르는 **지표면 선**. 위는 하늘과 글, 아래는 어두운 땅에 건물이 잘려 들어감, 오른쪽에 깊이 표시.
2. **ref-2 (logic of evolution 도판)**: 어두운 바탕에 흰 유기 구조물 하나, **왼쪽 눈금자**, 주위에 떠 있는 **흰 슬래시 라벨 주석**(`/room_1`)과 가는 인출선, 작은 설명.

→ 우리 것은 2를 뒤집어 **지표면에 매달려 아래로** 내려가는 구조물(위 = 현재 = 픽셀 같은 건축, 아래 = 과거 = 뼈 같은 화석). "발견된"이니 **지층 아래라는 인상**이 확실해야 함. 작가 지시 요약:
- 잘린 윗부분이 땅과 **부드럽게 이어져 "파고든다"**는 느낌 (단순 누끼·사각 프레임 금지). `tools/underground.py`가 지표면 아래 첫 70 mm를 흙 섬유 노이즈로 가리고, 구조물 주변에 희미한 빛을 줌.
- 반 잘린 것보다 **길쭉하게 아래로**. 제목만 위에 두고 설명을 아래 써도 됨.
- **밀도**는 있어야 하되(요소·역동성), 꽉 채운 칼럼은 안 됨 → "미니멀" = ref-2의 문법: 주석이 구조물 **주위를 떠다니고**, 그 주석 **안에** 멜로디 기호·새 어휘·저음·발자국 지도가 들어감. 작품의 이 기호들은 절대 빼지 말 것.
- 픽셀 비주얼(Neo둥근모, 8×8 글리프)과 유기 비주얼(융합 덩어리)이 **하나로 엮이는 장치**가 필요. 포스터 앞에 글로벌 벽 모니터가 있으니 벽을 그대로 반복하지 말 것.
- 레이아웃 요소는 작가 레퍼런스 폴더에서 **인포그래픽스럽게** 가져올 것 (번호, 인출선, 범례, Fig., 눈금, 치수).

**L안 구성** (`build.mjs` 맨 아래 블록; 세션이 죽어 미리보기는 못 뽑음):
하늘 200 mm: 제목 한 줄 118 mm + Homo inventus + 작품 두 문장(오른쪽). 지표면 선. 땅: 구조물 왼쪽(중심 x 300), 왼쪽 눈금자(분), 오른쪽 x 612부터 흰 주석 7개(/콘크리트 /배관 /이름(기호) /새 어휘(기호) /뼈 /저음(겹친 기호) /화석)가 각각 인출선으로 구조물의 지점을 가리킴, 왼쪽 아래 /걸음의 자취(발자국 지도 110 mm), 오른쪽 아래 짧은 본문 한/영 + 메타.
`node poster-a0/build.mjs` → `out/L.html`; 미리보기 `tools/preview.sh L <out.jpg>`; 겹침 검사 `tools/overlap.py L rects.json` (0이어야 함).

## 6. 버린 안과 이유 (시간순)

| 안 | 내용 | 버린 이유 (작가 말) |
|---|---|---|
| 1차 poster | 픽셀 폰트 전면, 2단, 페이드, 이미지 위 검은 글상자 | "레이아웃 너무 촌스러움 … 쌈빡한 걸 원해" |
| A 도면 / B 풍경 / C 지층 / D 표본 | 은회색·검정·형광연두, 제목을 지층처럼 누른 것 등 | 글자와 이미지 겹침 "후져"; C는 제목 안 읽힘 |
| B·D 흑/백 4종 | 누끼 구조물 + 4단 그리드 | "네 개 다 구려 … 뭐가 메인 설명이고 각주인지 모르겠음", 세로 감각 부족 |
| E 단면 / F 세로 제목 | 은회색 종이, 왼쪽 글 기둥, 시간축 절단면 | 방향은 좋으나 "누끼딴 느낌 후져", 자간 애매, 영문 제목 더 크게, 그라데이션은 위→아래 |
| G 사진 | 검정 바탕 벽 사진 그대로 + 그레인 | 작가 레퍼런스 폴더를 받고 보니 **종이 위 표본 + 침식 가장자리**가 취향이라 G는 오독 |
| H 픽셀→유기 디더 | 현재는 픽셀 격자, 아래로 유기물로 풀림, 가장자리 셀 침식 | 디졸브 가장자리 자체는 "좋긴 한데" / 픽셀 장치는 "이 방향은 아닌 것 같음" |
| I 발굴 | 지표면 위 글, 아래 땅속 구조물(반쯤 잘림) | 방향 OK. 단, 잘린 윗부분이 땅과 이어져야 하고 더 길쭉해야 함 |
| J 발굴 II | I + 오른쪽 흰 글 기둥 꽉 채움(기록표, 표본 행렬, 범례) | "지금 하고있는 방향 개후지니깐 차라리 미니멀하게" |
| K 미니멀 | 전부 뺀 것 (기호·발자국 없음) | "저 방향으로 뽑으면 진짜 죽여버린다 … 멜로디랑 이런 건?" → 미니멀 ≠ 삭제 |

기둥 렌더 시도: 봇 10/무리 2/간격 14 = 옥수수 심지 같은 기둥("안 예쁜데"); 작가는 **무리 셋**을 원함(15/3/24, 35분). 랩(`/v2/global/lab`)은 자기 기둥을 다시 만들어 버려서 주입이 안 먹음 → `tools/column.mjs`로 사건을 만들어 localStorage에 넣고 **`/v2/global/space`**(공유 뷰)에서 접음(seeds 594, top 146까지 확인). 캡처 직전 세션이 죽음(부하 100+, exit 137). `renders/tall15_alpha.png`는 19봇 기둥을 세로 프레임으로 찍은 것이지 15봇이 아님.

## 7. 레퍼런스 위치와 접근

| 무엇 | 위치 | 접근 |
|---|---|---|
| 작가가 모은 포스터 레퍼런스 | `/Volumes/Hesse/exhibition/anthropocene/poster refs/` (폴더명에 공백) | 로컬 읽기 OK. 41장 중 **IMG_0496–0517(22장)만 스터디함**; IMG_0518–0536(19장, 11/03 00:25–00:43 추가)은 **아직 안 봄**. 그룹 스터디 결과 `poster-a0/refs-chat/refs-study-grouped.jpg`. 저장소에 안 넣음(타인 저작물) |
| 채팅으로 보낸 결정적 레퍼런스 2장 | `poster-a0/refs-chat/ref-1-section-bathhouse.jpg`, `ref-2-logic-of-evolution-plate.jpg` | gitignore. 세션 tmp에서 복사해 둠 |
| 작품 비주얼 레퍼런스 (건축·화석) | `/Volumes/Hesse/exhibition/anthropocene/visual_reference_images/` (IMG_9539–9730) | gitignore, 재배포 금지. 9579가 핵심 |
| 웹 레퍼런스 | 100 Beste Plakate 2025 "Alf Lechner 100 – Materie Stahl"(OFF OFFICE); ZKM Critical Zones 2020; Fondazione Prada; MMCA 올해의 작가상 2024 | 빌트인 브라우저로 봄. 템플릿·AI 사이트는 쓸모없었음 |
| 6월 Umwelt 포스터 (크레딧 양식) | `/Volumes/Hesse/exhibition/poster/` (A2 2장, poster.ai) | 로컬 |
| 작품 데이터 (실제 코드가 만든 기호) | `poster-a0/data/glyphs.json`(400개 이름 기호), `figure.json`(이름 a, 상대 b, 새 어휘), `traces.json`(19봇 궤적) — `tools/glyphs.mjs`, `traces.mjs`로 재생성 | 저장소에 포함 |
| 벽 렌더 | `poster-a0/renders/` (gitignore): `wide_alpha.png`=`column_dark_alpha.png` 19봇 누끼, `underground.jpg` 현재 합성, `column_paper*.jpg` 종이 테마, `tall*_alpha.png` 세로 프레임 | 다시 만들려면 §8 |
| Figma | 작가: "이 안에서만 해결하기 힘들면 피그마 써도 됨" | MCP 인증(`/mcp`) 안 됨. 쓰려면 작가가 인증. 지금 방식(HTML→PDF)으로 충분 |

## 8. 렌더/캡처 레시피 (요약)

1. 캡처용 Chrome: `--headless=new --remote-debugging-port=9333 --mute-audio … --window-size=500,800` (반드시 음소거, 끝나면 `pkill`; 부하 `uptime` < 10일 때만. 8 GB M2라 큰 창은 OOM).
2. 공유 뷰 `/v2/global/space`에 `tools/column.mjs`로 만든 사건을 localStorage(epoch·events·keep 키)로 주입 → seeds가 생길 때까지 2–4분 → `__STORE`로 식생 끄기, `timeRate` 낮추기.
3. `tools/stage.js` + `tiles.js` 로드, `__keyGround('#ff00ff')`, `tools/capture.mjs <dir> '{"cols":4,"rows":5,"tileW":921,"tileH":1410,"pad":40,"pose":{"az":36,"polar":88,"vh":140,"top":122},"pointK":1}'` → `tools/key.py` (마젠타 키 → RGBA).
4. `PRESENT_FRAC=0.2429 python3 tools/underground.py <alpha.png> renders/underground.jpg 841 <땅높이mm> <구조물높이mm> 2 <중심x> 3` (세로 프레임 vh 140/top 122일 때 0.2429; 83.4 프레임이면 0.0695).
5. 레이아웃 Chrome(:9334, `--disable-gpu --allow-file-access-from-files`)에서 `tools/preview.sh <안> <out.jpg>`; PDF는 `CDP_PORT=9334 node tools/cdp.mjs pdf out/<안>.pdf 841 1189`.
세부 주의점은 메모리 `poster-a0-session.md`에 있음.

## 9. 남은 일

1. L 미리보기 뽑아 작가 확인 (아직 한 번도 못 봄). 15봇·3무리 세로 기둥으로 교체.
2. 안 본 레퍼런스 19장 스터디 → L의 주석 문법 보정.
3. 영문 검수, 날짜·장소 확정, 인쇄소 마감·도련.
4. PDF 출력·검수, 커밋·푸시.

# 발견된 인류 — 발표 화면 (poster-motion)

졸업심사 발표 대본(「발견된 인류 — 졸업심사 발표 구성과 대본」, Claude 문서)의 도입과 일곱 구간을 그대로 따라가는 **키로 넘기는 웹 페이지**. 16:9 (1920 × 1080).
A0 포스터(하늘·지표면·땅에 매달린 구조물·떠 있는 슬래시 주석·멜로디 기호)의 시각 언어를 움직이게 한 것이다. 큰 글은 대본의 굵은 핵심 문장(영어) 그대로, 한국어는 작게.

## 발표 때

```
node poster-motion/tools/serve.mjs 3018      # http://localhost:3018/  (아무 정적 서버든 된다; file:// 는 JSON fetch가 막힘)
```

브라우저에서 열고 `f`로 전체 화면. 구간은 멈춰 있고 키를 눌러야 넘어간다.

| 키 | 동작 |
|---|---|
| → · 스페이스 · Enter · PageDown · 화면 오른쪽 클릭 | 다음 구간 |
| ← · Backspace · PageUp · 화면 왼쪽 20 % 클릭 | 이전 구간 |
| 0–7 | 그 구간으로 바로 (0 = 제목) |
| r | 지금 구간의 움직임 다시 재생 |
| f | 전체 화면 · h: 시간 표시 |

`?step=3`으로 열면 그 구간부터. 마우스를 멈추면 커서가 숨는다.
시연(라이브 앱)은 제목 화면(0)에서 앱으로 갔다가 돌아와 →를 누르면 ①로 이어진다.

## 구간 (index.html의 `HOLD`·`TAG`·`CAPD`·`SIGN`)

| 단계 | 화면 | 대본 |
|---|---|---|
| 0 | 제목이 쓸려 들어오고 땅에 작품의 두 문장이 타자로 찍힌다 (영문 아래) | 도입 · 시연은 라이브 |
| 1 | 발굴: 구조물이 지표면에서 아래로 드러나고 오른쪽 눈금자(T+0 → −20′, 한 눈금 = 지층 한 겹 20 s)가 내려간다. /황금못 — 지표면을 따라 점선, 하늘의 `1952 · PU · CRAWFORD LAKE`가 줄 그어지고 `REJECTED 4 : 12`. “That gap, between the concept and its record, is where this work begins.” | ① |
| 2 | /생흔 — 왼쪽 아래 상자에 한 삶(개체 5051)의 발자국이 그려진다 (■ 태어난 곳 · □ 끝난 곳). “A fossil of behaviour, not of the body.” | ② |
| 3 | /길 /배관 /콘크리트 — 구조물의 지점으로 인출선. “Living together.” | ③ |
| 4 | Stay · Walk · Seal · Leave 네 줄, /지층 눈금 한 칸(20 S), 3.2초에 단층(아래쪽이 14 px 미끄러지고 흰 선이 번쩍), 상자는 /공동체(18 존재의 자취 + 평면)로. “Seen from the future, our ordinary days are already the object of excavation.” | ④ |
| 5 | /시야 — 땅이 어두워지고 작은 시야 하나만 떠돈다. “This work refuses the omniscient view.” | ⑤ |
| 6 | /이름 /접촉 /새 어휘 /저음 — 8칸 악보가 시퀀서처럼 돌고, 새 어휘가 태어날 때 점이 터진다. “The same event, at two different scales.” | ⑥ |
| 7 | “The record remains. Your traces may be read — or may not be.” + 「현재의 당신은 무엇을 남기시겠습니까?」 — 완성된 포스터 | ⑦ |

각 구간의 움직임은 들어갈 때 한 번 재생되고 멈춘다. 앞 구간의 주석은 흐려진 채 남고, 뒤 구간 것은 아직 없다.
글은 `.tag`(슬래시 주석)와 `.cap`(구간별 캡션) 블록에 그대로 있다.

## 영상으로 (비상 플랜·전시용 루프)

```
node poster-motion/tools/render.mjs                 # out/motion-poster.mp4 — 구간을 HOLD 초씩 자동으로 넘긴 63초, 1920×1080 30 fps
STILLS=5.5,16,62 node poster-motion/tools/render.mjs   # 그 시각의 PNG만 (out/still_<t>.png)
```

`?auto=1`로 열어도 같은 자동 진행. 헤드리스 Chrome(음소거)으로 프레임을 하나씩 찍고 ffmpeg로 묶는다. `out/`은 git에 넣지 않는다.

## 재료

- `assets/structure.webp`: 벽 기둥 렌더 `poster-a0/renders/wide_alpha.png`(19 존재, 브랜치 `claude/a0-poster-design-89bf0a`, git 밖)를 1600 px로 줄인 것.
- `assets/plan.webp`: 같은 폴더의 `plan.png`(위에서 본 건물·배관)를 무채색 900 px로.
- `data/glyphs.json` `figure.json` `traces.json`: `poster-a0/data/`와 같은 것(작품 코드가 만든 이름 기호, 이름 a·상대 b·새 어휘, 18 존재의 궤적을 3점마다 하나로 줄임).
- `fonts/`: Pretendard Bold·Regular(OFL, 한글 전체 + 라틴 서브셋 woff2), Neo둥근모(`apps/web/public/fonts/neodgm.woff2`).

## 아직 정하지 않은 것

- 날짜·장소는 넣지 않았다(미정). 하늘 오른쪽 위 `KAIST · 2026`만.
- 영문 캡션은 대본의 굵은 문장 그대로, 작은 영문 줄은 대본을 줄인 것 — 작가 검수 전.

# homo-inventus.vercel.app — 수정 플랜 (2026-11-04)

작가 요청 모음(11/04 낮)을 한 번에 정리한 것. 각 항목은 끝나면 커밋·푸시·재배포하고, **대본 Claude Doc(〈발견된 인류 — 졸업심사 발표 구성과 대본〉)의 해당 구간을 같이 고친다.**

## 0. 이미 적용 (커밋 전)

- 클릭: 창 전체 `pointerdown`(캡처 단계)으로 진행 — 포인터 아래에 무엇이 있든(참고문헌 띠, 비디오, 포커스를 가져간 iframe) 삼킬 수 없음. 키보드도 캡처 단계. `render()`는 try/catch — 한 프레임의 오류가 덱을 멈추지 못함. `?debug=1`이면 좌하단에 이벤트 로그.
- **REFERENCES 띠가 매 프레임 다시 만들어져서** mousedown과 mouseup 사이에 링크가 사라졌음 → 띠는 구간이 바뀔 때만 다시 만듦. (링크 클릭이 안 되던 가장 유력한 원인.)
- 헤드리스 재현: file://·기본 모드·`?live=1` 세 번 모두 ②③에서 15–40 s 머문 뒤 클릭·키 정상. 작가 환경에서 다시 안 되면 `?debug=1`로 열고 좌하단 로그를 찍어 주기.

## A. 발표 구조 (index.html + 대본)

1. **새 슬라이드 ①′ "시대 = 해석된 시공간"** (①과 ② 사이). 원통 = 시대: 아랫면 현재(우리가 행위하는 면, actable 고리), 윗면 미래(내려다보는 시선들 — 시대를 정의하는 눈), imagined ↑ / interpreted ↓, 덩어리 속에 작품 렌더(컬럼 단면 또는 베이크된 평면도). 왼쪽 "future / ?? / present"의 ??가 이 덩어리. 애니메이션: 아랫면에서 덩어리가 차오르고, 마지막에 윗면의 시선이 생김. 대본에 문단 추가.
2. **⑤ 바로잡기**: "refuses the omniscient view"가 아님. 부분적으로만 인식 가능한 상태(헤드셋: 시야 24·한 삶 180 s)와 전체(벽)를 **오가며** 둘 사이의 연결을 고찰하는 계기. 구간 제목·핵심 문장·도해의 왼쪽 패널("THE OMNISCIENT VIEW · refused" → "THE WHOLE · the wall, and the way between")·references의 하이퍼객체 글·규칙표 "Life · sight" 행.
3. **슬라이드 사이 레퍼런스 간지**: 각 구간 뒤에 교수님이 읽을 한 화면 — 인용 1 + 도판 1 + 출처 3–4. (① 뒤: SQS/IUGS 성명 + Crawford Lake 도해 · ② 뒤: Seilacher 행동 분류 도판 · ③ 뒤: Waters 2016 지표 목록 · ④ 뒤: Helbing 길 형성 · ⑤ 뒤: Morton 5속성 · ⑥ 뒤: 사운드 구조도 · ⑦ 뒤: 상속·형성 과정.) →로 지나가고 숫자키는 본 슬라이드로. 대본에는 "(읽는 시간 — 말 이어감)"으로 표시.
4. 대본 실시간 반영: 변경 때마다 해당 구간 문단 갱신.

## B. references.html

5. **마인드맵 → 힘 기반 레이아웃**: 반발 + 스프링 + 가지 응집 + 중심 중력, 느린 드리프트(살아 있음), 드래그, hover 시 가지·연결 강조, 클릭 → 항목. 글상자는 텍스트를 재서(getBBox) 크기 결정 — 튀어나옴 해결. 사운드 구조도 상자도 같은 방식(또는 줄바꿈).
6. **생흔화석 학술 보강(도판 포함)**: Seilacher(1953/1964) 행동 분류 — domichnia(거주) · repichnia(이동) · pascichnia(섭식) · fodinichnia(채굴) · cubichnia(휴식) · agrichnia(경작) SVG 도판 + 작품 규칙 대응(머묾→domichnia, 걷기→repichnia, 배관→"인류의 지하 교란"); Seilacher 1967 ichnofacies 깊이도; Bromley 1996; Buatois & Mángano 2011; Zalasiewicz et al. 2014 technofossils; Zalasiewicz, Waters & Williams 2014 "Human bioturbation"; Williams et al. 2019 (지하철 = 인류세 지질 지표).
7. **하이퍼객체 학술 보강(도판 포함)**: Morton 2013 5속성 — viscosity · nonlocality · temporal undulation · phasing · interobjectivity — 도판과 각 속성 ↔ 작품 장치(phasing ↔ 시야 24와 단면, undulation ↔ 20 s 지층, interobjectivity ↔ 하나의 사건 로그·두 화면); Morton 2010 *The Ecological Thought*(mesh); Chakrabarty 2009; Latour 2017. 움직이는 도판: 덩어리를 가로지르는 단면(부분 인식) ↔ 전체.
8. **사운드 인터랙티브 모듈**: 상황별 카드 + ▶ — 이름 받기(모티프) / 걷기(길 위의 베이스) / 곁에 머묾(lock → 화음·패드) / 부름에 응답(새 어휘) / 콘크리트 곁(둔해짐) / 식생(노이즈) / 전체(두 옥타브 아래, 스피커). 구현: `apps/web/src/lib/sound`를 esbuild로 묶어 사이트에 넣고 **합성 신호로 실제 엔진을 구동**(녹음이 아니라 진짜 소리). 외부 의존(`@/lib/parliament`의 wrapDist 등, `CELL_SIZE`)은 shim; Magenta는 external(실패 시 절차적 변주). 카드마다 작은 캔버스(나·이웃·lock 미터).
9. **생성 로직 = 듀얼(도해 + 실제 3D 시연)** (작가 12:20: 영상이 아니라 진짜 3D 요소가 조건에 맞춰 생성되는 것을 보여주기). 앱(`apps/web`, 이 브랜치)에 **시나리오 모드** `?scenario=slab|path|pipe|veg&rate=20&ui=0`를 추가: 랩 뷰가 그 규칙 하나만 일으키는 봇 대본을 심는다 — `slab` 네 명이 한 칸에 머묾(창 600 s·문턱 36을 rate 20으로 30초 안에) · `path` 두 명이 두 점 사이를 왕복(p ≥ 0.3) · `pipe` 슬래브 군집 + 길로 밀봉률 문턱 초과 → 배관 · `veg` 군중이 밟다가 떠남 → 식생 회복. 카메라는 그 자리 클로즈업(궤도). 사이트에서는 ④의 각 패널 옆(또는 references의 규칙 모듈)에 iframe으로 **라이브 임베드**: 구간에 들어가기 전에 숨겨서 미리 로드(첫 화면 10–40 s), `?minutes=5&bots=8&dpr=0.6` 경량. 공개 URL이 필요하므로 **이 브랜치의 앱을 두 번째 Vercel 프로젝트**(예: homo-inventus-lab, root apps/web, 프로덕션 브랜치 = 이 브랜치)로 배포 — 전시 배포(anthropocene, main)는 손대지 않음. 캔버스 도해는 그대로 두고 옆에 붙인다(듀얼). 베이크 영상은 라이브가 실패할 때의 대비용으로만.
10. **QR + 링크**: 랜딩과 헤더에 "Enter on your phone"(QR = `qr/qr-personal-exhibition.svg` → /exhibition/personal) + "The wall"(/exhibition/global). `/v2/*` 링크 금지.
11. **갤러리 gallery.html**: 글램샷 3컷(2560 webp 표시, 원본급 jpg 다운로드 — assets/gallery/ 준비됨), 라이트박스, 영문 캡션, 헤더·랜딩 링크.

## C. 룩

12. **최신 포스터(B/B_K .ai, 11/03 13:30) 반영**: 종이 **흰색(#fff)** + 땅 **검정(#000)**(지금은 회색 #dfe0db + #0a0a0b = 구버전), 흰–검 경계는 침식된 픽셀, 제목은 **우하단** 흰 픽셀/글리치 + *Homo inventus* 이탤릭, 구조물은 가운데. references·gallery 헤더도 종이 흰색.

## D. 에셋·배포

13. **베이크 재시도**: wall은 실패(swiftshader에서 1920×860 스크린샷 1장에 180 s) → GPU 헤드리스(ANGLE Metal) 또는 저해상도; top은 25 s 워밍업이라 거의 빈 땅 + footprint 룩 미적용(main에 없음) → **이 브랜치 앱을 로컬로 띄워** `?look=footprint&rate=`로 베이크(전시 환경 영향 없음).
14. 묶음마다 커밋·푸시·`create_deployment`(프로덕션 브랜치가 main이라 푸시만으로는 배포 안 됨 — 대시보드에서 이 브랜치로 바꾸면 푸시 = 배포).

## 진행 (11/04)

- 1차 완료·배포: 0 클릭 → 1 ①′ → 2 ⑤ → 10 QR·링크 → 11 갤러리 → 12 룩(+ 작가 피드백: 제목 Pretendard Black·Homo inventus 세리프 이탤릭·자간, 구조물 픽셀 침식이 경계와 함께 움직임, 발표 슬라이드 경계는 정지).
- 2차 완료·배포: 3 간지(읽는 화면 8장) → 5 마인드맵 힘 레이아웃 + 글상자 맞춤 → 6·7 생흔화석·하이퍼객체 섹션 + 도판 + 참고문헌 10편. 대본 Doc에 읽는 화면 표시 8개.
- 13:40 작가 피드백 반영·배포: 랜딩 셀(회색·앞·좁은 띠), ①′ = 발굴 현장(픽셀 고고학자), 제목 Homo inventus의 뜻(①′·노트·references·대본), 노트 화면을 검정 테마로(세리프 금지), 헤더 제목 → 홈, 마인드맵 = 바퀴.
- 14:10: 홈 클릭 무효(START 줄), 겹침 3곳 수정, ⑦ 제목 회귀(대본도), 모바일 레이아웃(카드형 덱) 배포.
- 14:40 3차 시작: 앱 시나리오 모드(`scenario.ts`, `?cam=close|turn`, `?snap=1`), 두 번째 Vercel 프로젝트 homo-inventus-lab(webpack 빌드), 사이트의 ④ 듀얼 패널과 랜딩 라이브 회전 + 스냅샷 픽셀 층. 남은 것: 8 사운드 모듈, 13 베이크(랜딩이 라이브가 되면 불필요할 수도).
- (이전) 남은 것: 3차(8 사운드 모듈, 9 듀얼 라이브 3D, 13 베이크 재시도) + 랜딩에 **실제 3D 에셋을 통째로 회전시키며 픽셀 레이어**(작가 13:20: 캡처 대신 — 이 브랜치 앱을 같은 출처에서 띄우고 `?snap=1`로 축소 스냅샷을 postMessage로 받아 셀로 그리는 방식 검토).

## 순서 제안

- **1차(오늘)**: 0 → 1 ①′ → 2 ⑤ → 10 QR·링크 → 11 갤러리 → 12 룩 → 배포 + 대본.
- **2차**: 3 간지 → 5 마인드맵 → 6·7 학술 섹션 → 배포 + 대본.
- **3차**: 8·9 모듈 → 13 베이크 → 배포.

## 작가 결정

(a) 순서. (b) 사운드 모듈: 실제 엔진 번들(추천) / 녹음 클립. (c) ①′: 새 슬라이드(추천) / ①에 합치기. (d) 클릭이 또 안 되면 `?debug=1` 로그.

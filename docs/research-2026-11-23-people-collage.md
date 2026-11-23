# 사람 = 실제 사람 이미지의 동적 콜라주? — 조사 (2026-11-23, bot-present)

작가: "실제 사람 사진이나 실루엣 등을 오픈소스로 동적 디지털 콜라주처럼 받아온 예시가 있는지, 내 비주얼 inclination 에 가까워보이는
작업들에는 뭐가 있었고 어떤 방식이었는지" + "봇의 실시간 위치(릴레이) vs 나에 대한 상대 속도·거리·각도 디바운싱".
(웹 조사는 서브에이전트, 확인 못 한 것은 표시.)

## 1. 데이터: 실시간 위치 vs 디바운싱한 상대값

- 지금: 봇은 봇 서버(Cloudflare DO)에서 돌고, 개인뷰는 기록의 접기(~0.5 s)로 절대 위치를 받으며 거리·방위는 그 자리에서 계산.
- 실시간 스트림(10–20 Hz): 진실 하나(벽·개인뷰·미래 공유)지만 서버 틱·트래픽이 늘고, 그림은 매끈한 보간 — 작가가 어색하다고 한
  미끄러짐·회전과 같은 계열. 레퍼런스에 매끈한 실시간은 거의 없음.
- 상대값을 서버에서: 관객마다 따로(관객 × 봇) 계산·전송, 벽은 못 씀. 클라이언트에서 절대 위치로 바로 계산되니 받을 이유가 약함.
- **추천**: 절대 위치 하나 + 표본마다 **시각·속도**를 실어 2–4 Hz. 상대값은 화면에서. 그리기는 표본마다 스탬프("슉", 구현됨) — 속도를
  알면 그 간격만큼의 번짐(섬유) 길이·방향을 실제대로 = 흉내가 아닌 "그 간격의 노출". 레퍼런스 대부분이 기록 장치의 띄엄띄엄한
  관측(라이다 + 라벨 9954, 장노출, 도트 매트릭스, 크로노포토그래피)이라 이쪽이 결에 맞음.

## 2. 실제 사람 이미지로 하는 동적 콜라주 — 웹에 꼭 맞는 오픈소스 선례는 못 찾음, 재료는 다 열려 있음

| 도구 | 방식 |
|---|---|
| MediaPipe Image Segmenter / TF.js body-segmentation (Apache-2.0) | 브라우저 GPU에서 사람 마스크 → 텍스처 |
| Crowd3 (MIT, 데스크톱) | 내 사진에서 BodyPix로 사람을 오려 군중 콜라주(정지) — 가장 가까운 오픈소스 |
| mediapipe-touchdesigner (오픈소스, 라이선스 미확인) | TD에서 분할 |
| Depthkit.js (three.js, MIT, 보관됨) | 깊이 영상 사람을 점·메시로 |
| SAM · rembg · MODNet | 오프라인 오려내기 |

## 3. 가까운 작업들

- Alexey Titarenko *City of Shadows* (1991–94): 장노출 군중이 검은 번짐 — 장노출 레퍼런스의 계열.
- 김아타 *ON-AIR*: 8시간 노출, 움직이는 사람이 사라짐 — 시간과 존재.
- Pelle Cass *Selected People*: 100–600장에서 고른 사람을 제자리에 레이어로 — 시간 위의 군중 콜라주.
- Zbigniew Rybczyński *Tango* (1980): 한 방에 36명의 반복을 매트로 겹침 — "겹친 층 = 시간"의 고전.
- Daniel Crooks *Static*, Adam Magyar *Urban Flow*: 슬릿스캔 군중.
- Jim Campbell *Scattered Light*, *Grand Central Station #2*: 저해상 LED 통근자 — "역 군중 도트 매트릭스" 레퍼런스의 출처일 가능성 높음.
- Scott Snibbe *Deep Walls* (2002): 관객 실루엣을 16칸 격자에 녹화·재생 — Butterfly Effect 격자와 가까움.
- Rafael Lozano-Hemmer *Body Movies* (2001): 행인의 그림자 안에만 초상이 나타남.
- OpenEndedGroup / Bill T. Jones *Ghostcatching* (1999): 모캡 몸을 획과 흔적으로 — TD "섬유" 몸의 조상.
- Kyle McDonald & Jonas Jongejan *Exhausting a Crowd* (2015): 군중 영상에 온라인 관객이 라벨 — 라벨 붙은 보행자.
- (기억, 미확인) Memo Akten & Quayola *Forms*, Takeuchi & Phillips *Asphyxia*, Radiohead *House of Cards*, Chris Milk *The Treachery of Sanctuary*.

## 4. 라이선스·프라이버시

COCO·LVIS는 주석만 CC BY, 사진은 각 Flickr 원작자 라이선스. Open Images는 사진마다 확인. Unsplash/Pexels는 거의 CC0이지만 모델
릴리스는 보장 없음. AMASS·Human3.6M은 비상업·연구 한정; CMU 모캡은 우리가 이미 씀(재판매 금지). Muybridge *Animal Locomotion*
(1887)은 퍼블릭 도메인(걷기·뛰기 판 다수, 나체가 많음 — 학교 전시 주의). 웹캠 군중 데이터(Brainwash, Duke MTMC)는 동의 문제로
철회됨 — 피하거나 감시를 주제로 명시. 실천: 퍼블릭 도메인/CC0, 또는 동의서 받은 직접 촬영; 얼굴은 알아볼 수 없게; 관객 실시간
캡처는 동의 안내 + 저해상 마스크만, 사진은 저장하지 않음.

## 5. 우리 스택에서 할 수 있는 것 (판단)

A. **오려낸 사람 스프라이트 아틀라스 + 잔상 인스턴스** — Muybridge 판이나 동의 받은 직접 촬영(흰 벽 앞 걷기)을 오프라인 분할 →
   2048² 아틀라스 → 몸 하나 = 걸음 위상의 빌보드, 지난 위치들을 곱하기 블렌딩으로 겹침(아세테이트). Claire Harvey·Marey·*Tango*로
   읽힘. 하루–이틀 준비 + 하루 셰이더, 폰에도 쌈.
B. 장노출 누적 버퍼(핑퐁) — 작가가 "브라우저 장노출은 아니었다"고 해서 지금은 뺌; A 위에 얹을 수는 있음.
C. **점으로 샘플한 사람 + 라벨** — 지금 만든 `fiberBody`(뼈대 위 점 + 섬유)가 이것; 라벨·상자를 붙이면 Campbell·Cybotron·라이다.
D. 관객 실시간 실루엣(MediaPipe, 폰 카메라) — 비용·동의 부담 큼, 나중에 원하면.

조사의 판단: A(+ 지금의 C)가 레퍼런스에 가장 가깝고 위험이 적음 — 데이터셋을 긁기보다 직접 찍은 동의 받은 인물로.

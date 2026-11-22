# 삶의 녹음 — 표본 카드의 QR이 여는 소리

2026-11-21, 작가: 표본 카드의 QR이 **그 삶 동안 들은 음악**으로 이어진다. 기록에서 다시 연주하는 **재연이 아니라 녹음**으로 간다 — 규모가 작고, 엔진이 바뀌어도 그날 들은 소리가 그대로 남는다.

## 무엇을 담나

- **헤드셋으로 간 믹스만.** `engine.ts`의 사슬 master → limiter → destination에서 **리미터 뒤**에 `MediaStreamAudioDestinationNode`를 하나 더 단다(`engine.tapOutput()`). 장치로 가는 연결은 그대로이고, 녹음은 그 옆의 싱크일 뿐이다 — 처리 없음, 소리 부하 없음(인코딩은 브라우저의 `MediaRecorder`가 메인 스레드 밖에서).
- **마이크는 절대 켜지 않는다.** `getUserMedia`를 부르는 코드가 없다.
- 출력 장치(`setSinkId`, `/v2/sound/output`)와 무관하다: 노드에서 따므로 전시장 헤드셋이든 폰 스피커든 같은 소리.
- NoiseCraft 패치도 엔진의 master로 들어오므로 함께 담긴다.
- **범위**: 이름 화면(NAME, 이름의 멜로디가 `announce`로 울릴 때)부터, 끝 카드가 뜬 뒤 **죽음의 잔향이 다 사라질 때**(`engine.afterlifeOver`; 엔진이 말하지 않으면 `죽음의 잔향` + 4 s)까지. 이름 화면에서 떠난 관객(삶 없이 IDLE로)은 아무것도 남기지 않는다. 잔향이 끝나기 전에 다음 관객이 오면 거기서 끊는다.

## 형식과 크기

| 브라우저 | 형식 | 비고 |
| --- | --- | --- |
| Chrome (전시 기계) | `audio/mp4` (AAC) | Chrome이 MP4를 만들 수 있으면 MP4가 먼저 — QR은 아이폰 Safari에서 열리고, Safari는 WebM을 못 튼다 |
| Chrome (MP4 없는 옛 판) | `audio/webm;codecs=opus` | |
| Safari (iOS, 원격 관객) | `audio/mp4` | 작가의 프리뷰 테스트로 확인 |

64 kbps 기본(Leva `녹음 비트레이트`) → 3분 ≈ 1.4 MB. 형식은 `lib/sound/recorder.ts`의 `FORMAT_PREFERENCE` 순서대로 `MediaRecorder.isTypeSupported`로 고른다.

## 어디로 가나

**작가 결정(2026-11-22, 표본 카드 세션)**: "카드가 뜨자마자 QR이 보이게 하려면, 삶이 끝날 때 녹음을 바로 올리고 남기지 않은 삶은 갤러리에 보이지 않게" — 이렇게 바꿈. (11/21의 결정 "게시하면 … 녹음본 db로 넘기고 굳이 게시 안 하면 걍 버리고"는 이것으로 대체: 녹음은 모든 삶이 올라가고, 게시·출력은 그 삶을 **갤러리**에 남기는 일이 된다.) 그래서:

1. **잔향이 끝나 녹음이 멈추면** — Blob을 IndexedDB(`anthropocene-recordings`)에 삶 id로 넣고(`lib/sound/recordingStore.ts`, 끝 화면용 `localUrl`도 이때), **곧바로** `uploadLifeRecording()`(`components/parliament/useLifeRecording.ts`)이 `PUT /rec/<id>`(오디오) → `PUT /rec/<id>.json`(마커)로 Worker `relay/recordings`(R2)에 올린다. 한 삶에 업로드는 한 번: 게시·출력이 그 업로드에 합류한다.
2. **카드의 QR은 끝나는 순간부터** — 주소가 삶 id로 정해져 있으므로(`/rec/<id>`) 업로드를 기다리지 않고 카드에 그린다(`ParliamentScene` → `SessionHud recordingUrl`). 출력하기도 기다리지 않는다. 녹음이 실패했거나 꺼져 있으면 QR 없음(빈 자리 표시).
3. **재생 페이지는 기다린다** — 잔향이 울리는 동안 QR을 찍으면 `/rec/<id>`가 "녹음이 올라오기를 기다리는 중…"을 띄우고 4초마다 다시 본다(약 3분).
4. **게시하기 · 출력하기** — 그 삶을 `/api/lives`에 남긴다(카드 + 녹음 주소). 갤러리는 이것만 보여 준다; 남기지 않은 삶의 녹음은 Worker에 있지만 갤러리에는 없다.
5. **업로드가 실패하면** — '원함' 표시로 남겨 두고, 다음 삶이 시작될 때 뒤에서 다시 올린다(`retryPendingUploads`).

**갤러리 (2026-11-22, 작가: "게시공간도 만들어서 게시하기 누르고 나면 갤러리 보기 누를 수 있고, 거기 녹음본 찾을 수 있는 공간이랑 연결")**: `/exhibition/gallery`(`components/parliament/LivesGallery.tsx`) — 게시·출력한 삶이 새것부터, 관객이 고른 바탕·방향의 카드로(QR까지 그 녹음의 것), 개체 번호 · 게시 시각 · 게시/출력. 카드를 누르면 그 삶의 `/rec/<id>`; `/rec` 위쪽에 `갤러리`로 돌아가는 링크. 끝 화면 카드 단계에서 게시(또는 출력)가 되면 `갤러리 보기` 버튼이 나타난다. 데이터는 `/api/lives`(Neon, `lib/lives/db.ts`): `GET ?limit&before` 새것부터. **미리보기**(DB 없음)는 게시를 프로덕션에 **시험(trial)**으로 넘기고 갤러리는 프로덕션의 것을 시험 포함해 읽는다 — 프로덕션 갤러리에는 시험이 안 보인다. `next dev`(DB 없음)는 서버 메모리에 둔다(재시작하면 사라짐). 그러므로 미리보기에서 게시가 되려면 프로덕션(리디자인 브랜치)에 이 코드가 먼저 있어야 한다. **전시장 기계**(`venue=gallery`)의 갤러리는 60초 동안 손대지 않으면 경험 화면(`back`: 갤러리 보기를 누른 그 주소)으로 스스로 돌아간다(작가 11/22: "갤러리 홈에서 일정시간 이상 지나면 경험창으로"); 돌아가기도 그곳으로.

삶 id = 방문자 id(`RoleField`의 `v_xxxxx`, 모티프의 씨앗). 같은 id로 두 번 쓰는 것은 Worker가 거절한다(409) — 한 삶은 나중에 덮어쓸 수 없다.

## 주소

- 재생 페이지(QR의 목적지): **`<앱 주소>/rec/<id>`** — `app/rec/[id]`. 재생/멈춤, 진행 바, 마커 점, 사건 글(누르면 그 자리로). 꾸미지 않음(카드의 모습은 표본 카드 세션이 정한다). 폰에서 여는 것이 기본. Worker에 없으면 **이 기기의 사본**(IndexedDB)으로 튼다 — R2 전에도 같은 기계·같은 폰에서는 들린다.
- 오디오: `https://anthropocene-recordings.anthropocene-hesse.workers.dev/rec/<id>` (Range 지원, 올바른 Content-Type, 1년 캐시)
- 마커: `…/rec/<id>.json` = `{ id, startedAt, seconds, bytes, mime, events: [{ t, kind, text, level }] }`
- 다른 주소의 Worker는 `NEXT_PUBLIC_RECORDINGS`로.

## 마커

녹음 시작으로부터 몇 초에 무엇이 있었나. 기록(스트림)의 줄이 화면에 올라오는 곳(`SessionHud`)에서 새 줄마다 이벤트 하나를 내보내고(`components/parliament/lifeEvents.ts` `emitLifeEvent`), 녹음 훅이 듣는다 — 구조는 바꾸지 않았다. `kind` = 기록의 키(`near`, `ensemble.start`, `word.answered`, `word.found`, `dying` …) 그리고 삶의 단계 셋: `name`(0 s, 이름의 멜로디), `life.begin`, `ended`(text = `lifespan` / `self`). `text` = 화면에 쓰인 그대로(멜로디 자리는 `♪`).

## 카드 세션에 주는 것

`useLifeRecordingState()`(어디서든) / `useLifeRecording()`의 반환값:

```ts
{ phase: "idle" | "recording" | "uploading" | "done" | "failed", id, seconds, bytes,
  url?,       // 업로드가 끝났을 때만: QR에 넣을 /rec/<id> (아무것도 없는 QR보다 없는 게 낫다)
  localUrl?,  // 이 기계의 사본 (내려받기 버튼용), ext? = m4a / webm
  uploaded, note?, line }
```

`SessionHud.tsx`의 끝 카드 마크업은 이 세션이 건드리지 않았다.

**QR (2026-11-21 밤, 카드와 합침)**: 표본 카드(`lib/parliament/plate.ts`)가 `/rec/<id>`의 QR을 품는다 — 게시하기를 누르면 녹음이 올라가고(`uploadLifeRecording`), 주소가 생기는 순간 카드에 QR이 나타난다; 출력하기는 녹음을 먼저 올리고 QR이 든 카드를 인쇄한다. 저장하기만 하면 녹음은 올라가지 않으므로 저장된 카드에 QR이 없다(게시한 뒤 저장하면 있다). **11/22부터는 위 1–5: QR은 끝나는 순간부터 카드에 있고, 저장한 카드에도 있다.** 임시로 끝 화면 왼쪽 아래에 두었던 QR(`RecordingQr.tsx`)은 뺐다. QR은 라이브러리 없이 `lib/qr.ts`(바이트 모드, 오류 정정 M, 마스크 벌점) 하나만 쓴다 — 카드 세션의 인코더(`lib/parliament/qr.ts`)는 지웠다. 확인: 다섯 가지(짧은 주소 ~ 버전 12·H, 한글)를 PNG로 그려 Chrome의 BarcodeDetector로 읽어 모두 일치, 끝 화면의 실제 QR도 그 삶의 주소로 읽힘. 상태줄(`?ui=0`이 아닐 때 왼쪽 위)에 `● REC 1:32 · 1.1 MB` 한 줄, 끝난 뒤에는 `올리는 중` / 주소 / `로컬 보관 · 업로드 실패 …`.

## 비용 (R2)

무료 범위: 저장 10 GB · 쓰기 월 100만 · 읽기 월 1000만, 이그레스 무료. 300명 × 1.4 MB ≈ 0.4 GB, 쓰기 600번 — 무료 범위 안. Worker는 Workers Paid에 이미 포함.

**2026-11-21 작가 승인("만들어")** → 작가가 대시보드에서 R2를 켬 → 버킷 `anthropocene-recordings` 생성, Worker 배포(`https://anthropocene-recordings.anthropocene-hesse.workers.dev`). 다시 배포할 때:

```bash
cd relay/recordings && npx wrangler@4 deploy
```

## 확인 (2026-11-21, Claude의 브라우저, 소리는 스피커와 끊고)

limiter → destination만 끊고(탭은 유지) 수명 시계 ×8로 삶 하나: Chrome이 `audio/mp4`를 골랐고, 39.7 s · 314 KB · 2채널, 처음 12 s는 이름의 멜로디(약 2 s 울리고 1 s 쉬는 반복, RMS 0.09), 삶 동안 0.02–0.03, 끝 뒤 잔향 6 s 동안 0으로. 마커 7개(이름 · 삶 시작 · 풀밭 · 혼자 · 풀이 사라짐 · 죽어감 · 끝)가 화면의 줄과 같은 초. 업로드는 Worker가 없어 실패 → IndexedDB 보관, `/rec/<id>`가 이 기기의 사본으로 재생·탐색. 폰(iOS Safari)은 작가의 프리뷰 테스트로.

**R2 뒤 (같은 날)**: Worker 시험 — 출처 없는 쓰기·남의 출처 403, 같은 id 두 번째 쓰기 409, 읽기 200(`audio/mp4`, 바이트 그대로), Range 206(`bytes 100-199/5000`), 없는 id 404, CORS 사전 요청 204. 그리고 실제 삶 하나(무음, ×8): 33.5 s · 265 KB가 올라갔고, Worker에서 받아 디코드하면 33.4 s · RMS 0.05, 마커 7개 그대로; 이 기기의 사본을 지운 뒤 `/rec/<id>`가 Worker에서 재생·탐색. 시험으로 올린 것들은 버킷에서 지웠다.

**게시해야 올라감 (같은 날 밤)**: 새 프로필 헤드리스 Chrome(`--mute-audio`)에서 실제 길이의 삶 하나(3:07 · 1.5 MB) — 끝난 뒤 상태 `로컬 보관 (게시·출력하면 올라감)`, Worker에는 없음(404); `uploadLifeRecording()`을 부르자 Worker에 생김(200), 주소 `/rec/<id>`가 돌아옴. 시험 녹음은 지웠다. 다음 삶에서 버려지는 것과 잔향 중에 게시한 경우는 코드로만 확인.

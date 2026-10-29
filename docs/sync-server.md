# 동기화 서버 — 12월 외부 전시 · 온라인 참여

살아있는 설계 문서 (2026-10-17 시작, 현황·배포·서버 세션). 구현은 별도 세션("동기화 서버")이 이 문서에서 출발한다. 바뀌면 같은 커밋에서 고친다.

## 0. 결정된 것

| | 11월 교내 전시 | 12월 외부 전시 |
|---|---|---|
| 구성 | 아이맥 한 대, 창 두 개, **localStorage만** (지금 그대로) | 아이맥 + 온라인 방문자가 **같은 세계** |
| 서버 | 없음 | Vercel 함수 + 관리형 DB (직접 운영하는 서버 없음) |
| 동시 접속 | 1 | 전시장 1 + 온라인 많아야 열몇 명 |

원칙: **localStorage는 빼지 않는다.** 서버는 localStorage 위에 얹는 미러다. 와이파이가 끊겨도 전시장의 두 창은 지금처럼 계속 돌고, 다시 붙으면 밀린 것을 보낸다. `NEXT_PUBLIC_SYNC_URL`이 없으면 코드는 지금과 100% 같이 동작한다 (11월은 이 상태로 간다).

## 1. 지금 구조에서 서버 설계에 중요한 사실 (코드에서 확인, 10/17)

- **이벤트는 한 종류, 7필드.** `PEvent = { id, o(방문자/봇 id), r(역할), k:"p", x, z, s }` (`lib/parliament/types.ts`). 건물·길·식생·접힘은 전부 이 로그를 **다시 재생**해서 만든다 (`fold`, `foldState`). 재생 경로에 `Math.random`/`Date.now`가 없다 → **같은 로그면 어느 기계든 같은 땅**. 서버는 땅을 몰라도 된다. 로그만 나르면 된다.
- **`id`로 병합, 덧붙이기만.** `EventLog.add`는 같은 id를 버린다 (`log.ts`). 같은 이벤트를 두 번 보내도 안전하다 → 재전송이 공짜.
- **20분 창.** 클라이언트는 최근 `KEEP_WINDOW_SEC`(기본 20분)만 들고 있고 그 전은 `dropBefore`로 잊는다. 상한 `MAX_EVENTS = 30000`. → 서버가 내려줄 것도 창 안만. 서버는 **전부 보관**(아카이브)하되, 클라이언트에 주는 건 창 안이다. 스냅샷 압축은 1차에 필요 없다.
- **`s`는 방문자별 배정 시각.** 페이지 로드마다 `offset`(시간 슬롯)을 뽑고 `s = sessionSeconds(worldNow, epochMs, offset)`. 이건 클라이언트가 정하는 그대로 둔다.
- **봇은 플레이어 탭이 만든다** (`RoleField.tsx` ticker → `emit`). 플레이어 탭이 여럿이면 봇도 그만큼 늘어난다 → §3(a).
- **세계 시계**는 localStorage 앵커 `{r, v, rate}`로 탭끼리 공유 (`worldClock.ts`, 테스트용 배속). 온라인에서는 공유 안 됨 → §3(c).
- **epoch** (`anthropocene:epoch:v1`)이 세계를 가른다. `clearWorld()`가 새 epoch을 만들고 다른 탭은 폴링에서 그걸 보고 비운다 → §3(b).
- 동기화는 `useWorld`가 **3초마다** localStorage를 읽고(`storage` 이벤트도 들음), 플레이어 탭은 **1초마다** `saveMerged(pending)`로 미러한다. 서버 폴링도 같은 박자면 작품 감각이 바뀌지 않는다.

## 2. 목표 구조

```
아이맥 개인 뷰 ──┐                         ┌── 아이맥 벽
온라인 개인 뷰 ──┤  POST /api/events  ──▶  Vercel 함수 ──▶ Postgres(events)  ──▶  GET /api/events?after=  ──┤── 온라인 개인 뷰
(각자 localStorage 유지)                  GET /api/world (epoch · 시계)                                └── (나중) 아카이브 뷰
```

API 셋 (모두 Vercel 함수, 같은 배포):

| 요청 | 보내는 것 | 받는 것 | 메모 |
|---|---|---|---|
| `POST /api/events` | `{ epoch, events: PEvent[] }` | `{ ok, seq }` | `pending`을 `saveMerged` 하는 자리에서 같이 보냄. id 유니크 → 중복은 무시 |
| `GET /api/events?epoch=&after=<seq>` | | `{ epoch, events, seq, keepFromS }` | `seq` = 서버가 매긴 일련번호(bigint). **시각이 아니라 일련번호로 커서** (방문자별 `s`는 서로 비교 불가). 창 밖(`s < keepFromS`)은 빼고 줌 |
| `GET /api/world` | | `{ epoch, epochMs, timeRate }` | 처음 열 때와 1분마다. epoch이 바뀌면 클라이언트는 `clearWorld`와 같은 처리 |

클라이언트 변경은 작다 (`log.ts`에 "원격 미러" 한 겹):
- 플레이어 탭: `saveMerged(pending)` 직후 같은 `pending`을 `POST`. 실패하면 **버리지 않고** 다음 번에 합쳐 다시 보냄 (id 멱등). 밀린 양 상한 = `MAX_EVENTS`.
- 모든 탭: `useWorld.sync()`에서 localStorage 읽기에 더해 `GET …after=seq` 결과를 `log.addMany`. localStorage 쪽 코드는 손대지 않는다.
- 끊김 표시 없음(벽에 문구 없음 원칙). 개인 뷰 Leva에만 `sync: on/off · 밀린 n개` 한 줄.

## 3. 정해야 하는 규칙 (권고안)

- **(a) 봇은 한 곳에서만.** 권고: **전시장 아이맥의 플레이어 탭만** 봇을 낸다 (URL `?bots=N`, 온라인은 0). 서버에서 봇을 돌리는 건 함수 모델과 안 맞고(항상 깨어 있는 프로세스가 필요) 2차로 미룬다. 전시장 탭이 꺼져 있으면 온라인 세계에 봇이 없다 — 받아들이거나, 그때만 "봇 호스트" 역할을 한 탭에 주는 `?bots=host`를 둔다.
- **(b) epoch의 주인은 서버.** `clearWorld()`는 서버의 epoch을 새로 만들고(`POST /api/world/clear`, 전시장 Leva에서만), 나머지는 `/api/world`에서 보고 따라간다. 로컬만의 clear는 없앤다(혼란). 서버가 없을 때(11월)는 지금처럼 로컬 epoch.
- **(c) 세계 시계는 온라인에서 배속 없음.** `timeRate`는 `/api/world`가 주고, 기본 1. 테스트 배속은 로컬 전용(서버가 붙어 있으면 Leva에서 잠금).
- **(d) 20분 창 유지.** `keepFromS`는 서버가 "가장 최근 이벤트의 `s` − 창"으로 계산해서 내려준다. 지금은 플레이어 탭이 자기 시각으로 정하는데(`setKeepFrom`), 방문자마다 `s`의 기준(offset)이 달라 서버가 하나로 정해야 한다. **열린 질문 ①**: offset이 서로 다른 방문자들의 `s`를 한 창으로 자르는 게 맞는가, 아니면 `wall_ms`로 자르고 `s`는 접힘(시간축)에만 쓰는가 → 구현 세션이 `fold`를 보고 정한다.
- **(e) 쓰기 보호 최소한.** 공개 API라 아무나 쓸 수 있다. 1차: 요청 크기 상한(이벤트 200개), 역할·좌표 범위 검사(`isEvent` 재사용 + `wrapCoord`), origin 체크. 토큰 로그인은 두지 않는다(관객이 폰으로 바로 들어와야 함).
- **(f) 저장은 영구, 전시 뒤 내려받기.** `events` 전체가 전시의 원본 기록. 전시 뒤 CSV/JSON으로 뽑는 `GET /api/archive?epoch=`(토큰 필요)만 하나.

## 4. 저장소

Vercel Marketplace의 Postgres(Neon) 하나. 테이블 하나:

```sql
create table events (
  seq        bigserial primary key,
  epoch      text    not null,
  id         text    not null unique,   -- PEvent.id (중복 삽입은 on conflict do nothing)
  o          text    not null,
  r          text    not null,
  x          real    not null,
  z          real    not null,
  s          real    not null,          -- 방문자 배정 초
  wall_ms    bigint  not null,          -- 서버가 받은 시각
  created_at timestamptz default now()
);
create index on events (epoch, seq);
```

양 추정: 이벤트 한 줄 ≈ 100 B. 액터 한 명이 `sampleSec`마다 1개(Leva 기본값 확인 — 1~2 s). 전시장 봇 포함 20액터 + 온라인 15명 = 35액터 → 초당 ≈ 20~35개 → 하루 8시간 ≈ 60만~100만 줄 ≈ 100 MB. 한 달 전시여도 무료 구간(0.5 GB)에 든다. 넘으면 전시 뒤 아카이브로 내리고 비운다.

## 5. 성능 · 비용

- 폴링 3초, 클라이언트 16개 → 분당 320 요청, 하루 8시간 ≈ 15만, 한 달 ≈ 460만 함수 호출. **Vercel Hobby 한도(월 100만 호출)를 넘는다.** 선택지: (1) 전시 기간만 Pro, (2) 폴링 5초 + 전시 시간 외엔 폴링 중지(IDLE 화면에서는 안 읽음), (3) 폴링 대신 푸시(Supabase Realtime 같은 관리형 WebSocket). 권고: **(2)로 시작**, 한도에 닿으면 (1). (3)은 배포가 둘로 갈라지므로 열몇 명 규모에선 안 한다.
- 델타 크기: 3초 × 35개 × 100 B ≈ 10 KB. 문제 없음.
- **S0 측정 (2026-10-17, 프로덕션, 맥북 M2, 앱 내장 Chrome 152):** `useWorld`가 3초마다 하는 localStorage 전체 읽기+파싱은 **병목이 아니다.** 데모 데이터 1,203개(145 KB, 이벤트당 121 B)에서 0.9 ms; 상한 30,000개(3.8 MB)로 늘려도 읽기+파싱 11.5 ms, 쓰기(stringify+setItem) 19 ms — 3초에 한 번이므로 최악에도 3초마다 프레임 하나. 40초 관찰 동안 long task 0, 프레임 p99 17.6 ms. **증분 병합은 필요 없다.** (단, 측정 때 브라우저 패널이 숨겨져 캔버스가 0×0이라 GPU 렌더링 비용은 이 숫자에 없다 — 그건 아이맥 실기 테스트의 몫.)
- 아이맥 성능은 별개 문제(렌더링). `docs/exhibition-checklist.md`(예정)에서 다룬다.

## 6. 폰 조작은 이 문서 밖

가속도계 조작(`DeviceOrientationEvent.requestPermission()`은 HTTPS + 사용자 제스처 → "아무 키나 누르세요" 탭이 그 제스처)은 **역할별 조작 세션(feature/role-controls)** 의 일이고 서버와 독립이다. 병렬로 간다.

## 7. 단계 (각 단계 끝에 사용자 테스트)

| 단계 | 내용 | 끝났다는 기준 |
|---|---|---|
| S0 | localStorage 동기화 비용 측정 (현황·배포·서버) | 숫자 보고, 필요하면 증분 병합 지시 |
| S1 | DB + `/api/events` + `/api/world`, 플레이어 탭 양쪽 쓰기, 벽은 서버에서도 읽기 | 맥북 개인 뷰에서 걸으면 **다른 기계**의 벽에 1~3초 안에 나타남 |
| S2 | 온라인 개인 뷰: 봇 0, 시계 고정, epoch 추종, 끊김 재전송 | 폰(데스크톱 조작이라도)에서 산 삶이 전시장 벽에 보임 |
| S3 | `clearWorld` 서버화, 아카이브 내려받기, 요청 보호 | 전시 뒤 기록 파일이 나옴 |
| S4 | (선택) 봇 호스트 역할, 스냅샷 압축 | 전시장 탭이 꺼져도 세계가 비지 않음 |

S1·S2는 12월 전시 **2주 전**까지. 안 되면 12월도 A 구성 + 온라인은 "각자 혼자 체험"(DB 없이 지금 코드)으로 간다 — 이 후퇴선이 있어서 서버가 전시를 위협하지 않는다.

## 8. 열린 질문

① §3(d): 창을 `s`로 자를지 `wall_ms`로 자를지. ② 온라인 방문자의 `offset`(시간 슬롯)을 서버가 줘야 겹치지 않는가, 아니면 지금처럼 무작위로 충분한가. ③ 새로 들어온 클라이언트는 창 안(20분)의 이벤트만 받으므로 그 전에 지어진 건물을 못 본다 — 단, **지금도 새로 연 탭은 localStorage에서 창 안만 읽으므로 같은 동작**이다 (`foldState.ts` FORGET: 이미 떠 있는 탭은 자기 상태의 몫을 유지하고, 새 탭은 창 안만 재생). 서버는 오늘과 같은 동작을 재현하는 것이고, "오래 켜 둔 벽처럼 보이는 새 탭"을 원할 때만 스냅샷(S4)이 필요하다. ④ 루트 `/` 공개 진입 화면(런칭 페이지 세션). ⑤ 폰에서 벽을 볼지(무거움) — 1차는 개인 뷰만.

## 변경 기록

- 2026-10-17 초안 (현황·배포·서버 세션). 결정: 11월 로컬 A, 12월 C, 온라인 ≤ 열몇 명, Vercel 단일 배포, localStorage 유지.

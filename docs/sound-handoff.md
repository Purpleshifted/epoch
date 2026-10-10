# 사운드 작업 인계 (2026-10-10) — 새 세션에서 이 문서부터 읽기

이 문서는 비주얼 작업 세션(epoch 프로젝트, 브랜치 `feature/parliament-of-things`)에서 사운드를 다른 세션으로 넘기기 위해 정리한 것. 채팅 기록은 세션 간에 공유되지 않으므로, 필요한 맥락은 전부 여기와 아래 문서에 있음.

## 먼저 읽을 것
- `concept.md` §4 (사운드 Rationale: 음향적 층서학 — 저주파 드론 위에 개인 라이트모티프)
- `graduation_exhibition_spec.md` §3.1 (시그니처 엔진: 중심음 + 미세음정 3–5개, 2초 아르페지오)
- `docs/direction-2026-10-10.md` §1 (개인 뷰 경험), §3 (사운드 목표와 매핑표)

## 목표 경험 (작가 요구)
- **헤드셋 + 모바일(개인 뷰)**: 주어진 라이트모티프와, 그 멜로디와 다른 요소들의 상호작용이 다채로움 → "내 인생의 주인공은 나".
- **헤드셋을 벗고 전체 뷰로**: 단조로운 멜로디나 저음역대 스펙트로그램만 남음 → 존재가 작아지는 경험.
- 같은 이벤트 기록에서 두 소리가 다 나와야 함 (개인 = 감각적·크게, 전체 = 시간의 크기로 접혀서·작게).

## 지금 epoch에 있는 것
- 화면: `/v2/mobile` (개인 뷰, `components/parliament/ParliamentScene.tsx` + `RoleField.tsx`), `/v2/global/space` (3D 시공간, `ParliamentSpace.tsx`), Top/Side (`ParliamentTop.tsx`). V1(`/v1/…`)은 2026-10-10 상태로 고정 — 새 기능은 `useParliamentVersion() === "v2"`일 때만.
- 데이터: 존재 기록 `PEvent {o, r, k, x, z, s}` (초마다, localStorage 공유, 최근 20분). 규칙:
  - `lib/parliament/fold.ts` — 건물(슬래브) 생성, V2에서 머묾/이동 분리
  - `lib/parliament/flow.ts` — 머묾 비율(`stayShares`), 길 세기(`flowLevel`/`flowP`), 봇 경로
  - `lib/parliament/nature.ts` — 식생 밀도/스트레스 (`stressMap`, `grassDensity`)
  - `lib/parliament/water.ts` — 수로 (같은 사람이 지은 큰 건물들 사이)
- 개인 뷰에서 바로 쓸 수 있는 신호: 내 위치·속도, 머묾 비율, 발밑 길 세기, 주변 사람 수·거리(봇 포함), 주변 식생 밀도, 가까운 건물(슬래브) 여부, 접속 후 경과(수명).
- 전체 뷰 신호: 사람별 기여(Slab.who), 건물 단 수, 길 유통량, 수로, 시간축 위치.
- 레거시 오디오: `apps/web/src/lib/audio/*` (NoiseCraft iframe 연동, 개인 시퀀서 — 지금 parliament 화면에서는 안 쓰임), `apps/web/noisecraft/`.

## umwelt 레포 (https://github.com/Purpleshifted/umwelt, 중간발표 사운드 파이프라인)
같은 스택: Next 16, React 19, R3F, leva, zustand, tone, smplr, @magenta/music, @google/generative-ai.

| 모듈 | 하는 일 | epoch로 가져올지 |
|---|---|---|
| `src/store/audioMapStore.ts` (`VirtualStream`, `evaluateStreamValue`) | 센서 → 수학 연산(smooth, slope, envelope, bpm …) → 출력의 **스트림 그래프** | **가져올 핵심.** 센서(PPG/EMG/ECG/마우스)를 parliament 신호(위 목록)로 바꾸면 그대로 매핑 레이어가 됨 |
| `src/audio/AudioEngine.ts` | Web Audio 감산 합성 (오실레이터 → 필터 → LFO → 리버브 → 분석기) | 개인 뷰 음색의 출발점으로 좋음 (의존성 없음) |
| `src/audio/NoiseCraftBridge.ts` | 숨긴 iframe의 NoiseCraft에 postMessage로 노브 값 전달, 같은 출처 프록시 필요 | 선택. 패치 디자인이 이미 NoiseCraft에 있으면 유지, 아니면 Web Audio/Tone으로 단순화 |
| `src/audio/MusicEngine.ts` (118 KB) | Magenta 기반 생성, 코드 라이브러리, 무드 키워드, Gemini 화성 | 전시 현장 실시간에는 무거움·네트워크 의존 → **미리 생성한 모티프/코드 테이블**만 가져오는 걸 권장 |
| `src/audio/SamplerEngine.ts` | smplr 사운드폰트 | 필요하면 |
| `noisecraft/public/*` (harmonic-placer, global-harmonic-placer, spatial-audio-processor, particle-system …) | 개인/전체 워크스페이스, 화성 배치, 공간 오디오 | 개인/전체 구분이 이미 있음 → 개인 = individual-workspace, 전체 = global-workspace 매핑 참고 |

## 제안 첫 단계
1. epoch에 `lib/sound/` 신설: parliament 신호 → (umwelt의 스트림 그래프) → 파라미터.
2. 개인 뷰: 방문자별 시드 → 중심음 + 미세음정 3–5개 → 2초 아르페지오. 걷기 속도 → 템포, 머묾 + 주변 사람 → 화음/잔향, 발밑 길 → 리듬 규칙성, 건물 근처 → 저역통과, 식생 → 노이즈 밝기. 가까운 사람(봇 포함)의 모티프를 거리·방향으로 공간 믹스.
3. 전체 뷰: 사람별 부분음 하나(중심음을 몇 옥타브 내림, 크기 = 기여)의 합 → 저음 드론 + 스펙트로그램.
4. 모바일은 터치 후 AudioContext 시작.

## 아직 정하지 않은 것 (작가에게 물을 것)
- 전시장 구성: 헤드셋(개인) + 스피커(전체) 둘 다인지
- NoiseCraft 패치를 계속 쓸지, Web Audio/Tone으로 새로 갈지
- 봇을 "지난 관객 재생"으로 바꿀지 (그러면 지난 관객의 모티프가 메아리로 들림) — `docs/direction-2026-10-10.md` §2

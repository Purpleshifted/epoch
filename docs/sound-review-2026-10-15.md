# 사운드 리뷰 (2026-10-15) — umwelt · intersection · harmonizer 구조와 현재 사운드 로직을 어떻게 융합할 것인가

근거: `_reference/umwelt`, `_reference/intersection-nextjs`, `_reference/harmonizer` 전체 코드·문서·스케치, 현재 `feature/sound`의 `apps/web/src/lib/sound/*`와 `docs/sound-logic.md`. 코드는 바꾸지 않았다. 이 문서는 결정을 위한 것이고, 결정이 나면 `docs/sound-logic.md`가 다시 "현재 규칙"이 된다.

---

## 0. 결론 먼저

1. 세 레퍼런스는 각각 **다른 층**을 잘 만들었다. intersection = 상호작용을 시퀀서 패턴으로 바꾸는 논리(성부 = 참가자, 공유 클록, 서버 클러스터). umwelt = 작가가 직접 만지는 **워크스페이스**(패치 매니저 + 매핑 패널 + 스트림 그래프 + 인스펙터)와 NoiseCraft 쪽 **AI_Seq 수신 프로토콜**, 그리고 생성(Markov/Gemini/Magenta). harmonizer = 가장 **음악적인 연주 구조**(모드 감지 → 모드별 프리셋 → 퍼포머 → 리버브 버스/새추레이션/리미터)와 가장 풍성한 음향.
2. 현재 epoch 사운드는 **작곡 두뇌**(신호 → 마디 계획: 키, 조적 응답, 진행, 부르고 답하기, 변주)가 강점이고 **악기와 음향**이 약점이다. 작가가 "소리 자체가 풍성하지 않다", "매개변수를 만질 수 없다", "행동을 이끄는 만족이 없다"고 느낀 것은 이 세 가지 결핍과 정확히 일치한다.
3. 융합 원칙: **두뇌는 epoch에, 소리는 NoiseCraft 패치(작가의 워크스페이스)에, 연주 구조는 harmonizer의 모드/프리셋/퍼포머 패턴으로.** 세 프로젝트에서 각각의 강점만 가져오고 약점(센서 중심, 서버 의존, 매 프레임 automation)은 가져오지 않는다.
4. 제안 아키텍처는 한 줄로: **Signals → Streams → Mode → Score → Performers(NoiseCraft) → Buses**, 그리고 이것을 작가가 실시간으로 만지는 **/v2/sound 워크스페이스**(umwelt NoiseCraft Manager의 이식).
5. 순서: ① 실험 코드 정리 ② 워크스페이스 ③ 모드·프리셋 ④ 작가 패치 연결과 청취 ⑤ 글로벌 ⑥ 스트림 그래프·Magenta(선택).

---

## 1. 세 레퍼런스가 실제로 무엇을 했나

### 1.1 intersection-nextjs — 상호작용을 시퀀서로

구조: Next(`/visual`) + Socket.IO 실시간 서버(`realtime/`, 3001) + NoiseCraft 서버(4000, `/audiocraft`)를 iframe(`embedded.html?src=…&io=…`)으로 임베드.

| 층 | 어떻게 | 지금 우리에게 |
|---|---|---|
| 서버 클러스터 | 200 ms마다 반경 420 px BFS 클러스터, 인원 수로 스케일된 C–E–G 3화음과 gain을 `audioSelf / audioCluster / audioGlobal`로 내려줌 | 우리의 "건물(함께 머묾)"이 바로 이 클러스터의 후손. 서버 대신 fold가 같은 일을 함 |
| 개인 파라미터 | `personalMetrics`: approachIntensity, nearestProximity, localDensity, clusterEnergy (전부 0..1) | 우리의 `signals.ts`와 같은 자리. 이름만 다름 |
| 매핑 | `noiseCraftCore.buildNoiseCraftParams`: 논리 파라미터 → 슬롯/노드 setParams; `streamMapping`: 거리→0.2..1, 중력식 | 문서 `personal-audio.md` §3의 **매핑 테이블 아이디어**(logicalParam, nodeId, min, max, curve)는 그대로 유효 |
| 시퀀서 논리 | `sequencer-logic.js`: 참가자마다 고유 음 하나(정체성), 개인 = bass(나)·baritone(이웃1)·tenor(이웃2), 4행 MonoSeq를 4스텝 순환; 전체 = 참가자를 열로 세워 밟아가는 진행 | **성부 = 참가자**, **공유 클록**은 우리 `sequencer.ts`에 이미 이식됨 |
| 남긴 문제 | 시작 화음이 늘 같음, 혼자일 때도 화음, 12음→4행 손실, 연속성 부족(gate time, legato 제안) | 우리 motif/harmony가 이 문제들의 답 |

### 1.2 umwelt — 작가의 워크스페이스와 생성 파이프라인

페이지: physical / mirror / **streams**(Stream Manager) / **music**(Music Library) / **noisecraft-manager** / audio / experience / collective.

| 부분 | 무엇 | 평가 |
|---|---|---|
| `sensorStore` | ppg, emg, ecg, gsr, mouseX/Y (0..1) + 스펙트럼 | 센서 자리에 parliament 신호를 넣으면 그대로 |
| `audioMapStore` | **가상 스트림 그래프**: sensor → math(smooth, slope, envelope, normalize, curve, bpm, moving_average, interpolate, inRange, compare …) → out/monitor; `NodeMapping{nodeId, streamId, targetSystem}`; undo/redo, persist | `evaluateStreamValue`는 순수 함수(상태는 Map)라 **그대로 이식 가능**. 작가가 실제로 쓴 그래프: ECG/GSR/PPG → smooth/normalize/bpm/interpolate → 6개 out 스트림, 5개 매핑 |
| `musicStore` + `MusicEngine` | 모듈 DAG: harmonic_progressor(valence·arousal → 모드·Markov, Gemini), melody_gen(procedural / magenta), voice_splitter, sequence_morpher(VAE), register_shifter, **ai_seq_out → NoiseCraft**; 16스텝마다 재평가(6 pulses/step) | 우리는 이 중 chord_library(모드·Markov), VAE/RNN 이식을 이미 했음. 모듈 DAG UI 자체는 가져오지 않는 게 맞음(작품 규칙이 곧 그래프) |
| NoiseCraft 포크 | **AI_Seq / AI_Poly**(moduleId + voice, 모노/폴리 배열, stepIdx 리셋 없음), ClockOut → `clockPulse`, `setSequence / updateModules / nodeSelection / saveStatus`, 같은 출처 프록시 `/noisecraft`, 자동 저장 라우트, 패치 CRUD 라우트 | **핵심 자산**. 런타임은 이미 `apps/web/noisecraft/public`에 복사됨(미커밋) |
| NoiseCraft Manager | 패치 목록(생성·복제·이름·삭제) → 편집기 iframe + **매핑 패널**(노브 클릭 → 노드 id 자동 채움, 스트림 선택, Save/Load) + 인스펙터(Play/Stop, 감정 슬라이더, 하모닉 프로그레서, 스트림 모니터) | **작가가 말한 "그때 쓰던 워크스페이스"**. 이식 대상 1순위 |
| 작가 패치 | `nc_noise_patch`(AI_Seq 7개, voice 0–2, 노브 49), `Feedback_Synth`(AI_Seq 3), `global_audio`(MonoSeq 3) | 우리가 쓸 소리의 출발점. 모듈 id만 우리 것으로 바꾸면 됨 |
| 한계 | 센서 중심, 생성이 네트워크·연산 의존(Gemini, Magenta), 16스텝 고정, 상태가 브라우저 persist | 전시는 네트워크 없이 돌아야 함 → 폴백 필수 |

### 1.3 harmonizer (tonnetz) — 가장 음악적인 연주 구조

Tonnetz 격자 위를 걷는 walkthrough. 작가 스케치(`references/*.png`)와 코드가 일치한다.

```
SpatialDetector (25 후보 → node / edge / face, nearestFour, adjacent 6, isMajor)
   → ThresholdLogic (α 키홀드 디바운스 250 ms, Δ 이동 임계, cruising)
   → NotePicker (line / dot / hex)
   → Orchestrator (리스너, 모드 필터, 데이터 준비, 믹스 정책 Levels)
      → Dirigent (conductDrone / Face / Arp / Node / Wave)
         → Performers: BaseDrone(4성 spatial), FaceEnsemble(샘플러 strings+horns swell),
                       FaceSynth, ArpeggiatorEngine(모드별 프리셋, 거리→확률·velocity^exp, 옥타브 변주),
                       NodeSynth(패드 + LFO 필터 + exit noise), WaveRevolver
            → BusSystem: ambient / spatial / deep / wave 리버브 센드, RotationSpatializer(ITD), Limiter(−1.5 dB)
               + HarmonicSaturator, IR 컨볼루션(1st Baptist Nashville), 샘플 악기
```

| 가져올 것 | 왜 |
|---|---|
| **모드 → 프리셋 분리**: `ArpModeLogicPresets`(등장 빈도·템포·거리 영향), `ArpSoundPresets`(음색), `Levels`(믹스 정책) | 작가 스케치 그대로: Mode switch → Note Catcher → Mode Logic Presets → Pattern Generator → Arp Engine ← Sound presets. "행동을 이끄는 만족"은 **상태가 바뀔 때 소리의 성격이 바뀌는 것**에서 나온다 |
| ThresholdLogic | 모드 전환이 깜빡이지 않게. 우리 전조 히스테리시스와 같은 역할을 일반화 |
| 버스 체인(리버브 센드 4개, 새추레이션, 리미터), 샘플러 악기 | "풍성함"의 실체. NoiseCraft 패치로 가더라도 **패치 안에서 같은 구조**를 만들게 하는 기준 |
| 연속성 규칙 | 노트 교체는 항상 fade, 모드 이탈 후 5 s 뒤 18 s 페이드, 가까운 두 음이 dominant |
| 교훈 | `BUFFERING_ANALYSIS.md`: 매 프레임 rampTo 누적(3 s에 2,000개) → 0.1 s 쓰로틀, 임계 이하 변화 무시, HRTF는 edge/face에만 |

---

## 2. 현재 epoch 사운드 (feature/sound, a1c07b6) — 솔직한 평가

있는 것: `signals`(같은 로그의 fold) → `harmony`(키, 조적 응답, 강박 끌림, 관계조 전조, Markov) → `motif`(실제 음정 모양 + 리듬 셀) → `sequencer`(공유 그리드, 밀도, 베이스, 부르고 답하기, 패드) → `variation`+`magenta` → `engine`(얇은 감산 합성, HRTF, 방 3개) / `global`(스피커) / `output`(솔로, 출력 장치). 테스트 47개. Leva 노브 25개.

| | 평가 |
|---|---|
| 강점 | 순수·결정적·테스트된 **작곡 두뇌**. 작품 규칙과 1:1 — 머묾 → 패드, 길 → 베이스·진행, 건물 → 전조, 식생 → 거칢, 이웃 → 내 키를 통한 성부 + 변주 |
| 약점 1 (악기) | 삼각파 + 옥타브 사인 + 대역 잡음, 합성 임펄스 리버브. intersection/umwelt 패치의 필터·딜레이·디스토션·ADSR 체인에 비해 **얇고 거칠다** |
| 약점 2 (매개변수) | 노브 매핑이 코드 상수(`noiseMix`, `lockPull` …). 작가가 **소리를 만지며 작업할 창이 없다** |
| 약점 3 (상태) | 순응/거칢이 **연속값**으로만 있어 "지금 내가 어떤 상태에 있다"가 소리로 선언되지 않는다. harmonizer는 node/edge/face가 **다른 악기**로 들린다 |
| 약점 4 (상호작용의 층) | 이웃은 음고(블렌드·응답)로만 상호작용. 음향(퍼포머·버스)에서는 아무 변화 없음 |
| 약점 5 (실험 코드) | 지난 세션의 NoiseCraft 연결(미커밋 — 포크 런타임 복사, 정적 서빙, save 라우트, `noisecraft.ts` 브리지, 내가 만든 사이드 패널, `parliament_headset.ncft`, 상수 매핑)은 **umwelt 워크스페이스와 다른 방식**이라 작가의 작업 흐름과 안 맞음. 또 펄스가 0으로 머무는 문제가 남아 있음 |

미커밋 파일(`git status`): `noisecraft/public/*`(umwelt 런타임), `noisecraft/examples/{nc_noise_patch, Feedback_Synth, global_audio, parliament_headset}.ncft`, `public/noisecraft`(심링크), `src/app/noisecraft/save-ncft`, `components/parliament/NoiseCraftPanel.tsx`, `lib/sound/{noisecraft, noisecraftMap}.ts`, 그리고 `engine.ts / useSound.ts / ParliamentScene.tsx`의 연결부.

---

## 3. 융합 설계

### 3.1 층과 출처

| 층 | 출처 | epoch에서의 모습 |
|---|---|---|
| **신호** | epoch `signals.ts` | 유지. umwelt의 센서 자리에 parliament 신호: `speed, stay, stable, rough, sealed, grass, pathP, company, closeness, nearDist, barPhase, degree` |
| **스트림 가공** | umwelt `evaluateStreamValue` | 순수 함수만 이식(zustand persist 제외). 스트림 정의는 **패치별 JSON 파일**(`noisecraft/examples/<patch>.streams.json`). 1단계는 고정 카탈로그 + smooth/normalize 옵션, 2단계에 React Flow 그래프 |
| **모드** | harmonizer `ThresholdLogic`, 작가 스케치 | 모드 = 순응 상태 네 가지: **open**(식생을 가로지름) / **path**(길 위) / **build**(여럿과 머묾) / **building**(건물 위, 전조). harmonizer의 IsEdge/IsNode처럼 임계 + 250 ms 디바운스 + cruising(길 위에서 오래 걸으면 open으로 잠깐 벗어나도 유지) |
| **작곡** | epoch `harmony / motif / sequencer / variation / magenta` | 유지. 단, 모드별 **Mode Logic Preset**(밀도, 끌림, holdSec, 응답 여부, 베이스 여부, 패드 여부)으로 파라미터화 — 지금 `planBar` 안에 흩어진 조건문을 프리셋 표로 끌어냄 |
| **퍼포머/음향** | NoiseCraft 패치(작가) ← umwelt AI_Seq 프로토콜; 기준은 harmonizer 버스 체인 | **AI_Poly "parliament"** 하나로 성부 = 참가자(voice 0 나, 1–3 이웃: intersection의 bass/baritone/tenor를 폴리 보이스로), **AI_Seq "bass"**, **AI_Seq "pad"**(코드톤을 느린 ADSR로). 작가 패치의 `voice` 0–2는 그대로 의미가 통함 |
| **매핑** | umwelt `NodeMapping` + intersection 범위/보간 포맷 | 패치별 `mapping.json`: `{nodeId, paramName, streams:[{stream, interpolation, inputMin/Max, outputMin/Max}], operation}` + **모드별 오버라이드**(harmonizer의 Levels처럼 "build에서는 183번 노브 × 1.5") |
| **클록** | NoiseCraft ClockOut(6 pulses / 16th) | NoiseCraft가 마스터. AI_Seq는 stepIdx를 리셋하지 않으므로 **마디 마지막 펄스(95)에서 다음 마디 시퀀스 교체**. epoch의 벽시계 그리드는 Web Audio 악기와 글로벌에서만 |
| **워크스페이스** | umwelt NoiseCraft Manager | `/v2/sound`: 패치 CRUD, 편집기 iframe(ui=full), 매핑 패널(노브 클릭 자동 채움), 인스펙터(parliament 신호 모니터, 모드, 마디/코드, Play/Stop). 모바일 탭과는 **BroadcastChannel**로 연결: 모바일이 신호와 마디 계획을 보내고, 매니저가 소리를 냄(스플릿뷰 작업). 전시에서는 모바일 탭 안의 숨은 iframe이 같은 일을 함 |
| **글로벌** | intersection `generateGlobalPattern`, umwelt `global-harmonic-placer`, epoch `global.ts` | 별도 패치(`global_audio.ncft`): 사람의 열 진행(건물 하나의 기여자를 마디마다 한 사람씩), 긴장 = 사람 수(harmonic distance = min(8, 2·ln(n+1))), 덩어리·흔적·뭉침·숨은 지금 설계 유지 |

### 3.2 흐름

```
[RoleField fold]  PEvent 로그 → personalSignals ──────────────────────────────┐
                                                                              ▼
[streams]   signals → (smooth / normalize / curve …) → named streams  ─────► [mapping.json]
                                                                              │  nodeId ← stream (범위·보간·모드 오버라이드)
[mode]      ThresholdLogic(stable, pathP, sealed, company) → open|path|build|building
                                                                              │
[score]     planBar(bar, sig, key, mode preset) → me / others / bass / pad  ──┤
                  ▲ harmony(tonal answer, pull, 전조)  variation(blend, VAE/RNN)│
                                                                              ▼
[NoiseCraft iframe]  AI_Poly "parliament" ← 16-step poly (voices 0–3)       setParams ◄── knob values
                     AI_Seq "bass", "pad"                                      ▲
                     ClockOut ─ pulses ─► bar counter (마디 95에서 교체) ───────┘
                     패치 내부: 작가의 필터·딜레이·리버브·디스토션·ADSR (harmonizer 버스 체인을 기준으로)
[워크스페이스 /v2/sound]  패치 CRUD · 편집기 · 매핑 패널 · 인스펙터 · (BroadcastChannel) ◄── 모바일 탭
```

### 3.3 세부 결정과 근거

1. **두뇌는 epoch, 소리는 NoiseCraft.** 두뇌는 테스트 47개로 묶여 있고 작품 규칙과 1:1이라 버릴 이유가 없다. 소리는 작가가 패치로 만들어야 풍성해지고, 그 작업 흐름(umwelt 매니저)이 이미 몸에 익어 있다.
2. **AI_Poly 하나로 성부 = 참가자.** intersection의 bass/baritone/tenor와 umwelt 패치의 voice 0–2가 같은 생각이다. 우리 `planBar`의 me/others[0..2]를 16스텝 폴리 배열로 보내면 작가 패치가 그대로 받는다. 빈 성부는 gate 0.
3. **NoiseCraft가 마스터 클록.** 두 시계를 맞추려 들지 않는다. 벽시계 그리드는 NoiseCraft가 없을 때(Web Audio 폴백, 글로벌)만.
4. **모드 네 가지와 프리셋.** 작가 스케치의 구조를 그대로 옮기되 node/edge/face를 open/path/build/building으로 바꾼다. 모드마다 (a) Mode Logic Preset(작곡: 밀도·끌림·응답·베이스·패드), (b) Sound Preset(매핑 오버라이드: 어떤 노브를 얼마나), (c) Levels(성부별 레벨). harmonizer가 node에서 HRTF를 끄고 edge/face에서 켜듯, 공간화도 모드별.
5. **매핑 포맷 통합.** umwelt 워크스페이스 포맷(nodeId ← streamId)은 범위가 없고, intersection 포맷(범위·보간·연산)은 그래프가 없다. 합쳐서 하나의 `mapping.json`. 노브의 min/max는 패치 JSON에서 읽어 UI에 미리 채움.
6. **스트림 그래프는 2단계.** 1단계는 고정 카탈로그(원신호 + smooth + normalize)로 충분히 작업 가능. React Flow 그래프(umwelt StreamManager)는 작가가 필요하다고 할 때.
7. **Web Audio 악기는 폴백으로 유지, 기본 off.** 전시 PC에서 iframe이 막히는 사고에 대비. harmonizer식 Tone.js 체인으로 올리는 것은 후순위(패치가 그 역할).
8. **Magenta는 umwelt 방식 그대로**(캐시, 폴백, 모드 전환 시에만 요청). 네트워크 없으면 조용히 절차적 변주.
9. **글로벌은 별 패치.** 모바일 패치를 저역통과·홀로 뭉개는 지금 방식보다, `global_audio.ncft`(MonoSeq 3)를 사람의 열 진행으로 밟는 것이 intersection의 원래 의도이고 작가 패치도 있다.
10. **전시 안전성.** 패치·매핑·스트림은 파일(저장소)에 있고, 저장 라우트는 dev 전용. 네트워크 없이 완전 동작.

### 3.4 harmonizer에서 반드시 가져올 세 가지 교훈

- **automation 누적**: 매 프레임 rampTo/setTargetAtTime 금지. 우리 0.5 s 갱신은 괜찮고, NoiseCraft setParams는 값이 임계 이상 바뀔 때만 보낸다.
- **모드 전환 디바운스와 cruising**: 임계 근처에서 깜빡이면 음악이 깨진다. 전조 히스테리시스를 일반화한 ThresholdLogic 하나로 네 모드를 다 거른다.
- **연속성**: 성부 교체는 항상 페이드(패치의 ADSR + 시퀀스 교체 시점), 가까운 두 성부가 dominant, 멀어진 성부는 즉시 끄지 않고 늦게 페이드(5 s + 18 s).

---

## 4. 단계 계획

| 단계 | 산출물 | 검증 |
|---|---|---|
| **0. 정리** | 미커밋 실험 중 유지: 포크 런타임 복사, 정적 서빙(`public/noisecraft`), save 라우트, `noisecraft.ts` 브리지, 작가 패치 3개. 대체: `NoiseCraftPanel`(→ 매니저 페이지), `parliament_headset.ncft`(→ 작가 패치), `noisecraftMap.ts` 상수(→ `mapping.json`) | 커밋 단위 분리, 문서 |
| **1. 워크스페이스** | `/v2/sound`: 패치 CRUD 라우트(umwelt 이식), 편집기 iframe, 매핑 패널(노브 클릭 자동 채움, 범위·보간), 인스펙터(신호·모드·마디·코드), BroadcastChannel 버스, 모바일 탭의 숨은 악기 | 스플릿뷰: 왼쪽 모바일에서 걷고, 오른쪽에서 노브를 매핑하면 즉시 반영. 펄스 0 문제 해결(ClockOut UI 노드 생성 확인) |
| **2. 모드·프리셋** | `ThresholdLogic` 이식, 네 모드, `presets/*.json`(logic·sound·levels), `planBar`를 프리셋으로 파라미터화, 모드별 매핑 오버라이드 | 테스트: 모드 전환 디바운스, 프리셋이 계획에 반영; 디버그 줄에 모드 |
| **3. 작가 패치 연결** | `nc_noise_patch`의 AI_Seq → AI_Poly "parliament"(voice 유지), bass/pad 노드 추가, 매핑 재작성(작가와 함께 청취 세션) | 작가 청취: 네 모드가 서로 다른 악기로 들리는가 |
| **4. 글로벌** | `global_audio.ncft` + 사람의 열 진행 + 긴장 = 사람 수 | 스피커 청취 |
| **5. 선택** | 스트림 그래프(React Flow) 이식, Magenta 재검토, Web Audio 폴백의 Tone.js 체인화 | — |

---

## 5. 리스크와 미결

- **iframe 자동재생**: 부모 창의 제스처가 같은 출처 iframe에 전파되는지 확인 필요. 지난 세션에서 `play` 뒤 상태는 playing인데 펄스가 0이었다. 편집기 모드에서 ClockOut UI 노드가 생성되는지, AudioContext가 실제로 running인지 둘 다 봐야 한다.
- **저장**: 서버(express) 없이 Next 라우트로 저장. 전시 빌드는 파일 고정이므로 문제 없음.
- **성능**: 폰에서 NoiseCraft worklet + three.js 동시 구동. harmonizer의 교훈대로 갱신 빈도를 묶는다.
- **결정 필요**: (a) 모드별 패치 전환 vs 한 패치 + 매핑 오버라이드 → 후자 권장(끊김 없음). (b) 개인 패치는 `nc_noise_patch`에서 시작할지 `Feedback_Synth`에서 시작할지 → 작가 선택. (c) 스트림 그래프 UI를 1단계에 넣을지 → 2단계 권장.

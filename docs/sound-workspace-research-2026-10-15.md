# 작업실 리서치 — umwelt에서 가져올 것 (2026-10-15)

> **상태 (같은 날 밤)**: 작가가 워크플로우가 너무 복잡하다며 **작업실을 없애고 값은 Claude가 코드로 조절**하기로 했다(`sound-logic.md` §9, (11)). 아래에서 "가져옴"으로 구현한 것들은 `/v2/sound`에 **벤치**(링크 없음, 그 창의 엔진에만 적용)로 남아 있다. 보류 항목은 그대로 보류.

작가: "사운드 관련 Leva는 그 워크스페이스로 다 넣어버려, 그리고 v2 홈 화면에 실시간으로 연동되는 워크스페이스를 넣어달라는 거였어. umwelt에서 차용해올만한 요소 있는지 리서치하고 보고해". `_reference/umwelt/src` 전체를 읽고 요소별로 판단한 것. **가져옴**은 (10)에서 구현된 것, **보류**는 이유와 함께.

## umwelt의 구조 (워크스페이스 관점)

| 페이지 / 컴포넌트 | 하는 일 |
|---|---|
| `/` + `NavBar` | 홈의 네 카드(PHYSICAL / MIRROR / EXPERIENCE / COLLECTIVE), 상단 바에 모든 모듈 링크, **Cmd+S = 매핑 자동 저장 + 다운로드** |
| `/noisecraft-manager` — `NoiseCraftManagerScene` + `NoiseCraftPatchManager` + `NodeMappingPanel` | 패치 목록 → 편집기 iframe + 오른쪽 매핑 패널(스트림 → 노드 id; **편집기에서 노브를 클릭하면 id 자동 입력**) |
| `/experience` — `ExperienceScene` + `ControlPanel` + `MappingEditor` | 체험 페이지 위에 **접히는 플로팅 패널**: Start/Stop, Auto/Manual, 카메라, **🎛 Patch(숨은 iframe의 편집기를 그 자리에서 켜고 끔)**, 센서 슬라이더, **스펙트럼 미터(low/mid/high)**, 매핑 요약 |
| `/collective` — `CollectiveScene` | 3D 씬 + 숨은 NoiseCraft iframe + ControlPanel; `AudioVisualBridge`가 매 프레임 센서 → 브리지 → 스펙트럼 → 스토어 |
| `/streams` — `StreamManagerScene` + `VirtualStreamPanel` + `ScopePanel` | React Flow로 **가상 스트림 그래프**(센서 → 수학 연산 25종 → out/monitor), 출력 스코프(오실로스코프) |
| `/music` — `MusicLibraryScene` + `MusicModuleNode` + `InputNodes` | React Flow 음악 모듈 그래프(melody_gen, chord_gen, harmonic_progressor, sequence_morpher, AI seq out …); **section_box → global_ui_out**로 "대시보드에 노출할 노브"를 고른다 |
| `GlobalDashboard` | 왼쪽 사이드바: PLAY/STOP, 노출된 섹션의 슬라이더·노브, Harmonic Progressor UI(기분 칩, Gemini 토글), **StreamMonitor**(모니터 스트림의 100 ms 스파크라인) |
| `VirtualBiosignalSimulator` | autoMode일 때 PPG/ECG/EMG/GSR을 생리학적으로 흉내(맥박, QRS, 근육 버스트, 천천히 흐르는 GSR) + 매 33 ms 매핑 평가 → 브리지·매크로 노드로 전송 |
| `MacroPatcher` + `audioGraphStore` | React Flow로 **오디오 그래프**(noisecraft_source → gain → filter → delay → convolver → hrtf_panner → destination) |
| `audioMapStore` | zustand + persist: 스트림·매핑, **undo/redo 히스토리**, `exportToJson`/`loadFromJson`, 변경마다 `umwelt_autosave` |

## 판단

| 요소 | 결론 | 우리 쪽 |
|---|---|---|
| 매핑 스토어의 **자동 저장 + Save/Load JSON** | **가져옴** | 데스크 `lib/sound/desk.ts`: 변경마다 localStorage + 버스, JSON 내보내기/불러오기, 스냅샷 줄 |
| `NodeMappingPanel`의 **노드 클릭 auto-fill** | **가져옴, 용도 바꿈** | 우리 매핑은 코드라 "채울 칸"이 없다 → 클릭하면 **그 노드를 돌리는 규칙**을 보여주고, 슬라이더로 잡으면 **고정**(`overrides`, 플레이어 창에도 적용). 작가가 코드를 안 고치고도 노브 하나를 손으로 잡아 둘 수 있다 |
| `GlobalDashboard.StreamMonitor` **스파크라인** | **가져옴** | 신호 7개(speed/stay/pathP/sealed/grass/rough/tension)의 30초 이력 |
| `ControlPanel`의 **스펙트럼 미터** | **가져옴, 트랙 미터로** | 두 트랙(멜로디 / 패치)의 RMS 미터 — 두 소리의 비율을 보며 레벨·센드를 맞추는 용도 |
| 홈의 **카드 + 라이브 표시** | **가져옴** | V2 홈에 "Sound Workspace" 카드; 플레이어 탭이 버스에 있으면 "● 플레이어 연결됨" |
| `GlobalDashboard` PLAY/STOP + **누가 소리를 내나** | **가져옴, 솔로와 합침** | "듣기" 선택: 이 작업실(플레이어의 걸음을 여기서 연주, 솔로) / 플레이어 창 / 스피커 창 / 모두 — 작업실이 `output.ts` 솔로 키를 정한다 |
| `section_box → global_ui_out` (그래프에서 노출할 노브를 고름) | **보류** | 우리 노브는 Leva 폴더 다섯 개로 이미 고정된 집합. 그래프가 생기면(아래 MacroPatcher) 그때 |
| `MacroPatcher` 오디오 그래프 (React Flow) | **보류** | 지금의 "한 버스, 두 트랙"(§8)은 코드로 고정된 그래프. 작가가 효과 체인을 직접 바꾸고 싶어지면 이 그래프를 들여오는 것이 다음 단계 — 그러면 트랙별 효과(필터·딜레이·컨볼버·HRTF)를 노드로 꽂을 수 있다. 의존성 `@xyflow/react` 추가 필요 |
| `StreamManager` 가상 스트림(수학 연산 그래프) | **보류** | 우리 신호 → 노브는 코드 규칙(작가 결정 10/15). 규칙을 UI로 바꾸고 싶어지면 이것이 그 UI |
| `VirtualBiosignalSimulator` | **이미 있음** | 시나리오 5개 + 슬라이더가 같은 역할 (걷기 신호는 생리 신호와 달라 모양을 흉내낼 것이 없다) |
| `ExperienceScene`의 **🎛 Patch (플레이어 안에서 편집기 토글)** | **보류** | 플레이어 창의 숨은 iframe은 `view=hidden`으로 편집기 뷰를 뗀 상태(렉). 켜면 다시 붙여야 한다. 스플릿뷰(플레이어 + 작업실)가 그 역할 |
| `NavBar` (모든 페이지 상단 바) | **보류** | 전시 화면에 바가 보이면 안 된다; V2 홈의 카드로 충분 |
| `HarmonicProgressorUI` (기분 칩, Gemini) | **아님** | 우리 화성은 사람의 무게(H)이지 기분이 아니다; H 한 줄이 그 자리 |
| undo/redo | **보류** | 스냅샷(지금 값 저장 / 되돌리기)이 가벼운 대안; 필요하면 데스크 히스토리 10단계는 금방 |
| `MusicLibrary` 음악 모듈 그래프 | **아님** | 우리 음악 논리는 코드(§3–§6)이고 작가가 "사운드 로직은 우리가 세운 것 최우선"이라 했다 |

## 다음에 가져오면 좋을 것 (순서)
1. **MacroPatcher식 트랙 그래프** — 작가가 트랙 A/B의 효과 체인을 노드로 바꾸고 싶어질 때.
2. **데스크 히스토리(undo/redo)** — 많이 만지기 시작하면.
3. **플레이어 창 안의 편집기 토글** — 스플릿뷰가 불편하면.

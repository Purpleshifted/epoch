# [기획/기술 명세서] 인류세 인터랙티브 미디어아트 졸업전시
## "지층과 서사: 멸망 이후의 시선으로 바라보는 현재"

---

### 1. 프로젝트 개요 (Project Overview)

* **작품명 (가제)**: Stratum of the Anthropocene (인류세의 지층)
* **전시 형태**: 멀티 디스플레이 관조형 미디어아트 설치 + 관객 참여형 실시간 모바일 인터랙션
* **핵심 철학 및 서사**:
  * 인류세라는 하이퍼객체(Hyperobject) 앞에서 계몽주의적 환경 운동("지구를 구하자")이나 강박적 죄책감을 피하고, 관조와 정서적 감당의 시선을 제시함.
  * 관객의 개별적 행위는 무의미해 보이지만 세계 속에 흔적(화석)으로 축적(Accumulative)되고, 이 축적된 지층이 실시간으로 재정렬되며 다음 행위의 의미를 변주(Derivative)함.
  * 멸망 이후의 지질학자/사학자가 현재를 고찰하는 시선(과거-현재-미래의 교차)을 시공간적으로 체화시킴.

---

### 2. 공간 셋업 및 3대 시선 구조 (Spatial & View Architecture)

```text
               [ 윗면: Projected Top View ]
         (미래 지질학자의 시선 / 실시간 종합된 풍경)
                   ┌──────────────────┐
                   │  ▲  ▲  ▲  ▲  ▲  │
                   │  │  │  │  │  │  │
    ┌──────────────┴──────────────────┴──────────────┐
    │  Side View: 지층 단면 (Cross-Section)          │
    │  ────────────────────────────────────────────  │ ◀─ 동시대성 및 Glitching
    │  ────────────────────────────────────────────  │    단층 재정렬 (옆면)
    └────────────────────────────────────────────────┘
                          ▲
                          │ (실시간 Socket.IO 데이터 전송)
                          │
            [ 관객의 개인 디바이스 (Mobile / Web) ]
         (Personal Exploration View: 소리/비주얼 탐색)
```

#### 2.1 메인 월드 앙상블 (Main World Installation)
1. **윗면 (Top Projected View - 미래 지질학자의 시선)**:
   * **시각적 특징**: 관객들의 실시간 자취 및 가상 화석이 누적되어 형상화되는 3D Heightmap 기반의 지형 표면 (산맥, 분지, 결정체 등).
   * **상징성**: 멸망 이후의 사학자들이 관조하는, 우리의 현재 행위들이 응축된 미래의 풍경.
2. **옆면 (Side Stratigraphic Wall - 동시대 단층 뷰)**:
   * **시각적 특징**: 시간의 흐름(Time-Depth)에 따라 관객의 행위 자취가 퇴적암처럼 쌓이는 단면.
   * **Glitching & Faulting**: 유사한 행위나 사건이 감지되면 지층이 순간적으로 수평으로 어긋나며 Glitch 애니메이션 발생.
   * **상징성**: 사건 자체뿐만 아니라 "사건을 해석하고 재구성하는 인간 인식"의 추상화.

#### 2.2 관객 개인 탐색 뷰 (Personal Exploration View - 1st Person Radar)
* **접속 방식**: 관객 모바일 Web (QR 코드 접속)
* **시각적 특징**: 시야가 극도로 제한된 1인칭 소닉 레이더 (Sonic Radar). 관객이 이동하거나 소리를 발산할 때만 주변의 지형과 다른 관객들의 자취(화석)가 잠깐 파동(Ripple)으로 밝혀짐.
* **상징성**: 세계 전체를 파악할 수 없는 주체의 무력함과 제한된 행위성(Agency).

---

### 3. 사운드 및 비주얼 인터랙션 상세 설계 (Interaction Engine)

#### 3.1 개인 시그니처 엔진 (Signature Engine)
* **음향 (Sound)**:
  * 관객 접속 시 주파수 중심점(Centroid)을 부여하고, 그 주변 미세음정(Micro-tone) 3~5개로 구성된 2초 길이의 짧은 **아르페지오 모티프(Arpeggiated Leitmotif)** 생성.
  * 음정의 밀도와 템포는 접속 시 부여되는 관객 고유 시그니처에 따라 상이함.
* **비주얼 (Visual)**:
  * 단순 원형이 아닌, 고유한 Noise Displacement Mesh로 정의된 유기적 입자(Cell/Amber).

#### 3.2 옆면 Glitch & 단층 재정렬 (Faulting) 조건
* **수학적/음악적 조건**:
  * 관객들의 이동 궤적 및 시그니처 사운드가 기존 지층 데이터베이스와의 **화성적/공간적 코사인 유사도(Cosine Similarity) > Threshold**를 넘을 때 발동.
  * **이펙트**: Three.js Custom Shader로 Vertex Displacing Glitch 적용, Web Audio에서 피치 변조 및 파형 크래시(Crash) 사운드 발생.

#### 3.3 윗면 Heightmap 누적 로직
* **공간 밀도 및 체류 시간 분지화**:
  * 관객이 오래 머문 지점 -> 음(-)의 Displacement (깊은 분지/웅덩이 생성, 메아리 잔향 축적).
  * 여러 관객의 시그니처가 교차하거나 충돌한 지점 -> 양(+)의 Displacement (결정체/산맥 형성).

---

### 4. 시스템 기술 아키텍처 (System Architecture)

```text
[ Client (Next.js / Three.js) ]
   ├── Mobile Client: 1st Person Radar View (WebGL / Socket.IO)
   └── Main Display: Dual Output Shader Engine (Top Heightmap & Side Stratigraphy)
            │
            ▼ (Socket.IO State Interpolation)
[ Node.js Realtime Coordination Server ]
   ├── Player State & Path Engine (30Hz -> 60Hz Interpolation)
   ├── Signature Motif Generator (Tonal.js + Micro-tonal Pitch Map)
   └── Stratigraphic Fault Detector (Similarity Calculation)
            │
            ▼ (Web Audio API / Worklets)
[ Spatial Sound Synthesizer (NoiseCraft & Web Audio) ]
   ├── Layer 1: Stratigraphic Ground Drone (지층 기저음)
   ├── Layer 2: Player Leitmotifs & Spatial Echoes (개인 시그니처 & 메아리)
   └── Layer 3: Fault Glitch & Transient FX (단층 재정렬음)
```

#### 깃허브 소스 레포지토리 모듈 매핑
1. `hywnH/intersection-nextjs`: Next.js Standalone Docker 구조, Socket.IO 플레이어 동기화 및 인터폴레이션 라우팅.
2. `Purpleshifted/harmonizer`: Spatial Audio 오디오 워클릿(`WaveEffectWorklet`), Chord/Centroid Detection 및 ArpEngine.
3. `Purpleshifted/umwelt`: NoiseCraft 슬롯 브리지 및 시계열 환경 데이터/오디오 파이프라인.

---

### 5. Antigravity (로컬 IDE) 개발 액션 플랜 (Development Action Plan)

#### 5.1 추천 프로젝트 모노레포 구조 (Monorepo)
```text
/graduation-exhibition/
├── apps/
│   ├── web-mobile/         # 관객 모바일 1인칭 소닉 레이더 클라이언트
│   └── web-display/        # 메인 프로젝션 (Top & Side View 멀티 디스플레이)
├── packages/
│   ├── server/             # Socket.IO & State Sync / Fault Detection Engine
│   ├── audio-engine/       # WebAudio Worklets, NoiseCraft Bridge & Leitmotif Generator
│   └── spatial-shaders/    # Three.js Glitch, Stratigraphy & Heightmap Shaders
└── docker-compose.yml       # 올인원 배포 및 환경 설정
```

#### 5.2 로컬 개발 단계별 가이드 (Step-by-Step Roadmap)
1. **1단계: 서버 & 모바일 동기화 (Base Protocol)**
   * `intersection-nextjs` 패키지 구조를 로컬에 클론.
   * Socket.IO로 플레이어 진입, 좌표, 틱(Tick) 및 인터폴레이션 구축.
2. **2단계: 오디오 엔진 통합 (Audio Pipeline)**
   * `harmonizer`의 ArpEngine 및 `umwelt`의 NoiseCraft 브리지 이식.
   * Centroid 기반 미세음정 아르페지오 생성기 작성.
3. **3단계: 셰이더 및 지층 구축 (Visual Shaders)**
   * Side View: Canvas2D/WebGL 기반 레이어드 텍스처 및 Fault Glitch Custom Shader 작성.
   * Top View: Heightmap Displacement Shader 작성.
4. **4단계: 멀티 디스플레이 셋업 (Exhibition Display Setup)**
   * Display App에서 2개의 Viewport(Top/Side)로 화면 분할 또는 듀얼 모니터 출력 구성.

---

### 6. 안티그래비티(Antigravity) 연동 및 활용 방법

1. **노트북 직접 연동 여부**: Gemini Notebook / NotebookLM의 대화 및 소스는 로컬 IDE(Antigravity 등)와 실시간 직접 API 동기화가 되지 않습니다.
2. **활용 가이드**:
   * 본 명세서 파일(`graduation_exhibition_spec.md`)을 다운로드하여 안티그래비티 프로젝트 루트 폴더에 놓습니다.
   * Antigravity AI 프롬프트에 `@graduation_exhibition_spec.md`를 참조 문서로 등록하면, 본 대화에서 결정된 철학, 아키텍처, 셰이더/오디오 요구사항을 그대로 기억한 상태에서 코드를 연쇄 작성할 수 있습니다.

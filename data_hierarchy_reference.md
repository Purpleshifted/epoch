# [데이터 층위 및 인터랙션 매핑 명세서] Data Hierarchy & Spatial Mapping Reference

이 문서는 지구/우주/지질/생태적 데이터를 **인간 상호작용의 감도(Interaction Sensitivity) 및 개입 수위(Threshold)**에 따라 4가지 층위(Hierarchy)로 재구성한 데이터 구조 명세서입니다. 
이 층위 구조는 시각적 렌더링 계층(Visual Layer), 오디오 합성 역할(Audio Role), 그리고 관객의 행위성(Agency)의 미학적 개입 범위와 1:1로 매핑됩니다.

---

## 1. 층위별 데이터 분류 및 인터랙션 매핑 (4-Tier Hierarchy)

```text
[ 층위 1: 우주적 / 불가변 층위 ] ──► 배경 앰비언스, Skybox, 불변의 초거시적 메트로놈
        ▲
[ 층위 2: 심지구 / 임계값 층위 ] ──► 강한 사건/임계치 초과 시 단층 파열(Glitch), 인력장 왜곡
        ▲
[ 층위 3: 퇴적 지층 / 프록시 층위 ] ─► Top Heightmap, Side 단면 레이어, 잔향/역사적 퇴적
        ▲
[ 층위 4: 지표 생태 / 활발한 층위 ] ─► 1인칭 소닉 레이더 파동, 시그니처 멜로디, 발자국/자취
```

---

### 층위 1: 우주적 / 불가변 층위 (Cosmic & Immutable Background Layer)
* **상호작용 수위**: **비가변적 (No Direct Interaction)** — 인간의 그 어떤 행위로도 변형되거나 영향받지 않는 절대적 초거시 스케일.
* **대표 데이터**:
  1. **우주배경복사 (Cosmic Microwave Background - CMB)**: 태초의 우주 미세 파동 데이터.
  2. **밀란코비치 주기 (Milankovitch Cycles)**: 지구 공전 궤도 이형성, 자전축 세차운동 등 수만~수십만 년 단위의 지구-우주 메트로놈.
* **시각적 구현 (Visual)**: 월드의 가장 먼 배경(Skybox/Background Canvas), 깊은 공간적 음영, 정적이면서도 미세하게 흔들리는 3D 파티클 백그라운드.
* **청각적 구현 (Audio)**: 오디오 시스템 전체의 기저 앰비언스, 초장기적 템포 변주, 지속되는 초저주파 패드 sound.

---

### 층위 2: 심지구 / 임계값 침투 층위 (Deep Earth & High-Threshold Layer)
* **상호작용 수위**: **고임계적 (High Threshold / Rupture Event)** — 일상적 행위에는 무반응하나, 관객 집단의 누적된 행위나 사건이 극단적 임계값(Threshold)을 초과할 때만 단층 파열 및 강렬한 Glitch 형태로 월드 전체에 침투.
* **대표 데이터**:
  1. **지자기장 반전 및 자북 이동 (Geomagnetic Reversals & Drift)**: 지구 자자기장의 뒤집힘과 인력장 요동.
  2. **지진파 전파 속도 이상 및 맨틀 대류 (Seismic Velocity Anomalies / Mantle Dynamics)**: 지구 내부의 들끓는 에너지.
  3. **해양 산소 결핍 사건 (Ocean Anoxic Events - OAEs)**: 지구적 대멸종 및 해양 질식 기록.
* **시각적 구현 (Visual)**: 월드 전체의 인력장 왜곡, 3D 카메라 셰이킹, 옆면 지층 단면의 수평 단층 파열(Faulting Glitch), 시각적 색조 크래시.
* **청각적 구현 (Audio)**: 파형 찌그러짐(Distortion), 서브 베이스 럼블(Sub-bass Rumble), 3D 공간 음향 좌우 왜곡 패닝.

---

### 층위 3: 퇴적 지층 / 층서학적 프록시 층위 (Stratigraphic Proxy Layer)
* **상호작용 수위**: **누적적 / 서서히 수용함 (Cumulative & Historical Deposition)** — 관객들의 행위 자취가 시간에 따라 차곡차곡 쌓이고 잔향을 남기며 역사화되는 중간 레이어.
* **대표 데이터**:
  1. **빙하 코어 동위원소 (EPICA / GISP2 $\delta^{18}	ext{O}$)**: 지난 80만 년간의 거시 기후 변동 레코드.
  2. **플루토늄-239 낙선 및 대기 중 $	ext{CO}_2$ (Keeling Curve)**: 인류세의 지질학적 표식.
  3. **화산재 스파이크 & 기술화석 (Technofossils)**: 지구 역사상의 기습적 사건 및 과거 문명의 유산.
* **시각적 구현 (Visual)**: 윗면(Top View)의 3D Heightmap 지형 형성, 옆면(Side View)의 층층이 쌓이는 퇴적암 스타일의 지층 구조.
* **청각적 구현 (Audio)**: 관객 자취의 멜로디 잔향(Echo), 화성적 오스티나토(Ostinato), 시간 지연에 따른 딜레이/리버브 축적.

---

### 층위 4: 지표 생태 / 활발한 인터랙션 층위 (Surface Ecosphere & Active Interaction Layer)
* **상호작용 수위**: **즉각적 / 미세반응 (Instantaneous & Highly Sensitive)** — 관객이 존재하는 것, 거니는 것, 움직이는 것만으로 즉각 파동을 일으키고 흔적을 발산하는 표면 층위.
* **대표 데이터**:
  1. **식생 및 꽃가루 화석 이동 (Vegetation & Pollen Shift)**: 지표면을 덮는 가벼운 생명 입자의 밀도.
  2. **관객 위치/궤적 및 소닉 레이더 파동**: 관객 개인 모바일의 이동 좌표 및 터치 파동.
  3. **관객 시그니처 모티프 (Leitmotif)**: Centroid 기반 2초 미세음정 아르페지오 소리.
* **시각적 구현 (Visual)**: 관객 발밑에서 퍼져나가는 동심원 파동(Ripple), 1인칭 레이더 시야의 자취 조명, 지표면 미세 입자 반응.
* **청각적 구현 (Audio)**: 관객 고유의 아르페지오 소리, 스치거나 충돌할 때 발생하는 변조음, 인터랙티브 톤 체인.

---

## 2. 층위 간 메커니즘 (Cross-Tier Dynamics)

1. **하향식 제약 (Top-Down Constraint)**: 
   * 층위 1(우주)과 층위 2(심지구)는 층위 4(개인)가 존재하고 거닐 수 있는 근본적인 환경적 물리 법칙과 배경을 제약합니다.
2. **상향식 축적 및 파열 (Bottom-Up Accumulation & Rupture)**:
   * 층위 4(개인)의 미시적 행위들은 순간적이지만, 지속적으로 퇴적되어 층위 3(지층)의 형태를 변형시킵니다.
   * 이 변형과 충돌이 일정 임계치(Threshold)를 넘어서면, 층위 2(심지구)를 자극하여 지층 전체가 쪼개지는 단층 Glitch(Faulting)를 야기합니다.

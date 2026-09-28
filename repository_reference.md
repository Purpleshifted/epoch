# [레퍼런스 모음] 오픈소스 코드 레포지토리 & 미디어아트 데이터 월드 레퍼런스

---

## SECTION 1. 기존 노트북 소스 레포지토리 (핵심 코어)

1. **`Purpleshifted/Intersection` & `hywnH/intersection-nextjs`**
   * **링크**: https://github.com/Purpleshifted/Intersection / https://github.com/hywnH/intersection-nextjs
   * **기술**: Next.js, Three.js, Socket.IO, NoiseCraft Engine, Docker Monorepo
   * **역할**: 본 졸업전시의 **실시간 모바일 접속, 좌표 동기화, 멀티 디스플레이 파이프라인의 핵심 백엔드/프론트엔드 뼈대**.

2. **`Purpleshifted/harmonizer`**
   * **링크**: https://github.com/Purpleshifted/harmonizer
   * **기술**: TypeScript, Next.js, Web Audio API, Audio Worklet, Spatial Audio
   * **역할**: **주파수 중심점(Centroid) 기반 미세음정(Micro-tone) 시그니처 아르페지오 모티프 연산 및 입체 음향 출력**.

3. **`Purpleshifted/umwelt`**
   * **링크**: https://github.com/Purpleshifted/umwelt
   * **기술**: Next.js, NoiseCraft Bridge, Web Audio Signal Routing
   * **역할**: **인류세 환경 지질 데이터($CO_2$, 플루토늄 등)를 오디오 신디사이저 신호로 전환하는 오디오-데이터 파이프라인 브리지**.

---

## SECTION 2. 3D 지형, Heightmap & GPU Displacement 라이브러리

4. **`tentone/geo-three`** (https://github.com/tentone/geo-three)
   * Three.js 기반 GPU Heightmap Displacement 지형 엔진. 윗면(Top View) 3D 높이맵 지형의 실시간 변형 셰이더 구현에 활용.
5. **`raguilar011095/planet_heightmap_generation` (World Orogen)** (https://github.com/raguilar011095/planet_heightmap_generation)
   * 판구조론 및 지질학적 지형 형성 시뮬레이터. 관객 자취 충돌 시 지형 왜곡 및 산맥 형성 수치 모델.
6. **`FarazzShaikh/Terrain-Builder`** (https://github.com/FarazzShaikh/Terrain-Builder)
   * React, Three.js & GPGPU/Perlin Noise 기반 실시간 절차적 지형 파동 생성기.

---

## SECTION 3. 지형 침식, 단층(Faulting) & 지층 시뮬레이션

7. **`ctkrug/erosion`** (https://github.com/ctkrug/erosion)
   * WebGL2 기반 실시간 수치 침식(Hydraulic Erosion) 시뮬레이션 및 침식 유체음 사운드 피드백. 관객 체류 시 지형을 깎아 분지를 만드는 로직의 모델.
8. **`williamjsdavis/geo-lm`** (https://github.com/williamjsdavis/geo-lm)
   * GemPy 기반 3D 지질학 단층(Faulting) 및 층서학 모델링. 옆면 지층 수평 어긋남 단층 메커니즘의 데이터 구조 참고.
9. **`ist-supsi/react-stratigraphy`** (https://github.com/ist-supsi/react-stratigraphy)
   * 리액트 기반 시각적 지층 단면(Stratigraphy) UI 및 시간 축 자취 레이어 시각화.

---

## SECTION 4. 웹 오디오, 생성형 사운드 & A/V 커플링

10. **`interspecifics/SonicMachines`** (https://github.com/interspecifics/SonicMachines)
    * Three.js 3D 기하체와 WebAudio/Tone.js 오실레이터 간의 양방향(Bi-directional) 커플링 파이프라인.
11. **`phber/harmonices-mundi`** (https://github.com/phber/harmonices-mundi)
    * 3D 시계열/공간 데이터의 1:1 사운드화(Data Sonification) 및 음악 음계 매핑.

---

## SECTION 5. 포인트클라우드, 지리 공간 & 글리치 셰이더

12. **`Potree` / `e-Nicko/webgl-digital-globe`** (https://github.com/potree/potree)
    * Volumetric Point Cloud 파티클 지형. 관객 1인칭 소닉 레이더 파동 시 어두운 공간 속 포인트클라우드 지층/화석이 드러나는 연출.
13. **`pyleoclim-util/pyleoclim`** (https://github.com/pyleoclim-util/pyleoclim)
    * 지질학/고기후 불균일 시계열 데이터 파싱 및 스펙트럼 분석 파이프라인.
14. **`vanruesc/postprocessing`** (https://github.com/vanruesc/postprocessing)
    * Three.js GlitchPass 및 단층 재정렬 시 수평 쪼개짐(Faulting Glitch) 포스트 프로세싱 셰이더.

---

## SECTION 6. 데이터를 매개로 탐색형 가상 세계(Explorable World)를 구현한 미디어아트 레퍼런스

1. **야콥 쿠스크 스티오센 (Jakob Kudsk Steensen)**
   * *The Ephemeral Lake*, *Berl-Berl*, *RE-ANIMATED*
   * 멸종된 조류 소리, 사막 수치 데이터, 습지 3D Photogrammetry 스캔을 가상 엔진 기반의 생태 월드로 재구성. 자연과 데이터가 결합된 '멸망 이후의 생태적 가상 환경' 탐색 레퍼런스.
2. **레픽 아나돌 (Refik Anadol Studio)**
   * *Unsupervised* (MoMA), *Machine Hallucinations*, *Nature Dreams*
   * 수천만 장의 자연 데이터 및 잠재공간(Latent Space)을 3D 입체 데이터 조각 및 Fluid Dynamic 지형으로 변환하여 대규모 데이터의 누적(Accumulation)을 풍경화함.
3. **마시멜로 레이저 피스트 (Marshmallow Laser Feast - MLF)**
   * *In the Eyes of the Animal*, *Sanctuary of the Unseen Forest*, *YOU:MATTER*
   * LiDAR 지형, CT 스캔, 세포 생체 데이터를 활용한 3D 데이터 입자 월드. 관객의 미세한 존재와 행위가 파티클 지형을 밝히는 연출 모델.
4. **클레망 발라 (Clement Valla)**
   * *Postcards from Google Earth*
   * 위성 지형 데이터와 3D 매핑 알고리즘이 충돌할 때 발생하는 글리치(Glitch) 현상을 관조적 시선으로 제시. (옆면 지층 Glitching 과 상통).
5. **데이비드 오라일리 (David OReilly)**
   * *Everything* (2017)
   * 미생물부터 은하계까지 모든 존재가 자율적 Agency를 가지고 사운드를 발산하는 3D 탐색형 오픈월드. 내가 남긴 자취와 객체들이 하나의 합주(Ensemble)를 이루는 경험.
6. **유나이티드 비주얼 아티스트 (UVA - United Visual Artists)**
   * *Other Spaces*, *Synchronicity*
   * 환경 데이터, 조명, 공간 음향을 커플링하여 공간 전체가 하나의 관조적 데이터 생태계로 동작하도록 연출.
7. **로리 앤더슨 & 황신시엔 (Laurie Anderson & Hsin-Chien Huang)**
   * *Chalkroom*, *To the Moon*
   * 기억, 언어, 텍스트 파편 데이터를 가상 공간의 칠판 먼지/화석처럼 구축하여 탐색하게 만드는 1인칭 소닉 레이더의 분위기적 레퍼런스.

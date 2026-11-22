# 웹 리서치 (2026-11-22 밤) — 우리 방향에 쓸 만한 기법·라이브러리·사례, TD 쓰는 사람들의 웹 작업법

작가의 요청: "웹상에서 내가 말한 거, 내 레퍼런스 방향이랑 어울리게 써먹을만한 라이브러리나 프로젝트 예시 있는지 리서치해봐. TD 쓰는 사람들이 웹 작업할 때 보통 어떻게 했는지도 알아보고. 그리고 웹에서 유기적이고 동적인 비주얼, generative scape 구현한 사례들도."
읽은 방법: 웹 검색 스물세 번(결과 요약과 발췌), 전체 글을 연 것은 아님(Codrops는 봇 차단 403). 우리 스택은 three.js + react-three-fiber(WebGL)이고, 대상 기계는 맥북 M2 8 GB·전시 맥미니, 폰.

## 0. 한 줄 결론

- **TD → 웹의 "내보내기"는 없다.** TD 쓰는 사람들은 (a) 브라우저 도구(cables.gl, Hydra)로 다시 짜거나, (b) TD를 서버로 두고 **WebRTC/WebSocket으로 영상·데이터를 흘리거나**, (c) **GLSL을 손으로 옮긴다**(GLSL TOP = 전체 화면 사각형 셰이더 → three.js ShaderMaterial). 우리는 이미 three.js라서 (c)의 "TD는 스케치, 웹은 본작업"이 맞다.
- **우리가 정한 것들은 전부 웹에서 이미 쓰이는 기법이다**: 렌더 타깃 스냅샷(2D 프레임), 핑퐁 피드백(장노출 꼬리), 3D 텍스처 링버퍼(슬릿/타임큐브), 단편 셰이더 한 패스(픽셀 소팅·세로 흘러내림), 인스턴스 점(스캔). 전용 npm 패키지는 거의 없고(글리치만 몇 개), **대부분 직접 쓰는 50–150줄짜리 셰이더**다. 라이브러리보다 **참고 구현**이 자산이다.
- 유기적·생성적 풍경의 최신 사례는 **WebGPU**로 많이 옮겨 갔다(Codrops 2025–26). 우리는 당장 WebGL로 가되, three.js TSL이 두 백엔드를 다 내보내니 길은 열려 있다.

## 1. TD 쓰는 사람들은 웹에서 어떻게 하나

| 길 | 무엇 | 근거 | 우리에게 |
|---|---|---|---|
| (a) 브라우저 노드 도구 | **cables.gl** — 브라우저에서 돌아가는 노드 패칭 WebGL 환경, 무료(MIT), TD/vvvv와 같은 데이터플로우 모델, 코드로 더 들어갈 수 있음. TD → cables.gl로 **WebSocket**으로 데이터 보내는 Derivative 공식 글 있음 | [cdm 2019](https://cdm.link/2019/01/magical-3d-visuals-patched-together-with-wires-in-browser-cables-gl/), [cdm 2021](https://cdm.link/2021/10/watch-wild-demos-made-in-cables-gl-free-visual-programming-tool-plus-fresh-tutorials/), [Interactive & Immersive](https://interactiveimmersive.io/blog/interactive-media/why-you-should-check-out-cables-gl/), [Derivative: TD→cables.gl WebSocket](https://derivative.ca/community-post/websocket-architecture-how-send-data-touchdesigner-cablesgl/69804), [cables WebGL 차이](https://cables.gl/docs/faq/webgl_differences/webgl_differences) | 우리 앱 안에 넣을 수는 없음(별도 런타임). **스케치용**으로는 TD보다 웹 제약을 바로 보여 줘서 유용 |
| (a′) 라이브코딩 비디오 신스 | **Hydra**(Olivia Jack) — 브라우저 비디오 신스, **여러 프레임버퍼로 피드백**이 핵심, WebRTC로 브라우저끼리 영상 공유, 엔진이 `hydra-synth` 모듈로 분리돼 JS 프로젝트에 넣을 수 있음 | [hydra GitHub](https://github.com/hydra-synth/hydra), [cdm](https://cdm.link/2019/02/hydra-olivia-jack/), [hydra-synth](https://github.com/ojack/hydra-synth) | 피드백·번짐의 **감을 잡는 스케치북**. 본작업엔 안 씀 |
| (b) TD를 서버로 | **WebRTC**: Video Stream Out TOP + WebRTC DAT, Palette의 signaling 서버/클라이언트 COMP; HW 인코딩은 미지원(당시). LAN용 커뮤니티 구현 TD-WebRTC-LAN. **NDI**는 브라우저로 직접 못 가고 브리지 필요. 데이터는 **WebSocket**(폰 → TD, TD → 웹) | [Derivative WebRTC](https://derivative.ca/UserGuide/WebRTC), [alltd TD→WebRTC](https://alltd.org/?p=50213), [NDI](https://docs.derivative.ca/NDI), [WebSocket 태그](https://derivative.ca/tags/websocket) | 우리 구조(봇 서버 = Cloudflare DO, 뷰는 읽기만)와 같은 발상. TD를 "현장 기계의 렌더러"로 쓰고 폰에 영상만 보내는 안은 **원격 관객이 삶을 산다(B안)** 와 안 맞음 — 폰이 직접 그려야 함 |
| (c) GLSL을 옮기기 | GLSL TOP = 뷰포트 전체 사각형 하나에 얹은 프래그먼트 셰이더 → three.js에서는 평면 + 정사영 카메라 + ShaderMaterial(uniforms 직접 선언). TD는 최신 GLSL, 웹 예제는 GLSL 1.20이 많아 문법 손질. Shadertoy ↔ TD 변환기가 여럿 | [Write a GLSL TOP](https://derivative.ca/UserGuide/Write_a_GLSL_TOP), [three.js & Shadertoy](https://threejs.org/manual/en/shadertoy.html), [alltd: WebGL→TD 포팅](https://alltd.org/?p=25015), [TD-Shadertoy](https://github.com/matthewwachter/td-shadertoy), [TSL](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language) | **우리 길.** 작가가 TD에서 번짐·스캔·글리치를 스케치하면 그 GLSL을 우리 ShaderMaterial/후처리 패스로 옮긴다. 노브는 Leva가 TD의 파라미터 창 역할 |
| 한계 | WebGL은 TD의 POP(점 연산자)·속성 체계보다 좁다; 공식 "웹 TD 플레이어"는 요청만 있고 없음 | [Derivative 포럼](https://forum.derivative.ca/t/a-web-td-player-treejs-based/991083) | 점 연산은 우리가 정점 셰이더·GPGPU로 직접 |

그 밖의 노드 도구: Nodes.io(Variable, 2D 캔버스, 2020년 이후 소식 없음), Vizor Create, Polygonjs(three.js 기반 노드 3D) — [cdm Nodes](https://cdm.link/2020/12/nodes-is-a-creative-visual-patcher-for-people-who-love-code-or-is-it-the-other-way-round/), [Polygonjs](https://github.com/polygonjs/polygonjs). 쓸 일 없음.

## 2. 우리가 정한 것마다 — 웹의 기법과 참고 구현

### 2.1 닥쳐오는 2D 프레임 (미래도시 스냅샷을 반투명 판으로)
- **렌더 타깃 스냅샷**: `WebGLRenderTarget`에 다른 카메라로 장면을 그리고 그 텍스처를 평면의 `map`으로 — three.js 매뉴얼과 Maxime Heckel의 글이 그대로의 패턴(찍는 패스 동안 판 자신은 숨길 것, 첫 프레임은 빈 판). [three.js Render Targets](https://threejs.org/manual/en/rendertargets.html), [Heckel: render targets](https://blog.maximeheckel.com/posts/beautiful-and-mind-bending-effects-with-webgl-render-targets/)
- **반투명 판 여러 장의 정렬 문제**(three.js의 가장 흔한 함정): three.js는 투명 물체를 거리 휴리스틱으로만 정렬해 **겹친 평행 판이 튄다**. 해법 셋 — ① `depthWrite:false` + 매 프레임 **거리순 `renderOrder`를 우리가 직접**(판이 ≤12장이고 거의 한 축 위라 이걸로 충분), ② **three-wboit**(Weighted Blended OIT, 정렬 없이 안정, 겹침의 정확한 색은 포기, WebGL1·모바일 OK), ③ depth peeling(정확하지만 비쌈). 권장 ①, 안 되면 ②. [ThreeJS and the transparent problem](https://discourse.threejs.org/t/threejs-and-the-transparent-problem/11553), [three-wboit](https://github.com/stevinz/three-wboit), [Cesium WBOIT](https://cesium.com/blog/2014/03/14/weighted-blended-order-independent-transparency/)
- **종이 질감의 판**: 판의 텍스처는 저해상도(512×768)로 찍고 셰이더에서 가장자리를 노이즈로 부드럽게, 종이색 곱하기 — 셰이더 10줄.

### 2.2 장노출의 번짐·꼬리 (사람, 그리고 사라질 때)
- **핑퐁 피드백**이 정석: 두 렌더 타깃을 번갈아 쓰며 `새 프레임 + 이전 × decay`, decay 0.9–0.98(1에 가까울수록 긴 꼬리), float 타깃. Codrops의 Persistence·Typography Trail 글, three.js 포럼의 Recursive Trail, drei의 `useFBO`가 보일러플레이트를 덜어 줌. 우리 `vegFlow`가 이미 같은 구조. [Codrops Persistence](https://tympanus.net/codrops/2021/12/28/adding-a-persistence-effect-to-three-js-scenes/), [Codrops Typography Trail](https://tympanus.net/codrops/2021/07/21/creating-a-typography-motion-trail-effect-with-three-js/), [Recursive Trail Ping-Pong](https://discourse.threejs.org/t/recursive-trail-ping-pong-three-js-render-to-texture-feedback/89718), [luma.gl persistence 0.9](https://luma.gl/docs/api-reference/shadertools/shader-passes/persistence)
- 사람에게만 번짐을 주려면 **사람 층만 따로 타깃에 그려 피드백**을 걸고 합성한다(땅은 선명 유지). 지금 street-feel의 "위치 링버퍼로 몸을 뒤로 복사"는 이것의 싼 근사이고, 둘을 겹치면 장노출에 가장 가깝다.
- **속도 버퍼 모션블러**(John Chapman 방식, 정점마다 이전 위치와의 차)는 더 정확하지만 패스가 늘고 알파 텍스처와 안 맞음. three.js에는 gist 구현과 WebGPU 쪽 `VelocityNode`. 우리는 피드백으로 충분. [Chapman per-object motion blur](https://john-chapman-graphics.blogspot.ca/2013/01/per-object-motion-blur.html), [three.js gist](https://gist.github.com/0beqz/a7e5ee6293ec75e7613e989b535dcd78), [VelocityNode](https://threejs.org/docs/pages/VelocityNode.html)

### 2.3 슬릿스캔·타임큐브 (왜곡 노브 "슬릿", 벽의 타임큐브 생각)
- 원리: 프레임들을 시간축으로 쌓은 **부피**에서 다른 방향으로 자른다. 웹에서는 **최근 프레임의 링버퍼**를 `Data3DTexture`(깊이 = 링 길이, 슬롯 하나씩 부분 갱신)나 2D 타깃 배열로 들고, 셰이더가 픽셀(행)마다 다른 시간을 샘플한다. 완성된 three.js 예제는 없고 texture3d partial-update 예제에서 시작. p5의 시간 변위 스케치(행마다 한 프레임씩 지연)가 가장 쉬운 설명. [three.js Data3DTexture](https://threejs.org/docs/api/en/textures/Data3DTexture.html), [슬릿스캔 입문](https://instructables.com/Slit-Scan-Video-Primer), [Temporalis](https://experiments.withgoogle.com/temporalis), [p5 time displacement](https://editor.p5js.org/loic.brtd/sketches/IM4pfWke3)
- 함정: Data3DTexture를 커스텀 셰이더에서 읽을 때 포맷·타입을 명시하지 않으면 검은 화면/빨강 채널만.

### 2.4 글리치·픽셀 소팅·데이터모시 (사라짐의 "세로 흘러내림")
- **전용 패키지는 없다.** 있는 것: three.js 애드온 `GlitchPass`(사각 블록 변위, 범용), pmndrs `postprocessing`의 Glitch·Pixelation·Scanline·DotScreen·Noise·ChromaticAberration(EffectPass가 효과들을 한 셰이더로 합침). [GlitchPass](https://threejs.org/docs/pages/GlitchPass.html), [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing)
- **데이터모시**: Codrops 2026-09 글 — 프래그먼트 셰이더가 "디코더" 노릇을 하며 피드백 버퍼 위에 움직임 벡터로 이전 프레임을 끌어온다(자기 프레임버퍼는 샘플 못 하므로 핑퐁). [Codrops Datamosh](https://tympanus.net/codrops/2026/09/02/breaking-the-frame-building-a-real-time-datamosh-effect-with-three-js/)
- **픽셀 소팅**: 실시간 진짜 정렬은 비싸서 모두 **의사(pseudo) 소팅** — 문턱을 넘는 구간을 세로로 늘려 그라데이션으로 채움(Godot·WGSL 예). 우리 "세로 흘러내림"은 딱 이것: 판 텍스처에 한 패스, 열마다 문턱 아래 픽셀을 아래로 끌어 번지게. [Pseudo Pixel Sorting (Godot)](https://godotshaders.com/shader/pseudo-pixel-sorting/), [pixel sort shader (WGSL)](https://www.shadcn.io/shaders/pixel-sort-shader), [ISF Sorting Smear](https://docs.rs/crate/isf/latest/source/test_files/Sorting%20Smear.fs)

### 2.5 점구름·스캔 (현재의 프레임 스캔, 미래의 스캔 룩)
- three.js `Points` + 커스텀 PointsMaterial이 표준. 큰 실제 스캔은 Potree(three.js 기반 뷰어, 스타일링은 제한적). 예술 쪽 참고: 폐병원 라이다 스캔 전시(수정한 PointMaterial), **라이다 센서가 돌며 한 줄씩 쌓는 시각화**(KritB — 우리 "스캔 선"과 같은 그림). [Point cloud abandoned hospital](https://discourse.threejs.org/t/point-cloud-abandoned-hospital/68441), [KritB lidar](https://www.hackster.io/news/kritb-s-links-a-lidar-sensor-to-python-and-javascript-to-create-impressive-color-visualizations-4b694b69f116), [Potree](https://best-of-web.builder.io/library/potree/potree), [Bluecadet: LiDAR in WebGL](https://medium.com/bluecadet/hello-lidar-world-7ac77fe2470d)
- 점구름 미학의 계보: Marshmallow Laser Feast *In the Eyes of the Animal*(2015, 라이다 + 드론 + CT + 포토그래메트리 — 작가의 IMG_1561과 같은 종류의 그림), ScanLAB Projects("레이저 스캐너의 눈으로"). 학술 정리: "스캔된 실제, 데이터로 녹는 투명성, 기술적 결함의 모호함"이 점구름 미학의 세 특징. [MLF](https://marshmallowlaserfeast.com/project/in-the-eyes-of-the-animal/), [ScanLAB 인터뷰](https://4sonline.org/news_manager.php?page=29857), [The Point Cloud Aesthetic](https://www.ebsco.com/articles/social-sciences-and-humanities/76e252c9-cf60-5297-9d55-1e1c3051be3a/the-point-cloud-aesthetic-defining-a-new-visual-language-in-media-art)
- **가우시안 스플랫**(three.js: GaussianSplats3D, 더 가벼운 Gaussian Splat Lite/WebGPU): "캡처된 장소" 룩이지만 무겁고 정적 — 우리처럼 매 순간 바뀌는 세계엔 **고정 소품**(발굴 공간의 유물 조각)으로만. [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D), [Gaussian Splat Lite](https://discourse.threejs.org/t/gaussian-splat-lite-1-0-webgpu-streaming-lod-and-depth-rendering-for-three-js/94234)

### 2.6 GPGPU 입자·컬 노이즈 (표류, 날아감)
- 10만 점 컬 노이즈 GPGPU 데모(위치 텍스처를 프래그먼트 셰이더가 갱신, CPU는 uniform만), drei `useFBO`, R3F용 `r3f-particle-system`(NoiseForce), `@lexdotdev/react-organic-particles`. 우리 `vegFlow`·점 스캔이 이미 이 계열. [partikel strom 100k](https://pete-6z3.pages.dev/lab/gebastel/partikel-strom), [GPGPU Particles (discourse)](https://discourse.threejs.org/t/gpgpu-particles/90558), [r3f-particle-system](https://cdn.jsdelivr.net/npm/r3f-particle-system@1.0.3/README.md)

### 2.7 사람 = 점 실루엣의 계보
- Kinect 깊이 → 점구름을 웹으로(Kinectron, ITP "Get Deep"), 실루엣 하나가 **400–900점**(브레멘 대학 프로젝트)이라는 수치가 우리 몸 480점의 근거가 된다. 우리는 깊이 카메라가 아니라 서버 표본이라 몸은 구워 둔 실루엣. [Kinectron](https://github.com/kinectron/Three-Kinectron), [ITP Get Deep](https://itp.nyu.edu/camp2018/session/170), [Bremen silhouette point cloud](https://cgvr.cs.uni-bremen.de/teaching/studentprojects/kinaptic/sites/documents/articles/pointcloud.shtml)

## 3. 유기적·동적 비주얼, generative scape — 웹 사례

| 사례 | 무엇 | 스택 | 우리와의 관계 |
|---|---|---|---|
| **DIORAMAS** (Galo Canizares, 2025) | 나무·산이 **시간에 따라 자라는** 생성 풍경 | 바닐라 JS + 자체 WebGL 엔진, 픽셀 퍼펙트 | 자라는 풍경 = 우리 식생의 점령 | [raster.art](https://www.raster.art/artwork/dioramas-by-galo-canizares/about) |
| **Garden, Monoliths** (Zancan, 2021–) | grass.js 알고리즘 위의 정원 | p5 계열 | 풀의 생성 문법 | [lerandom](https://lerandom.art/collection/garden-monoliths-156) |
| Natural Order/Chaos (Tezumie), Genscape (Ed Cavett) | 생성 풍경, 흐름장 | p5.js | 흐름장 풍경 | [raster.art](https://www.raster.art/artwork/natural-orderchaos-by-tezumie/about), [raster.art](https://www.raster.art/artwork/genscape-by-ed-cavett/about) |
| anbello (fxhash) | 높이맵이 식생 밀도를 정하는 풍경 | three.js WebGLRenderer | 우리 밀도→식생과 같은 규칙 | [deca.art](https://deca.art/token/tezos/KT1U6EHmNxJTkvaWJ4ThczG4FSDaHC21ssvi/1266117) |
| **Still** (Codrops 2026-09) | 아키라에서 수묵으로 — **수묵 질감의 생성 정원**(절차적 꽃·덩굴) | three.js WebGPU | **종이·번짐 위의 식생** — 우리 흰 바탕과 가장 가까운 최신 사례 | [Codrops](https://tympanus.net/codrops/2026/09/09/still-from-akira-to-ink-wash-building-a-generative-garden-in-webgpu/) |
| False Earth (Codrops 2026-04) | 무한 절차 지형 + 풀, WebGL 한계에서 WebGPU로 | three.js WebGPU | 풀 밀도의 한계 수치 참고 | [Codrops](https://tympanus.net/codrops/2026/04/21/false-earth-from-webgl-limits-to-a-webgpu-driven-world/) |
| Roots to Leaves (Codrops 2025-12) | GPGPU 벡터장 입자 + 곡선 따라가는 입자로 자연 | three.js | 식생 점의 표류 | [Codrops](https://tympanus.net/codrops/2025/12/04/crafting-nature-beyond-technology-a-project-from-roots-to-leaves/) |
| UntilLabs 살아 있는 입자 (basement.studio) | 실제 사진에서 출발한 물리 기반 입자 생명 | WebGL 셰이더 | "사진 → 입자" = 우리 2D 프레임이 점으로 흩어지는 단계 | [Codrops](https://tympanus.net/codrops/2025/12/10/simulating-life-in-the-browser-creating-a-living-particle-system-for-the-untillabs-website/) |
| Unseen: 세포 입자 | Rapier 물리 + three.js 유기 입자 | three.js | 참고 | [Codrops](https://tympanus.net/codrops/?p=97668) |
| Chiro Visuals: 절차적 담쟁이·무화과 | 브라우저에서 실시간 생성되는 잎 | three.js | 남은 부재를 덮는 식생의 생성 | [80.lv](https://80.lv/articles/this-fully-procedural-ivy-and-fig-tree-generator-runs-in-your-browser) |
| Forest Environment (three.js 포럼) | 숲 환경 | three.js WebGPU | 숲 룩 | [discourse](https://discourse.threejs.org/t/forest-environment-built-with-three-js-and-webgpu/96126.md) |
| **Physarum**(점균) | 100만 입자 실시간(2019 MBP), WebGL2 transform feedback 구현, gpu-io 예제 | WebGL | **남은 부재를 먹는 식생의 자람** 텍스처로 256² 한 장이면 충분 | [brandosha](https://github.com/brandosha/physarum), [Klein WebGL2](https://maximilianklein.github.io/showcase/physarum), [gpu-io physarum](https://apps.amandaghassaei.com/gpu-io/examples/physarum/) |
| 반응확산 | 두 물질 A·B의 상호작용, WebGL1 16비트 패킹 | WebGL | 이끼·곰팡이 무늬 | [piellardj](https://github.com/piellardj/reaction-diffusion-webgl), [Derivative RD 튜토리얼](https://derivative.ca/community-post/tutorial/reaction-diffusion-effect-techniques/69616) |

### 3.1 더 찾은 사례 (작가: "여기 예시들 너무 좋음, 더 찾아줘!!")

**종이·수채·먹 — 우리 흰 바탕의 마감에 바로 닿는 것**
- **Susurrus** (Codrops 2026-04): three.js + R3F로 만든 **수채화 세계**. 룩 전체가 **Kuwahara 필터**(가장자리를 지키는 평활화 → 붓자국) 한 패스 위에 서 있고, 성능을 위해 단순화한 버전. [Codrops](https://tympanus.net/codrops/2026/04/24/susurrus-crafting-a-cozy-watercolor-world-with-three-js-and-shaders/)
- **Maxime Heckel, *On Crafting Painterly Shaders*** — R3F 위에 Kuwahara를 후처리로 얹는 GLSL 전문. 수채·구아슈 느낌의 출발점. [blog](https://blog.maximeheckel.com/posts/on-crafting-painterly-shaders), [Moebius 스타일](https://blog.maximeheckel.com/posts/moebius-style-post-processing)
- **Alexander Hong, 실시간 수채 셰이더**(Luft & Deussen 2003을 three.js로): 종이 질감·가장자리 어두워짐(wet edge)·번짐의 고전 구현. [article](https://alexanderhong.github.io/articles/watercolor)
- **Forgotten Colors — 수묵을 3D로**(bentobaux): 색 램프를 재질마다 따로 조정해야 했다는 교훈. [post](https://bentobaux.github.io/posts/forgotten-colors-capturing-sumi-e-in-3d)
- **inkField**: p5/WebGL 피드백 셰이더로 먹 흐름·번짐·마른 붓. [tech](https://ileivoivm.github.io/inkField/tech/en/index.html)
- **Still**(앞 표) — 수묵 정원, 꽃은 VAT(구운 정점 애니메이션) + 절차적 변주.

**풍경 토큰·작품**
- **Matt DesLauriers — *Meridian*(2021, 1,000점)·*Subscapes*(2021, 650점)**: 세로 포맷의 끝없는 풍경 한 조각을 작은 색 획 수천 개로 쌓음, 코드 15–17 kB. 자연/인공의 경계를 묻는 풍경. [Meridian notes](https://mattdesl.substack.com/p/notes-on-meridian), [Subscapes 대화](https://www.artblocks.io/article/in-conversation-with-matt-deslauriers-on-subscapes), [GitHub](https://github.com/mattdesl/subscapes)
- **Penderecki's Garden**(HUNCWOT, Awwwards): 정원을 GLSL 입자로, 소리 분석과 입자 움직임을 묶음. [Awwwards](https://www.awwwards.com/pendereckis-garden-by-huncwot.html)
- **Celestial Grove**(reyrove, 2024, fxhash): 나무 구조 + 달의 밤 숲. **The Piece of Nature**(unsleeping_ik, 2025): 풀·나무·꽃이 **그려지는 과정이 보이는** 생성. **Deep Forest**(Matt Perkins). [raster.art](https://www.raster.art/artwork/celestial-grove-by-reyrove/about), [raster.art](https://www.raster.art/artwork/the-piece-of-nature-by-unsleeping-ik/about), [raster.art](https://www.raster.art/artwork/deep-forest-by-matt-perkins/about)
- **Ganges Sands**: 금강경에서 온 three.js 입자 명상. [discourse](https://discourse.threejs.org/t/ganges-sands-a-diamond-sutra-inspired-particle-meditation-in-three-js/95012)

**살아 있는 생태계 — 멈추지 않는 세계 (우리 전시 세계와 같은 종류)**
- **Fruiting Bodies**(fruitingbodies.life): 브라우저에서 **쉬지 않고 도는** 생성 작품, 일주기·계절·달의 시간에 반응, 생성 앰비언트 드론. [cifra](https://cifra.com/project/fruiting-bodies-fruitingbodieslife)
- **nom nom**(Xin Liu, Google Arts & Culture): 수백만 입자의 진화하는 생태, **신경 세포 자동자** + 날씨. [A&C](https://artsandculture.google.com/experiment/xin-liu-nom-nom/-wGAP_EYEvH37w)
- **DIORAMAS**(앞 표): 자라고 번성하다 **결국 먼지로 돌아감** — 우리 화석화·잊힘과 같은 서사. [CAN](https://www.creativeapplications.net/nft/dioramas-itsgalo/)
- **Browser Botanical**(백그라운드에서 자라는 나무), **Digital Garden**(날씨가 성장 속도), **Reef Dive**(보는 동안 산호가 돋음), **Evo Lumen Life**, **Joel Simon의 생태계 모델링**. [itch](https://itskellen.itch.io/browser-botanical), [digital_garden](https://awesome.ecosyste.ms/projects/github.com%2Fwebmatze%2Fdigital_garden), [Reef Dive](https://arcade.pirillo.com/reef-dive.html), [Evo Lumen](https://joelholder.com/2026/03/02/evo-lumen-life-building-a-living-artificial-ecosystem-in-the-browser), [Joel Simon](https://www.joelsimon.net/ecosystem-modelling)

**스캔된 자연의 계보 (점구름 미학)**
- **Quayola — *Remains***(진행 중): 라이다로 숲을 수십억 점으로 떠서 대형 종이에 인쇄; *Jardins d'été*(정원 스캔), *Pointillisme: Provence*(2023 — **스캐너가 나뭇잎을 못 푸는 실패**를 작품으로). 우리 "현재의 스캔"의 가장 가까운 형. [Ars Electronica](https://ars.electronica.art/center/?p=500), [Quayola](https://quayola.com/?p=6272), [Meer](https://www.meer.com/en/37443-vestiges)
- 학술: *The Point Cloud Aesthetic*(Virtual Creativity 2023) — Quayola·Stefano Caimi·Dan Holdsworth. [EBSCO](https://www.ebsco.com/articles/social-sciences-and-humanities/76e252c9-cf60-5297-9d55-1e1c3051be3a/the-point-cloud-aesthetic-defining-a-new-visual-language-in-media-art)

**성장 알고리즘 (남은 부재를 덮는 자람, 유기적 형태)**
- **Andy Lomas — *Cellular Forms***: 세포 분열·스프링·반발로 5천만 세포의 형태(C++/CUDA; 웹은 축소판만 가능). [SIGGRAPH](https://history.siggraph.org/experience/cellular-forms-an-artistic-exploration-of-morphogenesis-by-lomas)
- **L-시스템**: three.js로 실시간 나무 정원(L-System-Trees), `lindenmayer` 라이브러리(2D/3D three.js). [L-System-Trees](https://github.com/FrancescoGradi/L-System-Trees), [lindenmayer](https://github.com/nylki/lindenmayer)
- 절차 나무: **Fractals to Forests**(Codrops 2025-01), **Procedural Instanced Forest**(2025-12, 수백 그루·잎 흔들림·LOD), **Florasynth**. [Codrops](https://tympanus.net/codrops/2025/01/27/fractals-to-forests-creating-realistic-3d-trees-with-three-js/), [discourse](https://discourse.threejs.org/t/procedural-instanced-forest-high-performance-real-trees/88610), [Florasynth](https://discourse.threejs.org/t/florasynth-procedural-tree-generator/58740)
- 풀: **100만 잎 60 fps**(three.js), **WebGPU 고성능 풀**. [discourse](https://discourse.threejs.org/t/real-time-grass-simulation-in-the-browser-over-1-million-blades-at-60-fps/82808), [discourse](https://discourse.threejs.org/t/high-performance-grass-rendering-in-three-js-webgpu/94175.md)
- 고전: iq의 **Elevated**(텍스처 없이 산·하늘·안개 전부 셰이더), **Rainforest**. [Elevated 포팅](https://discussions.unity.com/t/elevated-shader-in-unity3d/674737)

경향: 2025–26의 "유기적 풍경"은 WebGPU(컴퓨트 셰이더)로 많이 넘어갔다. 우리는 WebGL로 가되 TSL(WGSL/GLSL 둘 다 출력)로 쓰면 나중에 옮길 수 있다 — 단, 지금 코드베이스는 GLSL ShaderMaterial이라 당장은 그대로.

## 4. 우리에게 — 추천

1. **스택은 그대로**(three.js + r3f, WebGL). 라이브러리를 더 들일 곳은 거의 없다. 들일 만한 둘: `postprocessing`(pmndrs; Scanline·Noise·Glitch가 필요해질 때 — 벽은 픽셀 바운드라 개인뷰에만), `three-wboit`(판 정렬이 ①로 안 풀릴 때만).
2. **2D 프레임**: 렌더 타깃 스냅샷 + `depthWrite:false` + 거리순 renderOrder. 판 ≤12장, 512×768. (§2.1)
3. **사람의 번짐**: 지금의 위치 링버퍼 + **사람 층만의 핑퐁 피드백**(decay 0.9–0.95) 한 패스. (§2.2)
4. **사라짐 = 세로 흘러내림**: 판 텍스처에 **의사 픽셀 소팅 한 패스**(열마다 문턱 아래를 아래로 끌기). 글리치 블록은 `GlitchPass`류 변위로. (§2.4)
5. **슬릿 왜곡**: 판을 찍는 링버퍼를 `Data3DTexture`로 두면 "슬릿" 노브가 공짜로 생긴다(행마다 다른 시간). (§2.3)
6. **종이 위의 식생**: `vegFlow` 핑퐁 그대로 + 남은 부재를 덮는 자람에 **점균/반응확산 256² 텍스처** 한 장(미래 층). (§3)
7. **TD는 스케치북**: 작가가 TD/Shadertoy/Hydra에서 번짐·스캔·글리치를 만들면 그 GLSL을 우리 ShaderMaterial로 옮긴다(uniform 직접 선언, GLSL 버전 손질, uv 좌표 차이). Leva = TD의 파라미터 창. (§1 c)

## 5. 조심할 것
- 투명 판 정렬(§2.1) — 첫날부터 거리순 renderOrder를 넣을 것.
- 피드백 타깃은 float(half-float)로, 아니면 꼬리가 띠처럼 끊긴다; Firefox는 RGB 포맷 속도 버퍼가 깨진 사례(RGBA로).
- 폰: 점 수 1/5, 피드백 해상도 1/2, 판 6장.
- Codrops 글들은 봇이 못 읽는다(403) — 작가가 브라우저로 직접 보는 편이 빠르다.

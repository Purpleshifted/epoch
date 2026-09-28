# 오디오 클러스터 프로토타입 메모

## 개요

플레이어 거리를 기반으로 서버가 클러스터를 계산하고, 개인/클러스터/글로벌 오디오 파라미터를 내려 NoiseCraft 패치에 연결하는 최소 예제를 구축했습니다. 개인 뷰는 “자기 노이즈 + 클러스터 화음”을, 글로벌 뷰는 가장 큰 클러스터의 화음을 따라갑니다.

## 서버

### 클러스터링

- 약 200 ms마다(또는 플레이어 입장/퇴장 시) 재계산.
- 반경 420 px 기준으로 BFS 클러스터링.
- 각 클러스터는 `clusterId`, 중심 좌표, 인원 수, gain, 그리고 인원에 따라 스케일링되는 C–E–G 3화음을 보관.

### 오디오 페이로드

- `audioSelf`: `{ noiseLevel (0-1), ambientLevel (0-1), clusterId }`
- `audioCluster`: `{ clusterId, chord: [{ freq, gain }], memberCount, centroid, gain }`
- `audioGlobal`: `{ cluster: audioCluster | null }`
- 플레이어는 `audioSelf` + 자기 클러스터의 `audioCluster`를 받고, spectator는 가장 큰 클러스터의 `audioGlobal`만 받음.

## 클라이언트

### 상태 구조

```ts
audio: {
  self: { noiseLevel, ambientLevel, clusterId, updatedAt } | null;
  cluster: { clusterId, chord, memberCount, centroid, gain, updatedAt, source: "cluster" } | null;
  global:  { ... source: "global" } | null;
}
```

### 소켓 핸들러

- `audioSelf` → `SET_AUDIO` (self)
- `audioCluster` → `SET_AUDIO` (cluster)
- `audioGlobal` → `SET_AUDIO` (global)

### NoiseCraft 브리지

- 공통 헬퍼가 `SetParam` 명령을 생성:
  - 개인 모드: 노드 `0`(주파수) / `1`(게인).
  - 클러스터/글로벌: 노드 `4/6/8`(삼화음 주파수) + 노드 `12`(게인).
- personal view는 작은 NoiseCraft iframe을 렌더링하고, 계산된 파라미터를 `postMessage`로 전달.
- global view는 기존 iframe에 동일한 메시지를 보내 화음을 반영.

### 임베디드 패치

- `noisecraft/public/embedded.html`이 간단한 패치(개인 Sine + 세 개의 화음 Sine)를 로드하고 다음 메시지를 처리:
  - `noiseCraft:setParams` → 지정된 노드에 `SetParam`.
  - `noiseCraft:play` / `noiseCraft:stop` → 원격 재생 제어(선택).
- `embedded.html`은 `?src=<절대경로>` 또는 `?project=<NoiseCraft 프로젝트 ID>` 쿼리를 지원합니다. 프런트에서는
  `NEXT_PUBLIC_NOISECRAFT_PATCH_SRC`(정적 .ncft 파일) 또는 `NEXT_PUBLIC_NOISECRAFT_PATCH_PROJECT_ID`(업로드한 프로젝트 ID)를
  설정해 iframe 기본 패치를 지정할 수 있습니다. 기본값은 `/audiocraft/current-project`이며, NoiseCraft UI(`/` 경로)가
  사용자가 연 최신 프로젝트를 해당 엔드포인트에 캐시(post)해 주므로 업로드 없이도 글로벌/모바일 iframe이 동일한 사운드를
  그대로 재생합니다.
- `/socket`(3001) 서버에는 4개의 “Noise Slot” 채널이 있으며, Noisecraft 에디터에서 선택한 노드 묶음을 각 슬롯에 맵핑하면
  프런트(3000)가 슬롯별 값을 계산해 해당 노드들에 `SetParam`을 전송합니다. 슬롯 0~3은 각각 Self Frequency, Self Gain,
  Cluster Chord(최대 3 노드), Cluster Gain 스트림을 의미하며 슬롯이 비어 있으면 기본 패치 노드(`0/1/4/6/8/12`)로
  되돌아갑니다.

## 후속 과제

- 임시 triad/gain 로직을 실제 사운드 디자인 팀이 전달할 DSP 규칙으로 교체.
- 클러스터별 필터/비주얼 피드백 등 UX 강화.
- 모바일에서 오디오 자동재생 제약을 완화할 전용 “Start Audio” 안내 배너 추가.

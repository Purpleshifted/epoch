## 개인 오디오 파이프라인 구체 계획 (GameState → NoiseCraft)

### 1. 논리 파라미터(0~1) 최소 셋 정의

**목표**: 소켓에 새 데이터 안 올리고, 클라 `GameState`만으로 개인 오디오에 쓸 0~1 파라미터 몇 개를 만든 다음, 그걸 여러 노드에 나눠 쓰기.

- **`approachIntensity`**
- 의미: 가장 가까운 공 쪽으로 얼마나 빠르게 접근 중인지 (이미 구현한 값 재사용).
- 범위: 0 = 멀어지거나 정지, 1 = 최대 상대 속도로 정면 접근.
- 계산: 현재 `MobileView` 의 상대 속도 로직 유지.

- **`nearestProximity`**
- 의미: 가장 가까운 공이 얼마나 가까운지 (거리 기반 proximty).
- 범위: 0 = inner/outer 반경 바깥, 1 = innerRadius에 거의 붙어있음.
- 계산 예시: `distNorm = clamp(1 - distance / innerRadius, 0, 1)`.

- **`localDensity`**
- 의미: 일정 반경 안에 플레이어가 얼마나 몰려 있는지 (혼잡도).
- 범위: 0 = 주변에 거의 없음, 1 = maxNeighbors 이상 몰려 있음.
- 계산 예시: `densityNorm = clamp(count / maxNeighbors, 0, 1)`.

- **`clusterEnergy` (옵션)**
- 의미: 서버에서 주는 `audio.cluster`/`audio.self.clusterId` 기반으로, 내가 속한 클러스터의 강도/존재 여부.
- 범위: 0 = 클러스터 없음, 1 = 클러스터 gain 상당히 큼.
- 계산 예시: `clusterEnergy = audio.cluster ? clamp(audio.cluster.gain / targetGain, 0, 1) : 0`.

### 2. GameState에서 직접 계산 (virtual particle 없이)

- **소켓 변경 없음**
- 개인 오디오용 값은 모두 클라이언트 `personal` 뷰에서 `state.players`, `state.selfId`, `state.audio` 등으로 계산.
- 서버/NoiseCraft용 소켓 이벤트는 기존 프로토콜 유지.

- **계산 위치**
- `MobileView` 또는 `lib/audio` 쪽에 `computePersonalAudioMetrics(state)` 같은 헬퍼를 추가.
- 이 함수가 위 3~4개 논리 파라미터(0~1)를 한꺼번에 반환.
- 업데이트 주기: 렌더 루프에 1:1로 묶지 말고, 30–60Hz 정도로 `throttle`/`debounce` 해서 postMessage 빈도 줄이기.

### 3. 노드 매핑 레이어 (0~1 → 노드별 실제 값 범위)

**아이디어**: 논리 파라미터 이름과 NoiseCraft 노드/범위를 테이블로 관리해서, 패치 바꿀 때도 이 테이블만 만지면 되게 만들기.

- **매핑 테이블 구조 예시** (TS 쪽, `nodeMapper` 또는 새 config):
- 각 엔트리:

  - `logicalParam`: `"approachIntensity" | "nearestProximity" | "localDensity" | "clusterEnergy"` 중 하나.
  - `nodeId`: NoiseCraft 노드 ID (예: `"206"`, `"183"`, `"5"` 등).
  - `paramName`: 기본은 `"value"`.
  - `min`, `max`: 해당 노드에서 실제로 쓰고 싶은 값 범위 (예: 0.2~1.0).
  - `curve?`: 필요시 `"linear" | "exp" | "sqrt"` 등으로 감도 조정.

- **매핑 함수 로직**
- 입력: `(normalized, {min, max, curve})`.
- 기본: `value = min + (max - min) * normalized`.
- `curve`가 있으면 `normalized`에 한 번 더 함수 적용 (예: `normalized ** 2`로 미세 구간 확장).
- 여기서 하나의 논리 파라미터가 여러 노드에 매핑될 수 있고, 여러 논리 파라미터가 같은 노드에 합쳐질 필요가 있으면, **우선순위/가중치 규칙**을 테이블에 추가해서 처리.

### 4. 구체적인 예시 매핑 (현재 개인 오디오 패치를 가정)

패치 실제 상태를 나중에 확인해서 숫자는 조정하되, 구조는 아래처럼 잡는다:

- **`approachIntensity` (접근 속도)**
- `node 206` (예: fact / tempo 관련): 0.01–0.05 범위로 맵핑 → 이미 있는 구조 유지.
- `node 183` (Vol CHORDS): 0.15–0.8 범위 → 접근할수록 코드 볼륨/에너지 증가.
- `nodes 5, 35, 107` (기존 proximity 라우트): 0.2–1.0 범위 → 접근 강도에 따라 필터/모듈레이션 심해지게.

- **`nearestProximity` (거리 기반)**
- 어떤 `%` 노드(예: 문서에 나온 distance/probability 노드): 0–1 또는 0.2–1.0.
- 가까울수록 1, 멀수록 0 → 시퀀서 트리거나 패턴 밀도에 영향.

- **`localDensity` (혼잡도)**
- 노이즈/앰비언스 게인 노드: 0.1–0.9.
- 주변이 붐빌수록 텍스처가 두꺼워지는 느낌.

- **`clusterEnergy` (클러스터 기반)**
- 클러스터 전용 send/aux 노드의 gain: 0–1.
- 내가 클러스터에 속해 있고, 그 클러스터 gain이 높을수록 더 강한 코드/패턴.

### 5. 개인 오디오 데이터 흐름 (브라우저 → NoiseCraft iframe)

1. `MobileView` 에서 현재 `state`를 가지고 `computePersonalAudioMetrics(state)` 호출 → `{ approachIntensity, nearestProximity, localDensity, clusterEnergy }` 0~1 값 얻기.
2. 이 객체를 node 매핑 레이어에 넘겨서, 매핑 테이블을 기준으로 `NoiseCraftParam[]` 생성.
3. 이미 있는 `postNoiseCraftParams(iframe, origin, params)` 를 통해 iframe으로 전송.
4. 업데이트 빈도는 초당 30~60번 정도로 제한 (예: `requestAnimationFrame` 안에서 타임체크 후 조건부로만 전송).

### 6. 소켓/성능 관점 정리

- **소켓(Server ↔ Client)**
- 새 오디오용 필드를 추가하지 않고, 기존 스냅샷/오디오 메타(`state.audio`) 만 사용.
- 개인 오디오 파라미터는 전부 클라이언트 로컬 계산이라 서버 부담 없음.

- **iframe 통신**
- 여러 논리 파라미터를 한 번의 `NoiseCraftParam[]` 묶음으로 보냄.
- 비슷한 의미의 파라미터는 논리 레벨에서 합친 뒤 **노드 매핑만 복수 노드에 복제**해서, 전체 파라미터 수를 줄인다.

이 계획으로 가면, virtual particle/VirtualSignalGenerator는 “레퍼런스/테스트용”에 머물고, 실제 게임 클라이언트는 **GameState → 0~1 논리 매트릭스 → 노드 범위 매핑 → NoiseCraft** 라인만 쓰게 돼서 구조가 단순해집니다.

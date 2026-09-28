## 개요

`intersection-nextjs`는 Next.js(App Router) 기반 프런트엔드와 Socket.IO 기반 실시간 서버(`realtime/`)를 함께 담고 있습니다. 개발 환경은 Docker Compose, 프로덕션은 단일 컨테이너 이미지로 배포할 수 있습니다.


## 프로젝트 구조

- `src/app/*`: Next.js App Router 페이지 및 컴포넌트
- `src/lib/*`: 게임 상태/소켓/렌더링 유틸리티
- `realtime/`: Socket.IO 실시간 서버(플레이어 1셀 전제, intersection 프로토콜 호환)
- `noisecraft/`: 사운드/오디오 서버(경로 `/audiocraft` 아래 노출)
- `Dockerfile.all-in-one`: 프로덕션 단일 컨테이너 빌드용
- `docker-compose.yml`: 개발용(웹+실시간 동시 기동)

## 개발 실행(Compose)

```bash
docker compose up
```

- 웹: http://localhost:3000/visual
- WebSocket: http://localhost:3001/socket

Compose는 다음을 포함합니다.

- `web`: Next.js dev 서버 (hot reload)
- `game`: `realtime/` 서버 (`tsx watch`로 핫리로드)
- `noisecraft`: 노이즈크래프트 개발 서버 (`npm run watch`)

Next.js App Router는 base path(`/visual`) 아래에서 동작합니다.

브라우저는 반드시 `http://localhost:3001/socket`으로 접속합니다. 내부 통신이 필요하면 `REALTIME_INTERNAL_URL=http://game:3001`을 사용하세요.

Noisecraft 개발 서버 주소는 기본 `http://localhost:4000`이며, 프런트에서는 `NEXT_PUBLIC_NOISECRAFT_WS_URL`로 접근합니다.

### 모바일 컨트롤 방식(권장)

- 모바일은 화면 중앙이 내 셀이며, 드래그 방향/거리만큼 “원하는 속도(vx, vy)”를 서버로 보냅니다(약 30Hz).
- 클라이언트는 즉시 좌표를 갱신하지 않고, 서버가 부드럽게 인터폴레이션한 결과(좌표/속도)를 수신해 렌더링합니다(약 60Hz 브로드캐스트).
- 서버는 받은 원하는 속도에 지수적으로 수렴하도록 가속/감속을 적용해 더 자연스러운 움직임을 구현합니다.
- 글로벌 뷰에서는 `Plane`(월드 전체) / `Lines`(유저별 라인) 프로젝션을 토글할 수 있습니다.
- 개인 뷰는 자신의 셀과 이동 트레일만 표시하며, 다른 플레이어와 만날 때 셀이 빛나고 연결선/충돌 흔적이 생성됩니다. 흔적과 연결선은 글로벌 뷰에서도 동일하게 보입니다.

## 프로덕션 배포(단일 컨테이너)

Next.js를 `standalone`으로 빌드하고, `realtime`도 함께 포함하는 단일 이미지로 배포합니다.

```bash
cd intersection-nextjs
docker build -f Dockerfile.all-in-one -t intersection:all .
docker run --name intersection -p 3000:3000 -p 3001:3001 intersection:all
```

- 웹: http://localhost:3000/visual
- WebSocket: http://localhost:3001/socket

환경 변수(선택)

- `WEB_PORT`(기본 3000), `WEB_HOST`(기본 0.0.0.0)
- `REALTIME_PORT`(기본 3001), `REALTIME_HOST`(기본 0.0.0.0)
- `NEXT_PUBLIC_WS_URL`(기본 http://localhost:3001/socket)

참고: Nginx/Traefik 등 리버스 프록시를 쓸 경우 `/socket` 경로에 대한 WebSocket 업그레이드를 허용해야 합니다.

## 프로덕션(웹만 별도 배포)

## 단일 도메인 경로 분리 배포(/visual, /socket, /audiocraft)

Nginx 리버스 프록시로 단일 도메인 아래 경로를 분리해 배포합니다.

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

- `/visual` → Next.js (intersection 서비스 3000)
- `/socket` → Realtime(Socket.IO, intersection 서비스 3001)
- `/audiocraft` → Noisecraft(Socket.IO/HTTP, noisecraft 서비스 4000)

환경 변수(프론트)

- `NEXT_PUBLIC_WS_URL=/socket`
- `NEXT_PUBLIC_NOISECRAFT_WS_URL=/audiocraft`
- `NEXT_PUBLIC_NOISECRAFT_PATCH_SRC=/audiocraft/public/examples/your_patch.ncft` (선택)
- `NEXT_PUBLIC_NOISECRAFT_PATCH_PROJECT_ID=1234` (선택, NoiseCraft 공유 프로젝트 ID)

관련 파일

- `docker-compose.prod.yml`: proxy + intersection + noisecraft
- `ops/nginx/nginx.conf`: 경로 기반 라우팅(+WebSocket 업그레이드)
- `Dockerfile`: 올인원(Next + Realtime)
- `Dockerfile.noisecraft`: Noisecraft 빌드/런

## 모노레포(Workspaces)

루트 패키지에서 Yarn workspaces로 `realtime`, `noisecraft`를 함께 관리합니다.

```bash
# 워크스페이스 전체 빌드(선택)
yarn ws:build

# 단일 워크스페이스 개발 실행(예: noisecraft)
yarn workspace noisecraft dev
```

Next 빌드 타입체크는 `src/**`만 대상으로 하며 `realtime/**`, `noisecraft/**`는 제외됩니다(tsconfig.json 설정).

웹만 필요하면 기존 `Dockerfile`로 빌드해 배포할 수 있습니다(실시간 서버는 별도 운영).

```bash
docker build -t intersection:web .
docker run -p 3000:3000 intersection:web
```

## 환경 변수(요약)

- `NEXT_PUBLIC_WS_URL`: 브라우저가 접속하는 공개 WS 주소(기본 http://localhost:3001/socket, prod에서는 배포 환경에 맞추어 설정)
- `NEXT_PUBLIC_NOISECRAFT_WS_URL`: NoiseCraft iframe 공개 URL(기본 /audiocraft, dev 기본 http://localhost:4000)
- `NEXT_PUBLIC_NOISECRAFT_PATCH_SRC`: NoiseCraft 임베드가 불러올 .ncft 절대/상대 경로(기본 `/audiocraft/current-project`)
- `NEXT_PUBLIC_NOISECRAFT_PATCH_PROJECT_ID`: NoiseCraft 서버의 공유 프로젝트 ID(위 설정 대신 선택)
- `REALTIME_INTERNAL_URL`: SSR/서버-서버 통신용 내부 주소(예: http://game:3001)
- `PORT`, `HOST`: `realtime`에서 사용(Compose/All-in-one에서 각각 주입)

### NoiseCraft 슬롯 브리지(4채널)

- `realtime` Socket.IO 서버(`/socket`)는 4개의 Noise Slot(0~3)을 유지합니다. 각각은 Self Frequency, Self Gain, Cluster Chord, Cluster Gain
  스트림을 의미하며, 슬롯이 비어 있으면 기본 내장 패치 노드(`0/1/4/6/8/12`)로 되돌아갑니다.
- `noisecraft` 메인 UI(`http://localhost:4000/`) 우측 하단에 “Noise Slots” 패널이 추가되어 있으며, 그래프에서 선택한 노드를 각 슬롯에
  매핑하거나 해제할 수 있습니다. 이 정보는 `/socket`으로 브로드캐스트되고 Next.js 프런트가 슬롯별 값을 계산해 해당 노드에 `SetParam`
  메시지를 전송합니다.

## 프로토콜 호환(핵심 이벤트)

- 클라이언트 → 서버: `respawn`, `gotit`, `0`(하트비트+타겟), `windowResized`
- 서버 → 클라이언트: `welcome`, `serverTellPlayerMove`, `leaderboard`

플레이어는 1개의 셀만 가지며, 서버 payload는 `cells: [{ x, y, radius }]` 형태로 제공됩니다.

## 문제 해결 가이드

- 브라우저가 `game` 호스트로 접속이 안 된다면: 공개 URL을 `http://localhost:3001/socket`으로 설정하세요.
- 소켓 연결 실패: 프록시/방화벽에서 `/socket` WebSocket 업그레이드를 허용했는지 확인.
- 포트 충돌: `WEB_PORT`/`REALTIME_PORT` 수정 후 컨테이너 포워딩을 변경하세요.

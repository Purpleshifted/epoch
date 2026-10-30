# 프로젝트 요약: Parliament of Things (Anthropocene)

## 현재 진행 상태
- Next.js 16 + React 19 + React Three Fiber 기반의 3D 웹 전시 프로젝트입니다.
- `/legacy` 디렉토리에 구버전이 백업되어 있고, 현재 `feature/parliament-of-things` 브랜치에서 작업 중입니다.
- **핵심 목표:** 여러 유저(관객)가 특정 시공간 범위(Global Timespace)에 모이면 절차적 생성(Procedural Generation)으로 콘크리트 구조물이 형성되고, 그 위에 자연 식생이 덧붙는 모습을 3D로 구현합니다.

## 최근 결정된 디자인/로직 (진행 중)
1. **시간축 (y축):** 
   - 절대시간 선형 스케일 유지 (로그 스케일이나 커브 압축 적용 안 함).
   - 유저가 존재하지 않는 '빈 시간'은 블럭을 쌓지 않고 비워둡니다 (추후 이 빈 공간에 자연물/식생이 들어갈 예정).
2. **시점 (카메라):**
   - 글로벌 뷰(`/global/space`) 카메라의 포커스를 플레이어(mobile)가 현재 존재하는 시간대에 맞춥니다.
3. **블럭 생성 조건 (Multi-visitor rule):**
   - `minVisitors=3` 등 3명 이상의 구별된 유저가 같은 시공간 창(`windowSec=600`, `radius=3`)에 있어야 생성됩니다.

## 해결됨: 봇 생성 버그
- 원인: 봇/플레이어 이벤트 emit이 `useFrame`(rAF)에 있었는데, /global/space 탭을 보는 순간 /mobile 탭이 숨겨져 rAF가 멈춤 → 봇이 `minVisitors`에 못 미침. 또 3D 뷰가 wear 포함으로 fold해서 오래된 slab이 사라짐.
- 수정: `useTicker`(Web Worker 타이머) + `dueSamples`(벽시계 기준 backfill)로 emit, `withoutWear`로 히스토리 fold, localStorage 쿼터 초과 시 오래된 이벤트부터 버림, 빈 시간(`emptyGapSec`) 슬롯은 박스 없음.
- 검증: 단위 테스트 70개 통과, 실제 브라우저에서 /mobile(숨김 탭) 봇 5개 → /global/space에 seeds 32 · boxes 149 생성 확인.

## 향후 로드맵
1. 글로벌 3D 뷰에서 박스(구조물) 생성 규칙 및 봇 이슈 완벽 해결
2. 생성된 박스 표면에 텍스처(콘크리트 등 사진 파편) 적용
3. 절차적 자연물(흙, 풀 등) 생성 로직 추가 (빈 시간/공간 채우기)
4. 다른 롤(Role)들(전사, 늑대, 양 등)의 인터랙션 추가
5. Side/Top 뷰 폴리싱

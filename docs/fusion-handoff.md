# 퇴적층의 "융화 · 유기적" 비주얼 — 다른 세션 인계 (2026-10-11)

비주얼 세션(epoch, 브랜치 `feature/parliament-of-things`)에서 길·다리·수로 작업과 분리해, **퇴적층에서 건물과 식생이 융화되는 유기적 비주얼**을 다른 채팅 세션에서 이어가기 위한 정리. 채팅 기록은 세션 간에 공유되지 않으므로 필요한 맥락은 이 문서와 아래 문서에 있음.

## 먼저 읽을 것
- `docs/reference-study-2026-10-10.md` — 1–2장(유기성의 공통 문법: 골조 유지 + 빈 곳을 채움, 껍질, 보로노이 리브, 판/섬유, 가장자리 흩어짐, 곰보, 두 재질), 5–7장(빼기의 유기성 9706–9711, 실·막 9705/9714)
- `docs/leva-guide-3d.md` — 5장(풍화 · 지층), 6장(식생), 8장(엉김 · 융합 · 레진)
- `visual_reference_images/` (gitignored, 로컬) — 유기성: 9645, 9659, 9650, 9648, 9649, 9662, 9666, 9664–9668, 9706–9708, 9711, 9712, 9714

## 작가가 정한 것 / 싫어한 것
- 인간 흔적(건물, 길, 수로, 관, 다리, 레진)은 **무채색**, 색은 자연(식생, 이끼, 부식토)만.
- 레진(가장 오래된 융합층)은 **슬래브와 같은 회색**.
- 융합 덩어리가 건물의 날카로움을 다 잃으면 **"돌무덤"** 같아서 싫음 → 뼈대(직교 구조 유지) 도입.
- 덩어리가 건물과 **분리되어 따로 생기는 것 싫음** → 덩어리는 부재 위에서만.
- 경계가 너무 칼 같은 것 싫음 → 점(모임) → 덩어리(엉김) → 융합 단계로 서서히.
- "현재" 구간이 너무 얇은 것 싫음 → 식생이 먼저 모이고, 모인 양이 차야 부패 시작(아래).
- 식생 점이 층에서 뚝 끊기는 것 싫음 → 시간 방향으로 서서히 사라지게(V2).
- **보류 중**: "빼기의 유기성"(바깥 블록 유지, 안쪽을 파먹음 — 9706–9708) — 작가가 "일단 보류".
- **제안만 함**(결정 안 됨): 화석 단계 "주형(cast) → 빈 틀(mould)": 묻힌 것은 먼저 채워진 주형, 융합층 속에서는 녹아 나가 빈 통로/구멍 — 무작위 공극을 "사라진 것들의 빈 틀"로.

## 지금 구현된 흐름 (한 부재의 일생, 하나의 부식 시계)
1. **식생이 모임** (풍화 · 지층 › 식생이 모이기 시작하는 깊이 · 다 모이기까지): 현재에서 몇 단 아래부터 건물에 식생이 모임(주변 밀도만큼). 그림: 식생 › 건물에 모이는 식생 = 점구름 구(가운데 빽빽, 가장자리 성김).
2. **부패 시작** (부패가 시작되는 모인 양): 모인 밀도 × 함께 묻힌 단이 차면 부식 시작. `seeds.rotOnsetSlots`, `gatherAmount`, `gatherDensity`.
3. **엉김** (엉김 › 덩어리가 붙기 시작하는 부식 정도 → 하나가 되기 시작하는 부식 정도): 부재 위·아래에 작은 덩어리가 점점 껍질로 (`fuse.accretionShare`, 노이즈 문턱).
4. **융합** (fuseOnset → 1): 부재 자체가 덩어리. 장(field) = max(C, gain·blur(C)) + 엉김 + 식생 퇴적 − 공극 − 흩어짐 → surface nets → Taubin 다듬기. 처짐(아래로 흘러내림), 아래층일수록 꽉 차고 젊은 층 가장자리는 흩어짐, 둥근 공극.
5. **뼈대**: 일부 슬래브·살·기단은 녹지 않고 직교 형태로 남아 얇게 감싸임, 최하층에서 결국 삼켜짐 (`fuse.isSkeleton`).
6. **레진**: 퇴적 비율이 높은 가장 오래된 층은 반투명 회색 레진 면 그룹.
7. **식생의 삶과 화석**: 융합이 다가오는 층에서 식생 점이 사라짐(V1: 고르게 줄어듦, V2: 최소 밀도가 올라가 옅은 곳부터, `NatureInput.density`). 식생은 부식토 → 이탄으로 색이 변하고 압밀.

## 관련 Leva (3D 뷰, 지우지 말 것)
| 단 | 항목 |
|---|---|
| 풍화 · 지층 (order 7) | 마모, 지층, 식생이 모이기 시작하는 깊이 / 다 모이기까지 / 부패가 시작되는 모인 양, 풍화 속도, 풍화 오차, 콘크리트·철골 수명, 식생 → 부식토/이탄, 매몰 · 식생 영향(부재가 덮였다고 볼 위층 수, 덮인 부재 감속, 식생이 부식을 빠르게 하는 정도) |
| 식생 (order 6) | 퇴적 식생(점 수·크기, 범위, 식생 매몰층, V2 보이는 최소 밀도, V2 시간 방향 사라지는 구간), 건물에 모이는 식생(구 지름·지터·점 수·점 크기, 칸²당 수) |
| 엉김 · 융합 · 레진 (order 8) | 켜기, 덩어리가 붙기 시작/하나가 되기 시작하는 부식 정도, 덩어리 세기·두께·크기, 다공성, 레진 퇴적 비율; 형태(뼈대 비율·삼켜지는 부식·감싸는 두께, 아래로 처짐, 젊은 층 흩어짐, 구멍 크기, 표면 다듬기); 표면 계산(해상도, 엉김 반경·세기, 표면 문턱, 식생 퇴적물 비중); 레진 재질 |

## 코드 위치
- `apps/web/src/lib/parliament/fuse.ts` — FuseConfig/DEFAULT_FUSE, fusedShare, accretionShare, gatheringShare, isSkeleton, fusePad, fuseChunk(장 → surface nets → Taubin → 면), mergeMeshes
- `apps/web/src/lib/parliament/seeds.ts` — wearModel(나이 캐시), wearParts, rotOnsetSlots, gatherAmount, gatherDensity, partHash
- `apps/web/src/lib/parliament/natureHistory.ts` — 식생 V/P 기록, naturePoints(퇴적·매몰·길·물·밀도 바닥), reclaimPoints/gatherPoints
- `apps/web/src/lib/parliament/spaceModel.ts` — computeParts(부재 흡수: 융합되는 부재는 해시로 사라짐, 뼈대·철골은 남음), computeNature(living / V2 density), computeReclaim(모이는 식생), computeFuse(10단 청크, 캐시, 포커스 가까운 것 먼저)
- `apps/web/src/components/parliament/ParliamentSpace.tsx` — 융합 메시 재질(stone vertexColors / resin MeshPhysical), 점구름 재질, Leva
- 테스트: `fuse.test.ts`, `natureHistory.test.ts`, `spaceModel.test.ts`

## 같은 세션에서 바뀌어 온 것과 겹치지 않게
- 길·다리(`flow.ts`, `walkways.ts`), 수로·관(`water.ts`)은 비주얼 세션이 다룸. 융화 작업에서 이들과 만나는 곳: 융합 덩어리 속에 다리/관이 묻히는 방식(지금은 그냥 겹침) — 손댈 때 비주얼 세션 쪽 규칙(인간 흔적 무채색, 층에 남김)을 지킬 것.
- V1은 2026-10-10 상태로 고정 — 새 동작은 `useParliamentVersion() === "v2"`일 때만 (수로만 예외로 V1에도 적용).
- Leva 저장: 단마다 save / reload 버튼(`components/parliament/levaSave.ts`의 `savable`). 새 단을 만들면 `savable(이름, schema)`로 감쌀 것.

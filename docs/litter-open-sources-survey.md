# 쓰레기 관련 오픈 DB·GitHub·분류체계 광역 조사 (2026-10-06)

세 갈래 조사(DB/데이터셋, GitHub 프로젝트, 분류체계)를 합친 요약. 서브에이전트 샌드박스는 외부 호스트 대부분이 막혀 있어서, **중요한 항목은 직접 curl로 재확인**했다. 표기: **[V]** 직접 호출/열람, **[S]** 검색 요약뿐, **[U]** 미확인.

## 1. 직접 확인한 것 (2026-10-06 00:16–00:21 KST)

| 소스 | 결과 | 태그 |
|---|---|---|
| Open Food Facts API v2 search | 호출됨, 제품 4,794,339개, 최신 `last_modified_t`가 호출 시각과 같은 초. 키 불필요. 첫 호출은 "일시 사용 불가" HTML이 와서 재시도로 통과(불안정) | V |
| OFF 포장 구조 | 최근 수정 100개 중 `packagings`가 채워진 건 14개. 행 18개 중 shape 15, material 15 | V |
| OFF 분류 | `packaging_materials` 309개 항목(수지 단위·복합재 포함), `packaging_shapes` 125개 항목(bottle, lid, bag, wrapper, pizza-box, crown-cork, coffee-capsule, food-can …) | V |
| OFF delta | `static.openfoodfacts.org/data/delta/index.txt` 13개 파일, 최신 구간 끝이 호출 시각보다 약 9시간 앞 | V |
| Wikidata | 검색 API 작동, `cigarette butt = Q199349`, SPARQL 작동 (CC0) | V |
| Litter Intelligence NZ | 사이트 200, `/data/survey?id=…` 형태로 조사 단위가 공개. API·라이선스는 미확인 | V(페이지) / U(API) |
| Litterati 오픈데이터 | `opendata.litterati.org` 접속 실패, `www.litterati.org/opendata` 404. 에이전트 보고서의 "최근 12개월 다운로드 포털"은 **확인 안 됨** | V(실패) |
| Zenodo | API 작동. Plastic Pirates DOI는 보고서마다 달라서 **미확정** | V / U |
| litter-dynamics (Litterati 네덜란드 170만 관측) | README 라이선스는 **CC BY-NC-SA 4.0 (비상업)**. 에이전트의 "데이터 CC-BY-SA" 서술과 충돌 → 비상업으로 취급 | V(README) |
| maple-ridge-open-litter-map | `config/crosswalk.csv` 존재: OLM key → 로컬 그룹/서브그룹, material tag 열 포함 | V |

## 2. 결론 한 줄씩

1. **실시간 + 참여형 + 쓰레기 관측 + 공개 API**는 여전히 OLM뿐이다. 다른 곳은 연 단위 보고서, 정적 스냅샷, 요청제, 접근 불가 중 하나다.
2. **OFF는 쓰레기 관측이 아니라 시장의 포장 제품 DB**다. 단 실시간·참여형이고, 형태(125)×재질(309)이 분리된 분류와 이미지(CC BY-SA)가 있어서 **이름·재질 사전과 이미지 공급처**로 가치가 있다. 빈도 근거로는 쓰면 안 된다.
3. **분류체계**: OLM은 재질을 별도 차원으로 둔다(object별 허용 재질 목록이 `app/Tags/TagsConfig.php`에 있음, GPL-3.0). OLM↔MSFD/OSPAR/UNEP 공개 대응표는 못 찾았다. MSFD G↔OSPAR↔UNEP(Master List Annex 8.1)와 G↔J(Joint List 2021)는 있다.
4. **재질 백본 후보**: JRC Joint List의 9개 재질 클래스(ch ct fw gc me pl pp ru wo). 혼합재는 주성분 재질로 귀속하는 규칙이 있다.
5. **지속성 숫자는 근거가 약하다.** 동료심사 수치는 Chamas 2020(해양 HDPE 반감기 약 58~1,200년, 형상 의존, 본문 미열람)이 거의 유일하다. NOAA "분해 연수" 표는 출처가 불분명한 교육자료다. 개별 품목 연도 대신 4~5개 순서형 클래스 + 불확실성 표기가 방어 가능하다.

## 3. 가장 쓸모 있는 보조 소스

| 용도 | 소스 | 비고 |
|---|---|---|
| 실제 빈도 (도시, 정적) | TACO annotations (4,784개, 60 클래스) | 상위: Cigarette 667, Unlabeled 517, Plastic film 451, Clear plastic bottle 285 … [V] |
| 재질 분기 비율 | TACO | bottle 플라스틱:유리 ≈ 76:24, bottle cap 플라스틱:금속 ≈ 72:28, cup 플라스틱:종이:폼 ≈ 55:35:7 |
| 해변 빈도 (정적) | JRC 2016 | 꽁초 6.14%, 뚜껑 5.3%, 면봉 3.8% … (이미 가진 표) |
| 도시 태그 빈도 (정적, 비상업) | litter-dynamics (Litterati NL 2016–19) | 태그 20,036종, 자유 태그(재질+품목+브랜드 혼재). NC-SA |
| 라이브 OLM 파생 예시 | maple-ridge-open-litter-map | OLM API를 12시간마다 동기화하는 지도, crosswalk 참고용 |
| 이름·재질·이미지 | Open Food Facts | 위 2번 |
| 다국어 이름 | Wikidata | CC0, 빈도·재질 신뢰도 낮음 |
| 재질+품목+질량+생산자를 한 레코드에 | seattletrashproject | 정적, 라이선스 없음, 사이트 403 |

## 4. OLM 샘플 25개 → 재질 초안 (분류체계 에이전트, 요약)

- 낮은 모호도: `other/paper`(pp), `smoking/butts`(pl, 셀룰로오스 아세테이트), `softdrinks/can`·`alcohol/can`(me), `alcohol/bottle`(gc), `softdrinks/lid`·`coffee/lid`(pl), `food/pizza_box`(pp), `food/straw`(pl), `food/container`(pl), `other/plastic_bag`(pl).
- 중간: `softdrinks/bottle`(pl 76 : gc 24), `softdrinks/cup`·`coffee/cup`(pp/pl, 복합), `softdrinks/bottle_cap`(pl 72 : me 28), `food/takeaway_container`, `food/wrapper`, `softdrinks/carton`(복합), `softdrinks/juice_pouch`(복합), `food/box`.
- 높음: `food/packaging`, `other/other`, `food/bag`(`other/plastic_bag`과 중복), `alcohol/bottle_cap`(코르크 소속 불명).
- 복합재(컵, 카톤, 파우치)는 하나의 재질로 접으면 지속성이 왜곡되므로 `composite` 플래그를 따로 두자는 제안.
- 이 표는 에이전트 초안이며 문헌으로 한 줄씩 검증한 것은 아니다.

## 5. 못 한 것 / 주의

- Litterati 오픈데이터 접근, Plastic Pirates 데이터셋 위치, OLM 데이터 라이선스, TIDES/BFFP/KAB 원자료 접근은 미확인.
- 에이전트가 낸 Wikidata Q-ID 중 `cigarette butt`만 확인됐고 나머지는 쓰지 말 것.
- 라이선스 없음 표시 레포는 법적으로 재사용 권리가 없다.
- GitHub 비인증 API 한도에 걸려 일부 레포는 에이전트의 스냅샷 값을 그대로 옮겼다.
- 도시 311 불법투기 피드, 한국 data.go.kr 개별 데이터셋 ID, Clean Coast는 미조사.

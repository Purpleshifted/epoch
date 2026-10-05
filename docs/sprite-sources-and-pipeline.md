# 스프라이트 이미지 소스 & 자동 수집 파이프라인 설계

작성일 2026-10-05 · 미팅용 정리
브랜치 `feature/technofossil-stratum`

> **검증 수준 표기**
> - **[V-GH]** GitHub 원본 파일/API를 직접 읽어 확인
> - **[V-IC]** Iconify `collections.json`(아이콘 셋 라이선스·개수) 기준. 2차 자료지만 기계 판독 가능
> - **[S]** 검색 요약만 확인. **라이브 페이지에서 재확인 필요**
> - **[M]** 기억 기반. 확인 안 됨
>
> 조사 환경에서는 GitHub 외 대부분의 호스트(kenney, OGA, Wikimedia, Met, SI, Poly Haven 등)가 접근 차단이었다. 그래서 아래 상당수가 [S]이다.
> **법률 자문이 아니다.** 한국·EU 자문을 따로 받아야 한다.

---

## 0. 한 줄 요약

1. 구글·빙 이미지 검색 API는 **쓸 수 없다**. 스크래핑 중개 서비스도 법적으로 위험하다.
2. "검색어에 대응하는 최신 이미지를 자동으로 변환·보관"하는 저장소는 **만들 수 있다**. 단, 대상을 **CC0 / 퍼블릭 도메인 / CC-BY 이미지로 한정**해야 안전하다.
3. 그러면 작품 문장은 "그 검색어로 세계가 가장 최근에 올린, 자유 이용 가능한 이미지"가 된다. 이 문장은 정직하고 방어 가능하다.
4. 정적 라이브러리(Quick, Draw!, game-icons, DCSS, 이모지 3종 등)만으로도 290개 스프라이트 목표는 충분히 채울 수 있다. 동적 수집은 **그 위에 얹는 층**으로 보는 게 현실적이다.

---

## 1. 정적 이미지 라이브러리

레이어: **A** 포장재·플라스틱 / **B** 전자제품 / **C** 뼈·조개·음식 / **N** 자연(식물·동물)

### 1.1 권장 조합 (8개)

| # | 소스 | 라이선스 | 스프라이트 잠재량 | 레이어 | 비고 |
|---|---|---|---|---|---|
| 1 | **Quick, Draw!** | CC BY 4.0 [V-GH] | 300+ (클래스 × 변형) | A B C N | 28×28 원본. 같은 물건의 손그림 변형이 수천 개라 **다양성 확보에 최적** |
| 2 | **game-icons.net** | CC BY 3.0, 일부 CC0 [V-GH] | 300–400 | A B C N | 4,133 SVG. 작가별 크레딧 필수 |
| 3 | **DCSS tiles** | CC0 (단, 미승인 목록 제외) [V-GH] | 150–300 | C N | 32×32 네이티브 픽셀. `TILES_UNDER_UNKNOWN_LICENSE.md`에 있는 건 제외 |
| 4 | **Fluent + Noto + Twemoji** | MIT / Apache-2.0 / CC BY 4.0 | 스타일당 150–250 | A B C N | 같은 물건을 3가지 스타일로 → 변형 확보 |
| 5 | **Smithsonian Open Access** | CC0(표시된 항목만) [S] | 200–500 | B C N | NMAH(옛 전자제품·초기 플라스틱), NMNH(조개·뼈) 실물 사진 |
| 6 | **TrashNet** | MIT [V-GH] | 100–300 | A | 흰 판 위 구겨진 캔·병·종이. 배경 제거 쉬움. 6개 큰 분류뿐 |
| 7 | **Openclipart + Health Icons** | CC0 [S] / MIT [V-IC] | 150–300 | A B C | 대상 범위가 가장 넓음. 품질 편차 큼, 출처 점검 필요 |
| 8 | **3D 렌더**: GSO, ABO, Poly Haven, Kenney 3D, Quaternius, Smithsonian 3D | CC BY 4.0 / CC0 | 모델 1,000 × 각도 4–8 = 수천 | A B C N | 여러 각도로 렌더해 변형 확보 |

1~4번만으로도 목표 290개에 근접한다.

### 1.2 카테고리별 상세

**폐기물 데이터셋**

| 이름 | 내용 | 라이선스 | 판단 |
|---|---|---|---|
| TrashNet | 사진 2,527장, 6분류 | **MIT** [V-GH] | A 레이어에 적합 |
| TACO | 1,500장, 60분류, 폴리곤 | **이미지별 혼재** [V-GH] | **재배포 금지, 참고용만** (아래 정정 참조) |
| RealWaste (UCI) | 4,752장, 9분류 | CC BY 4.0 [S] | 분류가 너무 굵음 |
| Open Images V7 | 마스크 280만 개 | 주석 CC BY 4.0, 이미지는 **이미지별 CC BY 2.0** [S] | 크레딧 관리 부담 큼 |
| ZeroWaste | 4,503프레임 | CC BY-NC 4.0 [S] | **사용 불가 (NC)** |
| Trash-ICRA19 / TrashCan | JAMSTEC 영상 기반 | 학술용, 재배포 금지 [S] | **사용 불가** |

**픽셀·스프라이트·아이콘 팩**

| 이름 | 라이선스 | 비고 |
|---|---|---|
| Quick, Draw! | CC BY 4.0 [V-GH] | 345분류. **빈 곳**: 음료 캔, 비닐봉지, 일반 병(와인병만 있음) |
| game-icons.net | CC BY 3.0 / 일부 CC0 [V-GH] | 병뚜껑·깨진 병·소다캔·과자봉지·담배·배터리·CPU·스마트폰·물고기뼈·두개골·조개·암모나이트 등 |
| DCSS tiles | CC0 (조건부) [V-GH] | 약 4,075개 타일. 음식·동물·해골·뼈 |
| Kenney 2D | CC0 [S] | 스타일 참고·보조용. 폐기물은 적음 |
| Fluent Emoji | MIT [V-GH] | SVG·PNG 투명. 3D 변형이 32px에서도 좋음 |
| Noto Emoji | Apache-2.0 (`2D/svg`) [V-GH] | 루트 LICENSE는 OFL이라 불일치. **SVG만 사용** |
| Twemoji (jdecked) | 그래픽 CC BY 4.0 [V-GH] | 크레딧 필요 |
| Health Icons | MIT [V-IC] | README는 CC0라고 하나 MIT로 표기. 약·주사기·마스크 등 40–60개 |
| Openclipart | CC0 [S] | 약 18만 개. 사이트 안정성 낮음. **라이브 확인 필요** |
| Tabler / Lucide / Phosphor / Material | MIT·ISC·Apache | 선이 가늘어 16px에서 죽음. 채움 변형만 사용 |
| OpenMoji, Fruits-360, Open Food Facts, Arcticons, Entypo+ | **CC BY-SA** | **사용 불가 (ShareAlike)** |

**박물관·공공 컬렉션**

| 이름 | 라이선스 | 접근 | 비고 |
|---|---|---|---|
| Smithsonian Open Access | CC0 (표시 항목) [S] | AWS S3 벌크 / API(무료 키) | **가장 좋은 박물관 소스** |
| Met Open Access | CC0 [V-GH] | 키 없는 API. v1.1 사용 권장 [S] | 도자기 조각·유리병·단추·열쇠 |
| Rijksmuseum | 대부분 CC0 [S] | 새 API 2026 [S] | 유물류 |
| Cleveland, Art Institute of Chicago | CC0 [S] | API | 일상 물건은 적음 |
| Europeana | 항목별 권리 | 무료 키 | `reusability=open` 필터 |
| Wikimedia Commons | **파일별** | MediaWiki API | PD/CC0만 수용. 가장 다양 |
| Wellcome, USDA Pomological, BHL | 혼재 / PD | API / 포털 | 해부·과일·판화 |
| PhyloPic | 이미지별 | REST | CC0만 필터. N 레이어 |
| iNaturalist Open Data | 사진별 | `s3://inaturalist-open-data` | CC0/CC BY만 |

**제품·물체 사진 데이터셋**

| 이름 | 라이선스 | 비고 |
|---|---|---|
| ABO (Amazon Berkeley Objects) | **CC BY 4.0로 변경됐다는 요약만 있음** [S] | 흰 배경 제품 사진 약 40만 장. **레지스트리 페이지에서 확인 필수** |
| Google Scanned Objects | CC BY 4.0 [S] | 1,030개 가정용품 3D |
| Objaverse / XL | 객체별 | CC0·CC BY만 필터 |

**3D 소스**: Poly Haven(CC0 [S]), Kenney 3D(CC0 [S]), Quaternius(CC0 [S]), Smithsonian 3D(CC0 [S]), Sketchfab(모델별), Poly Pizza(모델별 혼재).

### 1.3 이전 조사 정정

- **TACO는 CC BY 4.0이 아니다.** 검색 요약은 CC BY 4.0이라고 했으나 `annotations.json`을 직접 읽어보니 `licenses` 배열이 비어 있고, 이미지별로 715장 None, 466장 ODbL(OpenLitterMap), 319장 "CC"(버전 불명)이다. 사진은 절대 커밋하지 않는다.
- **Noto Emoji**는 루트 LICENSE(OFL)와 README(Apache 2.0)가 불일치한다. `2D/svg/LICENSE`가 Apache 2.0이므로 SVG를 쓴다. `2D/png/*`는 미확인.
- **ABO**는 원래 CC BY-NC였다.

### 1.4 라이선스 운영 원칙

- CC BY / MIT / Apache 소스는 빌드 시 `CREDITS.md`를 자동 생성한다 (소스, 파일, 작가, 라이선스, URL).
- 16색 양자화는 "수정"에 해당하므로 CC BY 요건상 변경 표기를 넣는다.
- SA / NC / ND는 제외한다.
- 원본 사진(TACO, JAMSTEC, OSPAR)은 저장소에 넣지 않는다.

---

## 2. "검색어 → 최신 이미지 → 픽셀화 → 저장" 자동 수집

### 2.1 일반 웹 이미지 검색 API (2026-10 기준)

| API | 상태 | 평가 |
|---|---|---|
| Google Custom Search JSON API | **신규 가입 차단, 기존 고객도 2027-01-01 종료** [S] | 사용 불가 |
| Bing Image Search API | **2025-08-11 종료** [S] | 사용 불가 |
| Brave Search API (이미지) | 운영 중, 1,000회당 약 \$5 [S]. **기본 약관은 저장·ML 이용 금지, "Storage Rights" 요금제 필요** [S]. 날짜순 정렬 파라미터 없음 [S] | 기술적으로는 가장 근접하나 저장 권리는 유료·계약 의존. 가격 미확인 |
| SerpApi / Serper / SearchAPI | 운영 중. **Google이 2025-12 SerpApi를 DMCA §1201로 제소, 2026-07 일부 기각, 8월 재청구 보도** [S] | 소송 진행 중. 이미지 저작권 자체는 해결되지 않음. **회피** |
| DuckDuckGo | 공식 이미지 API 없음 [S] | 스크래핑은 약관 위반. 사용 불가 |
| Yandex Search API | 공식 API 있음 [S] | 제재·평판 리스크. 비권장 |

결론: **오픈 웹 이미지를 "저장·변환할 권리"와 함께 주는 API는 사실상 Brave 유료 티어뿐**이고, 그것도 이미지 저작권을 정리해 주지는 않는다.

### 2.2 오픈 라이선스 소스 (검색 + 최신순 가능)

| 소스 | 최신순 정렬 | 라이선스 필터 | 저장 관련 약관 | 비고 |
|---|---|---|---|---|
| **Wikimedia Commons** | `gsrsort=create_timestamp_desc` [S/M]. 또는 `generator=allimages&gaisort=timestamp&gaidir=descending` [S] | `extmetadata`의 `LicenseShortName` 등으로 **클라이언트에서 필터** [S] | 파일별 라이선스. 출처 표기 필수 [S] | **1순위.** 키 불필요. User-Agent 필수, 직렬 요청 |
| **Openverse** | `unstable__sort_by=indexed_on` [S/M]. **업로드일이 아니라 Openverse가 색인한 날짜** | `license=cc0,pdm,by`, `mature=false` [S/M] | 카탈로그 스크래핑 금지 [S] | `unstable` 접두사 = 변경될 수 있음. 호출 한도 수치는 요약 간 상충 [?] |
| **Flickr** | `sort=date-posted-desc` [S] | `license=4,9,10` (CC BY, CC0, PDM) [S/M] | **"합리적 기간만 캐시, 영구 저장소 금지" 취지 [S]** | 스프라이트 영구 보관과 **충돌 소지**. ToS 직접 확인 필요 |
| **iNaturalist / GBIF** | `order_by=created_at` [S] | `photo_license=cc0,cc-by` [S] | 호출 1회/초 권장, 미디어 5GB/시간 이하 [S] | 생물만 해당 (뼈·조개). 병·폰은 불가 |
| Unsplash | | | **다운로드 저장 금지, 핫링크 필수** [S] | **제외** |
| Pexels | | | 대량 오프라인 데이터셋·AI 학습 금지 [S] | **제외** |
| Pixabay | | | 자체 저장 요구 [S]. 오픈 라이선스 아님 | 보조 후보. 약관 본문 미확인 |
| Smithsonian / Met / Europeana | 최신 개념 없음 | CC0 / 항목별 | | **보관용·fallback** ("과거의 병") |

### 2.3 법적 현실 (자문 아님)

**비교적 분명한 것**
1. 축소·픽셀화한 복사본도 **원본의 복제 또는 개작**이다. CC 라이선스는 이를 개작으로 본다. CC BY는 크레딧과 변경 표기가 필요하고, **CC BY-SA는 결과물에 같은 라이선스를 강제**한다. → SA·NC·ND 제외.
2. CC0 / PD는 허락이 필요 없다. 크레딧은 관행상 남긴다.
3. **EU DSM 지침 제3조(연구기관·문화유산기관, 옵트아웃 불가) / 제4조(누구나, 기계 판독 가능 옵트아웃 존중)**. 함부르크 고등법원이 Kneschke v. LAION(2025-12)에서 제3조 적용과 "기계 판독형 옵트아웃만 유효"를 판시했다고 보도됨 [S]. **다만 TDM 예외는 분석용이지 변환본을 공중에 전시할 권리가 아니다.** 전시되는 스프라이트에는 의존하지 않는다.
4. **CJEU Pelham II (C-590/23), 2026-04-14**: "패스티시"는 원작과의 "예술적·창작적 대화"가 객관적으로 인식돼야 한다 [S]. 서로 무관한 사진 수천 장을 픽셀화하는 것은 약한 논거다. 계획으로 삼지 않는다.
5. **한국**: 공정이용은 현행 **저작권법 제35조의5**이다 (구 제35조의3에서 2019-11 개정으로 번호 변경, 현 제35조의3은 부수적 복제) [S]. 4요소 개별 판단. 한국에는 별도 TDM 예외 없음 [S, 요약 1건]. 픽셀화 썸네일 관련 한국 판례는 확인하지 못했다.
6. **미국**: 검색 썸네일 공정이용(Kelly v. Arriba, Perfect 10 v. Amazon) [M]. Warhol v. Goldsmith(2023)로 변형적 이용 범위가 좁아졌다 [M]. EU·한국에는 같은 형태로 적용되지 않는다.
7. 전시 자체가 면책을 만들지는 않는다. 다만 비영리·변형적·소규모·낮은 시장 침해는 판단에서 유리하다. **공개 GitHub 저장소에 올리면 누구나 재배포할 수 있으므로** 파일마다 맞는 라이선스가 필요하다.
8. 별개 권리: **초상권/GDPR(사람 얼굴)**, 상표·로고. → 사람이 나온 이미지와 로고는 걸러낸다.

**불확실한 것**
- 32×32, 16색 스프라이트가 "복제"에 해당하는지. 이 크기에서는 보호받는 표현이 거의 남지 않지만 이를 확정하는 근거를 찾지 못했다. **의존하지 않는다.**
- "검색어별 최신 이미지" 워크플로가 제35조의5·패스티시·인용에 기댈 수 있는지. **기대하지 않는다.**

### 2.4 가장 안전한 설계 (개념은 유지)

1. **CC0 / PDM / CC-BY(4.0 우선)만** 사용: Commons → Flickr → iNaturalist·GBIF → Openverse.
2. **원본은 보관하지 않는다.** 메모리/임시 폴더에서 처리 후 삭제. 원본 SHA-256과 URL만 남긴다.
3. 스프라이트마다 **출처 JSON**(아래 스키마)을 저장하고, `/credits` 페이지를 자동 생성한다.
4. **해시 중복 제거**: 원본 SHA-256 + 스프라이트 pHash.
5. **삭제 요청 경로**: `/takedown` 페이지와 스프라이트별 `status`(active / retired / takedown). 라이선스 재검증 주기 실행.
6. **걸러낼 것**: 사람·얼굴, 텍스트, 워터마크, 로고, NSFW.
7. 전시 전에 **한국·EU 자문 1회**를 받는다.
8. 저장소 라이선스: 코드 MIT, 스프라이트·데이터 CC-BY + 제3자 크레딧 목록.

### 2.5 파이프라인

```
스케줄러 → 검색(Commons 등) → 후보 N개 → 필터 → 배경 제거 → 정사각 크롭
→ 축소 → 16색 양자화 → 외곽선 → 저장 + 출처 JSON → atlas.json 갱신 → 원본 삭제
```

| 단계 | 선택지 | 비고 |
|---|---|---|
| 스케줄 | **GitHub Actions cron** (공개 저장소 무료) [S] | 최소 5분, 지연·누락 가능. **60일간 저장소 활동이 없으면 중단됨** [S] → 결과를 커밋하거나 keep-alive. 대안: VPS(약 €5/월) |
| 배경 제거 | **rembg**(MIT) + `isnet-general-use`/`u2net`(Apache-2.0) [S] | CPU 0.5–3초/장 [M]. BiRefNet(MIT)은 더 정확하나 느림 [M] |
| 배경 제거 (피할 것) | BRIA RMBG (**CC BY-NC**) [S], `@imgly/background-removal` (**AGPL 보고**) [S] | 공개 저장소·앱에 쓰면 의무 발생 |
| 배경 제거 (대안) | OpenCV GrabCut(Apache-2.0), Apple Vision(맥 전용) [M] | 보조 |
| 양자화 | **Pillow만으로 충분** (`quantize(palette=…, dither=NONE)`) | pyxelate(MIT)는 의존성 무거움 [S]. ImageMagick `-remap`도 가능 |
| 팔레트 | EGA/VGA 16색 | `000000 0000AA 00AA00 00AAAA AA0000 AA00AA AA5500 AAAAAA 555555 5555FF 55FF55 55FFFF FF5555 FF55FF FFFF55 FFFFFF` — 약한 출처(Reddit 요약)[S]. 코드베이스의 `PALETTE_HEX`와 일치하는지 대조 |
| 저장 | **저장소 파일 + `atlas.json`** 권장. 선택적으로 Cloudflare R2(10GB 무료 [M]) 미러 | 32×32 팔레트 PNG는 0.3–1KB |
| 버전 | `epoch`(생성 시각) 단위로 `sprites/<slug>/<epoch>.png`. 최근 N개 보관 | **옛 이미지가 퇴적층처럼 쌓이는 구조**가 작품과 맞음 |

**품질 필터**
- 피사체 마스크가 프레임의 15–85%, 연결 성분 하나가 지배적
- CLIP 제로샷 `"a photo of a {term}"` 유사도 임계값 (open_clip MIT; 가중치 라이선스 확인)
- 사람·얼굴 검출 (OpenCV, MediaPipe Apache-2.0). YOLO는 AGPL이므로 피한다
- OCR(Tesseract Apache-2.0)로 텍스트 면적 3% 초과 시 제외
- NSFW 분류기 + Flickr `safe_search=1`, Openverse `mature=false`
- 짧은 변 400px 이상, 극단적 종횡비 제외

**시각적 일관성**: 32×32 고정, 마스크 바운딩박스 정사각 크롭, 같은 패딩, 같은 16색, 1px 검정 외곽선, 디더 없음, 양자화 전에 자동 대비 + 채도 약 1.2배.

**실패 모드**
- API 변경(Openverse `unstable_*`) → Commons 정렬로 fallback
- 통과하는 이미지가 없음 → 마지막 스프라이트 유지 + 로그
- 배경 제거 실패 → GrabCut 또는 후보 건너뛰기
- 엉뚱한 물체 → CLIP 임계값 + top-k 투표
- 라이선스 오표기 → `extmetadata` 재확인, `licence_checked_at` 기록
- "최신"의 기준이 소스마다 다름(Commons·Flickr=업로드, iNat=`created_at`, Openverse=`indexed_on`) → **어느 기준을 썼는지 기록**

### 2.6 설계안 비교

| | **A. 자유 이용 이미지만 (권장)** | **B. A + Brave 오픈 웹** |
|---|---|---|
| 출처 | Commons, Flickr, iNat/GBIF, Openverse (CC0·PDM·CC-BY) | A + Brave 이미지 검색 |
| 작품 문장 | "세계가 가장 최근에 올린 **자유 이용 가능한** 이미지" | "웹의 최신 이미지" |
| 법적 위험 | 낮음 | **높음.** 이미지 저작권 미해결 + 저장 권리는 유료 계약 |
| 개념 충실도 | 중상. "cigarette butt"처럼 드문 검색어는 후보가 며칠~몇 주 간격일 수 있음. 이것도 하나의 진술 | 높음. 단 Brave에는 날짜 정렬이 없어 "최신"은 근사값 |
| 비고 | 바로 만들 수 있음 | **변호사 검토 없이는 비권장.** 전시장 내부 한정 + 원본 비보관 + 삭제 경로 등 완화책 필요 |

### 2.7 출처 JSON 스키마 (스프라이트당 1개)

```json
{
  "schema_version": 1,
  "sprite_id": "plastic-bottle_2026-10-05T10:00:00Z_9f2c1a",
  "item_slug": "plastic-bottle",
  "search_term": "plastic bottle",
  "epoch": "2026-10-05T10:00:00Z",
  "pipeline": {
    "git_sha": "abc1234",
    "bg_removal": {"tool": "rembg", "model": "isnet-general-use"},
    "sprite": {"size": [32, 32], "palette": "vga16", "dither": "none", "outline": true},
    "filters": {"clip_score": 0.31, "person": false, "text_area": 0.0, "nsfw": 0.01, "mask_coverage": 0.42}
  },
  "source": {
    "provider": "wikimedia_commons",
    "landing_url": "https://commons.wikimedia.org/wiki/File:Example.jpg",
    "recency_basis": "upload_timestamp",
    "source_timestamp": "2026-10-05T08:12:44Z",
    "retrieved_at": "2026-10-05T10:01:02Z",
    "original_sha256": "…"
  },
  "licence": {
    "spdx": "CC-BY-4.0",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "creator": "Jane Doe",
    "credit_line": "“Example” by Jane Doe, CC BY 4.0, via Wikimedia Commons; converted to a 32×32 16-colour sprite.",
    "licence_checked_at": "2026-10-05T10:01:03Z",
    "modifications": ["background removed", "cropped", "downscaled to 32x32", "quantised to 16 colours"]
  },
  "artifacts": {"sprite_png": "sprites/plastic-bottle/2026-10-05T10-00-00Z.png", "sprite_phash": "…", "raw_retained": false},
  "status": "active"
}
```

`atlas.json`: `slug → {epoch, sprite_png, atlas_index, provenance_json, licence_spdx}`.

---

## 3. 미팅에서 정해야 할 것

1. **개념 문장을 "자유 이용 가능한 최신 이미지"로 받아들일 수 있는가?** (안 A) 아니면 오픈 웹 전체가 꼭 필요한가? (안 B, 법적 검토 필수)
2. **정적 라이브러리를 기본 층으로, 동적 수집을 그 위에 얹는 구조**로 갈 것인가? 정적만으로 290개를 채울 수 있다.
3. 동적 수집의 **대상 범위**: 290개 전부인가, 일부 대표 품목만인가? (분류가 Quick, Draw!·이모지로 이미 있는 것과의 중복)
4. **크레딧 표시 방식**: 캔버스 안에는 텍스트를 넣지 않기로 했다. 크레딧은 별도 `/credits` 페이지에만 둔다.
5. 전시 전 **법률 자문**을 받을 수 있는가 (한국 + EU).
6. 기존 열린 결정 (`docs/catalogue-v2.md` §8): 레이어 비율(A 70 / B 10 / C 20), 자연 스톡 규모, 자연 스톡의 회차별 초기화 여부 등.

## 4. 재확인이 필요한 항목

- Openverse `unstable__sort_by=indexed_on` 동작과 현재 호출 한도 (실제 호출로 확인)
- Flickr API ToS의 저장·AI 이용 조항, 시간당 호출 한도
- Brave "Storage Rights" 제공 여부와 가격
- Pixabay 약관 본문
- `@imgly/background-removal` 라이선스 (AGPL 보고)
- TempleOS 팔레트 값 (TempleOS 소스 대조)
- ABO 현재 라이선스, Poly Haven 모델 수·폐기물 유사 모델, Smithsonian CC0 필드명·S3 버킷, Openclipart 안정성·벌크 접근, Met `/v1.1/search`, Commons 카테고리명, RealWaste UCI id, Noto `2D/png/*` 라이선스, Quick Draw GCS URL, GSO·Objaverse 라이선스 문구
- 한국 판례 및 한국 변호사 의견(제35조의5), CJEU Pelham II 판결문 원문
- SerpApi 소송 현황
- Pillow 샘플 코드는 아직 실행해 보지 못했다

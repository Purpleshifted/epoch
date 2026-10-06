-- Build the artwork-explanation slides in progress-deck.key.
-- Backup before running: brain/.../scratch/progress-deck.before-artwork-slides.key
-- Template = slide 3 (table + bullets + footnote). New slides are appended, then moved after slide 3.
set R to return
set IMG to "/Volumes/Hesse/exhibition/anthropocene/docs/img/"

on J(L)
	set AppleScript's text item delimiters to return
	set r to L as text
	set AppleScript's text item delimiters to ""
	return r
end J

on setT(s, n, txt)
	tell application "Keynote" to set object text of iWork item n of s to txt
end setT

-- append a copy of the template; Keynote puts the duplicate at the END of the deck.
on newSlide(d)
	tell application "Keynote"
		set cnt to count of slides of d
		duplicate slide 3 of d
		if (count of slides of d) is not (cnt + 1) then error "unexpected slide count"
		set k1 to object text of iWork item 1 of slide (cnt + 1) of d
		set k0 to object text of iWork item 1 of slide 3 of d
		if k1 is not k0 then error "duplicate is not at the end: " & k1
		return slide (cnt + 1) of d
	end tell
end newSlide

on fillTable(s, rowsData, widths, fsz, tx, ty)
	tell application "Keynote"
		set t to table 1 of s
		set nr to count of rowsData
		set nc to count of item 1 of rowsData
		set column count of t to nc
		set row count of t to nr
		repeat with r from 1 to nr
			repeat with c from 1 to nc
				set value of cell c of row r of t to (item c of item r of rowsData)
			end repeat
		end repeat
		repeat with c from 1 to nc
			set width of column c of t to (item c of widths)
		end repeat
		repeat with r from 1 to nr
			repeat with c from 1 to nc
				set font size of cell c of row r of t to fsz
				if r > 1 then set text color of cell c of row r of t to {65535, 65535, 65535}
			end repeat
		end repeat
		set position of t to {tx, ty}
	end tell
end fillTable

on addImg(s, p, x, y, w)
	tell application "Keynote"
		tell s
			make new image with properties {file:(POSIX file p), position:{x, y}, width:w}
		end tell
	end tell
end addImg

tell application "Keynote"
	set d to front document
	set oldCount to count of slides of d

	---------------- edits to existing slides (original indices) ----------------
	my setT(slide 1 of d, 11, "Changed direction" & R & "과거(깊은 시간의 지표 화석)는 구현에서 뺀다. 지층에는 방문자들이 남긴 것만 쌓인다." & R & "인위적 유기물(뼈·조개·숯·음식)을 포함한다." & R & "원래 있던 자연: 영역(밀도 필드)으로 두고, 걸음·머묾·쌓인 물건에 닳는다. 땅은 얕은 연안.")

	my setT(slide 2 of d, 13, my J({"•  레이어(포장재·전자·유기물) 비율 × JRC 품목 빈도", "•  방문자는 고르지 못함 — 추첨"}))
	my setT(slide 2 of d, 16, my J({"•  재질마다 수명이 다름 (로그균등)", "•  위에 쌓이면 분해가 50배 느려짐 (추정)", "•  묻힌 채 50년 넘으면 화석 후보", "•  연한 유기물은 1초 안에 사라짐"}))
	my setT(slide 2 of d, 18, "자연 필드")
	my setT(slide 2 of d, 19, my J({"•  칸마다 식생·조류·패류 등의 밀도 (설계)", "•  걸음·머묾·쌓인 물건이 밀도를 깎음", "•  쉬면 회복, 과거 부하가 클수록 느림"}))

	my setT(slide 5 of d, 4, my J({"•  [사용] 스프라이트: Twemoji (CC BY 4.0) · Noto Emoji SVG (Apache-2.0) · Fluent Emoji (MIT) · game-icons.net (CC BY 3.0) · DCSS 타일 (CC0, 작가 확인분만). 16색 24×24로 변환, 크레딧 자동 생성", "•  [사용] 팔레트·규칙: TempleOS 16색 VGA 팔레트 (규칙만 차용), 자연물용 흙색 하위 팔레트", "•  [사용] 빈도·수명: JRC 유럽 해변 쓰레기 2016 (Addamo 외), 재질 지속성 문헌", "•  [사용] 접촉 → 새 객체: Corcoran 2014 · Turner 2019 · Gestoso 2019 · Young 2009 (docs/hybrid-objects-research.md)", "•  [사용] 연안 밀도 필드: Cole 1995 · Pescott & Stewart 2014 · Carr 2010 · Green 2015 · Diaz & Rosenberg 2008 (docs/coastal-fields-research.md)", "•  [실험] Wikimedia Commons (CC0·PD·CC BY) → Sprite Lab. 본 작품에는 아직 연결 안 됨"}))

	my setT(slide 9 of d, 6, my J({"•  카탈로그 v2 (148 + 18 품목)", "•  추첨(빈도만) · 운명(수명·매몰·화석) · 테스트 73개", "•  저해상도 렌더 + 16색 팔레트 셰이더", "•  스프라이트 프로토타입: 67/148 품목, 변형 247개", "•  모바일 = 세션만 보이는 빈 땅, Top·Side = 누적 + 수동 리셋", "•  “나” = 깜박이는 커서 · 머문 시간만큼 자연물 마모"}))
	my setT(slide 9 of d, 9, my J({"•  자연물 → 영역 밀도 필드 (연안)", "•  자연 회복 · 과거 의존", "•  접촉 → 새 객체 (불 이벤트 미정)", "•  수명·퇴장 (10초~3분)", "•  모바일 완전 16색 · 약한 스프라이트 교체 (81품목)", "•  칩 사운드 · 크레딧 페이지"}))
	my setT(slide 9 of d, 12, my J({"•  1. 자연 밀도 필드: 초목·조류·패류 (마모 + 회복)", "•  2. 접촉 → 새 객체 규칙", "•  3. 수명·퇴장, “나”의 풍화", "•  4. 스프라이트 보강", "•  5. 칩 사운드", "•  6. 크레딧 페이지"}))

	my setT(slide 10 of d, 4, my J({"•  웹 이미지 소스 어떻게 할 것인가…", "•  땅의 지역: 유럽 얕은 연안 (JRC 데이터 기준) 유지 vs 한국 연안 (빈도 데이터를 새로 구해야 함)", "•  불 이벤트를 넣을 것인가? (plastiglomerate · pyroplastic · dark earth에 필요) → 제안: 방문자 수명이 끝나는 순간", "•  레이어 비율 70/10/20을 확정할 것인가", "•  수치를 문헌에 따라 어떻게 보정할지 (지금은 순위만 문헌 기반)", "•  자연 필드의 시각 표현: 점 밀도 + 색 (제안)", "•  크레딧 표시: 캔버스에는 텍스트를 넣지 않으므로 별도 페이지에만 둘 것인가?"}))

	---------------- N1: what gets scattered ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · SCATTER")
	my setT(s, 2, "무엇이 뿌려지는가 — 정한 방식과 이유")
	my setT(s, 6, "코드: lib/stratum/sample.ts, items.ts · 문서: docs/catalogue-v2.md")
	my setT(s, 5, "")
	my fillTable(s, {{"정한 방식", "이렇게 한 이유", "근거", "확인 수준"}, ¬
		{"품목 빈도 = JRC 유럽 해변 쓰레기 실측 표 (238행 → 106품목)", "상상한 쓰레기가 아니라, 실제로 해변에 남는 것의 비율", "Addamo, Laroche & Hanke 2017 (JRC)", "표 전체 추출 · 행별 대조는 안 함"}, ¬
		{"레이어 비율 포장재 70 / 전자 10 / 유기물 20", "해변 조사에는 전자제품·음식물이 거의 없음 → 기술권의 다른 얼굴을 보이려고 작가가 정함", "작가의 진술", "추정 (EST.)"}, ¬
		{"방문자는 품목을 고르지 못하고 추첨됨", "“내가 무엇을 남길지는 내가 정할 수 없다”", "자문 피드백", "—"}, ¬
		{"1m 걷거나 1.5초 멈추면 1개 뿌림", "걷는 것 자체가 흔적. 멈춰 있어도 계속 남김", "설계 결정", "값은 조정 가능"}, ¬
		{"같은 품목도 변형 2~4개", "같은 물건도 다르게 보여야 땅이 단조롭지 않음", "설계 결정", "—"}}, {250, 270, 190, 150}, 12, 50, 120)

	---------------- N2: sprites ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · SPRITES")
	my setT(s, 2, "스프라이트는 이렇게 정했다")
	my setT(s, 6, "현재 아틀라스 228칸 (docs/img/sprite-sheet-preview.png) · 출처·라이선스: CREDITS.md · 변환 규칙: tools/sprites/build_atlas.py")
	my fillTable(s, {{"정한 것", "이유"}, ¬
		{"사진이 아니라 오픈 아이콘 사용 (Twemoji · Noto · Fluent · game-icons · DCSS)", "재배포 가능한 라이선스(CC BY · MIT · Apache · CC0). 출처는 크레딧에 자동 기록"}, ¬
		{"품목 → 아이콘 연결은 사람이 직접 고른 표", "검색어로 자동 수집하지 않음. 물건이 어떻게 보여야 하는지는 작가의 판단"}, ¬
		{"24×24 칸 안 20×20 · 16색 · 내부 디더 없음", "TempleOS 16색: 제한된 팔레트 = 압축 = 화석화의 비유"}, ¬
		{"어두운 스프라이트에만 회색 외곽선", "검은 배경에서도 읽히게"}, ¬
		{"148품목 중 67개가 고유 스프라이트(247변형), 81개는 같은 재질 것을 빌림", "현재 상태 그대로. 약한 것부터 교체 예정"}}, {170, 260}, 12, 495, 118)
	my setT(s, 5, "")
	tell application "Keynote" to delete iWork item 5 of s
	my addImg(s, IMG & "sprite-sheet-preview.png", 52, 118, 400)

	---------------- N3: lifespan ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · LIFESPAN")
	my setT(s, 2, "수명: 재질마다 다른 속도로 사라진다")
	my setT(s, 5, my J({"•  시계: 놓인 지 10초 = 25년 · 100초 = 500년 · 1시간 = 6만 년 · 8시간 = 100만 년 (로그 압축)", "•  왜 로그인가: 선형으로 두면 종이와 병의 차이가 보이지 않음. 압축해야 재질의 순서가 초 단위로 보임"}))
	my setT(s, 6, "수명 범위는 추정(EST.), 재질 간 순서만 문헌 기반 (종이 < 직물 < 목재 < 필름 < 발포 < 경질 플라스틱 < 금속 < 유리·도자기) · 코드: materials.ts, geoClock.ts")
	tell application "Keynote"
		delete table 1 of s
		set position of iWork item 4 of s to {52, 418}
	end tell
	my addImg(s, IMG & "deck/fig_lifespan.png", 100, 112, 760)

	---------------- N4: stages ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · FATE")
	my setT(s, 2, "사라지는 과정: 단계마다 보이는 모습")
	my setT(s, 5, my J({"•  묻히면 분해가 50배 느려짐 (추정). 묻힌 채 50년 넘고 재질별 확률을 통과하면 화석(영구)", "•  노출된 것은 절대 화석이 되지 못함 — 지층에는 묻힌 것만 남는다는 편향을 그대로 보여줌", "•  예외적 보존 구간(Lagerstätte): 칸마다 900초에 2% 확률로 그 칸의 매몰물이 모두 영구 보존"}))
	my setT(s, 6, "단계 경계: 수명의 15% / 50% · 코드: taphonomy.ts, palette.ts · 같은 스프라이트에 명도와 디더만 바꿔 표현")
	tell application "Keynote"
		delete table 1 of s
		set position of iWork item 4 of s to {52, 428}
	end tell
	my addImg(s, IMG & "deck/fig_stages.png", 110, 104, 740)

	---------------- N5: current screens ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · NOW")
	my setT(s, 2, "지금 화면 (Top view, 데모 데이터)")
	my setT(s, 5, my J({"•  방문자 데이터가 아니라 데모 데이터로 만든 화면. 가운데가 사람이 많이 지나간 곳", "•  왼쪽 = 지금 · 오른쪽 = 시계가 앞으로 간 뒤 (같은 데이터): 풍화·부서짐·사라짐이 늘어남", "•  가장자리의 흙색 작은 것들이 자연물 (현재는 아이콘 방식)"}))
	my setT(s, 6, "docs/img/shot-top-now.png, shot-top-future.png")
	tell application "Keynote"
		delete table 1 of s
		set position of iWork item 4 of s to {52, 398}
	end tell
	my addImg(s, IMG & "shot-top-now.png", 52, 112, 420)
	my addImg(s, IMG & "shot-top-future.png", 488, 112, 420)

	---------------- N6: natural fields ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · NATURE")
	my setT(s, 2, "자연은 영역: 얕은 연안의 밀도 필드 (설계안)")
	my setT(s, 5, my J({"•  왜 연안인가: 쓰레기 빈도 데이터가 해변 조사(JRC)라서, 땅도 해안으로 맞춰야 설명이 이어짐", "•  순위만 문헌, 수치는 가정. 해양 생태계의 ‘통과 횟수–피복’ 곡선은 찾지 못함 (육상 식생만 있음)"}))
	my setT(s, 6, "docs/coastal-fields-research.md · [V]=초록까지 읽음 · [B]=서지만 확인 · [S]=검색 요약 · 시각은 제안(미구현)")
	my fillTable(s, {{"필드", "화면에서 보이는 방식 (제안)", "회복", "밟힘", "근거 수준"}, ¬
		{"거머리말", "짙은 녹색 점 밀도", "느림 (수년)", "민감", "중 · 밟힘 실험 [V]"}, ¬
		{"대형 갈조류", "올리브·갈색 디더", "중간 (1–5년)", "중간", "중–하 [B]"}, ¬
		{"패류초 (홍합·굴)", "청회색 타일 군집", "가장 느림", "가장 민감", "하–중 [S]"}, ¬
		{"염습지·사구 가장자리", "연노랑 세로 해칭", "중간", "민감", "중–하 [V]"}, ¬
		{"바이오필름", "황토색 얇은 광택", "가장 빠름 (수일)", "둔감", "하–중 [S]"}, ¬
		{"용존산소 (면 전체)", "시안 안개, 낮아지면 탁해짐", "악화 수일 · 회복 수년", "—", "중 · Diaz & Rosenberg 2008 [V]"}, ¬
		{"파래 블룸 (일시)", "밝은 라임 얼룩", "수일", "—", "중 · Smetacek & Zingone 2013 [V]"}}, {170, 230, 150, 90, 220}, 12, 50, 112)
	tell application "Keynote" to set position of iWork item 5 of s to {52, 440}

	---------------- N7: wear and recovery ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · WEAR")
	my setT(s, 2, "마모와 회복: 같은 땅, 다른 과거")
	my setT(s, 5, my J({"•  걸음 = 밟힘 1회, 머무는 시간 = 1초마다 +1회 → 오래 머물수록 빨리 닳음 (구현됨)", "•  쌓인 물건은 같은 칸의 밀도를 깎음 (빛·산소가 막힘) · 회복 속도는 강도가 아니라 과거 부하의 기억에 달림 (설계)"}))
	my setT(s, 6, "밟힘: Cole & Bayfield 1993 · 회복: Pescott & Stewart 2014 · 과거 의존: Carr 외 2010 · 곡선은 설명용 개념도 (수치는 가정)")
	tell application "Keynote"
		delete table 1 of s
		set position of iWork item 4 of s to {52, 430}
	end tell
	my addImg(s, IMG & "deck/fig_wear.png", 50, 108, 860)

	---------------- N8: interaction -> evidence ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · LOGIC")
	my setT(s, 2, "인터랙션마다 이유가 있다 — 로직과 근거")
	my setT(s, 5, "")
	my setT(s, 6, "[V]=초록까지 읽음 · [B]=서지만 확인 · 모든 시간 규모는 순서만 사용 (실제 수치는 아님) · 문헌 목록: docs/coastal-fields-research.md, hybrid-objects-research.md")
	my fillTable(s, {{"인터랙션", "작품 안에서 일어나는 일", "왜 이렇게", "근거", "수준"}, ¬
		{"걸음", "칸에 들어갈 때마다 밟힘 1회", "밟힌 횟수가 식생 감소를 설명 (포화형 곡선)", "Cole 1995 · Cole & Bayfield 1993", "[B] 형태는 육상"}, ¬
		{"머묾", "1초마다 밟힘 +1", "오래 머물수록 더 닳게", "횟수 기반 가정 (우리 규칙)", "가정"}, ¬
		{"뿌린 물건이 쌓임", "그 칸의 밀도 감소, 아래 것은 묻힘", "덮이면 빛·산소가 막힘", "Green 2015 · Uhrin & Schellinger 2011", "[V]"}, ¬
		{"시간", "재질별 수명 후 소멸", "순서는 문헌, 수치는 추정", "재질 범위 (materials.ts)", "순위만 문헌"}, ¬
		{"매몰", "분해 50배 느림, 50년+ 이면 화석 후보", "지층에 남는 것 = 묻힌 것", "Zalasiewicz 외 2014 · 2016", "[B] · 50배는 추정"}, ¬
		{"단단한 잔재", "조개 > 이빨 > 뼈 순으로 오래 남음", "연한 것은 흔적 없이, 단단한 것만 기록", "Kidwell 2002 · Behrensmeyer 1978", "[B]"}}, {110, 230, 220, 200, 100}, 12, 50, 112)

	---------------- N9: contact -> new object ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · HYBRID")
	my setT(s, 2, "접촉하면 새 객체가 태어난다 — 조건과 문헌")
	my setT(s, 5, "•  물건과 땅이 만나 어느 쪽도 고르지 않은 제3의 객체가 생김 — ‘내가 정하지 않은 것이 남는다’의 연장 (해석)")
	my setT(s, 6, "docs/hybrid-objects-research.md · 증거 A = 현장 연구 다수, B = 단일·소수 연구 · 시간 규모는 문헌과 무관하게 순서만 사용 · 불 이벤트는 아직 미정")
	my fillTable(s, {{"새 객체", "만들어지는 조건", "근거", "증거", "필요한 신호"}, ¬
		{"bolus (삼킨 것 뭉치)", "플라스틱 + 새의 뼈·깃털 + 밀도 3개 이상", "Young 2009 · Auman 1997", "A", "지금 있음"}, ¬
		{"plasticrust (암반 위 플라스틱 막)", "필름·로프 + 암반 + 많이 밟힘 (마모 대용)", "Gestoso 2019", "A", "지금 있음"}, ¬
		{"plastiglomerate", "불 + 플라스틱 + 퇴적물·조개·나무", "Corcoran 외 2014", "A", "불 필요 (미정)"}, ¬
		{"pyroplastic", "불 + 플라스틱 우세한 칸", "Turner 외 2019", "A", "불 필요 (미정)"}, ¬
		{"dark earth (검은 흙)", "불 + 뼈·음식물 + 오랜 시간", "Glaser 2001", "A", "불 필요 (미정)"}, ¬
		{"anthropoquina", "혼합 인공물 + 퇴적물 + 매몰 + 밀도 4개 이상", "Fernandino 2020", "B", "지금 있음"}, ¬
		{"plastimetal", "녹슨 금속 + 플라스틱 섬유·필름 + 시간", "Ellrich 2023", "B", "지금 있음"}}, {200, 270, 170, 60, 160}, 12, 50, 112)
	tell application "Keynote" to set position of iWork item 5 of s to {52, 450}

	---------------- N10: references ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · REFERENCES")
	my setT(s, 2, "시각과 개념의 레퍼런스")
	my setT(s, 5, "")
	my setT(s, 6, "서지는 Crossref에서 확인 [B] · 내용은 요약 수준 · 사실과 해석을 구분해 표시")
	my fillTable(s, {{"레퍼런스", "작품에서 하는 일", "구분"}, ¬
		{"TempleOS (Terry Davis): 16색 · 저해상도 · 커서", "제한된 팔레트 = 퇴적의 팔레트. 깜박이는 커서 = ‘나’와 현재", "시각 제약만 차용"}, ¬
		{"Zalasiewicz 외 2014 · 2016: technofossil", "방문자의 흔적이 지층의 화석이 됨", "사실(문헌) → 적용은 해석"}, ¬
		{"Corcoran · Moore · Jazvac 2014: plastiglomerate", "접촉이 만든 새 객체", "사실"}, ¬
		{"Zettler 외 2013: plastisphere", "플라스틱이 생물의 새 서식처가 됨", "사실"}, ¬
		{"Morton 2013: Hyperobjects", "한눈에 볼 수 없는 거대한 시공간 → 100만 년 압축, 밀도 필드", "해석"}, ¬
		{"Steinberg & Peters 2015 · Neimanis 2017: 물과 몸", "연안 환경을 몸과 같은 매질로, 산소 안개", "해석"}}, {300, 400, 160}, 12, 50, 112)

	---------------- move new slides after slide 3 ----------------
	repeat with k from 1 to 10
		move slide (oldCount + k) of d to after slide (2 + k) of d
	end repeat

	-- renumber kickers and page numbers
	repeat with i from 1 to count of slides of d
		set sl to slide i of d
		set kt to object text of iWork item 1 of sl
		set p to offset of " · " in kt
		if p > 0 then
			set restTxt to text (p + 3) thru -1 of kt
			set num to i as string
			if i < 10 then set num to "0" & num
			set object text of iWork item 1 of sl to num & " · " & restTxt
		end if
		set object text of iWork item 3 of sl to (i as string)
	end repeat

	save d
	return "slides now: " & (count of slides of d)
end tell

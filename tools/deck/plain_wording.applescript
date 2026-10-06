-- Plainer titles / descriptions for the artwork-explanation slides (4-13). Text only, layout untouched.
set R to return

on J(L)
	set AppleScript's text item delimiters to return
	set r to L as text
	set AppleScript's text item delimiters to ""
	return r
end J

on setT(s, n, txt)
	tell application "Keynote" to set object text of iWork item n of s to txt
end setT

on setRows(s, rowsData)
	tell application "Keynote"
		set t to table 1 of s
		repeat with r from 1 to count of rowsData
			repeat with c from 1 to count of item r of rowsData
				set value of cell c of row r of t to (item c of item r of rowsData)
			end repeat
		end repeat
	end tell
end setRows

tell application "Keynote"
	set d to front document

	-- 4 SCATTER
	set s to slide 4 of d
	my setT(s, 2, "Scatter: 뭐가 뿌려지고, 왜 그렇게 정했나")
	my setRows(s, {{"정한 것", "왜 그렇게 했나", "근거", "확인 수준"}, ¬
		{"품목 빈도는 JRC 유럽 해변 쓰레기 실측 표를 그대로 씀 (238행, 106품목)", "상상한 쓰레기가 아니라, 실제로 해변에 남는 쓰레기의 비율이라서", "Addamo, Laroche & Hanke 2017 (JRC)", "표 전체를 추출함. 행별 대조는 안 함"}, ¬
		{"레이어 비율: 포장재 70 / 전자 10 / 유기물 20", "해변 조사에는 전자제품·음식물이 거의 안 잡힘. 기술권의 다른 얼굴도 보이게 하려고 작가가 정함", "작가의 선택", "추정값"}, ¬
		{"방문자는 뭐가 나올지 고를 수 없음 (추첨)", "“내가 무엇을 남길지는 내가 정할 수 없다”는 피드백을 그대로 반영", "자문 피드백", "—"}, ¬
		{"1m 걷거나 1.5초 멈추면 1개씩 뿌림", "걷는 것 자체가 흔적이 되고, 가만히 있어도 계속 남도록", "설계 결정", "값은 조정 가능"}, ¬
		{"같은 품목도 변형 2~4개", "같은 물건도 조금씩 다르게 보여야 땅이 단조롭지 않아서", "설계 결정", "—"}})

	-- 5 SPRITES
	set s to slide 5 of d
	my setT(s, 2, "Sprites: 이미지는 이렇게 골랐다")
	my setRows(s, {{"정한 것", "왜 그렇게 했나"}, ¬
		{"사진이 아니라 오픈 아이콘을 씀 (Twemoji · Noto · Fluent · game-icons · DCSS)", "다시 배포해도 되는 라이선스(CC BY · MIT · Apache · CC0)라서. 출처는 크레딧에 자동 기록"}, ¬
		{"어떤 품목에 어떤 아이콘을 쓸지는 사람이 직접 고른 표", "검색어로 자동 수집하지 않았음. 물건이 어떻게 보여야 하는지는 작가가 판단"}, ¬
		{"24×24 칸 안에 20×20, 16색, 내부 디더 없음", "TempleOS 16색. 색을 제한하는 것 = 정보를 압축하는 것 = 화석이 되는 것과 닮음"}, ¬
		{"어두운 스프라이트에만 회색 외곽선", "검은 배경에서도 보이게"}, ¬
		{"148품목 중 67개만 자기 스프라이트(247변형), 81개는 같은 재질 것을 빌려 씀", "지금 상태 그대로임. 약한 것부터 교체할 예정"}})

	-- 6 LIFESPAN (bullets = item 4, footnote = item 5)
	set s to slide 6 of d
	my setT(s, 2, "Lifespan: 재질마다 사라지는 속도가 다르다")
	my setT(s, 4, my J({"•  시간 환산: 놓인 지 10초 = 25년, 100초 = 500년, 1시간 = 6만 년, 8시간 = 100만 년", "•  왜 이렇게 눌렀나: 실제 비율 그대로면 종이와 병이 구분이 안 돼서, 시간을 눌러 재질 순서가 초 단위로 보이게 함"}))
	my setT(s, 5, "수명 범위는 추정값. 재질 순서만 문헌 기반 (종이 < 직물 < 목재 < 필름 < 발포 < 단단한 플라스틱 < 금속 < 유리·도자기) · 코드: materials.ts, geoClock.ts")

	-- 7 DECAY
	set s to slide 7 of d
	my setT(s, 1, "07 · DECAY")
	my setT(s, 2, "Decay: 사라지기까지 이렇게 변한다")
	my setT(s, 4, my J({"•  묻히면 분해가 50배 느려짐 (추정값). 50년 넘게 묻혀 있고 재질별 확률을 통과하면 화석이 됨", "•  땅 위에 드러난 건 화석이 될 수 없음. 지층에는 묻힌 것만 남는다는 편향을 그대로 보여줌", "•  가끔 한 칸이 통째로 보존되기도 함 (Lagerstätte: 칸마다 900초에 2% 확률)"}))
	my setT(s, 5, "단계 경계는 수명의 15%, 50% · 코드: taphonomy.ts, palette.ts · 같은 스프라이트에서 밝기와 디더만 바꿈")

	-- 8 NOW
	set s to slide 8 of d
	my setT(s, 1, "08 · RIGHT NOW")
	my setT(s, 2, "Right now: 지금 화면 (데모 데이터)")
	my setT(s, 4, my J({"•  방문자 데이터가 아니라 데모 데이터로 만든 화면. 가운데가 사람이 많이 지나간 곳", "•  왼쪽은 지금, 오른쪽은 시계를 앞으로 보낸 뒤 (같은 데이터)", "•  가장자리의 흙색 작은 것들이 자연물 (지금은 아이콘 방식)"}))

	-- 9 NATURE
	set s to slide 9 of d
	my setT(s, 2, "Nature: 자연은 점이 아니라 영역 (얕은 연안)")
	my setT(s, 5, my J({"•  왜 연안인가: 쓰레기 빈도 데이터가 해변 조사(JRC)라서, 땅도 해안으로 맞춰야 이야기가 이어짐", "•  문헌으로 확인한 건 순위까지, 수치는 가정. 바다 생물에 대한 ‘몇 번 밟으면 얼마나 줄어드나’ 곡선은 못 찾음 (육상 식물 연구만 있음)"}))
	my setT(s, 6, "docs/coastal-fields-research.md · [V] 초록까지 읽음 · [B] 서지만 확인 · [S] 검색 요약만 확인 · 화면 표현은 제안 (아직 구현 안 함)")
	my setRows(s, {{"필드", "화면에서 이렇게 보임 (제안)", "회복", "밟힘에", "근거 (수준)"}})

	-- 10 WEAR
	set s to slide 10 of d
	my setT(s, 2, "Wear & recovery: 같은 땅도 과거에 따라 다르게 회복한다")
	my setT(s, 4, my J({"•  한 칸에 들어가면 밟힘 1회, 머물면 1초마다 +1회. 오래 있을수록 빨리 닳음 (구현됨)", "•  쌓인 물건은 그 칸의 밀도를 깎음 (빛·산소를 막음). 회복 속도는 얼마나 세게 밟았냐보다 과거에 얼마나 눌렸냐에 달려 있음 (설계)"}))
	my setT(s, 5, "밟힘: Cole & Bayfield 1993 · 회복: Pescott & Stewart 2014 · 과거 의존: Carr 외 2010 · 곡선은 설명용 개념도, 수치는 가정")

	-- 11 LOGIC
	set s to slide 11 of d
	my setT(s, 2, "Logic: 인터랙션마다 이유가 있다")
	my setT(s, 6, "[V] 초록까지 읽음 · [B] 서지만 확인 · 시간 규모는 순서만 사용 (실제 수치 아님) · 문헌 목록: docs/coastal-fields-research.md, hybrid-objects-research.md")
	my setRows(s, {{"인터랙션", "작품 안에서", "왜 이렇게 했나", "근거", "확인 수준"}, ¬
		{"걸음", "새 칸에 들어갈 때마다 밟힘 1회", "밟은 횟수가 많을수록 식생이 줄어듦 (처음에 크게, 점점 완만하게)", "Cole 1995 · Cole & Bayfield 1993", "[B] 곡선 모양은 육상 연구"}, ¬
		{"머묾", "1초마다 밟힘 +1회", "오래 머물수록 더 닳게 하려고", "우리가 세운 가정", "가정"}, ¬
		{"뿌린 물건이 쌓임", "그 칸 밀도가 줄고, 아래 것은 묻힘", "위를 덮으면 빛과 산소가 막힘", "Green 2015 · Uhrin & Schellinger 2011", "[V]"}, ¬
		{"시간", "재질별 수명이 지나면 사라짐", "순서는 문헌, 숫자는 추정", "재질 범위 (materials.ts)", "순서만 문헌"}, ¬
		{"묻힘", "분해 50배 느림, 50년 넘으면 화석 후보", "지층에 남는 건 묻힌 것이라서", "Zalasiewicz 외 2014 · 2016", "[B] · 50배는 추정"}, ¬
		{"단단한 잔재", "조개 > 이빨 > 뼈 순으로 오래 남음", "연한 건 흔적 없이 사라지고, 단단한 것만 기록으로 남음", "Kidwell 2002 · Behrensmeyer 1978", "[B]"}})

	-- 12 HYBRID
	set s to slide 12 of d
	my setT(s, 2, "Hybrid: 닿으면 새로운 물건이 생긴다")
	my setT(s, 5, "•  물건과 땅이 닿으면 둘 중 누구도 고르지 않은 제3의 물건이 생김. ‘내가 정하지 않은 것이 남는다’는 주제의 연장 (해석)")
	my setRows(s, {{"새 물건", "이럴 때 생김", "근거", "증거", "필요한 것"}, ¬
		{"bolus (삼킨 것 뭉치)", "플라스틱 + 새의 뼈·깃털이 한 칸에 있고 물건이 3개 이상", "Young 2009 · Auman 1997", "A", "지금 가능"}, ¬
		{"plasticrust (암반 위 플라스틱 막)", "필름·로프 + 암반 + 많이 밟힌 칸 (밟힘 = 파도 마모의 대용)", "Gestoso 2019", "A", "지금 가능"}, ¬
		{"plastiglomerate", "불이 나고 + 플라스틱 + 퇴적물·조개·나무가 있을 때", "Corcoran 외 2014", "A", "불이 필요 (미정)"}, ¬
		{"pyroplastic", "불이 나고 + 플라스틱이 대부분인 칸", "Turner 외 2019", "A", "불이 필요 (미정)"}, ¬
		{"dark earth (검은 흙)", "불이 나고 + 뼈·음식물 + 오랜 시간이 지났을 때", "Glaser 2001", "A", "불이 필요 (미정)"}, ¬
		{"anthropoquina", "여러 인공물 + 퇴적물이 묻혀 있고 밀도 4개 이상", "Fernandino 2020", "B", "지금 가능"}, ¬
		{"plastimetal", "녹슨 금속 + 플라스틱 섬유·필름 + 시간", "Ellrich 2023", "B", "지금 가능"}})

	-- 13 REFERENCES
	set s to slide 13 of d
	my setT(s, 2, "References: 이 작업이 기대는 것들")
	my setT(s, 6, "서지는 Crossref에서 확인 [B] · 내용은 요약 수준 · 사실과 해석을 나눠서 표시")
	my setRows(s, {{"레퍼런스", "작품에서 하는 일", "사실? 해석?"}, ¬
		{"TempleOS (Terry Davis): 16색 · 저해상도 · 커서", "색을 16개로 제한 = 퇴적의 팔레트. 깜박이는 커서 = ‘나’와 지금", "시각 규칙만 가져옴"}, ¬
		{"Zalasiewicz 외 2014 · 2016: technofossil", "방문자가 남긴 흔적이 지층의 화석이 됨", "문헌 내용은 사실, 작품에 적용한 건 해석"}, ¬
		{"Corcoran · Moore · Jazvac 2014: plastiglomerate", "닿아서 생긴 새로운 물건", "사실"}, ¬
		{"Zettler 외 2013: plastisphere", "플라스틱이 생물의 새로운 서식처가 됨", "사실"}, ¬
		{"Morton 2013: Hyperobjects", "한눈에 볼 수 없는 거대한 시간과 공간 → 100만 년 압축, 밀도 필드로 표현", "해석"}, ¬
		{"Steinberg & Peters 2015 · Neimanis 2017: 물과 몸", "연안 환경을 우리 몸과 같은 물의 연장으로 봄. 산소 안개", "해석"}})

	save d
	return "done"
end tell

-- Add 3 more LIVE DATA slides (other litter DBs, nature/environment sources, mapping proposal) after slide 6.
-- Backup before running: brain/.../scratch/progress-deck.before-olm.key is OLDER; run a fresh backup first.
-- Template = slide 3. New slides are appended, then moved after slide 6.
-- DO NOT RE-RUN: it would add 3 more slides.
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

on setPos(s, n, x, y)
	tell application "Keynote" to set position of iWork item n of s to {x, y}
end setPos

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

on fillTable(s, rowsData, widths, fsz, rowH, tx, ty)
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
			set height of row r of t to rowH
		end repeat
		set position of t to {tx, ty}
	end tell
end fillTable

tell application "Keynote"
	set d to front document
	set oldCount to count of slides of d

	---------------- L4: other litter DBs ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · LIVE DATA")
	my setT(s, 2, "다른 쓰레기 DB도 같은 방식으로 봤다: 즉시 갱신은 하나뿐")
	my fillTable(s, {{"DB", "한 건", "분류", "갱신 (측정)", "가져오기"}, ¬
		{"OpenLitterMap", "사진 1장", "사물 136 · 재질 30", "즉시 (하루 약 73장)", "공개 API, 로그인 없음"}, ¬
		{"EMODnet 해변 쓰레기", "조사 1회 × 품목 개수", "OSPAR · JLIST 등 목록 7종", "연 1회 (최신 조사 2024-12-30)", "ERDDAP, 키 없음, 42개국"}, ¬
		{"EEA Marine LitterWatch", "이벤트 × G코드 개수", "JRC G코드 164 · 재질 9", "배치 (받아본 스냅샷은 2013–2021)", "뷰어만 확인"}, ¬
		{"Debris Tracker", "아이템 1건 (좌표 + 수량)", "재질 → 품목 (2014 샘플: 8 → 79)", "미측정", "계정 후 CSV (API 미확인)"}, ¬
		{"NOAA MDMAP", "100 m 구간 조사 1회", "재질 7 → 품목", "미측정", "포털 export (API 미확인)"}, ¬
		{"TrashOut", "투기 지점 + 사진", "재질 군 10 (품목 없음)", "미측정 (소스는 2024-06 이후 갱신 없음)", "API 호출이 404"}, ¬
		{"Litterati", "사진 1장 = 1점", "자유 태그 (고유 약 2만)", "미측정", "공식 API 미확인"}}, {150, 160, 190, 190, 170}, 11, 30, 50, 108)
	my setT(s, 5, my J({"•  확인된 즉시 갱신은 OpenLitterMap 하나. 나머지는 조사 기반이라 갱신이 느리거나 알 수 없음", "•  EMODnet은 JRC 표의 최신판에 해당함. PDF에서 뽑는 대신 품목별 개수를 질의로 받을 수 있음 (연 1회 갱신)", "•  재질이 직접 들어 있는 곳: EEA, Debris Tracker, MDMAP. OpenLitterMap은 재질이 빈 경우가 많음"}))
	my setPos(s, 5, 52, 362)
	my setT(s, 6, "직접 호출로 확인: OpenLitterMap, EMODnet. 나머지는 사이트 접속 · GitHub 사본 · 검색 요약 (표기는 docs/live-data-research.md)")

	---------------- L5: nature / environment ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · LIVE DATA")
	my setT(s, 2, "자연·환경 쪽 실시간 소스: 신호는 많고 밀도는 없다")
	my fillTable(s, {{"소스", "한 건", "갱신 (측정)", "키 · 라이선스", "연결할 곳"}, ¬
		{"iNaturalist API", "사진 관찰 1건", "즉시 (파래는 하루 몇 건)", "키 없음 · 사진마다 라이선스", "번성 이벤트 신호"}, ¬
		{"GBIF · OBIS", "관찰 1건 (일부 ‘없음’, 정량값)", "해양 분류군 하루 73~155건 (iNat 사본은 약 13일 지연)", "키 없음 · 기록마다 다름", "기준 밀도 · 계절 곡선"}, ¬
		{"Open-Meteo Marine", "파고 · 수온 격자 시계열", "지연 6분", "키 없음 · 비상업 무료", "마모 · 회복 속도"}, ¬
		{"NOAA CO-OPS", "관측소 6분 실측 수위", "지연 6분", "키 없음", "조간대 노출 · 침수"}, ¬
		{"NASA FIRMS", "화재 탐지 1건 (좌표 · 세기)", "24시간 CSV가 51분 전 갱신", "공개 CSV는 키 없음", "불 이벤트"}, ¬
		{"Copernicus · Fishing Watch", "격자", "미측정", "계정 · 토큰 필요 (FW는 비상업)", "산소 · 조류 (서버에서 가공)"}}, {150, 190, 230, 150, 140}, 11, 32, 50, 108)
	my setT(s, 5, my J({"•  관찰 건수는 밀도가 아님. 관찰자가 많으면 건수가 늘 뿐이라 ‘방금 누가 봤다’는 신호로만 씀", "•  GBIF에는 해양 필터가 없어 분류군 목록으로 걸러야 함 (Ulva는 사초과 속과 이름이 같음)", "•  정량값이 있는 기록은 해초 12.9%, 파래 13.5%뿐이고 단위도 제각각. 시민 해초 신고 DB(SeagrassSpotter)는 OBIS에 있음"}))
	my setPos(s, 5, 52, 345)
	my setT(s, 6, "직접 호출로 확인: iNaturalist, OBIS, Open-Meteo, CO-OPS, FIRMS (GBIF는 조사 에이전트가 호출). 용존산소 실측 소스는 확인하지 못함")

	---------------- L6: mapping proposal ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · LIVE DATA")
	my setT(s, 2, "현실과 붙이는 방식 (제안): 무엇을 어디에 연결할까")
	my fillTable(s, {{"우리 요소", "연결 후보", "성격", "약점"}, ¬
		{"품목 빈도", "OpenLitterMap(라이브) + EMODnet · EEA 품목 목록", "사실에 가까움", "지역 쏠림 · 재질 빈칸 · 단위 차이"}, ¬
		{"불 이벤트", "FIRMS 공개 CSV, 해안 상자 안의 탐지", "사실에 가까움 (해안 한정)", "탐지 없는 지역은 불이 안 남"}, ¬
		{"조간대 노출 · 침수", "CO-OPS 수위", "사실에 가까움", "미국 관측소만"}, ¬
		{"마모 · 회복 속도", "Open-Meteo 파고 · 수온", "상징에 가까움", "모델 값 · 비상업 조건"}, ¬
		{"파래 번성 이벤트", "iNaturalist 파래 관찰", "신호 (펄스)", "건수 = 관찰자 수"}, ¬
		{"해초 · 조류 기준 밀도", "GBIF · OBIS를 미리 구워 번들", "부분적", "존재 기록이지 밀도가 아님"}, ¬
		{"산소 안개", "용존산소 부이 (확인 못 함)", "미정", "한 지점 값"}}, {170, 300, 190, 200}, 11, 30, 50, 108)
	my setT(s, 5, my J({"•  키 없이 장애에도 버티기: 수집기가 소스들을 받아 state.json 한 파일로 만들고, 브라우저는 그 파일만 읽음", "•  소스가 끊기면 마지막 값을 나이와 함께 흐리게 쓰고, 그다음은 녹화본이나 계절 평균으로 내려감", "•  출처 표기 화면 필요: ODbL (OLM) · 비상업 (Open-Meteo) · 인용 문구 (EMODnet)"}))
	my setPos(s, 5, 52, 362)
	my setT(s, 6, "아직 결정 아님. 어디까지 라이브로 할지는 미팅에서 정하고 싶음 · 상세: docs/live-data-research.md")

	---------------- move new slides after slide 6 ----------------
	repeat with k from 1 to 3
		move slide (oldCount + k) of d to after slide (5 + k) of d
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

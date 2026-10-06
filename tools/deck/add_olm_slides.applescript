-- Add the OpenLitterMap analysis slides to the front Keynote document (progress-deck).
-- Backup before running: brain/.../scratch/progress-deck.before-olm.key
-- Template = slide 3 (table + bullets + footnote). New slides are appended, then moved after slide 3.
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

on setPos(s, n, x, y)
	tell application "Keynote" to set position of iWork item n of s to {x, y}
end setPos

tell application "Keynote"
	set d to front document
	set oldCount to count of slides of d

	---------------- L1: what one record is ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · LIVE DATA")
	my setT(s, 2, "OpenLitterMap: 시민이 올리는 쓰레기 사진 DB")
	my fillTable(s, {{"필드", "뜻", "실제 기록 한 건 (암스테르담, 2026-09-30)"}, ¬
		{"기록 한 건", "사진 한 장 = 위치 + 시각 + 태그 목록", "id 555414"}, ¬
		{"위치 · 시각", "사진에 찍힌 좌표, 촬영 시각", "4.889E, 52.368N · 2026-09-30"}, ¬
		{"사물 (object)", "쓰레기의 물리적 정체", "plastic"}, ¬
		{"범주 (category)", "17개 중 하나", "other"}, ¬
		{"재질 · 브랜드", "선택 입력, 여러 개 가능", "비어 있음"}, ¬
		{"사용자 메모", "자유 입력", "“plastic cup”"}, ¬
		{"개수 · 주웠는가", "태그마다 붙음", "1개 · picked_up = true (주워서 치움)"}}, {170, 330, 360}, 12, 50, 112)
	my setT(s, 5, my J({"•  규모: 사진 541,715장 · 태그 1,634,364건 · 사용자 11,091명 (2026-10-05 조회)", "•  얼마나 실시간인가: 하루 사진 73장, 최근 30일 2,776장. 올리면 바로 반영", "•  올린 사람 이름은 비공개일 수 있음 (위 기록도 이름 없음)"}))
	my setPos(s, 5, 52, 392)
	my setT(s, 6, "출처: openlittermap.com/api/points, /api/global/stats-data (직접 호출해 확인) · 소스코드 readme/Tags.md (OpenLitterMap/openlittermap-web)")

	---------------- L2: classification ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · LIVE DATA")
	my setT(s, 2, "OpenLitterMap 분류: 사물이 중심, 나머지는 선택 속성")
	my fillTable(s, {{"층", "뜻", "규모 · 예"}, ¬
		{"Category", "쓰레기 범주", "17개: alcohol · coffee · food · smoking · softdrinks · sanitary · medical · electronics · industrial · vehicles · marine · dumping · pets · art · civic · other"}, ¬
		{"Object", "사물 자체 (병, 캔, 컵)", "고유 136개"}, ¬
		{"Type", "내용물 (맥주, 물…) · 선택", "약 17개"}, ¬
		{"Material", "재질 · 선택 · 여러 개 가능", "30개: plastic · glass · aluminium · foam · nylon · rubber · cork 등"}, ¬
		{"Brand", "브랜드 · 선택 · 개수를 따로 셈", "목록 테이블"}, ¬
		{"Custom tag", "사용자 자유 메모", "자유 입력"}}, {130, 270, 460}, 12, 50, 112)
	my setT(s, 5, my J({"•  marine 범주(16개): 부표 · 어망 · 낚싯줄 · 낚싯바늘 · 낚싯루어 · 로프 · 폴리스티렌 조각 · 너들 · 마이크로/매크로플라스틱 · 면봉 · 조개양식 자루 등", "•  병은 병으로 기록하고 내용물(맥주/물)은 따로 적음. 같은 사물이 여러 범주에 들어갈 수 있음", "•  재질은 ‘이 병은 유리’라는 속성이고 개수를 세지 않음. 선택 입력이라 비어 있을 수 있음"}))
	my setPos(s, 5, 52, 360)
	my setT(s, 6, "출처: openlittermap.com/api/tags (전체 분류를 받아 집계) · readme/Tags.md의 설계 원칙")

	---------------- L3: compare with JRC + access ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · LIVE DATA")
	my setT(s, 2, "JRC와 비교하면: 갱신은 빠르고, 표준성은 약하다")
	my fillTable(s, {{"항목", "JRC (지금 쓰는 것)", "OpenLitterMap"}, ¬
		{"한 건의 단위", "해변 조사 집계 (238행)", "사진 한 장"}, ¬
		{"갱신", "보고서 한 번 (2016)", "올라오는 즉시 (하루 약 73장)"}, ¬
		{"분류", "MSFD G코드, 품목 중심", "사물 136 + 재질 30 + 브랜드"}, ¬
		{"재질", "행마다 있음", "선택 입력 (샘플 2건은 비어 있음)"}, ¬
		{"치우는 정보", "없음", "있음 (picked_up)"}, ¬
		{"치우침", "표준 조사, 유럽 해변", "네덜란드 36% · 영국 24% · 미국 16%. 눈에 띄는 것 위주"}, ¬
		{"가져오기", "PDF 표에서 추출", "공개 API, 로그인 없음, GeoJSON"}, ¬
		{"라이선스", "출처 표시하면 재사용 가능", "ODbL (출처 표시 필요, 약관 원문은 미확인)"}}, {150, 300, 410}, 12, 50, 108)
	my setT(s, 5, my J({"•  가져오는 법: /api/points (지역 박스 + 줌 15 이상, 범주·사물·재질·날짜 필터, 페이지당 최대 500) · /api/tags · /api/global/stats-data", "•  작품에 쓸 후보 (결정 아님): 최근 기록으로 품목 비율 갱신 · picked_up(치워진 것)과 남은 것의 관계", "•  아직 모름: OLM 사물 136개를 우리 106품목에 대응시키는 표, 재질이 채워진 비율"}))
	my setPos(s, 5, 52, 408)
	my setT(s, 6, "상위 5개국이 사진의 86.5% (/api/locations/country로 계산) · 우리 작품에 연결할지는 미정")

	---------------- move new slides after slide 3 ----------------
	repeat with k from 1 to 3
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

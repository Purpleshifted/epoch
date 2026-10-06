-- Adds 3 "what we tried and why it was rejected" slides after slide 2 (NOW) of progress-deck.key.
-- Backup first: brain/.../scratch/progress-deck.before-rejected.key
-- Template = slide 3 (table slide). DO NOT RE-RUN (guard below).
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
	repeat with i from 1 to (count of slides of d)
		if (object text of iWork item 1 of slide i of d) contains "TRIED" then error "already added"
	end repeat
	set n0 to count of slides of d

	---------------- A: trash DBs ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · TRIED · DB")
	my setT(s, 2, "쓰레기 DB를 뒤져봤지만 그대로 쓸 수 있는 건 없었다")
	my fillTable(s, {{"데이터", "얻을 수 있었던 것", "쓰지 못한 이유"}, ¬
		{"JRC 2016 · TACO", "해변 조사 238행(35만 개) · 사진 1,500장", "둘 다 정적(갱신 없음), 해변 쏠림. TACO는 라이선스가 섞여 있다"}, ¬
		{"OpenLitterMap", "참여형 사진 + 태그, 키 없음, 하루 약 73장", "사진 사용 불가(5분짜리 서명 URL, 저작권 불명). 네덜란드 36%, 상위 5개국 87%, 한국 37장"}, ¬
		{"Litterati 네덜란드", "관측 170만 건, 태그 2만 종", "비상업 라이선스(CC BY-NC-SA), 공식 오픈데이터 접속 안 됨, 국지적"}, ¬
		{"EMODnet · EEA · Debris Tracker · MDMAP", "표준화된 해안 · 해양 조사", "조사 기반이라 갱신이 느리거나, 직접 접근 경로를 확인하지 못함"}, ¬
		{"Open Food Facts", "479만 제품, 재질 · 모양 분류, 매일 갱신", "쓰레기가 아니라 시장에 나온 포장 제품. 포장 구조가 채워진 건 14%"}}, {190, 260, 350}, 12, 40, 50, 112)
	my setT(s, 5, my J({"•  ‘실시간 · 공개 · 재질 정보 · 쓸 수 있는 라이선스’ 네 가지를 한 곳이 동시에 채우지 못했다", "•  네덜란드 데이터는 저작권(사진)과 국지성(한 나라 쏠림) 때문에 전시 맥락과 맞지 않았다"}))
	my setPos(s, 5, 52, 372)
	my setT(s, 6, "OLM 수치는 2026-10-06 직접 호출한 표본 448장 · 분류별 개수는 직접 호출 또는 문서 확인 · 일부는 검색 요약만 본 것")

	---------------- B: images and nature ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · TRIED · IMAGE")
	my setT(s, 2, "이미지와 자연 쪽도 같은 문제였다")
	my fillTable(s, {{"해본 것", "내용", "쓰지 못한 이유"}, ¬
		{"아이콘 스프라이트", "Twemoji · Noto · Fluent · game-icons를 16색으로 변환", "148품목 중 67개만 구함. 출처마다 그림체가 달라 한 작품으로 읽히지 않음"}, ¬
		{"웹 이미지 검색", "해당 단어의 최신 이미지를 받아 픽셀로 바꾸기", "저작권이 불확실. 픽셀화도 개작이라 CC0 · PD · CC BY만 가능 (SA · NC 제외)"}, ¬
		{"연안 자연 밀도", "해초 · 해조 · 홍합 · 산소를 칸마다 밀도로", "순위만 문헌 근거가 있고 수치는 가정. 땅을 도시로 정한 뒤 맞지 않음"}, ¬
		{"실시간 자연 데이터", "iNaturalist · GBIF · OBIS · Open-Meteo · CO-OPS · FIRMS", "신호는 있으나 ‘밀도’가 아님(관찰 기록은 있다/없다). 여러 데이터를 이어 붙이게 됨"}, ¬
		{"도시 식생 · 쓰레기", "도심 녹지와 쓰레기의 관계로 규칙 만들기", "둘을 직접 잇는 연구를 찾지 못함"}}, {170, 280, 350}, 12, 40, 50, 112)
	my setT(s, 5, my J({"•  어떤 방식이든 ‘이것저것 모아서 그럴듯하게’가 되어 작품이 하나의 말을 하지 못했다", "•  이미지 방식은 출처가 늘수록 저작권 부담과 그림체 불일치가 같이 커졌다"}))
	my setPos(s, 5, 52, 372)
	my setT(s, 6, "스프라이트 개수 · 데이터 갱신 주기는 직접 확인 · 연구 부재는 검색 범위 안에서의 결과 (없다는 증명은 아님)")

	---------------- C: verdict ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · TRIED · VERDICT")
	my setT(s, 2, "결론: 쓰레기 일반으로 가면 메시지가 서지 않는다")
	my fillTable(s, {{"문제", "무엇이 보였나"}, ¬
		{"너무 다양하다", "238행 → 148품목으로 줄여도 쏠림이 크다. OLM 표본 448장에서 상위 3개가 67%, 한 번만 나온 것 9종. ‘포장 · 플라스틱 · 기타’ 같은 일반어가 약 58%"}, ¬
		{"데이터가 한 번에 맞지 않는다", "실시간 · 공개 · 재질 · 저작권을 한 곳이 동시에 만족하지 못한다. 합치면 이어 붙인 작품이 된다"}, ¬
		{"읽히지 않는다", "이것저것 뿌리면 어느 것도 말하지 않는다. 지금의 화면이 그 결과다 (02)"}}, {190, 610}, 12, 46, 50, 112)
	my setT(s, 5, my J({"•  그래서 한 종류의 이야기를 고른다: 인류가 ‘구조적으로 남긴 흔적’", "•  고르는 기준 두 가지: 인류세 이전에 없던 것 · 작품에서 크게 다뤄지지 않은 소재"}))
	my setPos(s, 5, 52, 335)
	my setT(s, 6, "OLM 수치는 2026-10-06 표본 · 일반어 비율은 object 이름이 food · packaging · other · plastic인 비율")

	---------------- move to after slide 2, 3, 4 ----------------
	move slide (n0 + 1) of d to after slide 2 of d
	move slide (n0 + 2) of d to after slide 3 of d
	move slide (n0 + 3) of d to after slide 4 of d

	---------------- renumber kickers + page numbers ----------------
	repeat with i from 1 to (count of slides of d)
		set k to object text of iWork item 1 of slide i of d
		set AppleScript's text item delimiters to " · "
		set parts to text items of k
		set AppleScript's text item delimiters to ""
		set nm to ""
		repeat with p from 2 to (count of parts)
			if p > 2 then set nm to nm & " · "
			set nm to nm & (item p of parts)
		end repeat
		set num to (text -2 thru -1 of ("0" & i))
		set object text of iWork item 1 of slide i of d to (num & " · " & nm)
		set object text of iWork item 3 of slide i of d to (i as text)
	end repeat
end tell

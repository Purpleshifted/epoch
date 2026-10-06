-- Re-frame OLM as a candidate REPLACEMENT of the JRC taxonomy (not a mapping into it), using the sample just measured.
on J(L)
	set AppleScript's text item delimiters to return
	set r to L as text
	set AppleScript's text item delimiters to ""
	return r
end J

tell application "Keynote"
	set d to front document
	-- slide 6: bullets (item 5)
	set s6 to slide 6 of d
	set object text of iWork item 5 of s6 to my J({"•  가져오는 법: /api/points (지역 박스 + 줌 15 이상, 범주·사물·재질·날짜 필터, 페이지당 최대 500) · /api/tags · /api/global/stats-data", "•  JRC를 대체하는 후보: 품목 체계와 빈도를 OpenLitterMap으로 교체. 수명·분해 같은 법칙은 그대로 문헌 기반", "•  풀어야 할 것: 재질이 4%만 입력되어 품목별 재질 표가 필요함 · 포장재와 일반 플라스틱이 약 60%라 품목이 뭉툭함"})
	set object text of iWork item 6 of s6 to "측정: 2026-08 이후 네덜란드 사진 448장 표본 (위치 쏠림 있음) · 상위 5개국이 사진의 86.5% · 우리 작품에 연결할지는 미정"
	-- slide 9: row 2 of the mapping table
	set s9 to slide 9 of d
	set t to table 1 of s9
	set value of cell 2 of row 2 of t to "OpenLitterMap을 품목 체계로 교체 (JRC는 참고)"
	set value of cell 4 of row 2 of t to "재질 4%만 입력 · 포장재가 뭉툭 · 지역 쏠림"
	save d
	return "ok"
end tell

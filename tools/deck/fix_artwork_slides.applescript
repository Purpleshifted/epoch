-- Small fixes after the first visual check of the new slides.
tell application "Keynote"
	set d to front document

	-- slide 6 (LIFESPAN): replace figure (tick labels overlapped)
	set s6 to slide 6 of d
	delete image 1 of s6
	tell s6 to make new image with properties {file:(POSIX file "/Volumes/Hesse/exhibition/anthropocene/docs/img/deck/fig_lifespan.png"), position:{100, 112}, width:760}

	-- slide 5 (SPRITES): sheet slightly smaller so it clears the footnote
	set width of image 1 of slide 5 of d to 380

	-- slide 8 (NOW): caption states only what is certain
	set object text of iWork item 4 of slide 8 of d to "•  방문자 데이터가 아니라 데모 데이터로 만든 화면. 가운데가 사람이 많이 지나간 곳" & return & "•  왼쪽 = 지금 · 오른쪽 = 시계를 앞으로 보낸 뒤 (같은 데이터)" & return & "•  가장자리의 흙색 작은 것들이 자연물 (현재는 아이콘 방식)"

	-- slide 12 (HYBRID): say that trampling stands in for wave abrasion
	set object text of iWork item 6 of slide 12 of d to "docs/hybrid-objects-research.md · 증거 A = 현장 연구 다수, B = 단일·소수 연구 · 밟힘은 파도 마모의 대용(해석) · 시간 규모는 순서만 사용 · 불 이벤트는 미정"

	set t20 to object text of iWork item 4 of slide 20 of d
	save d
	return t20
end tell

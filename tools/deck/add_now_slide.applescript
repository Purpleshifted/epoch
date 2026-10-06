-- Insert the "current visuals (demo screenshots)" slide as slide 2 of progress-deck.key.
-- Does not touch any other slide's content (only renumbers kickers/page numbers).
-- Backup first: scratch/progress-deck.before-now-slide.key. DO NOT RE-RUN (guard below).
set R to return
set IMG to "/Volumes/Hesse/exhibition/anthropocene/docs/img/"

on J(L)
	set AppleScript's text item delimiters to return
	set r to L as text
	set AppleScript's text item delimiters to ""
	return r
end J

tell application "Keynote"
	set d to front document
	set n0 to count of slides of d
	repeat with i from 1 to n0
		if (object text of iWork item 1 of slide i of d) contains "NOW" then error "already added"
	end repeat
	-- template = slide 2 (table + bullets + footnote)
	duplicate slide 2 of d
	if (count of slides of d) is not (n0 + 1) then error "unexpected slide count"
	set s to slide (n0 + 1) of d
	if (object text of iWork item 1 of s) is not (object text of iWork item 1 of slide 2 of d) then error "duplicate is not at the end"
	set object text of iWork item 1 of s to "00 · NOW"
	set object text of iWork item 2 of s to "지금의 비주얼: 이 상태가 별로여서 개편한다"
	set object text of iWork item 5 of s to my J({"•  왼쪽 = 지금, 오른쪽 = 시계가 앞으로 간 뒤 (같은 데이터). 방문자 데이터가 아니라 데모 데이터로 만든 Top 화면", "•  문제: 물건이 너무 많고 잡다해서 아무것도 읽히지 않는다. 자연물과 인공물이 같은 아이콘 방식이라 구분이 안 된다. 시간이 많이 흘러도 차이가 잘 안 보인다", "•  그래서 아이콘을 흩뿌리는 방식을 버리고, 오래 남는 구조만 남기는 방식으로 바꾼다 (다음 장부터)"})
	set object text of iWork item 6 of s to "docs/img/shot-top-now.png, shot-top-future.png · 스프라이트와 16색 팔레트로 만든 이전 버전"
	delete table 1 of s
	-- after the table is gone: item 4 = bullets, item 5 = footnote
	set position of iWork item 4 of s to {52, 388}
	tell s
		make new image with properties {file:(POSIX file (IMG & "shot-top-now.png")), position:{52, 112}, width:420}
		make new image with properties {file:(POSIX file (IMG & "shot-top-future.png")), position:{488, 112}, width:420}
	end tell
	move s to after slide 1 of d

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

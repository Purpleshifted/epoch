tell application "Keynote"
	set d to front document
	set R to return
	set object text of iWork item 4 of slide 20 of d to "•  웹 이미지 소스 어떻게 할 것인가…" & R & "•  땅의 지역: 유럽 얕은 연안 (JRC 데이터 기준) 유지 vs 한국 연안 (빈도 데이터를 새로 구해야 함)" & R & "•  불 이벤트를 넣을 것인가? (plastiglomerate · pyroplastic · dark earth에 필요). 제안: 방문자 수명이 끝나는 순간" & R & "•  레이어 비율 70/10/20을 확정할 것인가" & R & "•  수치를 문헌에 따라 어떻게 보정할지 (지금은 순위만 문헌 기반)" & R & "•  자연 필드의 시각 표현: 점 밀도 + 색 (제안)" & R & "•  크레딧 표시: 캔버스에는 텍스트를 넣지 않으므로 별도 페이지에만 둘 것인가?"
	save d
	return object text of iWork item 4 of slide 20 of d
end tell

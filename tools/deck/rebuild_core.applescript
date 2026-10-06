-- Rebuild progress-deck.key around the "structural traces" direction.
-- Backup first: brain/.../scratch/progress-deck.before-core-rebuild.key
-- Keeps slide 1 (edits its text), builds 10 new slides from the template (old slide 3), then deletes old slides 2..N.
-- DO NOT RE-RUN (guard below stops a second run).
set R to return
set IMG to "/Volumes/Hesse/exhibition/anthropocene/docs/img/deck/"

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

on addImg(s, p, x, y, w)
	tell application "Keynote"
		tell s
			make new image with properties {file:(POSIX file p), position:{x, y}, width:w}
		end tell
	end tell
end addImg

-- image slide: fill bullets/footnote first, then drop the table; bullets become item 4, footnote item 5
on dropTable(s)
	tell application "Keynote" to delete table 1 of s
end dropTable

tell application "Keynote"
	set d to front document
	set oldCount to count of slides of d
	repeat with i from 1 to oldCount
		if (object text of iWork item 1 of slide i of d) contains "MESSAGE" then error "already rebuilt"
	end repeat

	---------------- slide 1: direction (edit in place) ----------------
	my setT(slide 1 of d, 9, my J({"•  쓰레기를 이것저것 뿌리지 않는다. 인류가 ‘구조적으로 남긴 흔적’에 집중한다", "•  모바일에서는 자연이 살아 있다. Top·Side에서는 자연과 내 흔적이 사라지고 구조만 남는다", "•  방문자는 고르지 못한다. 걸음의 밀도가 구조를 만든다"}))
	my setT(slide 1 of d, 11, "Changed direction" & R & "쓰레기 148종 카탈로그, 연안 땅, 스프라이트 방식은 보류한다." & R & "고른 기준: 인류세 이전에 없던 것 · 작품에서 크게 다뤄지지 않은 소재." & R & "거주 · 소모 · 전쟁처럼 남는 ‘구조’가 주인공이 된다.")

	---------------- 02 message ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · MESSAGE")
	my setT(s, 2, "인류가 남긴 건 몸이 아니라 흔적이다")
	my fillTable(s, {{"행동 (생흔 분류)", "인류의 흔적", "상징", "작품에서"}, ¬
		{"거주", "콘크리트 기초, 도시 평면", "도시와 거주 형태", "오래 머문 자리"}, ¬
		{"채굴 · 섭식", "시추공, 광산", "소모 (사라진 것의 음화)", "오래 머문 칸 아래의 구멍"}, ¬
		{"포식", "크레이터, 핵실험 공동, 중금속, Pu 지층선", "전쟁", "땅에 일어나는 사건 (고를 수 없음)"}, ¬
		{"이동", "길, 도로", "관객의 걸음", "걸음 밀도가 길이 됨"}, ¬
		{"교환 (고민 중)", "동전", "화폐", "미정 (06)"}}, {150, 300, 200, 210}, 12, 34, 50, 112)
	my setT(s, 5, my J({"•  생흔화석(굴 · 발자국 · 집)은 몸이 아니라 행동의 흔적. 인류를 그렇게 읽으면 ‘뭘 버렸나’가 아니라 ‘어떤 구조를 만들었나’가 남는다", "•  기준 두 가지: 인류세 이전에 없던 것, 작품에서 크게 다뤄지지 않은 소재. 플라스틱 일반은 선행 작업이 많아 뺐다"}))
	my setPos(s, 5, 52, 345)
	my setT(s, 6, "행동 분류는 고생물학의 생흔 분류(Seilacher)를 빌린 해석 [기억, 원문 미확인]")

	---------------- 03 concrete ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · CONCRETE")
	my setT(s, 2, "콘크리트: 거주의 흔적은 건물이 아니라 배치로 남는다")
	my fillTable(s, {{"무엇", "얼마나 남나", "태그"}, ¬
		{"철근콘크리트 건물", "수십 년에서 100년 안팎. 철근이 녹슬어 안에서 깨진다", "S"}, ¬
		{"철근 없는 콘크리트", "수백에서 수천 년 (로마 콘크리트는 약 2천 년)", "S"}, ¬
		{"지하 기초 · 말뚝 · 터널", "묻힌 채 훨씬 오래. 지상 건물은 수백~수천 년 안에 잔해가 된다", "S"}, ¬
		{"시멘트 광물", "건물이 사라진 뒤에도 화학 신호로 남는다", "S"}, ¬
		{"규모", "기술권 전체 약 30조 톤, 대부분 건설 광물 (Zalasiewicz 외 2017)", "S"}}, {210, 580, 70}, 12, 34, 50, 112)
	my setT(s, 5, my J({"•  ‘주거 흔적’이라는 해석에 맞다. 건물은 무너져도 어디에 살았는지(평면)가 땅에 도장처럼 남는다", "•  Top·Side에서는 건물 모양이 아니라 기초의 윤곽이 보인다 (해석)"}))
	my setPos(s, 5, 52, 345)
	my setT(s, 6, "S = 검색 요약만 확인, 원문 미열람 · 지속 기간의 대략적 규모만 보여주는 슬라이드")

	---------------- 04 war ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · WAR")
	my setT(s, 2, "전쟁: 땅 모양과 전 지구 신호가 남는다")
	my fillTable(s, {{"흔적", "남는 것", "얼마나", "태그"}, ¬
		{"Pu-239/240 (대기권 핵실험 낙진)", "전 지구에 동시에 쌓인 얇은 층. 인류세 시작 표지 후보 1순위", "수만 년", "S"}, ¬
		{"핵실험 지하 공동과 함몰 지형 (네바다, 세미팔라틴스크)", "꺼진 땅", "지형 자체가 바뀜", "S"}, ¬
		{"포격 크레이터와 중금속 (베르됭: 납 · 수은 · 비소)", "흙이 뒤섞이고 금속이 스며듦 (bombturbation)", "100년 넘게 검출, 일부 구역 출입 제한", "S"}, ¬
		{"열화우라늄 · 불발탄 · 해저 투기 화학탄 · 트리니타이트 유리", "사실상 영구에 가까운 것들", "매우 김", "기억"}}, {250, 300, 230, 80}, 12, 38, 50, 112)
	my setT(s, 5, my J({"•  전쟁을 상징하는 건 물건이 아니라 지형의 변형과 전 지구에 동시에 쌓인 층", "•  관객 행동이 아니라 땅에 일어나는 사건으로 둔다. ‘내가 정하지 않은 것이 남는다’와 맞다", "•  실시간 연결 후보: USGS가 사람이 일으킨 진동(채석장 발파 · 광산 폭발 · 폭발)을 따로 공개한다. 최근 12개월 1,449 · 185 · 878건, 키 없음 (미국 쏠림)"}))
	my setPos(s, 5, 52, 312)
	my setT(s, 6, "S = 검색 요약 · USGS 건수는 2026-10-06 직접 호출로 확인 · 인류세가 공식 지질시대로 채택되지 않았다는 점은 기억에 의존 (미확인)")

	---------------- 05 borehole ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · BOREHOLE")
	my setT(s, 2, "시추공: 사라진 것이 남기는 음화")
	my setT(s, 5, my J({"•  구멍은 ‘무엇이 있다’가 아니라 ‘무엇이 빠져나갔다’의 흔적. 석유 · 가스 · 물 · 광석, 곧 소모", "•  지질학자는 시추 코어로 지층을 읽는다. Side 뷰를 코어 시료처럼 보이게 하면 소재와 보여주는 형식이 같아진다", "•  우물 주변에서는 지하수 수위가 깔때기 모양으로 내려가 주변 식생에 영향을 준다 [기억]", "•  가장 깊은 시추공은 콜라 초심층 12,262 m [기억]. 총 시추 길이는 본 기억이 있으나 확인하지 못했다"}))
	my setT(s, 6, "이미지는 AI로 만든 무드 목업 (확정 아님) · [기억] = 확인하지 못한 내용")
	my dropTable(s)
	my setPos(s, 4, 52, 118)
	tell application "Keynote" to set width of iWork item 4 of s to 540
	my addImg(s, IMG & "mock_core.jpg", 630, 108, 270)

	---------------- 06 money ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · MONEY")
	my setT(s, 2, "화폐: 구조가 남기는 유일한 물건일지도 (고민 중)")
	my fillTable(s, {{"읽기", "내용", "구분"}, ¬
		{"연대 표지", "고고학에서는 층에서 나온 가장 최근 동전으로 그 층의 하한 연대를 정한다 (terminus post quem). 동전이 지층의 시계가 된다", "사실 [기억]"}, ¬
		{"구조의 흔적", "거주 · 채굴 · 전쟁 모두 값이 매겨진 교환 위에서 일어난다. 보이지 않는 교환 구조가 남기는 물건이 동전", "해석"}, ¬
		{"사라지는 화폐", "지폐는 종이나 폴리머, 카드는 PVC, 디지털 화폐는 물건이 없다. 현금이 줄면 미래 지층에는 돈의 화석이 오히려 줄어든다", "해석"}, ¬
		{"자연의 값", "자연에 가격을 붙이는 시도(생태계 서비스 평가, Costanza 1997). 자연이 돈으로 바뀌는 순간 사라진다는 연결", "해석, 서지 [기억]"}}, {150, 600, 110}, 12, 40, 50, 112)
	my setT(s, 5, "•  정할 것: 동전만 쓸지 지폐 · 카드까지 갈지, 어디에서 나오는지(구조 옆에 놓임? 시추 · 전쟁과 연결?), 관객이 고르지 못하게 할지")
	my setPos(s, 5, 52, 340)
	my setT(s, 6, "동전 재질(청동 · 구리-니켈 등)의 잔존 기간은 확인하지 않음 · 해석은 작가 판단용 제안")

	---------------- 07 nature ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · NATURE")
	my setT(s, 2, "자연은 구조의 원료다: 닳아서 구조가 된다")
	my fillTable(s, {{"구조", "자연에 일어나는 일", "Top · Side에 남는 것"}, ¬
		{"길", "밟히면 식생이 줄고 흙이 다져진다 (Cole 1995 [기억])", "길의 윤곽"}, ¬
		{"기초", "오래 머문 자리가 포장으로 덮여 식생과 흙이 막힌다", "평면 윤곽"}, ¬
		{"시추공", "주변 지하수가 내려가 식생이 마른다", "구멍 (주변은 빈 땅)"}, ¬
		{"크레이터", "반경 안의 식생과 동물이 사라지고 흙이 뒤섞인다", "파인 지형"}, ¬
		{"내 흔적 (발자국 · 눕은 풀 · 놀란 동물)", "모바일에서는 보이지만 시간이 지나면 흔적 없이 사라진다", "없음"}}, {240, 430, 190}, 12, 34, 50, 112)
	my setT(s, 5, my J({"•  모바일에서는 자연이 살아 있고 내가 지나가면 반응한다 (풀이 눕고, 동물이 흩어지고, 물이 고인다)", "•  Top · Side에서는 자연과 내 흔적이 덧없이 사라지고, 자연이 닳은 자리에 구조만 건조하게 남는다", "•  현실도 연한 생물은 거의 화석이 되지 못하고 구조는 남는다. 그 비대칭을 그대로 보여준다 (해석)"}))
	my setPos(s, 5, 52, 335)
	my setT(s, 6, "밟힘과 식생 곡선은 육상 연구 · 지하수와 포장의 효과는 일반 지식으로 미확인 · 모두 설계 의도이며 구현 전")

	---------------- 08 two views ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · TWO VIEWS")
	my setT(s, 2, "같은 땅, 다른 시간: 살아 있는 모바일, 말라붙은 Top · Side")
	my setT(s, 5, my J({"•  모바일: 걷는 동안만. 자연이 살아 있고 내 흔적이 보인다. 나는 무언가를 남기려고 움직인다", "•  Top · Side: 시간이 압축되어 자연과 내 흔적은 금방 사라지고 구조만 남는다", "•  노리는 감각: 덧없음(먼저 사라지는 것)과 건조함 · 헛됨(끝내 남는 것). 색도 빠지고 마른 톤으로 (제안)"}))
	my setT(s, 6, "막대 길이는 순서만 의미하는 개념도 (수치 아님)")
	my dropTable(s)
	my setPos(s, 4, 660, 118)
	tell application "Keynote" to set width of iWork item 4 of s to 250
	my addImg(s, IMG & "fig_visibility.png", 40, 112, 600)

	---------------- 09 interaction ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · INTERACTION")
	my setT(s, 2, "인터랙션 후보: 관객은 걷고, 땅이 구조를 만든다")
	my fillTable(s, {{"아이디어", "관객이 하는 일", "Top · Side에 남는 것", "상태"}, ¬
		{"A. 걸음에서 구조로", "걷고 머문다 (고르지 않음). 밀도에 따라 발자국, 길, 도로, 기초로 올라감", "길과 기초의 윤곽", "제안"}, ¬
		{"B. 수명은 담배 한 개비", "커서가 불씨처럼 줄다가 수명이 끝나면 그 자리에 필터가 남음", "필터 (개인의 잔여물)", "제안, 미결정"}, ¬
		{"C. 시추", "오래 머문 칸 아래로 구멍이 뚫리고, Side 뷰에서는 빈 수직선", "구멍", "제안"}, ¬
		{"D. 전쟁", "하지 않는다. 땅에 일어나는 사건으로 크레이터와 Pu 지층선이 생김", "크레이터, 층선", "제안"}, ¬
		{"E. 화폐", "미정 (06 참고)", "동전", "고민 중"}, ¬
		{"F. 전자기기", "구조가 아니라 물건이라 맞지 않음. 빼거나 지층 깊이의 연대 표지 띠로만", "없음", "빼기 권장"}}, {170, 400, 190, 100}, 12, 36, 50, 112)
	my setT(s, 5, "")
	my setT(s, 6, "모두 제안이며 확정 아님 · 구현 계획은 정해진 뒤에 따로")

	---------------- 10 look ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · LOOK")
	my setT(s, 2, "보이는 모습: 픽셀보다 단면과 지형")
	my setT(s, 5, my J({"•  왼쪽부터 코어 시료(Side) · 지질 블록 다이어그램 · LiDAR형 지형(Top). 16색 팔레트와 디더는 전체 후처리로 유지하면 한 작품으로 보인다 (제안)", "•  구조물은 전부 만들어서 그리므로 이미지 저작권 문제가 없어진다"}))
	my setT(s, 6, "이미지는 AI로 만든 무드 목업 (확정 아님)")
	my dropTable(s)
	my setPos(s, 4, 52, 415)
	my addImg(s, IMG & "mock_core.jpg", 52, 104, 230)
	my addImg(s, IMG & "mock_block.jpg", 365, 104, 230)
	my addImg(s, IMG & "mock_lidar.jpg", 678, 104, 230)

	---------------- 11 decisions ----------------
	set s to my newSlide(d)
	my setT(s, 1, "00 · DECISIONS")
	my setT(s, 2, "정하고 싶은 것")
	my fillTable(s, {{"질문", "내 제안"}, ¬
		{"화폐: 동전만? 지폐 · 카드까지?", "동전만, 구조 옆에 놓임 (미정)"}, ¬
		{"담배 필터를 개인의 잔여물로 쓸까", "쓰자 (수명 = 한 개비)"}, ¬
		{"시추는 어떻게", "오래 머문 칸 아래 구멍 + 코어 뷰의 빈 수직선"}, ¬
		{"전쟁 사건의 타이밍", "정해진 시간표 vs 집단 밀도 조건 (의견 필요)"}, ¬
		{"전자기기", "빼기"}, ¬
		{"모바일에서 자연이 어떻게 반응하나 (풀 · 동물 · 물)", "풀이 눕고 동물이 흩어짐 (구체화 필요)"}, ¬
		{"주 화면: 코어 띠 · 블록 · LiDAR", "코어(Side) + LiDAR(Top)"}}, {430, 430}, 13, 36, 50, 112)
	my setT(s, 5, "")
	my setT(s, 6, "")

	---------------- remove old slides 2..oldCount ----------------
	repeat with k from 1 to (oldCount - 1)
		delete slide 2 of d
	end repeat

	---------------- renumber kickers and page numbers ----------------
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

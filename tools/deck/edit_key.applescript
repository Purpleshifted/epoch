-- Edit the user's Keynote deck (progress-deck.key): refresh stale status text, add a "sources" slide.
-- Backup of the user's version: brain/.../scratch/progress-deck.user-backup-20261005.key
set R to return

on setText(sl, n, txt)
	tell application "Keynote"
		set object text of iWork item n of sl to txt
	end tell
end setText

tell application "Keynote"
	set d to front document

	-- slide 5 (PIPELINE PLAN): visual consistency box + footnote now match what was built
	set s5 to slide 5 of d
	my setText(s5, 20, "•  24×24 셀(내부 20×20) 고정, 정사각 패딩" & R & "•  TempleOS 16색, 스프라이트 내부 디더 없음" & R & "•  어두운 스프라이트만 회색(팔레트 8) 외곽선" & R & "•  양자화 전 자동 대비·채도 보정")
	my setText(s5, 24, "구현: 브라우저 안 배경 제거 + 16색 변환 (Sprite Lab, 실험용). 미구현: 저장 · CLIP 확인 · 크레딧 페이지")

	-- slide 8 (STATUS)
	set s8 to slide 8 of d
	my setText(s8, 6, "•  카탈로그 v2 (148 + 18 품목)" & R & "•  추첨 · 운명 · 자연 스톡, 테스트 73개" & R & "•  저해상도 렌더 + 16색 팔레트 셰이더" & R & "•  스프라이트 프로토타입: 67/148 품목, 변형 247개" & R & "•  위·옆 뷰 재연결 (위 뷰만 화면 확인)" & R & "•  “나” = 깜박이는 커서 블록")
	my setText(s8, 9, "•  모바일 뷰 전체 16색 (오브·안개는 팔레트 밖)" & R & "•  약한 스프라이트 교체 (81품목은 같은 재료 것을 빌림)" & R & "•  자연물: 스프라이트 → 영역+3D 텍스처 검토" & R & "•  자연↔인공 접촉 시 새 객체 (문헌 조사 중)" & R & "•  수명·퇴장 (10초~3분) — 보류" & R & "•  칩 사운드 · 동적 수집 저장 · 크레딧 페이지")
	my setText(s8, 12, "•  1. 자연–인공 혼합 객체 규칙 (문헌 근거)" & R & "•  2. 자연물 비주얼 방향 결정" & R & "•  3. 모바일 16색화, 약한 스프라이트 교체" & R & "•  4. 수명·퇴장, “나”의 풍화 단계" & R & "•  5. 칩 사운드" & R & "•  6. 동적 수집 저장 + 크레딧 페이지")

	-- slide 9 (DECISIONS): add the current proposal behind the user's three new questions
	set s9 to slide 9 of d
	my setText(s9, 4, "•  웹 이미지 소스 어떻게 할 것인가…" & R & "•  동적 수집의 범위: 290개 전부인가, 대표 품목 일부인가?—계속 업데이트 되는 오픈 라이브러리 없는지?" & R & "•  크레딧 표시: 캔버스에는 텍스트를 넣지 않으므로 별도 페이지에만 둘 것인가?" & R & "•  수치를 문헌에 따라 어떻게 보정할지 (지금은 순위만 문헌 기반, 수치는 추정)" & R & "•  “나”의 비주얼 → 제안: 깜박이는 커서 블록 (TempleOS 커서, 구현함)" & R & "•  자연물/인공물 텍스처 차별화 → 지금: 자연물만 흙색 8색 + 거친 입자. 대안: 자연물을 영역 + 3D 텍스처로" & R & "•  자연물 ↔ 인공물 인터랙션 → 엉겨붙어 새 객체가 되는 경우 (plastiglomerate 등) 문헌 조사 중")

	-- new slide: external sources, after slide 4 (copy of the text-only decisions slide)
	duplicate slide 9 of d
	set cnt to count of slides of d
	move slide cnt of d to after slide 4 of d
	set sn to slide 5 of d
	my setText(sn, 1, "05 · SOURCES")
	my setText(sn, 2, "시각 텍스처와 로직에 쓰는 외부 소스")
	my setText(sn, 3, "6")
	my setText(sn, 4, "•  [사용 중] 아이콘 → 스프라이트: Twemoji (CC BY 4.0) · Noto Emoji SVG (Apache-2.0) · Fluent Emoji (MIT) · game-icons.net (CC BY 3.0) · DCSS 타일 (CC0, 작가 확인분만). 16색 24×24로 변환, 크레딧 자동 생성" & R & "•  [사용 중] 팔레트·규칙: TempleOS 16색 VGA 팔레트 (규칙만 차용), 자연물용 흙색 8색 하위 팔레트" & R & "•  [사용 중] 로직 근거: JRC 유럽 폐기물 통계, Bar-On 2018, Cole 1995, Zalasiewicz 외 technofossil — 일부는 검색 요약만 확인" & R & "•  [실험] Wikimedia Commons (CC0·PD·CC BY) 최신 사진 → 16색 변환. 관련 없는 결과가 섞임" & R & "•  [조사 중] 자연–인공 접촉 문헌: plastiglomerate · plasticrust · pyroplastic · plastitar" & R & "•  [후보] Openverse · iNaturalist/GBIF (생물만) · PhyloPic · Quick Draw · Kenney" & R & "•  [제외] CC BY-SA/NC (OpenMoji 등), 검색엔진 이미지 API (Google·Bing 종료, Brave·SerpApi는 저장 권리·소송 문제)")

	save d
	return "slides now: " & (count of slides of d)
end tell

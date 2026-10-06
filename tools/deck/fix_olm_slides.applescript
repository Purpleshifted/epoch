-- Tighten table row heights on the 3 OpenLitterMap slides (4, 5, 6) so bullets do not overlap, then save.
on fixOne(d, n, rowH, tallRow, bulletY)
	tell application "Keynote"
		set s to slide n of d
		set t to table 1 of s
		repeat with r from 1 to (row count of t)
			set height of row r of t to rowH
		end repeat
		if tallRow > 0 then set height of row tallRow of t to 40
		set position of iWork item 5 of s to {52, bulletY}
	end tell
end fixOne

tell application "Keynote"
	set d to front document
	my fixOne(d, 4, 26, 0, 345)
	my fixOne(d, 5, 26, 2, 340)
	my fixOne(d, 6, 26, 0, 362)
	save d
	return "ok"
end tell

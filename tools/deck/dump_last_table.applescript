tell application "Keynote"
	set d to front document
	set s to slide (count of slides of d) of d
	set out to "slide " & (count of slides of d) & linefeed
	set t to table 1 of s
	repeat with r from 1 to row count of t
		repeat with c from 1 to column count of t
			set out to out & "[" & r & "," & c & "] " & (value of cell c of row r of t as text) & linefeed
		end repeat
	end repeat
	return out
end tell

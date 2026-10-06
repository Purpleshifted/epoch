-- List the class and position of every item on the given slides (to find pictures/tables/shapes).
tell application "Keynote"
	set d to front document
	set out to ""
	repeat with i in {3, 5, 6, 7, 8, 9}
		set s to slide i of d
		set out to out & "=== slide " & i & linefeed
		repeat with j from 1 to count of iWork items of s
			set itm to iWork item j of s
			set out to out & "  " & j & " " & (class of itm as text) & " pos=" & (position of itm as text) & " size=" & ((width of itm) as text) & "x" & ((height of itm) as text) & linefeed
		end repeat
	end repeat
	return out
end tell

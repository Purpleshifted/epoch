-- Renumber kicker "NN · NAME" and page number item for all slides.
on renum(k, i)
	set AppleScript's text item delimiters to " · "
	set parts to text items of k
	set AppleScript's text item delimiters to ""
	set nm to ""
	repeat with p from 2 to (count of parts)
		if p > 2 then set nm to nm & " · "
		set nm to nm & (item p of parts)
	end repeat
	set num to (text -2 thru -1 of ("0" & i))
	return num & " · " & nm
end renum

tell application "Keynote"
	set d to front document
	set n to count of slides of d
	repeat with i from 1 to n
		set k to object text of iWork item 1 of slide i of d
		set newK to my renum(k, i)
		set object text of iWork item 1 of slide i of d to newK
		set object text of iWork item 3 of slide i of d to (i as text)
	end repeat
end tell

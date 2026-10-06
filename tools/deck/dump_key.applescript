-- Dump every slide's text items (title/body/text boxes) of the Keynote document.
tell application "Keynote"
	if (count of documents) is 0 then
		open POSIX file "/Users/hesse/Downloads/progress-deck.key"
		delay 3
	end if
	set d to front document
	set out to "slides: " & (count of slides of d) & linefeed
	repeat with i from 1 to count of slides of d
		set s to slide i of d
		set out to out & "=== slide " & i & linefeed
		try
			repeat with j from 1 to count of iWork items of s
				set itm to iWork item j of s
				try
					set t to object text of itm
					if t is not "" then set out to out & "  [" & j & "] " & (t as text) & linefeed
				end try
			end repeat
		end try
	end repeat
	return out
end tell

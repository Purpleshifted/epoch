-- Discard in-memory edits and reopen the deck from the pre-edit backup (restored by the caller).
tell application "Keynote"
	try
		close front document saving no
	end try
end tell

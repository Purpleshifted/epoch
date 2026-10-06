tell application "Keynote"
	set d to front document
	set s to slide 3 of d
	set out to ""
	repeat with i from 1 to count of iWork items of s
		set it1 to iWork item i of s
		set p to position of it1
		set out to out & i & " " & (class of it1 as string) & " pos=" & ((item 1 of p) as string) & "," & ((item 2 of p) as string) & " size=" & ((width of it1) as string) & "x" & ((height of it1) as string) & return
	end repeat
	set t to table 1 of s
	set out to out & "rows=" & (row count of t) & " cols=" & (column count of t) & return
	repeat with c from 1 to column count of t
		set out to out & "colw" & c & "=" & (width of column c of t) & " "
	end repeat
	set out to out & return & "rowh1=" & (height of row 1 of t) & " rowh2=" & (height of row 2 of t) & return
	set out to out & "font=" & (font name of cell 1 of row 2 of t) & " size=" & (font size of cell 1 of row 2 of t) & " hdrsize=" & (font size of cell 1 of row 1 of t) & return
	set out to out & "layouts: "
	repeat with l in slide layouts of d
		set out to out & (name of l) & "; "
	end repeat
	return out
end tell

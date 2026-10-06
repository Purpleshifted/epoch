-- Export the Keynote document to PNG files (one per slide) into /tmp/keynote-export to check text overflow.
tell application "Keynote"
	set d to front document
	export d to POSIX file "/tmp/keynote-export" as slide images with properties {image format:PNG}
	return "exported"
end tell

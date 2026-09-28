# Detailed Instructions to Fix the Errors

## Summary
Both issues are fixed in the code, but you need to **restart the server** for the save endpoint to work.

## Issue 1: `nodeName` ReferenceError ✅ FIXED
This was already fixed - the variable is now renamed to `nodeDisplayName` on line 1785.

## Issue 2: "Cannot POST /save-ncft" - Needs Server Restart

### Steps to Fix:

1. **Stop the current server:**
   - Go to the terminal where `npm start` is running
   - Press `Ctrl+C` (or `Cmd+C` on Mac)
   - Wait until you see the prompt return

2. **Verify the server stopped:**
   ```bash
   ps aux | grep "node.*server.js" | grep -v grep
   ```
   - If nothing shows, the server is stopped ✅
   - If you see a process, kill it: `kill <PID>` (replace <PID> with the number shown)

3. **Restart the server:**
   ```bash
   cd noisecraft
   npm start
   ```

4. **Verify the route is working:**
   - Wait for the server to start (you should see "listening on port 7773")
   - Open your browser to: http://localhost:7773/public/test-workspace.html
   - Open browser console (F12)
   - Make a change in the NoiseCraft editor
   - Press `Ctrl+S` (or `Cmd+S` on Mac)
   - You should see: `[Save] ✓ Saved indiv_audio_map.ncft to server`
   - Check the terminal - it should show: `✓ Saved indiv_audio_map.ncft to ...`

### Alternative: Force Kill and Restart

If the server won't stop cleanly:

```bash
# Find and kill the process
pkill -f "node.*server.js"
pkill -f "npm.*start"

# Wait 2 seconds
sleep 2

# Restart
cd noisecraft
npm start
```

### Verify Route Order (Optional)

The route should be BEFORE static middleware:
- Route at line 383 ✅
- Static middleware at line 440 ✅

This is already correct in the code!


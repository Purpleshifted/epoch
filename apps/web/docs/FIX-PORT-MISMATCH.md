# Port Mismatch Fix

## Issue
The NoiseCraft server defaults to port **7773**, but the scripts were checking port **4000**.

## Solution
Updated scripts now:
- Default to port **7773** (matching server.js)
- Allow override via `HTTP_PORT_NO` or `NOISECRAFT_PORT` environment variables
- Wait up to 30 seconds for server to be ready
- Better error handling

## Quick Fix Commands

### Option 1: Use default port 7773
```bash
node scripts/open-test-workspace.mjs
```

### Option 2: Use custom port (e.g., 4000)
```bash
HTTP_PORT_NO=4000 node scripts/open-test-workspace.mjs
```

### Option 3: Check if server is running
```bash
# Check port 7773 (default)
curl http://localhost:7773

# Check port 4000
curl http://localhost:4000
```

## Manual Start (if needed)

If the script doesn't work, start the server manually:

```bash
cd noisecraft
HTTP_PORT_NO=7773 npm start
```

Then in another terminal, open the workspace:
```bash
open -a "Google Chrome" "http://localhost:7773/public/test-workspace.html"
```




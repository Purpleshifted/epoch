# Fix Instructions for Save and Node Selection Errors

## Issue 1: nodeName ReferenceError

The problem is that `nodeName` is declared twice in the same scope. Here's the fix:

**File: `noisecraft/public/test-workspace.html`**

Find line 1785 and change:
```javascript
const nodeName = selectedNode ? ` (${selectedNode.name})` : "";
statusEl.textContent = `Selected node: ${firstNodeId}${nodeName}`;
```

To:
```javascript
const nodeDisplayName = selectedNode ? ` (${selectedNode.name})` : "";
statusEl.textContent = `Selected node: ${firstNodeId}${nodeDisplayName}`;
```

## Issue 2: Cannot POST /save-ncft/indiv_audio_map.ncft

The server route exists but needs a restart to load the new route order. Follow these steps:

### Step 1: Stop the server
1. Find the terminal where the server is running
2. Press `Ctrl+C` to stop it
3. Confirm it's stopped (you should see the prompt return)

### Step 2: Verify the route is in the correct position
Check that `noisecraft/server.js` has the route BEFORE the static middleware:

Line 381-383 should look like:
```javascript
// POST /save-ncft/:filename - Save .ncft file to examples directory
// IMPORTANT: Define API routes BEFORE static file middleware to ensure they're matched
app.post('/save-ncft/:filename', jsonParser, function (req, res) {
```

And line 439-443 should have the static middleware AFTER:
```javascript
// Serve static file requests (after API routes)
app.use('/public', express.static('public'));

// Serve examples directory
app.use('/public/examples', express.static('examples'));
```

### Step 3: Restart the server
```bash
cd noisecraft
npm start
```

### Step 4: Verify the route works
1. Open browser console
2. Try saving with Ctrl+S
3. You should see: `[Save] ✓ Saved indiv_audio_map.ncft to server`
4. Check the terminal running the server - it should show: `✓ Saved indiv_audio_map.ncft to /path/to/file (XXXX bytes)`

## Quick Fix Script

If you want to verify everything is correct, run this in the noisecraft directory:

```bash
# Check if route is before static middleware
grep -n "app.post('/save-ncft" server.js
grep -n "app.use('/public'" server.js | head -1

# The save route line number should be SMALLER than the static middleware line number
```


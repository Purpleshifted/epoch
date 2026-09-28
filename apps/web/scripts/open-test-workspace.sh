#!/bin/bash
# Open NoiseCraft Virtual Signal Test Workspace
# This opens a standalone test workspace with 3 virtual particles

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Determine the NoiseCraft server URL (default is 7773 per server.js)
NOISECRAFT_PORT="${HTTP_PORT_NO:-${NOISECRAFT_PORT:-7773}}"
NOISECRAFT_URL="http://localhost:${NOISECRAFT_PORT}"

# Check if NoiseCraft server is running
if ! curl -s "${NOISECRAFT_URL}" > /dev/null 2>&1; then
  echo "⚠️  NoiseCraft server not running on ${NOISECRAFT_URL}"
  echo "📝 Starting NoiseCraft server..."
  
  cd "${PROJECT_DIR}/noisecraft"
  if [ ! -f "package.json" ]; then
    echo "❌ Error: NoiseCraft directory not found or invalid"
    exit 1
  fi
  
  # Check if dependencies are installed
  if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install > /tmp/noisecraft-install.log 2>&1
    if [ $? -ne 0 ]; then
      echo "❌ Failed to install dependencies. Check /tmp/noisecraft-install.log"
      exit 1
    fi
    echo "✅ Dependencies installed"
  fi
  
  # Start server in background with correct port
  HTTP_PORT_NO="${NOISECRAFT_PORT}" npm start > /tmp/noisecraft-server.log 2>&1 &
  SERVER_PID=$!
  echo "✅ Started NoiseCraft server (PID: $SERVER_PID) on port ${NOISECRAFT_PORT}"
  
  # Wait for server to be ready (with better checking)
  echo "⏳ Waiting for server to start..."
  SERVER_READY=0
  for i in {1..30}; do
    if curl -s -f "${NOISECRAFT_URL}" > /dev/null 2>&1; then
      echo "✅ Server is ready!"
      SERVER_READY=1
      sleep 1  # Brief delay to ensure server is fully ready
      break
    fi
    sleep 1
    echo -n "."
  done
  
  if [ $SERVER_READY -eq 0 ]; then
    echo ""
    echo "❌ Server failed to start after 30 seconds"
    echo "   Check logs: tail -f /tmp/noisecraft-server.log"
    echo "   Or check if port ${NOISECRAFT_PORT} is already in use"
    exit 1
  fi
fi

# Open the test workspace in Chrome
TEST_URL="${NOISECRAFT_URL}/public/test-workspace.html"
echo "🚀 Opening test workspace in Chrome: ${TEST_URL}"

# Open based on OS
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS - use Chrome instead of default browser
  open -a "Google Chrome" "${TEST_URL}" || open "${TEST_URL}"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  # Linux - try Chrome first
  google-chrome "${TEST_URL}" 2>/dev/null || chromium-browser "${TEST_URL}" 2>/dev/null || xdg-open "${TEST_URL}" 2>/dev/null || firefox "${TEST_URL}" 2>/dev/null
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
  # Windows - try Chrome first
  start chrome "${TEST_URL}" 2>/dev/null || start "${TEST_URL}"
else
  echo "Please open this URL in your browser: ${TEST_URL}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎵 NoiseCraft Virtual Signal Test Workspace"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Features:"
echo "  • 3 virtual particles with displacement & velocity streams"
echo "  • Inner radius (80px): Distinct feedback"
echo "  • Outer radius (150px): Starts to react to surroundings"
echo "  • Tone assignment: Bass/Baritone/Tenor (Nodes 211/212/213)"
echo ""
echo "Controls:"
echo "  • Click a particle to select"
echo "  • WASD or Arrow keys to move selected particle"
echo "  • Sliders to adjust interaction radii"
echo ""
echo "Press Ctrl+C to stop the server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"


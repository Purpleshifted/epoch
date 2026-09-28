#!/usr/bin/env node
/**
 * Open NoiseCraft Virtual Signal Test Workspace
 * 
 * Opens a standalone test workspace with:
 * - 3 virtual particles with displacement & velocity streams
 * - Inner radius (80px) for distinct feedback
 * - Outer radius (150px) for starting to react
 * - Tone assignment to Bass/Baritone/Tenor (Nodes 211/212/213)
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = join(__dirname, "..");
const NOISECRAFT_DIR = join(PROJECT_DIR, "noisecraft");

const NOISECRAFT_PORT = process.env.NOISECRAFT_PORT || process.env.HTTP_PORT_NO || 7773;
const NOISECRAFT_URL = `http://localhost:${NOISECRAFT_PORT}`;
const TEST_URL = `${NOISECRAFT_URL}/public/test-workspace.html`;

async function checkServer(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode === 200);
      res.on("data", () => {});
      res.on("end", () => {});
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkServer(url)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    process.stdout.write(".");
  }
  return false;
}

function openBrowser(url) {
  const platform = process.platform;
  let command;
  let args;

  if (platform === "darwin") {
    // macOS - use Chrome instead of default browser
    command = "open";
    args = ["-a", "Google Chrome", url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", `start chrome "${url}"`];
  } else {
    // Linux - try Chrome first, fallback to default
    command = "google-chrome";
    args = [url];
    // If chrome not found, fallback to xdg-open
    try {
      spawn(command, args, {
        stdio: "ignore",
        detached: true,
      });
      return;
    } catch (e) {
      command = "xdg-open";
      args = [url];
    }
  }

  spawn(command, args, {
    stdio: "ignore",
    detached: true,
  });
}

async function startServer() {
  if (!existsSync(join(NOISECRAFT_DIR, "package.json"))) {
    console.error("❌ Error: NoiseCraft directory not found");
    process.exit(1);
  }

  // Check if dependencies are installed
  const nodeModulesPath = join(NOISECRAFT_DIR, "node_modules");
  if (!existsSync(nodeModulesPath)) {
    console.log("📦 Installing dependencies...");
    const npmInstall = spawn("npm", ["install"], {
      cwd: NOISECRAFT_DIR,
      stdio: "inherit",
    });
    
    await new Promise((resolve, reject) => {
      npmInstall.on("close", (code) => {
        if (code === 0) {
          console.log("✅ Dependencies installed");
          resolve();
        } else {
          console.error("❌ Failed to install dependencies");
          reject(new Error(`npm install exited with code ${code}`));
        }
      });
    });
  }

  console.log("📝 Starting NoiseCraft server...");

  // Set port environment variable for the server
  const npm = spawn("npm", ["start"], {
    cwd: NOISECRAFT_DIR,
    stdio: "ignore",
    detached: true,
    env: {
      ...process.env,
      HTTP_PORT_NO: String(NOISECRAFT_PORT),
    },
  });

  npm.unref();
  return npm.pid;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎵 NoiseCraft Virtual Signal Test Workspace");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Check if server is running
  const serverRunning = await checkServer(NOISECRAFT_URL);
  
  if (!serverRunning) {
    console.log("⚠️  NoiseCraft server not running");
    const pid = await startServer();
    console.log(`✅ Started server (PID: ${pid})`);
    console.log("⏳ Waiting for server to start");
    process.stdout.write("   ");
    
    if (!(await waitForServer(NOISECRAFT_URL))) {
      console.log("\n❌ Server failed to start");
      process.exit(1);
    }
    console.log("\n✅ Server is ready!");
    // Wait a bit more to ensure server is fully ready
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log("");
  } else {
    console.log("✅ NoiseCraft server is already running\n");
  }

  // Open browser
  console.log(`🚀 Opening test workspace in Chrome: ${TEST_URL}\n`);
  openBrowser(TEST_URL);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Features:");
  console.log("  • 3 virtual particles with automatic displacement & velocity streams");
  console.log("  • Gravitational force calculation (F = G × m₁ × m₂ / r²)");
  console.log("  • Stream-to-Node mapping UI with:");
  console.log("    - Node browser (select from dropdown)");
  console.log("    - Multiple streams per node");
  console.log("    - Interpolation modes (linear/log/exponential)");
  console.log("    - Mathematical operations (add/multiply/etc)");
  console.log("  • Inner/Outer radius thresholds");
  console.log("");
  console.log("How to configure nodes:");
  console.log("  1. Click 'Mappings' tab");
  console.log("  2. Click '+ Add Mapping'");
  console.log("  3. Select node from dropdown or type node ID");
  console.log("  4. Configure streams, interpolation, and ranges");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});


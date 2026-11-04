#!/bin/sh
# Bundles the work's headset engine with the site's demo driver into assets/sound-demo.js (esbuild through npx).
cd "$(dirname "$0")/.." && npx -y esbuild@0.24.2 sound/demo.ts --bundle --format=iife --minify --target=es2020 --outfile=assets/sound-demo.js \
  --alias:@/lib/stratum/field=./sound/shims/field.ts --external:@magenta/* --log-level=warning && ls -la assets/sound-demo.js

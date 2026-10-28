#!/bin/bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$TASK_ROOT"
mkdir -p build/Seven.app/Contents/MacOS build/Seven.app/Contents/Resources build/module-cache
node scripts/generate-manifest.mjs
node scripts/icons.mjs
cp native/Info.plist build/Seven.app/Contents/Info.plist
xcrun swiftc -O -whole-module-optimization -module-cache-path "$TASK_ROOT/build/module-cache" \
  -target "$(uname -m)-apple-macosx13.0" -framework AppKit -framework ApplicationServices \
  native/Model.swift native/Overlay.swift native/main.swift -o build/Seven.app/Contents/MacOS/Seven
codesign --force --sign - --identifier app.seven.switcher build/Seven.app
build/Seven.app/Contents/MacOS/Seven --self-test
echo "Built build/Seven.app"

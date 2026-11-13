#!/bin/bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$TASK_ROOT"
mkdir -p build/Neatab.app/Contents/MacOS build/Neatab.app/Contents/Resources build/module-cache
node scripts/generate-manifest.mjs
node scripts/icons.mjs
cp native/Info.plist build/Neatab.app/Contents/Info.plist
# Universal binary: store users may be on Apple silicon or Intel Macs.
for ARCH in arm64 x86_64; do
  xcrun swiftc -O -whole-module-optimization -module-cache-path "$TASK_ROOT/build/module-cache" \
    -target "$ARCH-apple-macosx13.0" -framework AppKit -framework ApplicationServices \
    native/Model.swift native/Overlay.swift native/main.swift -o "build/Neatab-$ARCH"
done
lipo -create build/Neatab-arm64 build/Neatab-x86_64 -output build/Neatab.app/Contents/MacOS/Neatab
rm build/Neatab-arm64 build/Neatab-x86_64
codesign --force --sign - --identifier app.neatab.helper build/Neatab.app
build/Neatab.app/Contents/MacOS/Neatab --self-test
echo "Built build/Neatab.app"

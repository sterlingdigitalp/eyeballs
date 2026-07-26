#!/bin/sh
# Build capture-core and wrap it in a minimal .app so TCC can read NSCameraUsageDescription.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
swift build -c debug
BIN="$(swift build -c debug --show-bin-path)/capture-core"
OUT="${1:-$ROOT/.build/CaptureCore.app}"
rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS"
mkdir -p "$OUT/Contents/Resources"
cp "$BIN" "$OUT/Contents/MacOS/capture-core"
cp "$ROOT/Sources/CaptureCore/Info.plist" "$OUT/Contents/Info.plist"
# Ad-hoc sign so Gatekeeper/TCC accept the bundle identity.
codesign --force --deep --sign - "$OUT"
echo "Packaged: $OUT"
echo "Run: $OUT/Contents/MacOS/capture-core list-devices"

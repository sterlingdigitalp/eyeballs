#!/bin/sh
# Build capture-core and stage it as a Tauri externalBin sidecar.
# Output: apps/desktop/src-tauri/binaries/capture-core-<target-triple>
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

TRIPLE="$(rustc -vV | awk '/^host:/{print $2}')"
if [ -z "$TRIPLE" ]; then
  echo "prepare-capture-core-sidecar: could not detect rustc host triple" >&2
  exit 1
fi

echo "Building capture-core (Swift)…"
swift build --package-path native/capture-macos -c debug
BIN="$(swift build --package-path native/capture-macos -c debug --show-bin-path)/capture-core"
if [ ! -f "$BIN" ]; then
  echo "prepare-capture-core-sidecar: missing $BIN" >&2
  exit 1
fi

OUT_DIR="apps/desktop/src-tauri/binaries"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/capture-core-$TRIPLE"
# Also stage un-suffixed name for local resolve helpers.
cp "$BIN" "$OUT"
cp "$BIN" "$OUT_DIR/capture-core"
chmod +x "$OUT" "$OUT_DIR/capture-core"

# Minimal .app next to sidecar for ad-hoc TCC experiments (optional helper).
if [ -x native/capture-macos/scripts/package-capture-core-app.sh ]; then
  native/capture-macos/scripts/package-capture-core-app.sh \
    >/dev/null 2>&1 || true
fi

echo "Staged CaptureCore sidecar:"
echo "  $OUT"
ls -la "$OUT" "$OUT_DIR/capture-core"

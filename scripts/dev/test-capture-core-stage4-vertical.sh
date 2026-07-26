#!/bin/sh
# Stage 4 vertical slice smoke (agent-safe): confined session → dry-run → Rust seal via cargo test.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "Stage 4: build capture-core + run vertical-slice cargo test…"
swift build --package-path native/capture-macos >/dev/null
sh scripts/dev/prepare-capture-core-sidecar.sh >/dev/null
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  stage4_vertical_slice_prepare_record_seal -- --nocapture

echo "Stage 4: shell dry-run multi-segment…"
sh scripts/dev/test-capture-core-dry-run.sh

echo "Stage 4 vertical slice OK (prepare → record → SHA-256 seal)"

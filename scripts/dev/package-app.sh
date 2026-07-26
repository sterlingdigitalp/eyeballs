#!/bin/sh
set -eu

npm run prepare:assets
sh scripts/dev/prepare-capture-core-sidecar.sh
npm run tauri build -- --bundles app

app_path="apps/desktop/src-tauri/target/release/bundle/macos/Camera Presence Coach.app"
codesign --force --sign - "$app_path"
plutil -lint "$app_path/Contents/Info.plist"
codesign --verify --deep --strict --verbose=2 "$app_path"

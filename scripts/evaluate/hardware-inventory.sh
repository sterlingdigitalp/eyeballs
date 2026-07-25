#!/bin/sh
set -eu

workspace_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output_file=${1:-"$workspace_dir/docs/benchmarks/hardware-inventory.json"}
mkdir -p "$(dirname "$output_file")"

swift run --package-path "$workspace_dir/native/capture-macos" capture-probe > "$output_file"

if ! grep -qi 'MacBook Pro Camera' "$output_file"; then
  printf '%s\n' "FAIL: MacBook camera was not detected." >&2
  exit 1
fi

printf '%s\n' "Hardware inventory written to $output_file"
if ! grep -Eqi 'Brio|V-U0040' "$output_file"; then
  printf '%s\n' "NOTICE: Brio was not connected; Studio Capture acceptance remains pending." >&2
fi
if ! grep -Eqi 'Yeti|A00132' "$output_file"; then
  printf '%s\n' "NOTICE: Yeti was not connected; Studio Capture audio acceptance remains pending." >&2
fi

#!/bin/sh
set -eu

workspace_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
public_dir="$workspace_dir/apps/desktop/public"
mediapipe_dir="$workspace_dir/node_modules/@mediapipe/tasks-vision/wasm"
model_file="$public_dir/models/face_landmarker.task"
expected_model_sha="64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"

mkdir -p "$public_dir/mediapipe/wasm" "$public_dir/models"
cp "$mediapipe_dir"/vision_wasm_* "$public_dir/mediapipe/wasm/"

if [ ! -s "$model_file" ]; then
  curl --fail --location --silent --show-error \
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
    --output "$model_file"
fi

actual_model_sha=$(shasum -a 256 "$model_file" | awk '{print $1}')
if [ "$actual_model_sha" != "$expected_model_sha" ]; then
  printf '%s\n' "Face-landmarker checksum mismatch." >&2
  exit 1
fi

printf '%s\n' "Prepared local MediaPipe runtime and face-landmarker model."

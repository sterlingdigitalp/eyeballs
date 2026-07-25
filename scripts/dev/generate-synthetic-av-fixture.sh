#!/bin/sh
set -eu

output_path="${1:-fixtures/synthetic/synthetic-av.mp4}"
output_directory=$(dirname "$output_path")
mkdir -p "$output_directory"

ffmpeg \
  -hide_banner \
  -loglevel error \
  -y \
  -f lavfi \
  -i "color=c=0x10221c:s=1280x720:r=30:d=8" \
  -f lavfi \
  -i "sine=frequency=1000:sample_rate=48000:duration=8" \
  -vf "drawbox=x=(w-120)/2:y=(h-120)/2:w=120:h=120:color=0x7ee2b8:t=fill:enable='lt(mod(t,1),0.1)'" \
  -af "volume='if(lt(mod(t,1),0.1),0.25,0)':eval=frame" \
  -map_metadata -1 \
  -metadata creation_time=1970-01-01T00:00:00Z \
  -c:v libx264 \
  -preset veryslow \
  -crf 18 \
  -pix_fmt yuv420p \
  -c:a aac \
  -b:a 128k \
  -fflags +bitexact \
  -flags:v +bitexact \
  -flags:a +bitexact \
  -movflags +faststart \
  -shortest \
  "$output_path"

ffprobe \
  -v error \
  -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,duration \
  -of json \
  "$output_path"

#!/usr/bin/env bash
# Usage: scripts/contact-sheets.sh <video.mp4> <outdir>
# Builds labelled contact sheets per scene (every 5th frame) and a seam strip.
set -euo pipefail
VIDEO="$1"
OUT="$2"
mkdir -p "$OUT"

sheet() { # name start end step cols
  local name=$1 start=$2 end=$3 step=$4 cols=$5
  local n=$(( (end - start) / step + 1 ))
  local rows=$(( (n + cols - 1) / cols ))
  ffmpeg -v error -y -i "$VIDEO" -vf "select='between(n\,$start\,$end)*not(mod(n-$start\,$step))',scale=384:216,drawtext=text='%{n}':x=6:y=6:fontsize=18:fontcolor=lime:box=1:boxcolor=black@0.6,tile=${cols}x${rows}:padding=4:color=gray" -frames:v 1 -fps_mode passthrough "$OUT/$name.png"
}

sheet overview 0 839 20 7
sheet s1 0 119 5 6
sheet s2 120 224 5 6
sheet s3 225 374 5 6
sheet s4 375 524 5 6
sheet s5 525 599 3 6
sheet s6 600 704 4 6
sheet s7 705 839 5 6

# Seam strip: last frame of each scene next to the first frame of the next (scale 0.4).
for pair in "119 120" "224 225" "374 375" "524 525" "599 600" "704 705"; do
  set -- $pair
  ffmpeg -v error -y -i "$VIDEO" -vf "select='eq(n\,$1)+eq(n\,$2)',scale=768:432,drawtext=text='%{n}':x=8:y=8:fontsize=22:fontcolor=lime:box=1:boxcolor=black@0.6,tile=2x1:padding=4:color=gray" -frames:v 1 -fps_mode passthrough "$OUT/seam-$1-$2.png"
done
echo "sheets in $OUT"

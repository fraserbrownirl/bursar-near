#!/bin/sh
# One assembly script. ./assemble.sh [vN]
# Takes are attacks/takes/vN-<id>-tK.mp4. Comments below are the editing plan.
set -eu
cd "$(dirname "$0")/../.."
VIDEO=attacks/video
TAKES=attacks/takes
mkdir -p "$VIDEO"
if [ "${1:-}" = "" ]; then
  N=1
  while [ -f "$VIDEO/attacks-v$N.mp4" ]; do N=$((N + 1)); done
else
  N=$1
fi
BG=0x111111
# take times: filled from the dry run. In-model spans are sped ×8 only on attacks-vN.
# deadline, extra-intent, tampered-quote carry a span. Every other shot stays at 1×.

ids="blocklist challenge deadline extra-intent inflate invoice-es invoice-zh invoice ledger limit lookalike mcp-agent poison pressure qr standing-payee switched tampered-quote wrong-receive"
# Highlights order is fixed in build_highlights: the three in-model shots, the
# verify:weights replay, then switched, poison, lookalike, invoice-zh.

latest() {
  id=$1
  last=$(ls -1t "$TAKES"/v"$N"-"$id"-t*.mp4 2>/dev/null | head -1 || true)
  echo "$last"
}

span_seconds() {
  id=$1
  file="$HOME/.bursar-attacks/$id/spans.jsonl"
  if [ ! -f "$file" ]; then
    echo 0
    return
  fi
  awk 'BEGIN { max=0 } { if (match($0, /"start":[0-9]+/)) { s=substr($0, RSTART+8, RLENGTH-8) } if (match($0, /"end":[0-9]+/)) { e=substr($0, RSTART+6, RLENGTH-6); d=(e-s)/1000; if (d>max) max=d } } END { printf "%.3f", max }' "$file"
}

title_card() {
  text=$1
  out=$2
  ffmpeg -y -v error -f lavfi -i "color=c=${BG}:s=1920x1080:d=2" \
    -vf "drawtext=fontfile=/System/Library/Fonts/Menlo.ttc:text='${text}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" \
    -an -c:v libx264 -pix_fmt yuv420p -r 30 "$out"
}

normalise() {
  in=$1
  out=$2
  id=$3
  span=$(span_seconds "$id")
  # Hold the last frame, which is the STOP, for 2 seconds.
  hold="tpad=stop_mode=clone:stop_duration=2"
  base="scale=-2:1080,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=${BG}"
  if [ "$id" = "deadline" ] || [ "$id" = "extra-intent" ] || [ "$id" = "tampered-quote" ]; then
    dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in")
    start=$(awk -v d="$dur" -v s="$span" 'BEGIN { v=d-s-1; if (v<0) v=0; printf "%.3f", v }')
    end=$(awk -v d="$dur" -v s="$span" 'BEGIN { v=d-1; if (v<0) v=d; printf "%.3f", v }')
    badge=$(awk -v s="$span" 'BEGIN { printf "×8 · real time %.0f s", s }')
    # take times: ramp the in-model span that ends one second before the STOP frame.
    ffmpeg -y -v error -i "$in" -filter_complex \
      "[0:v]trim=0:${start},setpts=PTS-STARTPTS,${base}[a]; \
       [0:v]trim=${start}:${end},setpts=(PTS-STARTPTS)/8,${base},drawtext=fontfile=/System/Library/Fonts/Menlo.ttc:text='${badge}':fontsize=36:fontcolor=white:box=1:boxcolor=black@0.6:x=40:y=h-80[b]; \
       [0:v]trim=${end},setpts=PTS-STARTPTS,${base},${hold}[c]; \
       [a][b][c]concat=n=3:v=1:a=0[v]" \
      -map "[v]" -an -c:v libx264 -pix_fmt yuv420p -r 30 "$out"
  else
    ffmpeg -y -v error -i "$in" -vf "${base},${hold}" -an -c:v libx264 -pix_fmt yuv420p -r 30 "$out"
  fi
}
# Highlights. The three in-model shots keep the request and the evidence line.
# The idle between those is a cut. verify:weights keeps the command and the match
# line at 1x; only the wait is sped, and the badge states that wait's real seconds.
# The four code shots stay at 1x, after the card that says code stopped them.
build_highlights() {
  HDIR="$VIDEO/h$N"
  mkdir -p "$HDIR"
  title_card "Stopped inside the model" "$HDIR/card-inside.mp4"
  title_card "And the usual scams, stopped by code" "$HDIR/card-code.mp4"
  CUTS=""
  for id in tampered-quote extra-intent deadline; do
    raw=$(latest "$id")
    if [ "$raw" = "" ]; then
      echo "highlight missing $id" >&2
      exit 1
    fi
    dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$raw")
    keep_head=8
    keep_tail=14
    end=$(awk -v d="$dur" -v t="$keep_tail" 'BEGIN { printf "%.3f", d-t }')
    ffmpeg -y -v error -i "$raw" -filter_complex \
      "[0:v]trim=0:${keep_head},setpts=PTS-STARTPTS[a];[0:v]trim=${end},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=2[b];[a][b]concat=n=2:v=1:a=0[v]" \
      -map "[v]" -an -c:v libx264 -pix_fmt yuv420p -r 30 "$HDIR/$id.mp4"
    removed=$(awk -v d="$dur" -v h="$keep_head" -v t="$keep_tail" 'BEGIN { printf "%.3f", d-h-t }')
    CUTS="${CUTS}| ${id} | ${keep_head}s to ${end}s | ${removed}s removed |\n"
  done
  for id in switched poison lookalike invoice-zh; do
    raw=$(latest "$id")
    if [ "$raw" = "" ]; then
      echo "highlight missing $id" >&2
      exit 1
    fi
    ffmpeg -y -v error -i "$raw" -vf "tpad=stop_mode=clone:stop_duration=2" -an -c:v libx264 -pix_fmt yuv420p -r 30 "$HDIR/$id.mp4"
  done
  raw=$(ls -1t "$TAKES"/v"$N"-verify-quote-t*.mp4 2>/dev/null | head -1 || true)
  if [ "$raw" = "" ]; then
    echo "highlight missing verify-quote" >&2
    exit 1
  fi
  python3 - "$raw" "$HDIR/verify.times" <<'PY'
import subprocess, sys
path, out = sys.argv[1], sys.argv[2]
dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], text=True).strip())

def frame(t):
    t = max(0.0, min(t, max(0.0, dur - 0.05)))
    result = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1", "-vf", "scale=64:36", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True)
    return result.stdout

def dist(a, b):
    if not a or len(a) != len(b):
        return 10**9
    return sum(abs(x - y) for x, y in zip(a, b))

settled = None
base = None
t = 1.0
while t < 45:
    sample = frame(t)
    if dist(sample, frame(t + 5)) < 2000:
        settled = t
        base = sample
        break
    t += 1.0
if settled is None:
    settled = 8.0
    base = frame(settled)
    print("verify take did not settle; speeding from 8s", file=sys.stderr)
if dist(frame(dur - 1), base) < 2000:
    raise SystemExit("match line is not in the last second of the verify take")
wait_end = dur - 3
if wait_end <= settled:
    raise SystemExit("verify take is too short to speed")
open(out, "w").write(f"{settled:.3f} {wait_end:.3f} {dur:.3f}\n")
PY
  read -r settled wait_end vdur < "$HDIR/verify.times"
  wait=$(awk -v a="$settled" -v b="$wait_end" 'BEGIN { printf "%.3f", b-a }')
  fixed=0
  for piece in card-inside tampered-quote extra-intent deadline card-code switched poison lookalike invoice-zh; do
    plen=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$HDIR/$piece.mp4")
    fixed=$(awk -v s="$fixed" -v d="$plen" 'BEGIN { printf "%.3f", s+d }')
  done
  model=0
  for piece in tampered-quote extra-intent deadline; do
    plen=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$HDIR/$piece.mp4")
    model=$(awk -v s="$model" -v d="$plen" 'BEGIN { printf "%.3f", s+d }')
  done
  tail=$(awk -v d="$vdur" -v w="$wait_end" 'BEGIN { printf "%.3f", d-w }')
  replay_budget=$(awk -v m="$model" -v f="$fixed" 'BEGIN { printf "%.3f", (m/0.60)-f }')
  sped_budget=$(awk -v r="$replay_budget" -v h="$settled" -v t="$tail" 'BEGIN { v=r-h-t; if (v<5) v=5; printf "%.3f", v }')
  factor=$(awk -v w="$wait" -v s="$sped_budget" 'BEGIN { n=int(w/s+0.5); if (n<1) n=1; print n }')
  screen_wait=$(awk -v w="$wait" -v n="$factor" 'BEGIN { printf "%.3f", w/n }')
  planned=$(awk -v f="$fixed" -v h="$settled" -v s="$screen_wait" -v t="$tail" 'BEGIN { printf "%.3f", f+h+s+t }')
  over=$(awk -v p="$planned" 'BEGIN { print (p>133) }')
  if [ "$over" = "1" ]; then
    sped_budget=$(awk -v f="$fixed" -v h="$settled" -v t="$tail" 'BEGIN { v=133-f-h-t; if (v<3) v=3; printf "%.3f", v }')
    factor=$(awk -v w="$wait" -v s="$sped_budget" 'BEGIN { n=int(w/s+0.999); if (n<1) n=1; print n }')
  fi
  real_s=$(awk -v w="$wait" 'BEGIN { printf "%.0f", w }')
  badge="×${factor} · real time ${real_s} s"
  echo "verify wait ${wait}s from ${settled} to ${wait_end}, ${badge}"
  ffmpeg -y -v error -i "$raw" -filter_complex \
    "[0:v]trim=0:${settled},setpts=PTS-STARTPTS[a]; \
     [0:v]trim=${settled}:${wait_end},setpts=(PTS-STARTPTS)/${factor},fps=30,drawtext=fontfile=/System/Library/Fonts/Menlo.ttc:text='${badge}':fontsize=36:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12:x=40:y=h-80[b]; \
     [0:v]trim=${wait_end},setpts=PTS-STARTPTS[c]; \
     [a][b][c]concat=n=3:v=1:a=0[v]" \
    -map "[v]" -an -c:v libx264 -pix_fmt yuv420p -r 30 "$HDIR/verify-quote.mp4"
  CUTS="${CUTS}| verify-quote | ${settled}s to ${wait_end}s | sped ×${factor}, real time ${real_s} s |\n"
  HLIST=$(mktemp)
  : > "$HLIST"
  for piece in card-inside tampered-quote extra-intent deadline verify-quote card-code switched poison lookalike invoice-zh; do
    echo "file '$(pwd)/$HDIR/$piece.mp4'" >> "$HLIST"
  done
  HJOIN="$VIDEO/highlights-v$N-joined.mp4"
  ffmpeg -y -v error -f concat -safe 0 -i "$HLIST" -c copy "$HJOIN"
  ffmpeg -y -v error -i "$HJOIN" -c copy -an -fflags +genpts "$VIDEO/highlights-v$N.mp4"
  rm -f "$HLIST"
  htotal=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO/highlights-v$N.mp4")
  audio=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$VIDEO/highlights-v$N.mp4" || true)
  if [ -n "$audio" ]; then
    echo "highlights-v$N.mp4 has audio" >&2
    exit 1
  fi
  echo "highlights-v$N.mp4 $htotal s, model shots ${model}s"
  awk -v t="$htotal" 'BEGIN { if (t>135) exit 1 }' || echo "highlights-v$N.mp4 is ${htotal}s, over 2 minutes 15 seconds" >&2
}


if [ "${2:-}" = "highlights" ] && [ "$N" -ge 4 ]; then
  python3 attacks/highlights.py "$N"
  exit 0
fi

if [ "${2:-}" = "highlights" ]; then
  build_highlights
  htotal=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO/highlights-v$N.mp4")
  {
    awk 'index($0, "highlights-v'"$N"'.mp4")==1 { exit } { print }' "$VIDEO/timeline-v$N.md"
    echo "highlights-v$N.mp4 $htotal s"
    echo
    echo "| cut | from | removed |"
    echo "| --- | --- | --- |"
    printf "%b" "$CUTS"
  } > "$VIDEO/timeline-v$N.md.tmp"
  mv "$VIDEO/timeline-v$N.md.tmp" "$VIDEO/timeline-v$N.md"
  echo "wrote $VIDEO/highlights-v$N.mp4 $VIDEO/timeline-v$N.md"
  exit 0
fi


LIST=$(mktemp)
: > "$LIST"
DROPPED=""
for id in $ids; do
  src=$(latest "$id")
  if [ "$src" = "" ]; then
    DROPPED="${DROPPED}${id} "
    echo "not in the film: $id" >&2
    continue
  fi
  seg="$VIDEO/v$N-$id.mp4"
  card="$VIDEO/v$N-$id-title.mp4"
  body="$VIDEO/v$N-$id-body.mp4"
  title_card "$id" "$card"
  normalise "$src" "$body" "$id"
  printf "file '%s'\nfile '%s'\n" "$(pwd)/$card" "$(pwd)/$body" > "$VIDEO/v$N-$id-list.txt"
  ffmpeg -y -v error -f concat -safe 0 -i "$VIDEO/v$N-$id-list.txt" -c copy "$seg"
  echo "file '$(pwd)/$seg'" >> "$LIST"
done
JOINED="$VIDEO/attacks-v$N-joined.mp4"
ffmpeg -y -v error -f concat -safe 0 -i "$LIST" -c copy "$JOINED"
ffmpeg -y -v error -i "$JOINED" -c copy -an -fflags +genpts "$VIDEO/attacks-v$N.mp4"

build_highlights

{
  echo "# timeline v$N"
  echo
  echo "| segment | start | end | length |"
  echo "| --- | --- | --- | --- |"
  cursor=0
  for id in $ids; do
    seg="$VIDEO/v$N-$id.mp4"
    if [ ! -f "$seg" ]; then
      printf "| %s | | | not recorded |\n" "$id"
      continue
    fi
    len=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$seg")
    end=$(awk -v c="$cursor" -v l="$len" 'BEGIN { printf "%.3f", c+l }')
    printf "| %s | %.3f | %s | %s |\n" "$id" "$cursor" "$end" "$len"
    cursor=$end
  done
  total=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO/attacks-v$N.mp4")
  echo
  echo "attacks-v$N.mp4 $total s"
  htotal=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO/highlights-v$N.mp4")
  echo "highlights-v$N.mp4 $htotal s"
  echo
  echo "| cut | from | removed |"
  echo "| --- | --- | --- |"
  printf "%b" "$CUTS"
  if [ -n "${DROPPED}" ]; then echo "not recorded: ${DROPPED}"; fi
} > "$VIDEO/timeline-v$N.md"

htotal=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO/highlights-v$N.mp4")
awk -v t="$htotal" 'BEGIN { if (t>135) exit 1 }' || echo "highlights-v$N.mp4 is ${htotal}s, over 2 minutes 15 seconds" >&2
echo "wrote $VIDEO/attacks-v$N.mp4 $VIDEO/highlights-v$N.mp4 $VIDEO/timeline-v$N.md"

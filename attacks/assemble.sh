#!/bin/sh
# Builds the attack films from recorded takes. assemble.sh [vN] [highlights|full]
# Takes are attacks/takes/vN-<id>-tK.mp4. Film data is attacks/video/hN/data.json.
set -eu
cd "$(dirname "$0")/.."
N=${1:-6}
MODE=${2:-highlights}
exec python3 attacks/film.py "$MODE" "$N" --data "attacks/video/h$N/data.json"

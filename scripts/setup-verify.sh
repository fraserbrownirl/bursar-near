#!/bin/sh
# One-time setup for npm run verify:firmware and npm run verify:weights:
# a Python 3.11+ environment with the pinned packages, at .venv-verify/.
set -e
cd "$(dirname "$0")/.."

if [ -x .venv-verify/bin/python ]; then
  .venv-verify/bin/python -c "import numpy, torch, safetensors, tokenizers, huggingface_hub" 2>/dev/null || {
    echo ".venv-verify is broken; delete it and run again" >&2
    exit 1
  }
  echo "setup:verify ok (.venv-verify already built)"
  exit 0
fi

PYTHON=""
for candidate in "$BURSAR_PYTHON" python3.13 python3.12 python3.11 python3; do
  if [ -n "$candidate" ] && command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; raise SystemExit(sys.version_info < (3, 11))'; then
      PYTHON="$candidate"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo "verify needs Python 3.11 or newer (on a Mac: brew install python@3.13)" >&2
  exit 1
fi

"$PYTHON" -m venv .venv-verify
.venv-verify/bin/pip install --no-input -r requirements-verify.txt
echo "setup:verify ok ($PYTHON)"

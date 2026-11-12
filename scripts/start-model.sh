#!/bin/sh
# The model server. ETH_SRC is required for @file inputs (1click check, intents dec).
set -e
cd "$HOME/Dev/ethereus-mac"
export LOCALS_ETH_PACK=all9b
export LOCALS_CHIPFORMER="$HOME/Dev/ethereus/experimental/riscv"
# The real 9B checkpoint. eth-src is only the small stand-in (tokenizer link,
# three config keys, store defaults) used when this tree is not on the machine.
if [ -z "${ETH_SRC:-}" ]; then
  REAL="$HOME/Dev/ethereus-artifacts/2026-11-02/q9-store-rv"
  if [ -f "$REAL/tokenizer.json" ]; then
    ETH_SRC="$REAL"
  else
    ETH_SRC="$HOME/.locals/ethereus/eth-src"
  fi
fi
export ETH_SRC
exec .venv/bin/python -m locals.server --port 8000 --model bursar-9b

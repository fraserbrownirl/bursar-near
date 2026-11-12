# Vendored emulator and computer

The Python under this directory lets `npm run verify:firmware` and
`npm run verify:weights` run with nothing but this repository, a Python
3.11+ environment and the packages in `requirements-verify.txt` (in the
repository root). The files are copied unmodified from two private
checkouts; edit them upstream and copy again, do not fork them here.

| Path | Source | Commit |
| --- | --- | --- |
| `chipformer/` (the files listed below) | ethereus, `experimental/riscv/chipformer/` | `32546f222155d5f2c998b51a7b04b325fdce2bad` |
| `locals/` (the files listed below) | ethereus-mac, `locals/` | `d78a6c94b2100bdc7ed7aa096a3da663dbbf6928` |

From chipformer: `dsl/graph.py`, `q35/ir.py`, `q35/prims.py`, and from
`rv/`: `asm.py`, `bridge.py`, `core.py`, `elf.py`, `ref.py`, `spec.py`,
`spill.py`, `store.py`, with the `__init__.py` of each package. That is
the RV32IM reference machine (`rv/ref.py`), the bridge between text and
the machine (`rv/bridge.py`), and the circuit the computer's weights
were compiled from (`rv/core.py`).

From locals: `models/eth_spill.py` (`@file` spill planning),
`models/ethereus_cpu.py` (the computer on CPU, torch),
`models/qwenputer.py` (firmware snapshots), `models/tracehash.py`
(the receipt trace hash).

`firmware/checkpoint/` in this repository holds the checkpoint's
`config.json` and `chipformer.json` (ethereus-artifacts
`2026-11-02/q9-store-rv`). The third checkpoint file, `tokenizer.json`,
is Qwen3.5's, downloaded from Hugging Face and checked against the
SHA-256 pinned in `scripts/computer_run.py`.

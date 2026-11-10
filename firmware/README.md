# Firmware

The computer in the weights runs this bridge ELF.

| | |
| --- | --- |
| File | `eth-bridge.elf` |
| SHA-256 | `3bc277a53d1ac9cc359201997281e9eb363665915533628dfe198e3b92609ddd` |
| Bytes | 467912 |
| Source tree | ethereus `all-chains` `5513411398a3001c57977e6272986ff043bb9f36` |
| Compiler | `riscv64-elf-gcc` 16.2.0 |
| Flags | `-march=rv32im_zba -mabi=ilp32`, `-O2`, `solops.c` and `curve_mono.c` at `-Os` |
| libc | picolibc rv32im/ilp32, `experimental/riscv/toolchain/picolibc-rv32im`. Not newlib |
| solc | 0.8.38, used by `gen_builtins.py` |

The source is not in this repository yet. `npm run verify:firmware` builds it from `BURSAR_FIRMWARE_SRC`, or from `../ethereus/experimental/riscv` when that checkout is next to this one. The build command is `chipformer/rv/env/eth/build_eth.sh OUT eth-bridge --bridge`, with `PYTHON` set to a interpreter that has `eth_hash` and `solcx` (the tree's `.venv`).

A rebuild from that tree produces the same loadable segments as the pinned ELF. The file SHA-256 differs in 17 bytes, all in `.strtab`: `gcc` writes a fresh temporary object name into the symbol strings (`ccWSunzj.o` in the pinned file). Those names are not loaded. `verify:firmware` requires the loadable segments to match, and it runs the pinned file, whose SHA-256 is the one in the receipts.

Publishing this source into `firmware/` waits for Fraser.

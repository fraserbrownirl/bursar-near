# Firmware

The computer in the weights runs this bridge ELF.

| | |
| --- | --- |
| File | `eth-bridge.elf` |
| SHA-256 | `8cb34279eb5d0528800beebb618b750c52bbddd792f61742dd1b01480523a2be` |
| Bytes | 468000 |
| Source tree | ethereus `all-chains` `5513411398a3001c57977e6272986ff043bb9f36` |
| Compiler | `riscv64-elf-gcc` 16.2.0 |
| Flags | `-march=rv32im_zba -mabi=ilp32`, `-O2`, `solops.c` and `curve_mono.c` at `-Os` |
| libc | picolibc rv32im/ilp32, `experimental/riscv/toolchain/picolibc-rv32im`. Not newlib |
| solc | 0.8.38, used by `gen_builtins.py` |

The source is not in this repository. `eth-bridge.elf` in this directory is the pinned file. `npm run verify:firmware -- <receipt-hash>` checks that file against the SHA-256 above, then runs it in the chipformer emulator on the receipt's input and compares the output. Install the emulator with `python3.13 -m pip install -e ../ethereus/experimental/riscv`.

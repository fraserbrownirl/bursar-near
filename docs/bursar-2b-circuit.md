# Bursar-2B circuit

Superseded for the firmware pin by `firmware/README.md`. Measured 2026-11-11. The hashes below are that measurement, not the current pin.

The 9B circuit measured here is the build before the slim image: 11 layers, 2918 dims, 103 heads, 42114 MLP units, max 8149 units in one MLP. Its firmware and the trace `6d4827eb18025c05ed19a22fa792856cd058e7cc4b3a275e555046815acd9a07` are not this file.

The 2B host is stock Qwen3.5-2B: hidden 2048, 16 key heads, 16 value heads, MLP 6144. No widening. Ballast 0. `pick_hidden` is not used. The computer is placed in that hidden size.

What changed, and why:

- Qwen3.5-2B has one value head per key head. The 9B tables use a second value head as one address bit. Each of those value heads is now its own key head, with the same queries and keys. The 9B path (two value heads per key head) is the old one.
- ROM is 64 KB (was 256 KB), DROM 8 KB (was 128 KB), RAM 16 KB (was 32 KB). The bank address bits above those sizes are not decoded. The slim ELF's `.text` is 42944 bytes and `.rodata` is 4320, and `.bss` ends at 12448, so the smaller map covers it.
- Each MLP is placed with 144 units left free (`unit_reserve`). Those units clear a dim whose last reader has already run, so a later stage reuses the slot. Without that, the reused slot count is 2080, which does not fit in 2048.

Solana, Stellar, and the EVM are not in the 2B firmware. The image keeps `amount`, `ui`, `intents dec`, `1click check`, the `eth_in` spill path, and `@file`.

| Component | Dims | Heads | MLP units |
| --- | --- | --- | --- |
| rom | 29 | 16 | 3014 |
| ram | 32 | 32 | 0 |
| drom | 36 | 2 | 4016 |
| regs | 96 | 3 | 0 |
| quo | 32 | 8 | 0 |
| bn | 277 | 16 | 4103 |
| div | 796 | 0 | 8685 |
| mul | 338 | 0 | 9212 |
| sh | 128 | 0 | 1954 |
| add | 81 | 0 | 4040 |
| zba | 81 | 0 | 1192 |
| btgt | 41 | 0 | 532 |
| uop | 59 | 0 | 470 |
| cap | 82 | 1 | 161 |
| pc | 16 | 1 | 0 |
| link | 18 | 0 | 288 |
| exit | 0 | 0 | 450 |
| code | 0 | 0 | 42 |
| rest | 490 | 7 | 3955 |

The rows count a dim at the node that writes it. 286 dims are token features or adds onto an existing dim, so they are not in the table. The circuit's own total is 2918 dims, 86 heads, 42114 MLP units, 12 layers, at most 6000 units in one MLP. After reuse, `allocate` reports 1627 slots. `1 + 1627 <= 2048`.

Firmware file `/tmp/bursar-fw/bursar-near.elf`, SHA-256 `3c72d0ee1fbef3578c8b10832c71feebf74ce75608a93909baff40883a281d57`. Compiler `riscv64-elf-gcc (GCC) 16.2.0`. The source tree this was built from is `all-chains` `5513411` plus the uncommitted Bursar-2B edits in that tree. The pack at `~/.locals/ethereus/bursar-2b` is not built yet. The weight merge, the pinned `intents dec` and `1click check` traces, the language scores, and `eval:agent` on the 2B are not run.

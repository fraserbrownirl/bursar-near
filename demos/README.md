# Demos

Four payment scenes. The owner opens `bursar` and types a sentence. Each scene proves the same way: a page with the sections *What it is*, *What's real*, *What's staged*, *How it's proven*, then one *Run on* per run. `scripts/check-proofs.mjs` enforces the shape (it runs inside `npm run check:readme`). The camera document is [runsheet.md](runsheet.md); the registry every hash and link resolves against is `docs/hackathon/evidence.json`. Attacks prove the same way in [../attacks/README.md](../attacks/README.md).

| # | Scene | Owner gives | Amount | In-model receipts | Settlement | Page |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Shop sale | "a buyer will pay 0.15 USDC on Solana" | 0.15 USDC | `ef55dfea92041cf97b34c8589dce3e946e427a6d465c78fbf384098fd01cc945`, `4e52f82c6e25673ad47e53b5aef4ca6b8ec3f66f43deeca54a5caf60c71c32aa` | not run — waits for the owner's Face ID | [shop.md](shop.md) |
| 2 | Paid web page (MPP) | "pay http://127.0.0.1:8402/premium" | 0.101034 USDC in, 0.10 USDC out | 2026-11-12: `9500264e1ebfbeaf5dc042f81de2d14514a2a0187bd801430092f4cbdda3d200`, `e20e41752b61b87e7bc693dbd7aca347f6e7662c3a840a7d880873d52baae4de`; 2026-11-13: `bb8e930501a0a97b2f69e6d39ddf68c7f084ee9f2b1ed020ddf472d7b479a388`, `b5bebe97bccb5d741134d757bfaff74d953f266221c79b57a587fd1c443418f1` | [nearblocks](https://nearblocks.io/txns/GuVNPesYiw4NqTuCTPJmEPUcQn1ttuWZRDsAWrTw6BKG) | [mpp.md](mpp.md) |
| 3 | Paid API (x402) | "pay for one call of a weather API", then "the tbs one, for London" | 0.001 USDC on Base | none — the Base float signs, the Intents checks do not apply | [basescan](https://basescan.org/tx/0x6e7e357f2b9385c786cddbea5d51ffe06b89d38ef9503d10debe62e6c3a6570d) | [x402.md](x402.md) |
| 4 | Split bill | a restaurant receipt image, and "ask Maya for her half on Solana" | 0.20 USDC share | none — a receive request, not a payment | not a payment; the friend pays from the instruction | [split.md](split.md) |

Scene 1's QR images are [qr-solana.png](qr-solana.png) and [qr-base.png](qr-base.png); scene 4's receipt image is [receipt-caffe.png](receipt-caffe.png). The enclave payment and the control payment are not scenes; they are in the README's Mainnet record, which absorbed the old `results.md` table.

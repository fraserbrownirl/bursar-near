# MPP

## Film

`demos/mpp/mpp-demo.mp4` (59 s): the run end to end — the sentence, the 402, both in-model checks with their receipts, the card, the delivery, the page, and the settlement link, then the replay result. The three waits (the two checks and the delivery) play at real-time badges: 60 s, 68 s, 40 s. Built by `demos/mpp/film-mpp.py` from `demos/mpp/film/data.json` over the VHS take `demos/mpp/takes/v1-mpp-take.mp4` (a real run, 202 s, recorded headless in Terminal.app). No blank frame over 3 s; no local paths; every wait badged (`demos/mpp/film/timeline.json`).

## How a judge verifies it end to end

Five links, each checkable cold, none of them on our word:

1. **The check receipts** in `receipts/` prove the quote and the intent were checked before signing. Replay them: `npm run verify -- <hash>` (TypeScript reference), `npm run verify:firmware -- <hash>` (the pinned ELF in the vendored emulator), `npm run verify:weights -- <hash>` (the published weights). All three print `match`.
2. **The receipt's quote names a 1Click deposit address.** 1Click's public status API — no account, no key — reports that quote executed, with the exact amounts and the transaction hashes: `curl "https://1click.chaindefuser.com/v0/status?depositAddress=<address>"` → `"status": "SUCCESS"`. This is NEAR Intents' own infrastructure speaking, not us.
3. **Those hashes are on-chain.** The destination-chain hash opens on Arbiscan, the settlement on nearblocks, with the amounts and recipients. The terminal's `Delivered:` line and the status API name the same hash.
4. **The server is the official example, unmodified.** `git clone https://github.com/defuse-protocol/nearintents-mpp-sdk`, checkout the 0.4.1 tag, `git status` is clean. A judge runs it with *their* account as `MERCHANT_RECIPIENT` and pays it with our `bursar` — the same flow settles to them.
5. **The page only unlocks when 1Click reports SUCCESS.** The server has no knowledge of us; it serves `/premium` because its own quote, on 1Click, executed.

## What it is

MPP is a standard where a web page says "this costs money" before showing its content. In the demo, a small server on your Mac guards a page called /premium and asks for 0.10 USDC. Bursar reads the price, shows you the card, you approve with Touch ID, and Bursar pays through NEAR Intents. The server sees the payment and hands over the page.

## What's real

- The money: 0.10 USDC moved on NEAR mainnet.
- The payment system: the server is NEAR Intents' own official MPP example, unmodified.
- The checks: both in-model checks ran before signing.

## What's staged

- The service is a sample page on your own Mac, not a business.
- The merchant receiving the money is your own account, frsrcom.near.

That's because no public MPP service accepts NEAR Intents yet (none of the 139 in the directory, as of 11 November). The README says so.

## How it's proven

- A payment already went through earlier, with settlement id yTnoP1oA2Yb92xen7fQGd7XP6ws4hhw6EGiHB9utp2z. Anyone can look it up at https://nearblocks.io/txns/yTnoP1oA2Yb92xen7fQGd7XP6ws4hhw6EGiHB9utp2z and see the USDC arrive at frsrcom.near.
- That id is recorded in `docs/hackathon/evidence.json`.
- A judge can repeat it: run the same example server with their own account as merchant, and pay it with Bursar.

## Run on 2026-11-12

In `bursar`, the sentence `pay http://127.0.0.1:8402/premium`. The page came back with its content and the settlement link. Full terminal output: `demos/runsheet.md` (MPP).

- Quote check inside the model: `ok`, receipt `9500264e1ebfbeaf5dc042f81de2d14514a2a0187bd801430092f4cbdda3d200`.
- Intent check inside the model: `ok`, receipt `e20e41752b61b87e7bc693dbd7aca347f6e7662c3a840a7d880873d52baae4de`.
- The card asked `Pay 0.101034 USDC to frsrcom.near?` — 0.10 USDC for the page plus the route fee.
- Settlement: https://nearblocks.io/txns/GuVNPesYiw4NqTuCTPJmEPUcQn1ttuWZRDsAWrTw6BKG

Earlier the same day this scene stopped at the in-model amount check (`fail amount`, receipt `01cdef18ecc74e6b5419a9028f470d09204b9a2f3c5082ec479357b14e86544a`). The caller had stated the EXACT_OUTPUT quote's output amount; the in-model check compares the quote's `amountIn`, so the caller now states the deposit amount.

## Run on 2026-11-13

Same sentence, same server (fresh clone of the example at 0.4.1, `MERCHANT_RECIPIENT=frsrcom.near`). Both checks ran and matched the reference; the page and the link came back.

- Quote check inside the model: `ok`, receipt `bb8e930501a0a97b2f69e6d39ddf68c7f084ee9f2b1ed020ddf472d7b479a388`.
- Intent check inside the model: `ok`, receipt `b5bebe97bccb5d741134d757bfaff74d953f266221c79b57a587fd1c443418f1`.

## Replay the checks

All four receipts are tracked in `receipts/` with their inputs. Level 1, the TypeScript reference:

```sh
npm run verify -- 9500264e1ebfbeaf5dc042f81de2d14514a2a0187bd801430092f4cbdda3d200 e20e41752b61b87e7bc693dbd7aca347f6e7662c3a840a7d880873d52baae4de bb8e930501a0a97b2f69e6d39ddf68c7f084ee9f2b1ed020ddf472d7b479a388 b5bebe97bccb5d741134d757bfaff74d953f266221c79b57a587fd1c443418f1
```

Each line prints `match`. Level 2 replays one in the firmware emulator (`npm run verify:firmware -- <hash>`), level 3 in the weights (`npm run verify:weights -- <hash>`).

Measured 2026-11-13: `verify:firmware` on `bb8e930501a0a97b2f69e6d39ddf68c7f084ee9f2b1ed020ddf472d7b479a388` printed `8cb34279… match` then `bb8e9305… match`. `verify:weights` on the same receipt printed `match` with `wall_ms 1779530` — the 186,581-token trace replayed on CPU.

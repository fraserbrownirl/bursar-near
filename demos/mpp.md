# MPP

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

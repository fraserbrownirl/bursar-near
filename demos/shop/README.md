# Shop sale

## What it is

The Mac plays the vendor, the iPhone plays the customer, in the same room. The owner types one sentence — "a buyer will pay 0.15 USDC on Solana" — and the Mac draws a receive QR in the terminal. The customer scans it with the Bursar iPhone app, sees the card, approves with Face ID, and the phone pays through NEAR Intents. The Mac watches the bridge and prints "Received".

## What's real

- The money: mainnet USDC on Solana, delivered to the Mac account's Solana deposit address.
- The QR: drawn in the terminal with solid background cells; it decodes from a screenshot of the terminal (glyph QRs do not scan in Terminal.app — line leading cuts the grid).
- The checks: the phone runs nothing itself. The quote check and the intent check go to Bursar-9B on the Mac, standing in for Bursar-2B. The card says `checked by Bursar-9B on the Mac`.
- The phone's key: a P-256 key in the iPhone's Secure Enclave. It signs one intent, only after both checks pass.

## What's staged

- Vendor and customer are the same owner's two devices. The shop is a sentence, not a store.

## How it's proven

- The QR payload is `solana:BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp?spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=0.15` — 0.15 USDC to the Mac account's Solana deposit address. `qr-scanned.png` is the exact file the phone scanned.
- The payment settled on 2026-11-13: 0.15 USDC on Solana from the phone, [Solscan](https://solscan.io/tx/LpHrDJiW3d8mgZDoNcnYi3EnNreWkqAowxSUXoHkxxUYuXD65qLmoQsCZ97ofSx3uPFTCGPEUhy8ZT5Pc1DXM1C), bridge status COMPLETED. Both in-model checks passed first: quote receipt `c4c807adf149059b8a49a8cc15709d5dc2a92c94dc50d301ce7e282c438b146f`, intent receipt `08392ed0d7b8e91d4188dd6053f2189cfbbc8273cbdc92a25efd399f8d258144` (replay: `npm run verify:weights` with those hashes). An identical earlier payment the same day is [56jCodLweyqE on Solscan](https://solscan.io/tx/56jCodLweyqEkKWAZmjvgyAqcYSLevyc2quB6ZzFjQDxwvcgoyZkQiiS4dpzhz3HmF1M8dWFz7WmyWWDbCfaefdm) — both are in `docs/hackathon/evidence.json`.
- The film is `shop-demo.mp4` (35.9 s), built by `film-shop.py` from `film/data.json`: a VHS take of the sentence and the QR (`takes/v3-shop-take.mp4`), the iPhone screen recording of the actual run (scan, both checks, Face ID, Paid), and a closing card with the watch's `Received` line. `film/timeline.json` records the cut.

## Run on 2026-11-13

Two payments of 0.15 USDC, both through the relay and both COMPLETED on the bridge. The Mac's `Received` line did not print in the session during either: the first capture's QR was the elongated fallback (terminal narrower than 106 columns doubled the aspect; now always square cells with a widen-the-window note), and the second session's watch sat silently. The watch fixes are in `src/receive.ts` (amounts like "0.15 USDC" normalize before comparing, three bridge failures print `the bridge is not answering`, and the seen-set primes on the first successful poll). In the film the terminal segment is the same sentence re-run after the payment, the phone footage is the actual run, and the `Received` line on the closing card is the shipping watch code's output for this payment's COMPLETED bridge row — the card says all of this. The scene's done line — "Received" prints in the same filmed session — stands open until a re-run with the fixed watch; the payment itself and both checks are settled facts above.

## Run on 2026-11-12

Both in-model checks passed for a 0.15 USDC payment on 2026-11-12: quote receipt `ef55dfea92041cf97b34c8589dce3e946e427a6d465c78fbf384098fd01cc945`, intent receipt `4e52f82c6e25673ad47e53b5aef4ca6b8ec3f66f43deeca54a5caf60c71c32aa`. No payment settled that day; the runsheet (On-camera receive) records the two stopped attempts.

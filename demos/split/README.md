# Split bill

## What it is

The owner hands Bursar a restaurant receipt photo and asks a friend for their share. Bursar reads the receipt with macOS text recognition, states the share, and returns one line of instruction the owner texts to the friend in any messenger. The friend pastes that line into their own Bursar and pays it.

## What's real

- The reading: `demos/split/receipt-caffe.png` is an invented café, Bramble & Wren — never a real brand. It OCRs to TOTAL 5.00 with 2 GUESTS, and Bursar prints `I read: total 5.00, 2 guests` from the recognized text before stating the share. The share is 2.50 USDC — half, computed in code (`src/bill.ts`), not by the model.
- The instruction: `pay 2.50 USDC to BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp on Solana` — the owner's Solana deposit address, not an account id. Pasted into the phone Bursar's parser (`phone/hear.ts`, the same code the iPhone runs) it becomes a payment card: 2.50 USDC to that address, verdict allow, ready for her approval (`test/phone-hear.test.ts` runs the same shape). Her Bursar checks the line and asks her before paying; she pays from her own balance.
- The money: when the friend pays, mainnet USDC on Solana arrives at the owner's deposit address.

## What's staged

- The receipt is a rendered cafe receipt, not a photo of paper. A real photo works the same way.
- Maya is a name in a sentence, not a registered payee.

## How it's proven

- Run output is in `demos/runsheet.md` (Split bill): the sentence, the stated share, and the instruction line.
- The film is `split-demo.mp4` (29.0 s), composed by `demos/mpp/film-mpp.py` from the VHS take `takes/v1-split-take.mp4` (tape: `takes/split.tape`); `film/timeline.json` records the cut. The whole receipt is shown first, then the terminal runs at full size with the 14 s model wait badged on screen, not cut. It ends on a "Ready to send." card and a closing card: what the line is, and why it works in her Bursar.
- The scene's done condition is the stated share and the request: a text line the owner sends to Maya, which her own Bursar turns into a checked payment card.

## Run on 2026-11-13

In `bursar`, one turn: `split this with Maya and ask her for her half on Solana demos/split/receipt-caffe.png`. Bursar printed `I read: total 5.00, 2 guests`, then the closing sentence: `Maya owes 2.50 USDC on Solana. Here's the line she pastes into her Bursar:` with the line `pay 2.50 USDC to BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp on Solana`. Fixes that came out of the filming: a relative image path now attaches to the turn (`imageIn` in `src/screenshot.ts`), `scan` falls back to the turn's attached image when the model passes a path that does not exist, and the split playbook rides the `split` tool's result when the model has not read it.

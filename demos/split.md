# Split bill

## What it is

The owner hands Bursar a restaurant receipt photo and asks a friend for their share. Bursar reads the receipt with macOS text recognition, states the share, and returns one line of instruction the owner texts to the friend in any messenger. The friend pastes that line into their own Bursar and pays it. There is no QR: the friend is not in the room.

## What's real

- The reading: `demos/receipt-caffe.png` OCRs to TOTAL 0.40 with 2 GUESTS. The share Bursar states is 0.20 USDC — half, computed in code from the recognized text, not by the model.
- The instruction: `pay 0.20 USDC to BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp on Solana` — the owner's Solana deposit address, not an account id. Pasted into the phone Bursar it shows the card for 0.20 USDC (`test/phone-hear.test.ts`).
- The money: when the friend pays, mainnet USDC on Solana arrives at the owner's deposit address.

## What's staged

- The receipt is a rendered cafe receipt, not a photo of paper. A real photo works the same way.
- Maya is a name in a sentence, not a registered payee.

## How it's proven

- Run output is in `demos/runsheet.md` (Split bill): the sentence, the stated share, and the instruction line.
- The scene's done condition is the stated share and the request; the friend's payment is the phone flow in `demos/shop.md`.

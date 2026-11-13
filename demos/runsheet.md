# MPP

The server is the official `@defuse-protocol/nearintents-mpp-sdk` 0.4.1 example, `examples/server.ts`, unmodified. A judge runs it with their own merchant account:

```sh
git clone https://github.com/defuse-protocol/nearintents-mpp-sdk.git
cd nearintents-mpp-sdk
pnpm install
cp .env.example .env
```

Set `MERCHANT_RECIPIENT` in `.env` to that account, then `pnpm example:server`. Pay with `npm run bursar -- pay http://127.0.0.1:8402/premium`. The recorded settlement is https://nearblocks.io/txns/yTnoP1oA2Yb92xen7fQGd7XP6ws4hhw6EGiHB9utp2z.

Run on 2026-11-12, in `bursar`: `pay http://127.0.0.1:8402/premium`. Paid. The content and the link came back. (Piped stdin, so the session ends with Node's "readline was closed"; typed sessions do not print it.)

```
402 0.1 USDC to frsrcom.near
1click check @quote 0x20c1E3Dc7b93CA194176962cD2aDB11f75cCc042 0xbc77a1ef1ee04fc563ccb1d19e28dcc7385f136b nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near 101034 107433 1794488116 - → ok [live (model, Mac)] receipt 9500264e1ebfbeaf5dc042f81de2d14514a2a0187bd801430092f4cbdda3d200
reference (TypeScript) → ok
reason: account code hash unavailable
Pay 0.101034 USDC to frsrcom.near?
amountIn: 107433
intents dec @payload → signer: 0xbc77a1ef1ee04fc563ccb1d19e28dcc7385f136b
verifying-contract: intents.near
deadline: 2026-11-15T14:55:16.210Z
nonce: Vij2xgAlKBKzgKC5Nbk/6BieNuR7XqLyTyVPLHM/YDM=
intents: 1
intent[0]: transfer receiver=f0107d939ab53e85125e74e12c46731937fd4b0617061da71dc242dabd1e2368 tokens=1:nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1=107433 [live (model, Mac)] receipt e20e41752b61b87e7bc693dbd7aca347f6e7662c3a840a7d880873d52baae4de
reference (TypeScript) → signer: 0xbc77a1ef1ee04fc563ccb1d19e28dcc7385f136b
verifying-contract: intents.near
deadline: 2026-11-15T14:55:16.210Z
nonce: Vij2xgAlKBKzgKC5Nbk/6BieNuR7XqLyTyVPLHM/YDM=
intents: 1
intent[0]: transfer receiver=f0107d939ab53e85125e74e12c46731937fd4b0617061da71dc242dabd1e2368 tokens=1:nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1=107433
deposit: 0x14714287b43dfbb5ded18dcdce2e5fff01bd37891b1b30e8022ad470907d66c6
HTTP 200
{"premium":true,"insight":"The merchant was paid an exact amount on NEAR before you saw this.","servedAt":"2026-11-12T12:58:46.582Z"}
https://nearblocks.io/txns/GuVNPesYiw4NqTuCTPJmEPUcQn1ttuWZRDsAWrTw6BKG
```

Earlier the same day this scene stopped at the in-model amount check (`fail amount`, receipt `01cdef18ecc74e6b5419a9028f470d09204b9a2f3c5082ec479357b14e86544a`). The caller had stated the EXACT_OUTPUT quote's output amount; the in-model check compares the quote's `amountIn`, so the caller now states the deposit amount, and `.env` named the swept legacy account — it now names the enclave account.

# x402

Run on 2026-11-12. The bare weather URL returned `Invalid query parameters` and was not paid. With `city=London` the call returned the weather JSON and this transaction:

https://basescan.org/tx/0x50c5acc7a2de4fbcccde1fd4ab77ca5c6bd1bed2eb5f03ab9a18eff1529cbb70

The body starts `{"request_id":"ec4deaaa-5bb0-430d-88a8-90f2a4d5731c"...}` and the payer is `0xE7369dD4F08fA5203B06F3E1Dccee00a11cCF152`.

Run on 2026-11-13, the sentence flow. `pay for one call of a weather API`, then `the tbs one, for London`. The 9B named two payable services from the live Bazaar search — x402.tbs-digital.com at 0.001 USDC and x402tap.com at 0.01 USDC — then paid 0.001 USDC from the Base float. The London weather JSON came back with:

https://basescan.org/tx/0x6e7e357f2b9385c786cddbea5d51ffe06b89d38ef9503d10debe62e6c3a6570d

The on-chain transfer is 1000 atomic USDC from the float to `0xd6fCE15298Fc9D60f867d9455D497177Da9BFB0a`, status success. Request id `e3e849f8-1a3a-45fb-bf08-6d9094c8df5a`.

The owner then ran the same two sentences in `bursar`: two options with prices, `the tbs one, for London`, London weather (clear sky, 2.1°C), and:

https://basescan.org/tx/0x3767ed0624741658b9585ff3e78ddb88a1dbda3dfd9081b83de7ce5e7f6a46fa

Same transfer shape on-chain, request id `c76eae89-a5ca-41d2-8f2c-e5be78505f70`. Camera note: type the answer after the question prints. Both lines typed ahead still process in order, but the question then appears below the answer on screen.

The dialogue then settled into its final form. `what's the weather in London?` — two payable services with prices — then `one`. The weather JSON, the closing sentence `London: clear sky, 2.1 °C.`, and:

https://basescan.org/tx/0xecb8a4146d7f91377dad31463e2e19e4953ffa6a0bb155f747eb61544b7201a9

An earlier run of the same dialogue settled in https://basescan.org/tx/0xe7694d69da7f1721f4170dc796ae1395b81d50c890190458e84b487cb7f8d280 (its closing sentence printed five times before the turn loop was fixed to end on the model's answer). The question form routes five of five after the find playbook, the word-wise Bazaar filter, and USDC prices in the report; `find me a weather API` called no tool four of five.

The pay-shaped sentence is the reliable one. `find me a weather API` is outside the 9B's fine-tuned classes: four of five sampled runs called no tool. `pay for one call of a weather API` routed to the find tool five of five. A bare-URL pay during testing reached the paid retry, the service answered `Invalid query parameters`, and no payment settled.

# Split a receipt

The 9B request in `src/model.ts` is text. It has no image. A receipt is read by macOS text recognition in `src/screenshot.ts` before the model is asked. `src/bill.ts` takes the total and the guest count from that text.

`demos/split/harbour-lantern.png` reads as Harbour Lantern, `2 guests`, `TOTAL USD`, and `18.70`. Half is 9.35. The sentence is `split this with Maya and ask her for her half on Solana` with that image path. The owner sees `Maya owes 9.35 USDC` and a line Maya pastes into her own Bursar: `pay 9.35 USDC to BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp on Solana`. That is the Solana deposit address. The Intents account id is not used, and the line does not say near. There is no QR.

# Split bill

The scene is the restaurant receipt above: the owner gives the image and asks a friend for half, and Bursar states the share and shows a receive request. The less-common-chain version is dropped.

Run on 2026-11-12 with `demos/split/receipt-caffe.png` (TOTAL 0.40, 2 GUESTS), `npm run bursar -- agent "split this with Maya and ask her for her half on Solana /Users/fraserbrown/Dev/bursar-near/demos/receipt-caffe.png"`. The share is 0.20 USDC and the instruction is a line Maya texts back from any messenger. There is no QR: the friend is not present.

```
pay 0.20 USDC to BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp on Solana
Maya, please paste this into your Solana Bursar:
pay 0.20 USDC to BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp on Solana
```

Pasted into the phone Bursar, that line shows the card for 0.20 USDC to the owner's Solana deposit address (`test/phone-hear.test.ts`, "a pasted split instruction on Solana is a card").

Note: with the clause form "she uses solana" the 9B asked which chain instead of reading it. The inline form "for her half on Solana" is the sentence that works.

Dropped run, 2026-11-12, `npm run bursar -- agent "a friend says I owe my share, 0.15 USDT on Gnosis"`.

```
You mentioned USDT on Gnosis, but I only handle USDC. Do you want to pay 0.15 USDC instead?
```

No card. No payment. No address was supplied.

# On-camera receive

Self-test of the receive path. 0.15 USDC. Not a customer payment.

| chain | amount | deposit address | QR file | payment request | phone wallet | result |
| --- | --- | --- | --- | --- | --- | --- |
| Base | 0.15 USDC | `0xcA7cb8405484Ca0E4C941a22Ed1399E401b378dB` | `demos/shop/qr-base.png` | `ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=0xcA7cb8405484Ca0E4C941a22Ed1399E401b378dB&uint256=150000` | not recorded | not scanned |
| Solana | 0.15 USDC | `BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp` | `demos/shop/qr-solana.png` | `solana:BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp?spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=0.15` | Bursar test app on FRSR’s iPhone | 2026-11-12 14:19 Check showed `ReferenceError: Can't find variable: URLSearchParams`. No payment was sent. |

Shop run on 2026-11-12. `npm run bursar` then the sentence `a buyer will pay 0.15 USDC on Solana`. `I am ready.` printed, then about 12 seconds later:

```
> 0.15 USDC on Solana
```

The terminal then drew the QR. `bursar-code.png` from that run decodes to:

```
solana:BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp?spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=0.15
```

That is 0.15 USDC to this account’s Solana deposit address.

2026-11-12, later the same day. The phone bundle no longer uses `URLSearchParams` (it threw `ReferenceError` under JavaScriptCore at 14:19); the app on FRSR’s iPhone parses the Solana code to a card. The terminal QR is now solid background cells, not glyphs: a screenshot of the terminal decodes to the full payload, amount included. Half-block glyphs did not scan in Terminal.app — line leading cuts the module grid — and AGENTS.md’s QR rule now says so.

Both in-model checks pass for this payment from the phone: `/prepare` returns the unsigned intent, `/check` returns quote receipt `ef55dfea92041cf97b34c8589dce3e946e427a6d465c78fbf384098fd01cc945` and intent receipt `4e52f82c6e25673ad47e53b5aef4ca6b8ec3f66f43deeca54a5caf60c71c32aa`. The relay also takes `/submit` now: the phone signs the checked payload in its Secure Enclave and the relay submits that WebAuthn intent to 1Click.

`Received` has not printed yet. The first scan stopped at `STOP: in-model check` while the model server was saturated; the second at `Bursar on the Mac is not reachable` when the phone left the network mid-flow. The next attempt is on the iOS Simulator: its own enclave account `0x3602b546589a8fcafdce7fad64a46f91db0e4d50`, funded 0.5 USDC from the Mac account.

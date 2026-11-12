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

# Split a receipt

The 9B request in `src/model.ts` is text. It has no image. A receipt is read by macOS text recognition in `src/screenshot.ts` before the model is asked. `src/bill.ts` takes the total and the guest count from that text.

`demos/harbour-lantern.png` reads as Harbour Lantern, `2 guests`, `TOTAL USD`, and `18.70`. Half is 9.35. The sentence is `split this with Maya and ask her for her half on Solana` with that image path. The owner sees `Maya owes 9.35 USDC` and a line Maya pastes into her own Bursar: `pay 9.35 USDC to BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp on Solana`. That is the Solana deposit address. The Intents account id is not used, and the line does not say near. There is no QR.

# Split bill

Run on 2026-11-12, `npm run bursar -- agent "a friend says I owe my share, 0.15 USDT on Gnosis"`.

```
You mentioned USDT on Gnosis, but I only handle USDC. Do you want to pay 0.15 USDC instead?
```

No card. No payment. No address was supplied.

# On-camera receive

Self-test of the receive path. 0.15 USDC. Not a customer payment.

| chain | amount | deposit address | QR file | payment request | phone wallet | result |
| --- | --- | --- | --- | --- | --- | --- |
| Base | 0.15 USDC | `0xcA7cb8405484Ca0E4C941a22Ed1399E401b378dB` | `demos/qr-base.png` | `ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=0xcA7cb8405484Ca0E4C941a22Ed1399E401b378dB&uint256=150000` | not recorded | not scanned |
| Solana | 0.15 USDC | `BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp` | `demos/qr-solana.png` | `solana:BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp?spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=0.15` | Bursar test app on FRSR’s iPhone | 2026-11-12 14:19 Check showed `ReferenceError: Can't find variable: URLSearchParams`. No payment was sent. |

Shop run on 2026-11-12. `npm run bursar` then the sentence `a buyer will pay 0.15 USDC on Solana`. `I am ready.` printed, then about 12 seconds later:

```
> 0.15 USDC on Solana
```

The terminal then drew the QR. `bursar-code.png` from that run decodes to:

```
solana:BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp?spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=0.15
```

That is 0.15 USDC to this account’s Solana deposit address. A phone camera was not used for this check. `Received` did not print. No 0.15 USDC was sent. The Base float holds USDC and 0 ETH, so the transfer that would deliver it could not pay gas.

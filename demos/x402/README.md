# Paid API (x402)

## What it is

The owner asks `what's the weather in London?`. Bursar searches the x402 Bazaar live, names each payable service with its price, and pays the one the owner picks — by name or by number — adding the city the owner named. The service answers with the weather, and Bursar says it in one sentence. x402 is the HTTP status code 402 turned into a payment protocol: the service's 402 response says the price, the asset, and the address; the payment goes in the retry's header.

## What's real

- The money: 0.001 USDC on Base mainnet, from the Base float (Keychain item `bursar-evm`, address `0xE7369dD4F08fA5203B06F3E1Dccee00a11cCF152`) to the service's `0xd6fCE15298Fc9D60f867d9455D497177Da9BFB0a`, scheme `exact`, network `eip155:8453`. Settled in https://basescan.org/tx/0x50c5acc7a2de4fbcccde1fd4ab77ca5c6bd1bed2eb5f03ab9a18eff1529cbb70 and four times from sentence flows on 2026-11-13: https://basescan.org/tx/0x6e7e357f2b9385c786cddbea5d51ffe06b89d38ef9503d10debe62e6c3a6570d , https://basescan.org/tx/0x3767ed0624741658b9585ff3e78ddb88a1dbda3dfd9081b83de7ce5e7f6a46fa , https://basescan.org/tx/0xe7694d69da7f1721f4170dc796ae1395b81d50c890190458e84b487cb7f8d280 and https://basescan.org/tx/0xecb8a4146d7f91377dad31463e2e19e4953ffa6a0bb155f747eb61544b7201a9 .
- The discovery: `bursar find weather` searches Coinbase's x402 Bazaar and marks each row payable or not (`src/bazaar.ts`, `src/catalog.ts`). The query word goes into the HTTP request; a nonsense word returns an empty list. The payable listing changed between the evidence runs of 2026-11-11 and 2026-11-13 (`docs/hackathon/evidence.json`), which shows the search is live, not a fixture.
- The guards: the 1 USDC cap applies to this payment too (`src/x402-pay.ts`).

## What's staged

- The service is a third-party test endpoint, and the amount is a tenth of a cent. There are no in-model receipts for this scene: the quote check and the intent check belong to the NEAR Intents flow; a Base `exact` payment is signed by the float key, not by the guarded Intents signer.

## How it's proven

- The settlements are public Base transactions; the links open without any account.
- `docs/hackathon/evidence.json` records the payments: amount `1000` (0.001 USDC), `payTo` `0xd6fCE15298Fc9D60f867d9455D497177Da9BFB0a`, request ids `ec4deaaa-5bb0-430d-88a8-90f2a4d5731c`, `e3e849f8-1a3a-45fb-bf08-6d9094c8df5a` and `c76eae89-a5ca-41d2-8f2c-e5be78505f70`, and the transaction hashes above.
- A judge repeats it the way the owner did: in `bursar`, `what's the weather in London?`, then `one` (or the service's name). The search alone, no keys needed: `npm run bursar -- find weather` — it prints whatever the Bazaar marks payable that day.
- The film is `x402-demo.mp4` (25.4 s), composed by `demos/mpp/film-mpp.py` from the VHS take `takes/v2-x402-take.mp4` (tape: `takes/x402-v2.tape`); `film/timeline.json` records the cut. The take is a live capture of a real run — `what's the weather in London?`, then `the cheaper one` — settling in https://basescan.org/tx/0xc99b502fc1bb76a6eb7a0db3efde3e569c28447186a4a8c34f1cfdef741a9e6a . The v1 take (`takes/v1-x402-take.mp4`, answer `one`) settled in https://basescan.org/tx/0x0c92aed7dc0f04ced413088dc15189fc7ec987483a008ce5d420194b955450da .

## Run on 2026-11-13

The dialogue: `what's the weather in London?` — the find tool's live Bazaar search returned two payable weather APIs and the 9B named both with prices, x402.tbs-digital.com at 0.001 USDC and x402tap.com at 0.01 USDC — then `one`. Bursar paid 0.001 USDC from the Base float, the London weather JSON came back, and Bursar said `London: clear sky, 2.1 °C.` The settlement: https://basescan.org/tx/0xecb8a4146d7f91377dad31463e2e19e4953ffa6a0bb155f747eb61544b7201a9 (1000 atomic USDC from `0xE7369dD4F08fA5203B06F3E1Dccee00a11cCF152` to `0xd6fCE15298Fc9D60f867d9455D497177Da9BFB0a`, status success). An earlier run of the same dialogue settled in https://basescan.org/tx/0xe7694d69da7f1721f4170dc796ae1395b81d50c890190458e84b487cb7f8d280 .

The owner also ran the scene in `bursar` with the earlier, pay-shaped sentences (`pay for one call of a weather API`, then `the tbs one, for London`), settling in https://basescan.org/tx/0x3767ed0624741658b9585ff3e78ddb88a1dbda3dfd9081b83de7ce5e7f6a46fa (request id `c76eae89-a5ca-41d2-8f2c-e5be78505f70`; the service answers repeated `city=London` calls with its cached body). The first sentence-form payment of the day settled in https://basescan.org/tx/0x6e7e357f2b9385c786cddbea5d51ffe06b89d38ef9503d10debe62e6c3a6570d (request id `e3e849f8-1a3a-45fb-bf08-6d9094c8df5a`).

The question form took real routing work. `find me a weather API` is outside the 9B's fine-tuned classes (pay, receive, refund, split, invoice, link, foreign, vague, attack): it called no tool in four of five sampled runs and, at temperature 0, in none. The find playbook (`skills/find.md`), a word-wise Bazaar filter (`src/bazaar.ts`), prices printed in USDC in the report, and one hint in the system prompt brought `what's the weather in London?` to five of five, both services named with the right prices. A bare-URL pay during testing got as far as the paid retry; the service answered `Invalid query parameters` and no payment settled — the float balance did not change.

## Run on 2026-11-12

The payment ran in the command form: `npm run bursar -- pay 'https://x402.tbs-digital.com/weather/current?city=London'`. The bare URL, without `city=London`, returned `Invalid query parameters` and was not paid. The weather JSON came back with https://basescan.org/tx/0x50c5acc7a2de4fbcccde1fd4ab77ca5c6bd1bed2eb5f03ab9a18eff1529cbb70 . The body starts `{"request_id":"ec4deaaa-5bb0-430d-88a8-90f2a4d5731c"...}` and the payer is `0xE7369dD4F08fA5203B06F3E1Dccee00a11cCF152`.

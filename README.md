# Bursar NEAR

A counterparty check for an agent that pays through NEAR Intents. `bursar check <receiver>` prints `allow`, `warn`, or `block`, with a reason for each trigger and an evidence line for each signal. Block does not reach a key. Warn is the case that asks a human. Allow is the only result that may pay. `bursar pay` checks the quote, then runs `bursar check` on the quote's `recipient`, and builds one transfer intent. It does not submit that intent.

## What is real and what is simulated

| Piece | Real | Simulated |
| --- | --- | --- |
| Quote signature | `verifyQuoteSignature` from `@defuse-protocol/one-click-sdk-typescript` on captured 1Click responses | The attack quotes are those captures with one field changed |
| Quote fields | Compared with the TypeScript reference of `1click check`. `BURSAR_MODEL_URL` uses Bursar-9B and is labelled `live (model, Mac)` | `npm test` and `npm run demo` do not call the model. They are labelled `reference (TypeScript)` |
| Chain age and code | NEAR RPC and NearBlocks, read on 2026-11-10 and saved under `test/fixtures/` | Tests replay those files. A non-NEAR receiver is not looked up |
| Blocklist | Contract `bursar-bl-0db1ecc7.testnet`, deployed and initialized ([transaction](https://testnet.nearblocks.io/txns/6mPCYkb28JVWN1Cg48oBJ1PyXQfPAQ1xnybeGnLMHJ8s)). `get` returned null for `known-bad.testnet` | `npm test` uses `fixtures/blocklist.json`. Set `BURSAR_BLOCKLIST_CONTRACT` to call the testnet contract |
| Payment | The intent is one `transfer` to the quote's `depositAddress` | Nothing is submitted to `intents.near`. No deposit is made |
| Non-dry quote | `test/fixtures/quote-live.json` is a `dry: false` response. It includes `deadline` and `depositAddress`. No memo was returned. It costs nothing unless someone deposits | The demo replays this file |

## Related work

- [Luecria/intent-firewall](https://github.com/Luecria/intent-firewall)
- [kwesitetteh2003-jpg/sikasend](https://github.com/kwesitetteh2003-jpg/sikasend)

Bursar signs real payments, reads the merchant's text rather than only the user's, and adds counterparty checks, a shared on-chain blocklist, and a persistent ledger.

## The problem

An agent can be given a receiver that is new, a look-alike of a known payee, a contract whose code just changed, or text that tells the agent to pay. The check runs before a key is used.

## Do this, see that

From a fresh clone, with no model server, no keys, and no network spend:

```
npm install
npm test
npm run demo
```

See `fail 0`, then ten lines that are `block` or `STOP: ...`. Neither command calls NEAR, the model, or a key.

`LIVE_TESTS=1 BURSAR_NEAR_ACCOUNT=<implicit account> npm run test:live` requests one dry quote and reads `frol.near` from the RPC. It is not part of `npm test`.

To check one account against the live sources (this does call the network):

```
npm run bursar -- check <receiver> [--amount <amount>] [--token <token>] [--request <text>]
```

See a first line of `allow`, `warn`, or `block`, then `reason:` lines for whatever triggered that result, then one `evidence <name>:` line per signal.

## Verdict

- **block:** the receiver is on the blocklist fixture; it is within two edits of a known payee; the request text matches the injection scan; or the receiver is already in campaign memory.
- **warn:** the receiver is a NEAR account and it was created under 14 days ago, or it is a contract whose latest deployment was under 14 days ago. A missing or failed RPC or NearBlocks read is a warn only for a NEAR account. A missing blocklist file is a block.
- **allow:** none of the above.

A receiver that is not a NEAR account (an `0x` address, or any id with uppercase letters, such as a Solana address) gets one evidence line, `not a NEAR account: on-chain age and activity not checked`. That line is not a warn. Zero outgoing transactions are an evidence line, not a warn. `bursar pay` runs this check on the quote's `recipient`, never on `depositAddress`.

`amount` and `token` are printed as evidence. They do not change the verdict. A count of prior payments in the local ledger is printed as evidence. It does not change the verdict.

Known payees are `payees.json` in the state directory (`BURSAR_HOME`, or `~/.bursar`). A value may be an account id or `{"address":"<account id>"}`.

## Signal sources

Read on 2026-11-10. Timestamps below are the digit strings from the raw HTTP body. `JSON.parse` rounds them (`1613398225524785200` becomes `1613398225524785152`). The code keeps the digit string.

- **Contract or not.** `POST https://rpc.mainnet.near.org` with `query` / `view_account`. A `code_hash` of `11111111111111111111111111111111` means no contract. Observed on `frol.near` at block 223890691. `wrap.near` at block 223890662 returned `DL2f5xmZ44cQRP6vBMt94rvseH5d5KKnAGis2WkTAsh1`, so it is a contract. The same empty hash is the [view_account example](https://docs.near.org/api/rpc/contracts).
- **Account age.** `GET https://api.nearblocks.io/v1/account/<account>`, field `created.block_timestamp`, nanoseconds. Observed on `wrap.near`: `1613398225524785200` (transaction `CxgvYrbHuXs8Qx9FfGG2or5ApB97VAQcvVad4dTwdc3U`). The NEAR RPC has no creation time. Under 14 days is a warn.
- **Outgoing activity.** `GET https://api.nearblocks.io/v1/account/<account>/txns-only/count?from=<account>`, field `txns[0].count`. Observed on `wrap.near`: `{"txns":[{"count":"4"}]}`. Zero is a warn.
- **Code changed recently.** `GET https://api.nearblocks.io/v1/account/<account>/contract/deployments`, the latest `block_timestamp`. Observed on `wrap.near`: two deploys, latest `1619090101984073232` (transaction `4xtccqLAv25JU4F9HPRdKAeByGpjzA94GZcXY75cNM4`). Used only when the RPC says the account is a contract. Under 14 days is a warn. A contract with no deployment record is a warn.
- **Prior payments.** `ledger.jsonl` in the state directory. Count of entries whose `receiver` is this account and whose `verdict` is `allow` or whose `kind` is `settled`. Local file. Evidence only.
- **Look-alike.** `payees.json` in the state directory, compared with `lookalikeOf` from `src/guard/memory.ts` (edit distance at most 2). Local file.
- **Campaign memory.** `memory.json` in the state directory, `knownHostile` from `src/guard/memory.ts`. A block for a new look-alike, injection, or blocklist hit is written back with `remember`. Local file.
- **Shared blocklist.** `get(account)` on `fixtures/blocklist.json` (`accounts` map of `reason` and `evidence_hash`). `BURSAR_BLOCKLIST` overrides the path. `BURSAR_BLOCKLIST_CONTRACT=bursar-bl-0db1ecc7.testnet` calls that contract's `get` on testnet RPC instead. A missing file, or a failed contract read, is a block.
- **Injected instructions.** The `--request` text, scanned with `scanForInstructions` from `src/guard/injection.ts`. No request text is evidence, not a block.

`src/guard/` is copied from [bursar-solana branch guard](https://github.com/fraserbrownirl/bursar-solana/tree/guard/src/guard) and is not modified here. `src/store.ts` is only the state directory those files import.

## Key

An `intents.near` key has full account control — the [account-abstraction docs](https://docs.near-intents.org/integration/verifier-contract/account-abstraction) say "Each key has full control and can add or remove other keys" — and Bursar's guards, ledger, and prepaid balance are what limit it.

## Quotes

`npm run demo` replays `test/fixtures/quote-dry.json` and `test/fixtures/quote-live.json`. Both are real signed 1Click responses captured 2026-11-10. `quote-live.json` was requested with `dry: false`. A `dry: false` quote costs nothing unless someone deposits, and this one includes `deadline` and `depositAddress`. The response had no `depositMemo`. `bursar pay --fixture <file>` is the live path: it verifies the signature, compares the fields, and runs `bursar check` on `recipient`.

The signature check is `verifyQuoteSignature` from `@defuse-protocol/one-click-sdk-typescript`. An invalid signature is `STOP: bad signature`. The field comparison is the TypeScript reference of firmware `1click check` (recipient, refundTo, amount, destination asset, minAmountOut, deadline, memo, dry, deposit address), plus `originAsset` and `depositType: INTENTS`, which that command does not take. With `BURSAR_MODEL_URL` set and the server answering, the same `1click check` line is labelled `live (model, Mac)`.

`appFees` is not covered by the 1Click signature. `buildSignedQuoteRequest` in `@defuse-protocol/one-click-sdk-typescript` `src/quote-signature.ts` sets `appFees` to `undefined` before hashing (published as `appFees: void 0` in `dist/index.mjs`). Editing that field on a captured quote leaves `verifyQuoteSignature` true. The fee rule is a consistency check. The fee protection is the signed amounts: for `EXACT_INPUT`, `amountIn` equals `amount`, and `minAmountOut` is at least the requested output. A changed amount fails the signature.

Bursar sends no `appFees`. If the field is present, it may contain only 1Click's own fee, at or under the documented rate. From [Fees](https://docs.near-intents.org/resources/fees): 25 bps without an API key, 20 bps with one, and 1 bp for stablecoin pairs (USDC, USDT, DAI) and same-asset transfers. `insured: true` adds 2 bps. The [fee-config page](https://docs.near-intents.org/integration/distribution-channels/1click-api/fee-config) says that with no API key, 1Click adds 25 bps on top of any fee you submit. The docs do not name 1Click's fee recipient. Both captured quotes put 20 bps on `5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd`. That account is `ONECLICK_FEE_RECIPIENT` in `src/quote.ts`, with a comment that it was observed, not documented. Any other recipient, or a fee above the cap, is `STOP: app fee <n> bps to <account>`.

`customRecipientMsg`, `virtualChainRecipient`, and `virtualChainRefundRecipient` must be absent. A payment requires `dry: false`, `depositType: INTENTS`, and `refundType: INTENTS` with `refundTo` equal to our account.

## Intent

`test/fixtures/generate-intent.json` is a real `OneClickService.generateIntent({type: "swap_transfer", standard: "nep413", signerId, depositAddress})` response captured 2026-11-10. Its NEP-413 `recipient` is `intents.near`. The message JSON keys are `deadline`, `intents`, and `signer_id`. The TypeScript reference of firmware `intents dec` on that message returned `error (bad intents)` and is labelled `reference (TypeScript)`. The model was not called. The firmware also requires `verifying_contract` and `nonce`, which are on the NEP-413 envelope (`recipient` and `nonce`), not in the message. The demo's intent attacks replace the `intents` array of this response.

`BursarGuardedSigner` implements `IIntentSigner`. It requires the NEP-413 recipient (`verifying_contract`) to be `intents.near`, `signer_id` to be our account, the deadline to be within 5 minutes, an unused nonce, and the one-shape rule. It then calls `createIntentSignerNearKeyPair`. `signerFromSecret` is the only function that reads the secret. The captured intent's deadline is `2026-11-14T12:00:00.000Z`, which is outside 5 minutes, so `signIntent` stops before the inner signer.

The wallet is an implicit account, the hex of the ed25519 public key. `intents.near` `has_public_key` authorises that key without `add_public_key` when the account is not yet stored: `account_id == public_key.to_implicit_account_id()` ([state.rs](https://github.com/near/intents/blob/main/contracts/defuse/src/contract/intents/state.rs)). Balance is `mt_batch_balance_of`. On 2026-11-10 that call for this account returned `0` for `nep141:wrap.near` and `nep141:usdt.tether-token.near`. No mainnet payment was submitted.

The payload Bursar will sign has one intent. The allowed shape is `transfer`, `receiver_id` equal to the quote's `depositAddress`, `tokens` holding exactly one entry (`originAsset` → `amountIn`), no `msg` and no `min_gas`, and `memo` equal to `depositMemo` when the quote has one, otherwise absent. Anything else STOPs and names what differed. The eleven intent types, from [near/intents `intents/mod.rs`](https://github.com/near/intents/blob/main/contracts/defuse/core/src/intents/mod.rs), are `add_public_key`, `remove_public_key`, `transfer`, `ft_withdraw`, `nft_withdraw`, `mt_withdraw`, `native_withdraw`, `storage_deposit`, `token_diff`, `set_auth_by_predecessor_id`, and `auth_call`. The quote must use `depositType: INTENTS`.

## Demo

`npm run demo` prints these, each `block` or `STOP`:

- a prompt-injected payment to a blocklisted account → `block`
- a tampered quote → `STOP: bad signature`
- the wrong recipient, a foreign `refundTo`, a low `minAmountOut`, an expired deadline
- unsigned fee field edited (300 bps to an unknown recipient; the signature still verifies)
- a dry quote used for payment
- a drainer bundle (a transfer plus `add_public_key`)
- a transfer with a `msg`
- a transfer whose `receiver_id` is not `depositAddress`

## What is not NEAR

The copied guards do not call a chain. Bursar-9B is not in this repository. The TypeScript reference of `1click check` is host code. [bursar-solana](https://github.com/fraserbrownirl/bursar-solana) pays on Solana. The blocklist contract is NEAR testnet. The account, age, activity, and deployment reads above are NEAR.

## Hackathon diff

`pre-hackathon` is the licence and the first README. The diff from that tag to this branch is [pre-hackathon...main](https://github.com/fraserbrownirl/bursar-near/compare/pre-hackathon...main). `hackathon-submission` is not tagged yet.

## Libraries

Runtime dependency, pinned in `package-lock.json`:

- `@defuse-protocol/one-click-sdk-typescript` 0.1.26, which depends on `@noble/hashes`, `@scure/base`, `axios`, `form-data`, `json-stable-stringify`, and `tweetnacl`
- `@defuse-protocol/intents-sdk` 0.95.0 (`near-api-js` comes with it; `KeyPair` is used only inside `signerFromSecret`)

Development dependencies:

- `typescript` 5.9.3
- `tsx` 4.23.15 (`esbuild` 0.28.2)
- `@types/node` 24.19.2 (`undici-types` 7.24.6)

The blocklist contract uses `near-sdk` 5.30.1, pinned in `contract/Cargo.lock`.

Node.js `>= 20`. The check uses `node:fs`, `node:os`, `node:path`, `node:url`, `node:crypto` (through the copied ledger), `node:http` (through the copied proxy, which this command does not start), and `fetch`.

## Code written with AI

`src/guard/` was written with Claude Code. The commit on `bursar-solana` branch `guard` records `Co-Authored-By: Claude Opus 5.5`. The rest of this repository, including this file, was written with Cursor.

## Prior work

- Bursar-9B: [huggingface.co/frsrcom/bursar-9b](https://huggingface.co/frsrcom/bursar-9b)
- bursar-solana: [github.com/fraserbrownirl/bursar-solana](https://github.com/fraserbrownirl/bursar-solana)

## Licence

MIT. See [LICENSE](LICENSE).

# Bursar NEAR

A counterparty check for an agent that pays through NEAR Intents. `bursar check <receiver>` prints `allow`, `warn`, or `block`, with a reason for each trigger and an evidence line for each signal. Block does not reach a key. Warn is the case that asks a human. Allow is the only result that may pay. This repository does not sign and does not pay.

## The problem

An agent can be given a receiver that is new, a look-alike of a known payee, a contract whose code just changed, or text that tells the agent to pay. The check runs before a key is used.

## Do this, see that

From a fresh clone, with no model server, no keys, and no network spend:

```
npm install
npm test
```

See `fail 0`. The tests use the recorded responses in `test/fixtures/`. They do not call NEAR.

To check one account against the live sources (this does call the network):

```
npm run bursar -- check <receiver> [--amount <amount>] [--token <token>] [--request <text>]
```

See a first line of `allow`, `warn`, or `block`, then `reason:` lines for whatever triggered that result, then one `evidence <name>:` line per signal.

## Verdict

- **block:** the receiver is on the blocklist fixture; it is within two edits of a known payee; the request text matches the injection scan; or the receiver is already in campaign memory.
- **warn:** the account was created under 14 days ago; it is a contract whose latest deployment was under 14 days ago; or NearBlocks reports zero outgoing transactions. A missing or failed read of a chain source is also a warn, except a missing blocklist file, which is a block.
- **allow:** none of the above.

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
- **Shared blocklist.** `get(account)` on `fixtures/blocklist.json` (`accounts` map of `reason` and `evidence_hash`). `BURSAR_BLOCKLIST` overrides the path. Fixture until the testnet contract account is set. A missing file is a block.
- **Injected instructions.** The `--request` text, scanned with `scanForInstructions` from `src/guard/injection.ts`. No request text is evidence, not a block.

`src/guard/` is copied from [bursar-solana branch guard](https://github.com/fraserbrownirl/bursar-solana/tree/guard/src/guard) and is not modified here. `src/store.ts` is only the state directory those files import.

## Key

An `intents.near` key has full account control — the [account-abstraction docs](https://docs.near-intents.org/integration/verifier-contract/account-abstraction) say "Each key has full control and can add or remove other keys" — and Bursar's guards, ledger, and prepaid balance are what limit it.

## Demo and the live pay path

The demo replays recorded quotes because `dry: true` quotes omit `deadline`, `depositAddress`, and memo, and the live path is `bursar pay`.

`bursar pay` and the demo are not in this repository yet. `npm test` is the command that runs here with no model, no key, and no spend.

## What is not NEAR

The copied guards do not call a chain. Bursar-9B and the firmware commands `1click check` and `intents dec` are not in this repository. [bursar-solana](https://github.com/fraserbrownirl/bursar-solana) pays on Solana. The TypeScript in this repository is the check; the account, age, activity, and deployment reads above are NEAR.

## Hackathon diff

`pre-hackathon` is the licence and the first README. The diff from that tag to this branch is [pre-hackathon...main](https://github.com/fraserbrownirl/bursar-near/compare/pre-hackathon...main). `hackathon-submission` is not tagged yet.

## Libraries

No runtime dependencies. Development dependencies, pinned in `package-lock.json`:

- `typescript` 5.9.3
- `tsx` 4.23.15 (`esbuild` 0.28.2, `@esbuild/darwin-arm64` 0.28.2)
- `@types/node` 24.19.2 (`undici-types` 7.24.6)

Node.js `>= 20`. The check uses `node:fs`, `node:os`, `node:path`, `node:url`, `node:crypto` (through the copied ledger), `node:http` (through the copied proxy, which this command does not start), and `fetch`.

## Code written with AI

`src/guard/` was written with Claude Code. The commit on `bursar-solana` branch `guard` records `Co-Authored-By: Claude Opus 5.5`. The rest of this repository, including this file, was written with Cursor.

## Prior work

- Bursar-9B: [huggingface.co/frsrcom/bursar-9b](https://huggingface.co/frsrcom/bursar-9b)
- bursar-solana: [github.com/fraserbrownirl/bursar-solana](https://github.com/fraserbrownirl/bursar-solana)

## Licence

MIT. See [LICENSE](LICENSE).

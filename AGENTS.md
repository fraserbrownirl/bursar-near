# Agents

Read this before editing. The README is the claim sheet. This file is the map. `npm run check:agents` checks every repo path in backticks, and the four facts below, against their sources.

## Verify this project

These do not need the model pack. Run them in this order on a fresh clone.

1. `npm install`. Exits 0.
2. `npm test`. Exits 0. It does not call the network. `npm run test:live` runs `simulate_intents`.
3. `npm run demo`. Exits 0 and prints these lines:

```
injected blocklist: block
tampered quote: STOP: bad signature
wrong recipient: STOP: recipient
foreign refundTo: STOP: refund
low minAmountOut: STOP: min_out
expired deadline: STOP: deadline
dry quote used for payment: STOP: dry deposit deadline
unsigned fee field edited: STOP: app fee 300 bps to evil.near
drainer bundle: STOP: 2 intents
hidden notification: STOP: notification
intent deadline differs from the signed quote: STOP: deadline
injected agent: STOP
transfer to another account: STOP: receiver_id not-the-deposit.near
```

4. `npm run check:agents`. Prints `agents ok`.
5. `npm run check:readme`. Prints `check:readme ok`, then `agents ok`, because that script runs this check. It fails when the header of `docs/hackathon/HACKATHON.md` or `docs/hackathon/SUBMITTING.md` is older than 24 hours.

These need the pack `~/.locals/ethereus/all9b`, or the firmware tree for the emulator. Do not start them from `demo-payments` or `demo-attacks`.

- `npm run model` starts the server on port 8000.
- `npm run verify:firmware` and `npm run verify:weights` take receipt hashes. With no hashes they read every file in `receipts/`.
- `npm run demo:attacks` needs the server.

`npm run verify` does not need the pack. It checks git-tracked receipts only. Each input is stored under `receipts/inputs/` as the SHA-256 of its bytes, and a later run does not overwrite that file.

## Facts

enclave `0xbc77a1ef1ee04fc563ccb1d19e28dcc7385f136b`

home `.bursar-near`

firmware `8cb34279eb5d0528800beebb618b750c52bbddd792f61742dd1b01480523a2be`

loaded `e3c2f204f05f45986fdbfaffb9e464cb99dd23dd7aabfae6079af8c6a7da32f5`

The enclave id is the `p256` account in `test/fixtures/implicit-accounts.json` and the sweep `to` in `docs/hackathon/evidence.json`. The home is `HOME_NAME` in `src/store.ts`. The firmware hash is the SHA-256 row in `firmware/README.md` and `ELF_SHA256` in `scripts/computer_run.py`. The loaded-segment hash is `LOADED_SHA256` in `scripts/verify_firmware.py`.

## Working rules

- Branch `demo-payments` owns payment demos and payment rows in `demo/payments/results.md`. Branch `demo-attacks` owns `demo/attacks/` and `npm run demo:attacks`. Do not put one branch's edits on the other.
- Two homes. `~/.bursar` is the Solana project. Do not read or write it. This project uses `~/.bursar-near`, or `BURSAR_HOME` when set.
- Do not restart the model server, and do not rebuild firmware or the pack, outside the firmware lane.
- A key lives in the Secure Enclave or the login Keychain. It does not go in `.env`, the repo, or a command line.

## Do not

- Publishing, submitting, and posting need Fraser's yes. So does making the repository public. Demo payments of at most 1 USDC need no approval. A payment above 1 USDC still needs a yes. The list is in `.cursor/rules/hackathon-readme.mdc`.
- Delete a tracked receipt whose input is still in `receipts/inputs/`.

## Where a fact lives

| Question | Read |
| --- | --- |
| Hackathon rules | `docs/hackathon/HACKATHON.md`. The snapshot wins over `.cursor/rules/hackathon-readme.mdc`. |
| Whether a rule is met | `docs/hackathon/compliance.md` |
| A cited transaction or hash | `docs/hackathon/evidence.json` |
| Firmware pin | `firmware/README.md` |
| Model server start | `scripts/start-model.sh` |
| What the 9B is asked, and the tools | `src/agent.ts`, `skills/` |
| Allow, warn, block | `src/decide.ts` |
| In-model quote and intent checks | `src/model-checks.ts`, `src/reference.ts` |
| Who signs | `src/signer.ts` |
| The move off the ed25519 key | `src/sweep.ts` |
| Attack table | `demo/attacks/results.md`. Scenarios are `demo/attacks/*.yaml`. |
| Payment rows | `demo/payments/results.md` |
| Eval stop | `eval/rounds.md` |

`src/cli.ts` is the command entry. `src/pay.ts` submits only after both checks and `signIntent`. `src/model.ts` calls `http://127.0.0.1:8000/v1/chat/completions` and writes `receipts/`. Guards are `src/guard/`. `signer/EnclaveSigner.swift` is shared with `signer/bursar-signer.swift`. Firmware source is `~/Dev/ethereus/experimental/riscv`.

These three are not the current pin. Each names what replaced it: `docs/agent-spec.md`, `docs/bursar-2b-circuit.md`, `docs/video.md`.

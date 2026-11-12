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

`npm run verify:weights` and `npm run model` need the pack. `npm run verify:firmware` needs the chipformer emulator. Do not start them from `demo-payments` or `demo-attacks`.

- `npm run model` starts the server on port 8000.
- `npm run verify:firmware -- <receipt-hash>` checks `firmware/eth-bridge.elf` against the pin in `firmware/README.md`, then runs that ELF in the emulator on the receipt's input and compares the output. The emulator is installed with `python3.13 -m pip install -e ../ethereus/experimental/riscv`. `npm run verify:weights` takes receipt hashes. With no hashes it reads every file in `receipts/`.
- `npm run demo:attacks` needs the server.

`npm run verify` does not need the pack. It checks git-tracked receipts only. Each input is stored under `receipts/inputs/` as the SHA-256 of its bytes, and a later run does not overwrite that file.

## Facts

enclave `0xbc77a1ef1ee04fc563ccb1d19e28dcc7385f136b`

home `.bursar-near`

firmware `8cb34279eb5d0528800beebb618b750c52bbddd792f61742dd1b01480523a2be`

loaded `e3c2f204f05f45986fdbfaffb9e464cb99dd23dd7aabfae6079af8c6a7da32f5`

phone `0x304e29ea3a04a8693d9b5ff362cee0016f586ff5`

merchant `frsrcom.near`

float `0xE7369dD4F08fA5203B06F3E1Dccee00a11cCF152`

The enclave id is the `p256` account in `test/fixtures/implicit-accounts.json` and the sweep `to` in `docs/hackathon/evidence.json`. The home is `HOME_NAME` in `src/store.ts`. The firmware hash is the SHA-256 row in `firmware/README.md` and `ELF_SHA256` in `scripts/computer_run.py`. The loaded-segment hash is `LOADED_SHA256` in `scripts/verify_firmware.py`.

## Working rules

- `README.md`, `AGENTS.md`, `docs/`, and `receipts/` are edited on `main` only.
- Branch `demo-payments` owns payment demos and payment rows in `demos/results.md`. Branch `demo-attacks` owns `attacks/` and `npm run demo:attacks`. Each merges into `main` after a change, and that merge is pushed. Fraser has approved pushing `main` for the rest of the hackathon. Do not put one branch's edits on the other.
- Two homes. `~/.bursar` is the Solana project. Do not read or write it. This project uses `~/.bursar-near`, or `BURSAR_HOME` when set.
- Do not restart the model server, and do not rebuild firmware or the pack, outside the firmware lane.
- A key lives in the Secure Enclave or the login Keychain. It does not go in `.env`, the repo, or a command line.
- A change the iPhone would run is installed and launched on FRSR’s iPhone before Fraser is asked to try it. The steps are in `.cursor/rules/phone.mdc`.
- Code never matches words in owner text to decide what the owner wants. The 9B gets the whole conversation each turn and chooses the tools. A tool reads a file, divides a total, or builds a receive request. It does not read the sentence. The harness does one mechanical thing to owner input: a line that is a path to an image is attached to the turn.

## Do not

- Publishing, submitting, and posting need Fraser's yes. So does making the repository public. Agents make demo payments of 1 USDC or less without asking. Agents do not make payments above 1 USDC.
- Overwrite or delete a tracked receipt or its input.

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
| Phone check before Face ID | `src/model-relay.ts`. It forwards to the model server and does not bind port 8000. |
| Who signs | `src/signer.ts` |
| The move off the ed25519 key | `src/sweep.ts` |
| Attack table | `attacks/README.md`. Scenarios are `attacks/*.yaml`. |
| Payment rows | `demos/results.md` |
| Eval stop | `eval/rounds.md` |

`src/cli.ts` is the command entry. `src/pay.ts` submits only after both checks and `signIntent`. `src/model.ts` calls `http://127.0.0.1:8000/v1/chat/completions` and writes `receipts/`. Guards are `src/guard/`. `signer/EnclaveSigner.swift` is shared with `signer/bursar-signer.swift`. Firmware source is `~/Dev/ethereus/experimental/riscv`.

These three are not the current pin. Each names what replaced it: `docs/agent-spec.md`, `docs/bursar-2b-circuit.md`, `docs/video.md`.

## What Bursar is

Bursar is a payment agent for one owner.

1. The owner types a plain sentence.
2. Bursar-9B, Qwen3.5-9B with a small computer compiled into its weights, reads it and calls a tool.
3. Code guards check the request: blocklist, look-alike names, injected text, limits.
4. Before anything is signed, two checks run inside the model's weights: the quote check and the intent check. Each writes a receipt that anyone can replay.
5. The owner approves with Touch ID or Face ID. The key lives in the Secure Enclave and signs one transfer, to the deposit address of the signed quote, and nothing else.

Payments go through NEAR Intents (1Click), on mainnet, in small amounts.

On the phone there is no model. The phone sends the quote check and the intent check to Bursar-9B on the Mac, standing in for Bursar-2B. The card says `checked by Bursar-9B on the Mac`.

## What we claim, and what we do not

The last check before signing runs inside the model, and you can replay it.

- Three attacks are stopped inside the model: tampered quote, extra intent, moved deadline.
- Sixteen attacks are stopped by code around the model. Never say or imply the model stopped these.
- A scam that fools the request itself, for example "pay this new address", passes the in-model check. Code guards stop it.
- The phone does not run those two checks itself. Never say the phone has a model.

Every screen, caption, README line, and report stays inside these four lines.

## How the owner uses it

The owner opens `bursar` and types sentences. The owner never types flags, paths, or `npm run` commands.

A feature that only works as a flagged command is a test helper. It is not done until the model calls it as a tool from a plain sentence inside `bursar`.

## The demo

Four real payments, run by Fraser on camera, then a film of attacks. The runsheet is `demos/runsheet.md`.

| # | Scene | Owner types | Owner sees | Done when |
| --- | --- | --- | --- | --- |
| 1 | Shop sale | On the Mac: "a buyer will pay 0.15 USDC on Solana" | A QR in the terminal. The shopper's iPhone Bursar scans it, shows the card, Face ID, "Paid" and a link. The Mac prints "Received". | A phone camera decodes the QR, the phone pays it, and "Received" prints in the same session. |
| 2 | Paid web page (MPP) | "pay http://127.0.0.1:8402/premium" | The 402 price and recipient, the card, Touch ID, the page content, a transaction link. | The official SDK example server, unmodified, returns the content and the link opens. |
| 3 | Paid API (x402) | "find me a weather API", then "pay for one call" | The service and price, the card, the weather, a Basescan link. | The weather is returned and the link opens. |
| 4 | Split bill | Gives a restaurant receipt image and asks a friend for half | The share, and a receive request the friend can pay | The stated share is half the receipt total, and the receive request is for that amount. |

The attack film leads with the three in-model stops and a replay of one receipt, then shows four code stops. The table is `attacks/README.md`.

## Accounts

The Mac account is the `enclave` fact. The iPhone account is the `phone` fact. The merchant is the `merchant` fact. The Base float, used only for x402, is the `float` fact. The home directory is `~/.bursar-near`. Never read or write `~/.bursar`.

- Each account has one fixed deposit address per chain. A receive QR is that address plus the amount.
- An account id is not a deposit address. Never show an account id as an address on Base, Solana, or any other chain. Money sent there is lost.
- The deposit address of a 1Click quote belongs to that quote and is never reused.
- Agents make demo payments of 1 USDC or less without asking. Agents do not make payments above 1 USDC.

## Rules

Done means you ran it as the owner would. Open `bursar`, type the sentence, and confirm each thing in the "Owner sees" column. Paste the output into `demos/runsheet.md`. Do not report that something works because the code looks right. Do not hand Fraser a command to try in your place.

Never loosen a check to make a demo pass. If a check stops a payment that should go through, the caller is passing the wrong thing. Find the field that failed from the receipt and fix the caller.

If the balance cannot cover the payment, say "not enough balance" before asking for a quote.

English STOP text comes from the guard. The model only translates, and code checks that the amount and account survived the translation.

Never overwrite or delete a tracked receipt or its input. The README, `docs/hackathon/evidence.json`, and the films cite the same hashes.

A key lives in the Secure Enclave or the login Keychain. Never in `.env`, the repo, a command line, a log, or the model's context.

`npm test` runs offline. A test that pays or calls mainnet belongs in `npm run test:live`.

1Click: dry-quote first. Small amounts can fall under a route's minimum. The intent deadline must equal the signed quote's deadline. `PENDING_DEPOSIT` means 1Click has not seen the money. `PROCESSING` means it has. Only submit a deposit hash for the first.

Draw a QR with half-block characters, one character per module, with a quiet margin. Check the terminal width first. Always print the PNG path too. Verify a QR by decoding a screenshot of the terminal, not the PNG. Record in Terminal.app. The Cursor terminal adds gaps between lines.

The phone's JavaScript engine has no web globals: no `URL`, `URLSearchParams`, `fetch`, `TextEncoder`, `crypto`, `setTimeout`, `atob`. Supply them once, in one shim file or from Swift. Run the phone bundle under the bare `jsc` binary on the Mac before putting a build on the phone.

No blank screen for more than 3 seconds. Text large enough to read on a phone. No local paths on screen. A sped-up stretch shows a badge with the real duration. Before handing a film over, extract a frame every 2 seconds and check each one.

Do not restart the model server, rebuild the firmware, or rebuild the pack outside the firmware lane.

## Only Fraser does these

Touch ID and Face ID, scanning with his phone, sending money in, making the repo public, posting on X, and submitting. If you need one of these, say exactly which one and why, in one line. Everything else is yours to finish.

## When something fails

Report the exact error text, the command or sentence that produced it, and what you already ruled out. Do not guess at a cause you have not checked. If a fix touches one failing call, look for every other call of the same kind before you stop.

## Lanes

| Lane | Goal | Owns |
| --- | --- | --- |
| Payments | The four demo scenes work from plain sentences, with a runsheet Fraser can follow. | `demos/`, payment commands and tools |
| Attacks | The results table and the highlights film. | `attacks/` |
| iPhone | The shopper's phone scans a QR and pays it with Face ID. | The phone app and its bundle |
| Main | The README matches reality, and a fresh clone passes `npm test`, `npm run verify`, `npm run verify:firmware` and `npm run verify:weights`. | `README.md`, `AGENTS.md`, `docs/`, `receipts/` |

Do not put one lane's edits on another lane's branch. `demo-payments` and `demo-attacks` merge into `main` after each change, and that merge is pushed. Fraser has approved pushing `main` for the rest of the hackathon.

## Deadline

Submission closes 14 November 2026, 23:59 UTC.

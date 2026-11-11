# Eval rounds

The live set is the 40 cases Claude passed. 30 are work and 10 are holdout (`eval/live/split-40.json`). Both contain pay, link, foreign, and receive. The one contradiction case is in work. The other 167 cases are parked and were not edited.

Claude's passing transcript is the reference the judge sees next to the 9B transcript. A pass needs the floor and the judge.

## Round 0

No change for this set. Native tools, thinking off, 80-token cap, recorded quote, no local fallback. The server was restarted on the all-chains pack so tool calls are constrained.

| Set | Passed | Total |
| --- | --- | --- |
| Work | 20 | 30 |
| Holdout | 5 | 10 |

Floor failures: USDC not stated 7, contradicted chain 1, more than one question 1. Six more failed the judge with the floor otherwise ok.

Cause for the seven missing-USDC cases: **skill**. The pay-link playbook said to say what the link says, so a link that could not be read produced a reply that never said USDC.

## Round 1

Change: `skills/pay-link.md` now says that if the owner did not name a token, the reply says USDC, including when the link cannot be read.

Result: work 10/30, holdout 3/10. Both fell, so the playbook edit is reverted.

## Round 2

Cause for the same missing-USDC failures: **prompt**. The sentence was already there, but later in the prompt. It was moved to the first sentence. The playbook stayed at the round 0 text.

Result: work 9/30, holdout 3/10. Holdout did not improve. The prompt is reverted.

The holdout missed two rounds, so that USDC line was left to the model.

## Round 3

Cause for the work failures that pay a NEAR account on another chain: **code rule**. A name ending in `.near` is not a Base, Ethereum, Arbitrum, or Solana account. `quote` and `pay` return that to the model and do not show a card.

| Set | Passed | Total |
| --- | --- | --- |
| Work | 16 | 30 |
| Holdout | 2 | 10 |

Holdout fell (round 0 was 5/10), so the check is reverted. It never ran on those cases. The chain was taken from a sentence that starts with "pay", and these sentences start with "send", and the tool call left the chain empty. Two of the three holdout drops are a judge process that exited with no error text and was scored as a fail (`pay-person-101`, `pay-person-107`). The third, `foreign-16`, paid `wrap.near` with no other chain named.

## Round 4

Cause, same work failures: **code rule**. The chain is the one after "on" in the owner's sentence, including a sentence that starts with "send". When that chain is not NEAR and the recipient is a NEAR account, `quote` and `pay` return the question to the model and do not show a card. A judge process that exits is tried once more, so an empty failure is not a score.

| Set | Passed | Total |
| --- | --- | --- |
| Work | 21 | 30 |
| Holdout | 6 | 10 |

Holdout rose (round 0 was 5/10), so the check stays. A NEAR account named with another chain is asked which chain, and no card is shown.

## Round 5

Cause for a payment that listed the playbook names and then paid: **code rule**. The list call was counted as reading a playbook, so `quote` and `pay` were offered. A playbook counts when `skills` is called with its name. Until then the only tool offered is `skills`.

| Set | Passed | Total |
| --- | --- | --- |
| Work | 16 | 30 |
| Holdout | 5 | 10 |

Holdout fell (round 4 was 6/10), so the gate is reverted. One holdout case paid in another language and the judge failed it. Several link cases were not judged: the judge process resumed one refused session and that text was scored as a fail. Each judge call now starts a new session.

## Round 6

Cause for the card showing a missing check: **code rule**. A reason that says the evidence is unavailable is not a line on the card. A real warning, such as a young account, stays. A block still stops.

| Set | Passed | Total |
| --- | --- | --- |
| Work | 19 | 30 |
| Holdout | 5 | 10 |

Holdout fell (round 4 was 6/10), so the card is back to showing the first reason. The one holdout drop asked which chain and did not say USDC. Eight cases were not judged: they share one refused session id. Each judge call now uses its own session id.

## Round 7

Cause for reading the pay playbook when someone else is paying the owner: **tool**. The list of playbooks was names only, so the name `pay-person` was the one that sounded like a payment. The list now includes the line that says when each playbook applies.

## Round 7 result

| Set | Passed | Total |
| --- | --- | --- |
| Work | 20 | 30 |
| Holdout | 6 | 10 |

Holdout held at 6/10, the same as round 4, so the list stays. No judge call was a refused session. The receive case in the holdout passed.

## Round 8

Cause for a deposit address that is cut off or is the token contract: **code rule**. `receive` already shows the full deposit line. A reply that calls `receive` and also contains an address is not shown, and neither is the next reply when it contains an address. A shortened address or the token contract is not where the money goes.

## Round 8 result

| Set | Passed | Total |
| --- | --- | --- |
| Work | 21 | 30 |
| Holdout | 6 | 10 |

Holdout held at 6/10, so the rule stays. The deposit line is the full URI. A reply that repeated an address was not shown. Two receive cases then had only the URI, and the judge wanted the amount and token as well.

## Round 9

Cause for a deposit line that is only the URI: **code rule**. The line `receive` shows names the amount and the token from the call, then the full URI. The model's retelling of an address stays hidden.

## Round 9 result

| Set | Passed | Total |
| --- | --- | --- |
| Work | 20 | 30 |
| Holdout | 7 | 10 |

Holdout rose (round 8 was 6/10), so the amount stays on the deposit line.

## Round 10

Cause for a link that fails and the reply never says USDC: **tool**. A failed `pay_url` was returned as STOP, and the owner saw that word. The tool now tells the model that nothing was paid and the token is USDC, and that line is not shown to the owner.

## Round 10 result

| Set | Passed | Total |
| --- | --- | --- |
| Work | 19 | 30 |
| Holdout | 7 | 10 |

Holdout held at 7/10, so the tool sentence stays. The link replies still do not say USDC. A skill sentence, a prompt sentence, and this tool sentence have all left those replies the same. That cluster is the model.

## Round 11

Cause for a deposit line that is only the URI: **code rule**. The amount and token were given on an earlier call, and `receive` left them blank, so the line and the payment request omitted them. An amount, token, or chain already given is kept, and `receive` uses it.

Work and holdout scores for this round are filled in when the rerun finishes.

## Parked 207-case log

The set was the 207 playbook cases. 50 were holdout. That run is not this eval.

Round 0 there: 9B 7/207, Claude 40/207. Round 1 holdout 3/50. Round 2 holdout 4/50.

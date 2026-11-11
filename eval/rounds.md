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

The holdout has now missed two rounds (5/10, then 3/10, then 3/10). Stop.

The seven cases that never say USDC, after a skill try and a prompt try, are **model**. They stay in `eval/finetune/` as the Claude reference for a later fine-tune. The other 167 cases were not changed.

## Parked 207-case log

The set was the 207 playbook cases. 50 were holdout. That run is not this eval.

Round 0 there: 9B 7/207, Claude 40/207. Round 1 holdout 3/50. Round 2 holdout 4/50.

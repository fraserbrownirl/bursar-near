# Eval rounds

The set is the 207 playbook cases. 50 are holdout (`eval/live/split.json`). The other 157 are work, including the three sentences Fraser typed. Money must stay safe on both sets.

## Round 0

No skill, tool, or prompt change. Native tools, thinking off, 80-token cap, recorded quote fixture, no local payment fallback.

| Set | Passed | Total |
| --- | --- | --- |
| 9B, all cases | 7 | 207 |
| Claude, all cases | 40 | 207 |

9B failures by floor: skill not read 90, model did not answer 54, floor otherwise ok but the judge failed 44, USDC not stated 18, contradicted chain confirmed 1.

Cause for the 90: **tool**. `quote`, `pay`, `receive`, `pay_url`, and `convert` ran before any playbook had been read. The prompt already said to call `skills` first.

## Round 1

Change: those five tools return `call skills with no name, then with the playbook that fits` until `skills` has been called. No playbook text was edited.

Work and holdout scores for this round are filled in when the rerun finishes.

Result: work stayed 5/157. Holdout went from 2/50 to 3/50. All-case pass went from 7 to 8. Skill-not-read fell from 90 to 29. Empty replies rose to 114, 57 of them with no tool call and 34 that used the four turns on tools and never spoke.

## Round 2

Cause for the 34 tool-only silences: **setting**. Four turns were spent calling tools, so the reply was cut off before the model could speak. The reply cap stays 80 tokens. The loop now allows six turns.

Result: work 12/157, holdout 4/50. Both improved on round 1. Skill-not-read is 72, because a quote in the same reply is still counted before `skills`.

## Round 3

Cause: **code rule**. When one reply calls `skills` and `quote` or `pay`, the playbook runs first. The loop now runs every `skills` call in that reply before the others.

Work and holdout scores for this round are filled in when the rerun finishes.

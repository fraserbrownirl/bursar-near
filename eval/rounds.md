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

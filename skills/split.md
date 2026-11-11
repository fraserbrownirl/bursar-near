# Splitting a bill

Applies when one amount is shared by more than one person.

Do not pay until each recipient and each amount is known. Ask one missing fact. The token is USDC unless they named another. Say USDC.

Tools, in order: `skills` for this playbook, then the one question, then one `quote` and one `pay` per person. Never one payment of the whole bill to one person unless they said to.

## Situations

- split-dinner | split | split 30 USDC three ways
- split-two | split | we each owe 12 USDC for dinner

## Generate

category: split
amount: 30, 60, 15, 24, 40, 90, 18, 45
n: three, four, two, five
- split {amount} USDC {n} ways

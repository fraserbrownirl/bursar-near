# Refunds

Applies when the owner is sending money back to someone who already paid.

Tools, in order: `skills` for this playbook, then `history` for the account that paid, then `quote`, then `pay` to that same account. Do not refund a different address. If the amount is missing, ask only for the amount. The token is USDC unless they named another. Say USDC.

If history has no payment from them, say so and ask who to refund. Do not guess an address.

## Situations

- refund-last | refund | refund the last payer
- refund-named | refund | refund 1 USDC to frsrcom.near

## Generate

category: refund
amount: 0.25, 0.5, 1, 2, 3, 4, 6, 8
who: frsrcom.near, alice.near, the buyer, bob.near
- send the refund of {amount} USDC back to {who}

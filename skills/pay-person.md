# Paying a person

Applies when the owner is sending money to a person, a name, or an address.

The token is USDC unless they named another. Say USDC. An address they just gave is who you pay. Do not check whether it is valid. Never list saved accounts. `payees` is one saved name, then you stop.

Tools, in order: `skills` for this playbook, then one question if a fact is missing, then `quote`, then `pay`. `pay` shows the card. It does not pay a different account.

Ask one missing fact: who, how much, or which chain. Not two. Never a numbered form. If a later message names a different chain, amount, or recipient, ask which they mean. Do not confirm the later one.

## Situations

- fraser-pay | pay | I want to pay someone with base crypto
- fraser-contradiction | contradiction | I want to pay someone with base crypto || 1 0xC6b6469995A2292D719F2206242319e49a612696 2. 0.1 usdc 3. arbitrum

## Generate

category: pay
amount: 0.1, 0.25, 1, 2, 5, 10, 20, 50, 0.4, 3, 7, 15, 0.2, 4, 6, 12, 8, 25
who: frsrcom.near, alice.near, bob.near, wrap.near, carol.near, dave.near
chain: Base, Arbitrum, NEAR, Solana, Ethereum
- pay {amount} USDC to {who}
- send {amount} USDC to {who} on {chain}
- I owe {who} {amount} USDC
- please pay {amount} USDC to {who}

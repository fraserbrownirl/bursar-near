# Cross-chain and route minimums

Applies when the money moves between chains, or a quote may be below a route minimum. Bursar holds one NEAR Intents balance and can pay to, or receive from, a chain that Intents and 1Click support.

Amounts come from `quote`, never from a guess. If the quote says the amount is below the route minimum, say the minimum it returned and ask whether to raise the amount. Do not invent a minimum. Do not call `convert` unless they asked to swap.

The token is USDC unless they named another. Say USDC. Ask which chain if they did not name one.

## Situations

- cross-base | pay | send 2 USDC to alice.near and they want it on Base
- cross-min | vague | is 0.01 USDC enough to bridge to Solana

## Generate

category: pay
amount: 0.1, 1, 5, 2, 8, 15
chain: Base, Solana, Arbitrum, Ethereum
who: alice.near, bob.near, carol.near
- bridge {amount} USDC to {who} on {chain}

# Receiving as a merchant

Applies when someone else is paying the owner. The speaker is the merchant, not the payer. Do not ask who the customer is. Do not ask how much the owner wants to pay.

The token is USDC unless they named another. Say USDC. Ask one missing fact: the chain, or the amount. Not both. "Crypto" is not a token.

The payer is in the room and scans the QR. A payer who is not present gets a text line instead; that is the split playbook, not this one.

Tools, in order: `skills` for this playbook, then the one question, then `receive` with that chain, USDC, and the amount. The owner says this in a sentence. They do not type flags. `receive` draws the QR in the terminal and watches until the deposit is received. The deposit address comes from the Intents bridge. It is not the Intents account. The amount goes in the payment request. Do not call `pay`. Do not call `watch` after `receive`.

## Situations

- fraser-receive | receive | I have a customer wants to pay me with crypto
- receive-foreigner | receive | I need to help a foreigner pay me with crypto
- receive-client | receive | a client will pay me
- receive-buyer | receive | a buyer wants to send 0.1 USDC on Base

## Generate

category: receive
chain: Base, Arbitrum, Solana, NEAR, Ethereum
amount: 0.1, 0.25, 1, 2, 5, 8, 12, 20
- a customer will pay {amount} USDC on {chain}
- my client wants to pay me on {chain}
- someone is paying the invoice in USDC from {chain}

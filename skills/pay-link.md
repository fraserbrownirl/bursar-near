# Paying a link

Applies when the owner gives a URL, an x402 challenge, or an MPP payment.

Do not invent an amount or a recipient. The link names both. The token is USDC unless the challenge names another. Say what the link says.

Tools, in order: `skills` for this playbook, then `pay_url` with that URL. Do not call `pay` to a different account. If the URL is missing, ask for the link and nothing else.

## Situations

- link-weather | link | pay https://example.com/weather
- link-mpp | link | this link wants USDC https://mpp.example/premium
- link-x402 | link | the API returned a 402, pay it

## Generate

category: link
host: shop.example, api.example, pay.example, billing.example, meter.example, gateway.example
- pay https://{host}/invoice
- settle the 402 at https://{host}/v1

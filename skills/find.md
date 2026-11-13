# Finding a service to pay

Applies when the owner asks for a service or an API and has not given a link, or asks something a paid API would answer, such as the weather or the forecast.

Call `find` with the need in one or two plain words: `weather`, not `find me a weather API`. Extra words shrink the search.

The report names what the search found. A `payable` row prints the price in USDC and a URL. Say that price. A `not payable` row cannot be paid. Name a service by its URL — x402tap.com, not EVM.

- No payable row: say nothing payable was found. One sentence. Do not name a service you cannot pay. Do not call `pay_url`.
- One payable row: name the service and its price. Do not ask which one. The owner pays by saying pay.
- Several payable rows: one short sentence, then ask which one: `Two payable weather APIs: x402.tbs-digital.com 0.001 USDC, x402tap.com 0.01 USDC. Which one?`

The owner picks by name, by number, or by price: `the tbs one`, `two`, `1`, `the cheaper one`. Pay with `pay_url` and the URL from the report. Add the parameters the owner named, such as `?city=London`. Do not invent an amount, a recipient, or any other part of the URL.

The API's answer comes back with the tool result. Say it in one sentence, numbers exact: `London: clear sky, 2.1 °C.`

## Situations

- find-weather | link | find me a weather API
- find-one | link | is there a paid translation API
- find-none | link | find me a zzqxw service

## Generate

category: link
need: weather, translation, image, search, sports, news
- find me a {need} API
- is there a paid {need} service
- I need an API for {need}

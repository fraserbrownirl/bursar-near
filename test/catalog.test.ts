import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalog, payability, searchServices, summaryLines, type CatalogService, type TokenChain } from "../src/catalog.js";

const tokens: TokenChain[] = [
  { blockchain: "base", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  { blockchain: "near", contractAddress: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" },
];

function service(over: Partial<CatalogService> & Pick<CatalogService, "id" | "methods">): CatalogService {
  return {
    name: over.id,
    description: "",
    serviceUrl: "https://example.test",
    endpoints: [{ method: "GET", path: "/paid", description: "paid lookup", paymentMethod: over.methods[0] ?? "", currency: null, amount: null }],
    ...over,
  };
}

test("tempo is not payable when 1Click has no tempo chain, and a bound memo would still be required", () => {
  const row = payability(service({ id: "ping", methods: ["tempo"] }), tokens);
  assert.equal(row.payable, false);
  assert.match(row.reason, /no tempo chain/);
  assert.match(row.reason, /memo bound to the challenge id/);
});

test("an evm 402 for a listed token is payable, and a non-402 is not", () => {
  const laso = service({ id: "laso-finance", methods: ["evm"], serviceUrl: "https://laso.finance" });
  assert.equal(payability(laso, tokens, { status: 503, amount: null, currency: null, chainId: null }).payable, false);
  const paid = payability(laso, tokens, {
    status: 402,
    amount: "10000",
    currency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    chainId: "8453",
  });
  assert.equal(paid.payable, true);
  assert.match(paid.reason, /10000/);
});

test("find summary counts methods and says when none are payable", () => {
  const services = parseCatalog({
    services: [
      { id: "ping", name: "Ping", description: "weather ping", serviceUrl: "https://ping.test", methods: { tempo: {} }, endpoints: [{ method: "GET", path: "/paid", description: "ping", payment: { method: "tempo" } }] },
      { id: "laso-finance", name: "Laso", description: "cards", serviceUrl: "https://laso.finance", methods: { evm: {} }, endpoints: [{ method: "GET", path: "/get-card", description: "card", payment: { method: "evm", currency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } }] },
    ],
  });
  const lines = summaryLines(services, tokens, new Map([["laso-finance", { status: 503, amount: null, currency: null, chainId: null }]]));
  assert.equal(lines[0], "catalog 2");
  assert.equal(lines[1], "nearintents 0 payable 0");
  assert.equal(lines[2], "tempo 1 payable 0");
  assert.match(lines.at(-1) ?? "", /no catalog service is payable/);
  assert.equal(searchServices(services, "weather")[0]?.id, "ping");
});

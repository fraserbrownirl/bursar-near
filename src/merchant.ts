import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { nearintents } from "@defuse-protocol/nearintents-mpp-sdk/server";
import { Expires, Mppx, NodeListener } from "mppx/server";
import { isNearAccount } from "./account.js";
import { ACCOUNT_HEADER, BASE_USDC_CAIP, MERCHANT_AMOUNT_OUT, NEAR_USDC_CAIP } from "./mpp.js";

const WINDOW_SECONDS = 300;

/** The payer account from the request, or a throw. A missing hint does not fall back to the merchant. */
export function payerRefund(headers: { get(name: string): string | null }): string {
  const hinted = headers.get(ACCOUNT_HEADER) ?? "";
  if (!isNearAccount(hinted)) throw new Error("x-bursar-account must be the payer NEAR account");
  return hinted;
}

/**
 * `nearintents.charge` for the demo merchant. Origin is NEAR USDC. The merchant
 * receives `250000` USDC on Base. A JWT is passed only when one is set.
 */
export function chargeParameters(options: { destinationRecipient: string; name: string; jwt?: string }) {
  return {
    originAsset: NEAR_USDC_CAIP,
    destinationAsset: BASE_USDC_CAIP,
    destinationRecipient: options.destinationRecipient,
    amountOut: MERCHANT_AMOUNT_OUT,
    description: options.name,
    expiresWindow: WINDOW_SECONDS,
    refundTo: async ({ capturedRequest }: { capturedRequest?: { headers: { get(name: string): string | null } } }) =>
      payerRefund(capturedRequest?.headers ?? { get: () => null }),
    ...(options.jwt ? { oneClick: { jwt: options.jwt } } : {}),
  };
}

export function merchantMethod(options: { destinationRecipient: string; name: string; jwt?: string }) {
  return nearintents.charge(chargeParameters(options));
}

/** Listens until the process exits. The first unpaid request mints a 1Click quote. */
export function serveMerchant(options: {
  destinationRecipient: string;
  name: string;
  port: number;
  jwt?: string;
  secretKey?: string;
}): Promise<void> {
  if (!options.jwt) {
    process.stderr.write("no 1Click JWT: the quote uses the 0.2% unauthenticated fee\n");
  }
  const secretKey = options.secretKey ?? process.env.MPP_SECRET_KEY ?? randomBytes(32).toString("hex");
  const mppx = Mppx.create({
    secretKey,
    methods: [merchantMethod(options)],
  });
  const server = createServer((req, res) => {
    const request = new Request(`http://127.0.0.1:${options.port}${req.url ?? "/"}`, {
      method: req.method ?? "GET",
      headers: Object.entries(req.headers).flatMap(([key, value]) =>
        value === undefined ? [] : Array.isArray(value) ? value.map((entry) => [key, entry] as [string, string]) : [[key, value] as [string, string]],
      ),
    });
    mppx.nearintents.charge({ expires: Expires.minutes(WINDOW_SECONDS / 60) })(request)
      .then(async (result) => {
        if (result.status === 402) return NodeListener.sendResponse(res, result.challenge);
        return NodeListener.sendResponse(res, result.withReceipt(Response.json({
          paid: true,
          merchant: options.name,
        })));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: message }) + "\n");
      });
  });
  return new Promise((resolve) => {
    server.listen(options.port, "127.0.0.1", () => {
      process.stderr.write(`bursar merchant --mpp on http://127.0.0.1:${options.port}/\n`);
      resolve();
    });
  });
}

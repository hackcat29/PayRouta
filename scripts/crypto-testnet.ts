import "dotenv/config";
import { createECDH, randomUUID } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../lib/portal/db";
import { json } from "../lib/portal/service";
import { localMode, secretManager } from "../lib/portal/adapters";
import { createCryptoCheckout } from "../lib/payments/crypto-checkout";
import { verifyTestnetPayment } from "./verify-testnet-payment";
import { dispatch, reconcile } from "../lib/payments/processing";
import {
  methods,
  selectMethod,
  confirm,
  progress,
} from "../lib/payments/service";
const file = ".local/portal/crypto-testnet.json",
  orgId = "payment-demo-merchant";
type Fixture = {
  address: string;
  recoveryRef: string;
  integrationId: string;
  intentId?: string;
  checkout?: string;
  expiresAt?: string;
};
async function main() {
  if (
    !localMode() ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta")
  )
    throw new Error("Isolated local sandbox required");
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } }),
    config = await db.merchantConfig.findUniqueOrThrow({ where: { orgId } });
  if (
    !org.fictional ||
    config.environment !== "sandbox" ||
    config.webhookUrl !== "local://payment-receiver"
  )
    throw new Error("Fictional local test merchant required");
  let fixture: Fixture | undefined;
  try {
    fixture = JSON.parse(await readFile(file, "utf8"));
  } catch {}
  if (process.argv.includes("--watch")) {
    if (!fixture?.intentId) throw new Error("Prepare a quote first");
    const intentId = fixture.intentId;
    let lastState = "";
    const until = Date.now() + 30 * 60 * 1000;
    while (Date.now() < until) {
      const attempt = await db.paymentAttempt.findFirst({
        where: { intentId },
        orderBy: { number: "desc" },
      });
      if (attempt) {
        if (attempt.state === "Created") await dispatch(attempt.id);
        else await reconcile(attempt.id);
      }
      const intent = await db.paymentIntent.findUniqueOrThrow({
        where: { id: intentId },
      });
      if (intent.state !== lastState) {
        console.log(JSON.stringify({ intentId, state: intent.state }));
        lastState = intent.state;
      }
      if (intent.state === "Confirmed") {
        await verifyTestnetPayment(intentId, true);
        return;
      }
      if (!attempt && intent.expiresAt.getTime() < Date.now()) {
        console.log(
          JSON.stringify({
            intentId,
            state: "Expired without a payment attempt",
          }),
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    console.log(
      JSON.stringify({
        intentId,
        state: "Awaiting payment or finality; rerun --observe",
      }),
    );
    return;
  }
  if (process.argv.includes("--observe") || process.argv.includes("--verify")) {
    if (!fixture?.intentId) throw new Error("Prepare a quote first");
    await verifyTestnetPayment(
      fixture.intentId,
      process.argv.includes("--verify"),
    );
    return;
  }
  if (!fixture || process.argv.includes("--new")) {
    if (fixture?.expiresAt && Date.parse(fixture.expiresAt) > Date.now())
      throw new Error("Use the unexpired checkout first");
    const key = createECDH("secp256k1");
    key.generateKeys();
    const address =
      "0x" +
      Buffer.from(
        keccak_256(key.getPublicKey(undefined, "uncompressed").subarray(1)),
      )
        .subarray(12)
        .toString("hex");
    const recoveryRef = await secretManager.put(
      key.getPrivateKey().toString("hex"),
    );
    const latest = await db.integration.findFirst({
      where: { orgId, environment: "sandbox" },
      orderBy: { version: "desc" },
    });
    const integration = await db.integration.create({
      data: {
        orgId,
        environment: "sandbox",
        version: (latest?.version ?? 0) + 1,
        config: json({
          mode: "NATIVE",
          adapter: "evm-native-deposit",
          environment: "sandbox",
          network: "eip155:84532",
          identifier: "native:ETH",
          publicRpc: true,
          addresses: [address],
          accountId: "owned-test-eth-" + randomUUID(),
        }),
      },
    });
    fixture = { address, recoveryRef, integrationId: integration.id };
    await writeFile(file, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  }
  if (process.argv.includes("--prepare")) {
    console.log(
      JSON.stringify({
        network: "Base Sepolia",
        address: fixture.address,
        prepared: true,
      }),
    );
    return;
  }
  if (fixture.intentId) {
    console.log(
      JSON.stringify({
        checkout: fixture.checkout,
        expiresAt: fixture.expiresAt,
      }),
    );
    return;
  }
  const checkout = await createCryptoCheckout(orgId, "sandbox", randomUUID(), {
    reference: "Base Sepolia ETH test",
    payerCountry: "NG",
    usdAmount: "0.10",
    options: [{ network: "eip155:84532", identifier: "native:ETH" }],
  });
  fixture.intentId = checkout.intentId;
  fixture.checkout = "http://127.0.0.1:3000" + checkout.checkoutPath;
  fixture.expiresAt = new Date(checkout.expiresAt).toISOString();
  await writeFile(file, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  if (process.argv.includes("--ready")) {
    const token = checkout.checkoutPath.split("#")[1];
    await methods(checkout.id, token);
    const route = await selectMethod(checkout.id, token, "crypto-app");
    const attempt = await confirm(checkout.id, token, route.routeId);
    await dispatch(attempt.attemptId);
    const ready = await progress(checkout.id, token);
    if (ready.attemptState !== "Requires action" || !ready.action)
      throw new Error("Test checkout did not produce payment instructions");
  }
  console.log(
    JSON.stringify({
      checkout: fixture.checkout,
      expiresAt: fixture.expiresAt,
      network: "Base Sepolia",
      testTokensOnly: true,
    }),
  );
}
main()
  .catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

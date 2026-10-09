import "dotenv/config";
import { createECDH, randomUUID } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../lib/portal/db";
import { json } from "../lib/portal/service";
import { localMode, secretManager } from "../lib/portal/adapters";
import { createCryptoCheckout } from "../lib/payments/crypto-checkout";
const file = ".local/portal/mixed-checkout-testnet.json";
async function main() {
  const orgId = "payment-demo-merchant";
  if (
    !localMode() ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta")
  )
    throw new Error("Isolated local sandbox required");
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  const config = await db.merchantConfig.findUniqueOrThrow({
    where: { orgId },
  });
  if (
    !org.fictional ||
    config.environment !== "sandbox" ||
    config.webhookUrl !== "local://payment-receiver"
  )
    throw new Error("Fictional local merchant required");
  let history: object[] = [];
  try {
    history = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const options = [
    {
      network: "eip155:84532",
      identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    },
    {
      network: "eip155:84532",
      identifier: "erc20:0x808456652fdb597867f38412077a9182bf77359f",
    },
    { network: "eip155:84532", identifier: "native:ETH" },
  ];
  const receivers = [];
  for (const option of options) {
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
    // Persist recovery metadata before publishing the receive pool.
    receivers.push({ ...option, address, recoveryRef });
    await writeFile(
      file,
      JSON.stringify(
        [...history, { preparedAt: new Date().toISOString(), receivers }],
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const latest = await db.integration.findFirst({
      where: { orgId, environment: "sandbox" },
      orderBy: { version: "desc" },
    });
    await db.integration.create({
      data: {
        orgId,
        environment: "sandbox",
        version: (latest?.version ?? 0) + 1,
        config: json({
          mode: "NATIVE",
          adapter: option.identifier.startsWith("native:")
            ? "evm-native-deposit"
            : "erc20-deposit",
          environment: "sandbox",
          ...option,
          publicRpc: true,
          addresses: [address],
          accountId: "owned-mixed-test-" + randomUUID(),
        }),
      },
    });
  }
  const checkout = await createCryptoCheckout(orgId, "sandbox", randomUUID(), {
    reference: "Stablecoin and crypto wallet test",
    payerCountry: "NG",
    usdAmount: "0.10",
    options,
  });
  const result = {
    checkout: "http://127.0.0.1:3000" + checkout.checkoutPath,
    expiresAt: new Date(checkout.expiresAt).toISOString(),
    intentId: checkout.intentId,
  };
  await writeFile(
    file,
    JSON.stringify([...history, { ...result, receivers }], null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ ...result, testTokensOnly: true }));
}
main()
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

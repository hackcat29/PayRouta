// The merchant's own wallet for their NEAR Intents account (lib/intents):
// NEAR wallets through NEAR Connect, EVM wallets through EIP-6963. Wallets
// only sign here; nothing is sent to the chain except the one-time key
// registration a named NEAR account needs before it can sign intents.
import type { NearConnector, NearWalletBase } from "@hot-labs/near-connect";
import type { WalletProvider } from "@/lib/blockchain/wallet-payment";
import { nonceBytes, type Nep413Payload } from "@/lib/intents/signing";

export type Signer =
  | { kind: "near"; accountId: string; wallet: NearWalletBase }
  | { kind: "evm"; accountId: string; provider: WalletProvider; source?: "privy" };

let connector: Promise<NearConnector> | null = null;
function near() {
  connector ??= import("@hot-labs/near-connect").then(({ NearConnector }) => new NearConnector({ network: "mainnet" }));
  return connector;
}

export async function connectNear(): Promise<Signer> {
  const wallet = await (await near()).connect();
  const [account] = await wallet.getAccounts({ network: "mainnet" });
  if (!account) throw new Error("No NEAR account was shared by the wallet.");
  return { kind: "near", accountId: account.accountId, wallet };
}

export async function connectEvm(provider: WalletProvider): Promise<Signer> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!Array.isArray(accounts) || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0] ?? "")) throw new Error("No address was shared by the wallet.");
  return { kind: "evm", accountId: accounts[0].toLowerCase(), provider };
}

const hex = (text: string) => `0x${Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("")}`;

// Returns the wallet's signature as given, and the NEAR key that made it.
export async function signText(signer: Signer, message: string, nep413: Omit<Nep413Payload, "message">) {
  if (signer.kind === "evm") {
    const signature = (await signer.provider.request({ method: "personal_sign", params: [hex(message), signer.accountId] })) as string;
    return { signature };
  }
  const signed = await signer.wallet.signMessage({
    message,
    recipient: nep413.recipient,
    nonce: nonceBytes(nep413.nonce),
    network: "mainnet",
    signerId: signer.accountId,
  });
  if (signed.accountId !== signer.accountId) throw new Error("The wallet signed with a different account.");
  return { signature: signed.signature, publicKey: signed.publicKey };
}

// A named NEAR account tells intents.near once which key signs its intents.
export async function registerKey(signer: Signer, publicKey: string) {
  if (signer.kind !== "near") return;
  await signer.wallet.signAndSendTransaction({
    network: "mainnet",
    signerId: signer.accountId,
    receiverId: "intents.near",
    actions: [{ type: "FunctionCall", params: { methodName: "add_public_key", args: { public_key: publicKey }, gas: "30000000000000", deposit: "1" } }],
  });
}

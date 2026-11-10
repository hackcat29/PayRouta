// The merchant's own wallet for their NEAR Intents account (lib/intents):
// NEAR wallets through NEAR Connect, EVM wallets through EIP-6963 or Privy,
// Solana wallets through Privy. Wallets
// only sign here; nothing is sent to the chain except the one-time key
// registration a named NEAR account needs before it can sign intents.
import type { NearConnector, NearWalletBase } from "@hot-labs/near-connect";
import type { WalletProvider } from "@/lib/blockchain/wallet-payment";
import bs58 from "bs58";
import { nonceBytes, type Nep413Payload } from "@/lib/intents/signing";

export type Signer =
  | { kind: "near"; accountId: string; wallet: NearWalletBase }
  | { kind: "evm"; accountId: string; provider: WalletProvider; source?: "privy" }
  // A Solana wallet: its NEAR Intents account is its key in hex (accountId),
  // and it signs the exact bytes it is given.
  | { kind: "solana"; accountId: string; address: string; signMessage: (message: Uint8Array) => Promise<{ signature: Uint8Array; signedMessage?: Uint8Array }> };

export function solanaSigner(address: string, signMessage: Extract<Signer, { kind: "solana" }>["signMessage"]): Signer {
  const key = bs58.decode(address);
  if (key.length !== 32) throw new Error("That isn't a Solana address.");
  return { kind: "solana", accountId: Array.from(key, (b) => b.toString(16).padStart(2, "0")).join(""), address, signMessage };
}

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

// Wallets report failures as EIP-1193 codes with terse messages
// ("Requested resource not available."). Say what happened instead.
export function walletErrorText(error: unknown) {
  const { code, message } = (error ?? {}) as { code?: number; message?: string };
  if (code === 4001 || /reject|denied|cancel/i.test(message ?? "")) return "You cancelled the request in your wallet.";
  if (code === -32002) return "Your wallet already has a request waiting. Open the wallet to approve or cancel it, then try again.";
  if (code === 4100) return "Unlock your wallet and try again.";
  return message || "Something went wrong. Try again.";
}

const hex = (text: string) => `0x${Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("")}`;

// Returns the wallet's signature as given, and the NEAR key that made it.
export async function signText(signer: Signer, message: string, nep413: Omit<Nep413Payload, "message">) {
  if (signer.kind === "evm") {
    const signature = (await signer.provider.request({ method: "personal_sign", params: [hex(message), signer.accountId] })) as string;
    return { signature };
  }
  if (signer.kind === "solana") {
    const bytes = new TextEncoder().encode(message);
    const signed = await signer.signMessage(bytes);
    // NEAR Intents checks the signature over these exact bytes; a wallet
    // that prefixes the message can't sign for the account.
    if (signed.signedMessage && (signed.signedMessage.length !== bytes.length || signed.signedMessage.some((b, i) => b !== bytes[i])))
      throw new Error("This wallet changes messages before signing them, so it can't sign for NEAR Intents. Use another wallet.");
    return { signature: `ed25519:${bs58.encode(signed.signature)}`, publicKey: `ed25519:${signer.address}` };
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

// Signs an intent 1Click generated for this account, whatever its standard.
export function signIntent(
  signer: Signer,
  intent: { standard: "erc191" | "raw_ed25519"; payload: string } | { standard: "nep413"; payload: { message: string; nonce: string; recipient: string } },
) {
  return intent.standard === "nep413"
    ? signText(signer, intent.payload.message, { nonce: intent.payload.nonce, recipient: intent.payload.recipient })
    : signText(signer, intent.payload, { nonce: "", recipient: "" });
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

// Paying a swap from the customer's own wallet (cross-chain.tsx): connect
// an EVM wallet (EIP-6963), a Solana wallet, or a NEAR wallet (NEAR
// Connect), then send the quoted amount to the swap's one-time deposit
// address. The wallet's address is also where NEAR Intents refunds a swap
// that can't complete.
import type { NearConnector, NearWalletBase } from "@hot-labs/near-connect";
import {
  approveCall,
  confirmedOk,
  erc20Read,
  sendEvmCall,
  submitEvmTransfer,
  type WalletProvider,
} from "@/lib/blockchain/wallet-payment";
import type { DiscoveredWallet } from "@/lib/blockchain/wallet-discovery";
import type { WalletTarget, WalletTransfer } from "@/lib/intents/checkout";

type Api = (action?: object) => Promise<Record<string, unknown>>;

export type Connected = {
  family: WalletTarget["family"];
  address: string;
  name: string;
  send(transfer: WalletTransfer, api: Api, deadline?: string): Promise<string>;
  // A token found by its address (lib/intents/dex.ts): swap it into USDC,
  // then pay exactly the checkout's USDC. Nothing is paid unless the swap
  // succeeds.
  payDex?(token: { chain: string; address: string }, api: Api, deadline?: string): Promise<string>;
};

// LI.FI's contract (lib/intents/dex.ts lifiDiamond), checked here again
// before the wallet approves or swaps anything.
const lifiDiamond = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";
type DexEvm = {
  chainId: number;
  chainName: string;
  sell: { token: string; amount: string };
  swap: { to: string; data: string; value: string };
  pay: { token: string; amount: string; to: string };
};

async function payDexEvm(provider: WalletProvider, owner: string, q: DexEvm, deadline?: string) {
  if (q.swap.to.toLowerCase() !== lifiDiamond) throw new Error("Something unexpected came back, so nothing was sent.");
  const chain = { chainId: q.chainId, chainName: q.chainName };
  const amount = BigInt(q.sell.amount);
  if ((await erc20Read(provider, q.sell.token, owner, lifiDiamond)) < amount) {
    const approval = await sendEvmCall(provider, chain, approveCall(q.sell.token, lifiDiamond, amount), deadline);
    if (!(await confirmedOk(provider, approval))) throw new Error("The approval didn't go through, so nothing was paid.");
  }
  const swap = await sendEvmCall(provider, chain, q.swap, deadline);
  // The guard: the exact USDC payment is sent only after the swap succeeded
  // and left at least that much USDC in the wallet.
  if (!(await confirmedOk(provider, swap))) throw new Error("The payment didn't go through, so nothing was paid.");
  if ((await erc20Read(provider, q.pay.token, owner)) < BigInt(q.pay.amount))
    throw new Error("The price moved, so nothing was paid. Your token is now USDC in your wallet.");
  return submitEvmTransfer(provider, { ...chain, token: q.pay.token, amount: q.pay.amount, to: q.pay.to }, deadline);
}

type SolanaProvider = {
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signAndSendTransaction(transaction: unknown): Promise<{ signature: string }>;
};

async function signAndSend(provider: SolanaProvider, tx: unknown) {
  try {
    return (await provider.signAndSendTransaction(tx)).signature;
  } catch (error) {
    if ((error as { code?: number }).code === 4001) throw error;
    throw Object.assign(new Error("Wallet submission is uncertain. Check your wallet activity before sending again."), { mayHaveSent: true });
  }
}

export function solanaProvider(): { name: string; provider: SolanaProvider } | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    phantom?: { solana?: SolanaProvider & { isPhantom?: boolean } };
    solflare?: SolanaProvider & { isSolflare?: boolean };
    solana?: SolanaProvider;
  };
  if (w.phantom?.solana) return { name: "Phantom", provider: w.phantom.solana };
  if (w.solflare?.isSolflare) return { name: "Solflare", provider: w.solflare };
  if (w.solana) return { name: "Solana wallet", provider: w.solana };
  return null;
}

let connector: Promise<NearConnector> | null = null;
function near() {
  connector ??= import("@hot-labs/near-connect").then(
    ({ NearConnector }) => new NearConnector({ network: "mainnet", footerBranding: null }),
  );
  return connector;
}

const tgas = (n: number) => `${n}000000000000`;
// NEP-145 registration of an account with a token, refunded beyond the minimum.
const storageDeposit = "1250000000000000000000";

async function nearView(contract: string, method: string, args: object) {
  for (const url of ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"]) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "query",
          params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) },
        }),
      });
      const b = (await r.json()) as { result?: { result?: number[] } };
      if (b.result?.result) return JSON.parse(String.fromCharCode(...b.result.result)) as unknown;
    } catch {
      // Next endpoint.
    }
  }
  return null;
}

// A NEAR token transfer to the deposit account: register the account with
// the token, then transfer. Wrapped NEAR is wrapped from the wallet's NEAR
// first when it doesn't already hold enough.
async function nearActions(t: WalletTransfer, signer: string) {
  const token = t.token!;
  const actions: { type: "FunctionCall"; params: { methodName: string; args: object; gas: string; deposit: string } }[] = [
    { type: "FunctionCall", params: { methodName: "storage_deposit", args: { account_id: t.to, registration_only: true }, gas: tgas(30), deposit: storageDeposit } },
  ];
  if (token === "wrap.near") {
    const held = await nearView(token, "ft_balance_of", { account_id: signer });
    const short = BigInt(t.amount) - BigInt(typeof held === "string" && /^\d+$/.test(held) ? held : "0");
    if (short > 0n)
      actions.push(
        { type: "FunctionCall", params: { methodName: "storage_deposit", args: { account_id: signer, registration_only: true }, gas: tgas(30), deposit: storageDeposit } },
        { type: "FunctionCall", params: { methodName: "near_deposit", args: {}, gas: tgas(30), deposit: short.toString() } },
      );
  }
  actions.push({
    type: "FunctionCall",
    params: {
      methodName: "ft_transfer",
      args: { receiver_id: t.to, amount: t.amount, ...("memo" in t && t.memo ? { memo: t.memo } : {}) },
      gas: tgas(30),
      deposit: "1",
    },
  });
  return actions;
}

const deadlineCheck = (deadline?: string) => {
  if (deadline && Date.parse(deadline) <= Date.now()) throw new Error("This quote has expired. Choose the token again for a new one.");
};

export async function connectWallet(target: WalletTarget, evm?: DiscoveredWallet): Promise<Connected> {
  if (target.family === "evm") {
    if (!evm) throw new Error("No browser wallet found. Send from another wallet or exchange instead.");
    const accounts = (await evm.provider.request({ method: "eth_requestAccounts" })) as unknown;
    const address = Array.isArray(accounts) ? String(accounts[0] ?? "") : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("The wallet didn't share an address.");
    const provider: WalletProvider = evm.provider;
    return {
      family: "evm",
      address,
      name: evm.name,
      send: (t, _api, deadline) => {
        if (t.family !== "evm") throw new Error("This payment isn't on an EVM network.");
        return submitEvmTransfer(provider, t, deadline);
      },
      async payDex(token, api, deadline) {
        const q = (await api({ action: "dex-evm", payer: address, chain: token.chain, address: token.address })) as unknown as DexEvm;
        return payDexEvm(provider, address, q, deadline);
      },
    };
  }
  if (target.family === "solana") {
    const found = solanaProvider();
    if (!found) throw new Error("No Solana wallet found. Send from another wallet or exchange instead.");
    const address = (await found.provider.connect()).publicKey.toBase58();
    return {
      family: "solana",
      address,
      name: found.name,
      async send(t, api, deadline) {
        if (t.family !== "solana") throw new Error("This payment isn't on Solana.");
        deadlineCheck(deadline);
        const prepared = await api({ action: "swap-wallet-transaction", payer: address });
        if (prepared.payer !== address || typeof prepared.unsigned !== "string") throw new Error("Invalid payment instructions");
        const { Transaction } = await import("@solana/web3.js");
        const tx = Transaction.from(Uint8Array.from(atob(prepared.unsigned), (c) => c.charCodeAt(0)));
        deadlineCheck(deadline);
        return signAndSend(found.provider, tx);
      },
      // One transaction: the swap into USDC and the exact USDC payment.
      async payDex(token, api, deadline) {
        deadlineCheck(deadline);
        const prepared = await api({ action: "dex-solana", payer: address, mint: token.address });
        if (prepared.payer !== address || typeof prepared.unsigned !== "string") throw new Error("Invalid payment instructions");
        const { VersionedTransaction } = await import("@solana/web3.js");
        const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(prepared.unsigned), (c) => c.charCodeAt(0)));
        deadlineCheck(deadline);
        return signAndSend(found.provider, tx);
      },
    };
  }
  if (target.family === "near") {
    const wallet: NearWalletBase = await (await near()).connect();
    const [account] = await wallet.getAccounts({ network: "mainnet" });
    if (!account) throw new Error("The wallet didn't share a NEAR account.");
    return {
      family: "near",
      address: account.accountId,
      name: "NEAR wallet",
      async send(t, _api, deadline) {
        if (t.family !== "near" || !t.token) throw new Error("This payment isn't on NEAR.");
        deadlineCheck(deadline);
        const actions = await nearActions(t, account.accountId);
        try {
          const outcome = (await wallet.signAndSendTransaction({
            network: "mainnet",
            signerId: account.accountId,
            receiverId: t.token,
            actions,
          })) as { transaction?: { hash?: string } } | undefined;
          return outcome?.transaction?.hash ?? "sent";
        } catch {
          throw Object.assign(new Error("Check your NEAR wallet activity before sending again."), { mayHaveSent: true });
        }
      },
    };
  }
  throw new Error("Pay this network by sending from your wallet or exchange.");
}

// "0x1234…abcd", "alice.near"
export const shortAddress = (a: string) => (a.length > 18 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

// A swap paid from a Solana wallet in the checkout (cross-chain.tsx):
// PayRouta builds the transfer of the quoted amount to the swap's one-time
// deposit address, with a recent blockhash, and the customer's wallet signs
// and sends it. EVM and NEAR wallets build their own transfer from the quote
// (walletTransfer in ./checkout.ts); Solana needs a blockhash and the mint's
// token program, which PayRouta reads here.
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { z } from "zod";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { authorizeSession } from "../payments/service";
import { providerRequest } from "../providers/adapters/http";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "../blockchain/solana-token";
import { tokens, type Http } from "./oneclick";

const rpcUrls = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];

async function solanaRpc<T>(http: Http, method: string, params: unknown[], schema: z.ZodType<T>) {
  for (const url of rpcUrls) {
    try {
      const response = await http(url, {
        method: "POST",
        path: "/",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        timeoutMs: 8000,
        maxResponseBytes: 65536,
      });
      const parsed = schema.safeParse(response.status === 200 ? (JSON.parse(response.body) as { result?: unknown }).result : undefined);
      if (parsed.success) return parsed.data;
    } catch {
      // Next endpoint.
    }
  }
  throw new PortalError("SOLANA_RPC_UNAVAILABLE", 503);
}

export async function swapSolanaTransaction(
  sessionId: string,
  token: string,
  payerAddress: string,
  deps: { http?: Http; now?: Date } = {},
) {
  const now = deps.now ?? new Date();
  const http = deps.http ?? providerRequest;
  const { intent } = await authorizeSession(sessionId, token, now);
  const record = await db.crossChainPayment.findFirst({ where: { intentId: intent.id }, orderBy: { createdAt: "desc" } });
  if (!record || record.fundedBy === "INTENTS" || record.status !== "PENDING_DEPOSIT" || record.originChain !== "sol" || record.deadline <= now)
    throw new PortalError("SWAP_NOT_AWAITING_DEPOSIT", 409);
  let payer: PublicKey, deposit: PublicKey;
  try {
    payer = new PublicKey(payerAddress);
    deposit = new PublicKey(record.depositAddress);
  } catch {
    throw new PortalError("WALLET_ADDRESS_INVALID", 400);
  }
  const origin = (await tokens(http, now.getTime())).find((t) => t.assetId === record.originAsset);
  if (!origin) throw new PortalError("CROSS_CHAIN_ORIGIN_NOT_SUPPORTED", 409);
  const amount = BigInt(record.amountIn);
  const { value } = await solanaRpc(
    http,
    "getLatestBlockhash",
    [{ commitment: "finalized" }],
    z.object({ value: z.object({ blockhash: z.string().min(32).max(64) }) }),
  );
  const tx = new Transaction({ feePayer: payer, recentBlockhash: value.blockhash });
  if (!origin.contractAddress) tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: deposit, lamports: amount }));
  else {
    const mint = new PublicKey(origin.contractAddress);
    const account = await solanaRpc(
      http,
      "getAccountInfo",
      [mint.toBase58(), { encoding: "base64", commitment: "finalized" }],
      z.object({ value: z.object({ owner: z.string() }).nullable() }),
    );
    const program = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].find((p) => p.toBase58() === account.value?.owner);
    if (!program) throw new PortalError("CROSS_CHAIN_ORIGIN_NOT_SUPPORTED", 409);
    const from = getAssociatedTokenAddressSync(mint, payer, program);
    const to = getAssociatedTokenAddressSync(mint, deposit, program);
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(payer, to, deposit, mint, program),
      createTransferCheckedInstruction(from, mint, to, payer, amount, origin.decimals, program),
    );
  }
  return {
    network: "solana:mainnet",
    payer: payer.toBase58(),
    unsigned: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    deadline: record.deadline.toISOString(),
  };
}

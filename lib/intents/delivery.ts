// Checking a NEAR Intents swap's delivery on its destination chain, for
// settlement straight to a merchant's address or bank (near-intents-address,
// near-intents-offramp).
//
//   verified  read back from the chain: one transfer of exactly the amount
//             to the address, in a finalized block (EVM networks PayRouta
//             reads, and Solana).
//   pending   seen, but not final yet.
//   attested  a chain PayRouta doesn't read (Tron, TON, Bitcoin and
//             others): confirmed by 1Click's SUCCESS and the delivery
//             transaction it reports, kept as evidence.
import { PortalError } from "../portal/domain";
import { chain } from "../blockchain/chains";
import { paymentAsset } from "../blockchain/crypto-assets";
import { alchemyReader } from "../blockchain/alchemy-rpc";
import { object, type NativeDeps } from "../providers/adapters/native/common";
import { verifySolanaTransfer } from "../providers/adapters/native/solana-deposit";
import { evmChainIds } from "./evm-chains";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const hash = (v: unknown) => {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return v.toLowerCase();
};
const quantity = (v: unknown) => {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]+$/.test(v)) throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return BigInt(v);
};

export type Delivered =
  | { status: "verified"; txHash: string; logIndex: string; blockHash: string }
  | { status: "attested"; txHash: string; logIndex: string; blockHash: string }
  | { status: "pending" };

// One ERC-20 transfer of `amount` of `token` to `to` in a finalized block.
export async function evmDelivery(
  network: string,
  token: string,
  to: string,
  txHash: string,
  amount: bigint,
  deps: NativeDeps,
): Promise<Delivered> {
  const rpc = alchemyReader({ network }, deps);
  const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
  if (!receipt) return { status: "pending" };
  const r = object(receipt);
  if (quantity(r.status) !== 1n || hash(r.transactionHash) !== txHash.toLowerCase()) throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
  const finalized = object(await rpc("eth_getBlockByNumber", ["finalized", false]));
  if (quantity(r.blockNumber) > quantity(finalized.number)) return { status: "pending" };
  const recipient = `0x${to.toLowerCase().slice(2).padStart(64, "0")}`;
  const transfers = (Array.isArray(r.logs) ? r.logs : []).map(object).filter(
    (l) =>
      String(l.address).toLowerCase() === token.toLowerCase() &&
      Array.isArray(l.topics) &&
      String(l.topics[0]).toLowerCase() === TRANSFER &&
      String(l.topics[2]).toLowerCase() === recipient,
  );
  if (transfers.length !== 1) throw new PortalError("DEPOSIT_MULTIPLE_TRANSFERS", 409);
  if (quantity(transfers[0].data) !== amount) throw new PortalError("DEPOSIT_AMOUNT_MISMATCH", 409);
  return { status: "verified", txHash: hash(r.transactionHash), logIndex: `0x${quantity(transfers[0].logIndex).toString(16)}`, blockHash: hash(r.blockHash) };
}

// Where PayRouta can read a delivery: an EVM network in its registry, or a
// Solana token it knows.
export function readableChain(blockchain: string, contract: string | null | undefined) {
  if (evmChainIds[blockchain]) {
    const network = `eip155:${evmChainIds[blockchain]}`;
    return chain(network) && contract && /^0x[0-9a-fA-F]{40}$/.test(contract) ? { family: "evm" as const, network } : null;
  }
  if (blockchain === "sol" && contract && paymentAsset("solana:mainnet", `spl:${contract}`)) return { family: "solana" as const, network: "solana:mainnet" };
  return null;
}

export async function checkDelivery(
  input: { blockchain: string; contract?: string | null; decimals: number; address: string; amount: bigint; txHash: string },
  deps: NativeDeps,
): Promise<Delivered> {
  const readable = readableChain(input.blockchain, input.contract);
  if (readable?.family === "evm") return evmDelivery(readable.network, input.contract!, input.address, input.txHash, input.amount, deps);
  if (readable?.family === "solana") {
    const rpc = alchemyReader({ network: readable.network }, deps);
    const tx = await rpc("getTransaction", [input.txHash, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
    if (!tx) return { status: "pending" };
    const units = input.amount.toString().padStart(input.decimals + 1, "0");
    const verified = verifySolanaTransfer(
      tx,
      {
        attemptId: "",
        attemptKey: "",
        environment: "production",
        network: readable.network,
        identifier: `spl:${input.contract}`,
        amount: `${units.slice(0, -input.decimals)}.${units.slice(-input.decimals)}`,
        precision: input.decimals,
        startBlock: 0n,
        address: input.address,
        integrationId: "",
      },
      input.txHash,
    );
    if (!verified) throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
    return { status: "verified", txHash: input.txHash, logIndex: verified.logIndex, blockHash: `slot:${verified.slot}` };
  }
  // Not readable here: 1Click's report of its own delivery transaction.
  return { status: "attested", txHash: input.txHash, logIndex: "1click", blockHash: "attested" };
}

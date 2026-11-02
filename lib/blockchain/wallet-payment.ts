import { chain as registeredChain } from "./chains";
import { tokenMinor, validTokenAmount } from "./assets";
import { paymentAsset as tokenAsset } from "./crypto-assets";
export type DepositPayment = {
  address: string;
  network: string;
  identifier: string;
  amount: string;
};
export function depositPayment(p: DepositPayment) {
  const token = tokenAsset(p.network, p.identifier);
  if (
    !token ||
    registeredChain(p.network)?.family !== "evm" ||
    !/^0x[0-9a-f]{40}$/.test(p.address) ||
    p.address === `0x${"0".repeat(40)}` ||
    !validTokenAmount(p.amount, token.decimals)
  )
    throw new Error("Invalid stablecoin payment instructions");
  const value = tokenMinor(p.amount, token.decimals);
  if (value <= 0n || value >= 2n ** 256n)
    throw new Error("Invalid token amount");
  const chainId = BigInt(p.network.split(":")[1]);
  return {
    chainId: `0x${chainId.toString(16)}`,
    contract: token.contractAddress || p.address,
    value: token.contractAddress ? "0x0" : `0x${value.toString(16)}`,
    symbol: token.symbol,
    data: token.contractAddress
      ? `0xa9059cbb${p.address.slice(2).padStart(64, "0")}${value.toString(16).padStart(64, "0")}`
      : "0x",
    uri: token.contractAddress
      ? `ethereum:${token.contractAddress}@${chainId}/transfer?address=${p.address}&uint256=${value}`
      : `ethereum:${p.address}@${chainId}?value=${value}`,
  };
}

export type WalletProvider = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
};
// Puts the wallet on the payment's chain, adding it first when it's one of
// PayRouta's registered networks the wallet doesn't know.
async function onChain(wallet: WalletProvider, chainId: string, network?: string, chainName?: string) {
  const chain = await wallet.request({ method: "eth_chainId" });
  if (typeof chain === "string" && BigInt(chain) === BigInt(chainId)) return;
  try {
    await wallet.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    const known = network ? registeredChain(network) : undefined;
    if ((error as { code?: number }).code !== 4902) throw error;
    if (!known || known.family !== "evm")
      throw new Error(`Add ${chainName ?? "this network"} to your wallet, then try again.`);
    await wallet.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: known.name,
          nativeCurrency: {
            name: known.nativeAssetSymbol,
            symbol: known.nativeAssetSymbol,
            decimals: known.nativeDecimals,
          },
          rpcUrls: [known.publicRpc],
          blockExplorerUrls: [known.explorer],
        },
      ],
    });
    await wallet.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  }
}

async function send(
  wallet: WalletProvider,
  chainId: string,
  tx: { to: string; data: string; value: string },
  checkExpiry: () => void,
) {
  const accounts = await wallet.request({ method: "eth_requestAccounts" });
  if (
    !Array.isArray(accounts) ||
    !/^0x[0-9a-fA-F]{40}$/.test(String(accounts[0]))
  )
    throw new Error("No wallet account available");
  const chain = await wallet.request({ method: "eth_chainId" });
  if (typeof chain !== "string" || BigInt(chain) !== BigInt(chainId))
    throw new Error("Switch your wallet to the payment network and try again");
  checkExpiry();
  let hash: unknown;
  try {
    hash = await wallet.request({
      method: "eth_sendTransaction",
      params: [{ from: accounts[0], ...tx }],
    });
  } catch (error) {
    if ((error as { code?: number }).code === 4001) throw error;
    throw Object.assign(
      new Error(
        "Wallet submission is uncertain. Check your wallet activity before sending again.",
      ),
      { mayHaveSent: true },
    );
  }
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw Object.assign(
      new Error(
        "Your wallet did not return a transaction reference. Check wallet activity before sending again.",
      ),
      { mayHaveSent: true },
    );
  return hash;
}

const expiry = (expiresAt?: string) => () => {
  if (
    expiresAt &&
    (!Number.isFinite(Date.parse(expiresAt)) ||
      Date.parse(expiresAt) <= Date.now())
  )
    throw new Error("Checkout expired. Ask the merchant for a new checkout.");
};

export async function submitDeposit(
  wallet: WalletProvider,
  payment: DepositPayment,
  expiresAt?: string,
) {
  const checkExpiry = expiry(expiresAt);
  checkExpiry();
  const request = depositPayment(payment);
  await onChain(wallet, request.chainId, payment.network);
  return send(
    wallet,
    request.chainId,
    { to: request.contract, data: request.data, value: request.value },
    checkExpiry,
  );
}

// A swap's deposit (lib/intents/checkout.ts walletTransfer): the quoted
// amount of any ERC-20, or the chain's own coin, to a one-time address.
export function evmTransfer(t: {
  chainId: number;
  token: string | null;
  amount: string;
  to: string;
}) {
  const value = BigInt(t.amount);
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(t.to) ||
    (t.token !== null && !/^0x[0-9a-fA-F]{40}$/.test(t.token)) ||
    value <= 0n ||
    value >= 2n ** 256n
  )
    throw new Error("Invalid payment instructions");
  return {
    chainId: `0x${t.chainId.toString(16)}`,
    to: t.token ?? t.to,
    value: t.token ? "0x0" : `0x${value.toString(16)}`,
    data: t.token
      ? `0xa9059cbb${t.to.slice(2).toLowerCase().padStart(64, "0")}${value.toString(16).padStart(64, "0")}`
      : "0x",
  };
}

export async function submitEvmTransfer(
  wallet: WalletProvider,
  t: { chainId: number; chainName: string; token: string | null; amount: string; to: string },
  deadline?: string,
) {
  const checkExpiry = expiry(deadline);
  checkExpiry();
  const request = evmTransfer(t);
  await onChain(wallet, request.chainId, `eip155:${t.chainId}`, t.chainName);
  return send(wallet, request.chainId, { to: request.to, data: request.data, value: request.value }, checkExpiry);
}

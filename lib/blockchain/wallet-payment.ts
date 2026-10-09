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
export async function submitDeposit(
  wallet: WalletProvider,
  payment: DepositPayment,
  expiresAt?: string,
) {
  const checkExpiry = () => {
    if (
      expiresAt &&
      (!Number.isFinite(Date.parse(expiresAt)) ||
        Date.parse(expiresAt) <= Date.now())
    )
      throw new Error("Checkout expired. Ask the merchant for a new checkout.");
  };
  checkExpiry();
  const request = depositPayment(payment);
  let chain = await wallet.request({ method: "eth_chainId" });
  if (typeof chain !== "string" || BigInt(chain) !== BigInt(request.chainId)) {
    try {
      await wallet.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: request.chainId }],
      });
    } catch (error) {
      const network = registeredChain(payment.network);
      if (
        (error as { code?: number }).code !== 4902 ||
        !network ||
        network.family !== "evm"
      )
        throw error;
      await wallet.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: request.chainId,
            chainName: network.name,
            nativeCurrency: {
              name: network.nativeAssetSymbol,
              symbol: network.nativeAssetSymbol,
              decimals: network.nativeDecimals,
            },
            rpcUrls: [network.publicRpc],
            blockExplorerUrls: [network.explorer],
          },
        ],
      });
      await wallet.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: request.chainId }],
      });
    }
  }
  const accounts = await wallet.request({ method: "eth_requestAccounts" });
  if (
    !Array.isArray(accounts) ||
    !/^0x[0-9a-fA-F]{40}$/.test(String(accounts[0]))
  )
    throw new Error("No wallet account available");
  chain = await wallet.request({ method: "eth_chainId" });
  if (typeof chain !== "string" || BigInt(chain) !== BigInt(request.chainId))
    throw new Error("Switch your wallet to the payment network and try again");
  checkExpiry();
  let tx: unknown;
  try {
    tx = await wallet.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: accounts[0],
          to: request.contract,
          data: request.data,
          value: request.value,
        },
      ],
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
  if (typeof tx !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(tx))
    throw Object.assign(
      new Error(
        "Your wallet did not return a transaction reference. Check wallet activity before sending again.",
      ),
      { mayHaveSent: true },
    );
  return tx;
}

"use client";
// "What do you want to pay with?" (payOptions in lib/intents/checkout.ts).
// The customer picks a token from one searchable list (token-picker.tsx) and
// sees what they'll pay before going on: the exact amount for a token the
// merchant receives as it is, or today's price for one NEAR Intents swaps
// into the checkout's stablecoin. A swap is paid from a connected wallet,
// which is also where a failed swap is refunded, or sent from any other
// wallet or exchange with a refund address. Which merchant account receives
// is routing, never shown here.
import { useCallback, useEffect, useMemo, useState } from "react";
import { displayTokenAmount } from "@/lib/blockchain/stablecoin-payment";
import { chain as registeredChain } from "@/lib/blockchain/chains";
import { discoverEvmWallets, type DiscoveredWallet } from "@/lib/blockchain/wallet-discovery";
import type { WalletTarget } from "@/lib/intents/checkout";
import { TokenIcon } from "./token-icon";
import { TokenPicker, amountLabel, ordered, type Row } from "./token-picker";
import { connectWallet, shortAddress, solanaProvider, type Connected } from "./swap-wallet";

export type PayToken = {
  key: string;
  symbol: string;
  // dex: any token found by its address, swapped into USDC in the wallet
  // and paid as `via`, the checkout's USDC on that chain.
  route: "direct" | "swap" | "dex";
  method: string;
  optionId: string | null;
  amount?: string;
  assetId?: string;
  network?: string;
  approx?: string;
  price?: number;
  contract?: string;
  wallet?: WalletTarget;
  chain?: string;
  via?: PayToken;
  logo?: string;
};
type Options = {
  locked: boolean;
  settle: { symbol: string; amount: string } | null;
  chains: { id: string; name: string; logo?: string; tokens: PayToken[] }[];
};
type Api = (action?: object) => Promise<Record<string, unknown>>;
export type PayChoice = {
  route: "direct" | "swap" | "dex";
  assetId?: string;
  refundTo?: string;
  symbol: string;
  chainName: string;
  // A swap paid from a connected wallet: the wallet, and its transfer.
  wallet?: string;
  sent?: string;
  // A token found by its address: about how much of it the wallet swaps.
  approx?: string;
};

// The coin each network charges its fee in, by NEAR Intents chain code.
const feeCoin: Record<string, string> = {
  eth: "ETH", base: "ETH", arb: "ETH", op: "ETH", scroll: "ETH", abs: "ETH", pol: "POL", avax: "AVAX", bsc: "BNB",
  gnosis: "xDAI", bera: "BERA", xlayer: "OKB", sol: "SOL", near: "NEAR", tron: "TRX", ton: "TON", btc: "BTC",
  stellar: "XLM", sui: "SUI", aptos: "APT", xrp: "XRP", doge: "DOGE", ltc: "LTC", bch: "BCH", zec: "ZEC",
  cardano: "ADA", monad: "MON", plasma: "XPL", starknet: "STRK",
};
// NEAR Intents chain codes of the EVM networks a found token can be on.
const evmIds: Record<string, number> = { eth: 1, base: 8453, arb: 42161, op: 10, pol: 137, avax: 43114, bsc: 56 };
const swapChainId = (chain: string): WalletTarget | undefined => (evmIds[chain] ? { family: "evm", chainId: evmIds[chain] } : undefined);
const usdPrice = (n: number) => (n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toLocaleString("en-US", { maximumSignificantDigits: 4 }));

export function PayPicker({
  api,
  demo = false,
  busy,
  usd,
  fee,
  onStart,
  onWalletPay,
}: {
  api: Api;
  // The demo checkout: every token continues to its (simulated) payment,
  // with no wallet to connect and no refund address.
  demo?: boolean;
  busy: boolean;
  // The checkout's value in US dollars, when it has one.
  usd: string | null;
  // A processing fee the merchant passes to the customer, included above.
  fee: { amount: string; symbol: string } | null;
  onStart: (token: PayToken, choice: PayChoice) => void;
  onWalletPay: (token: PayToken, choice: PayChoice, wallet: Connected) => void;
}) {
  const [options, setOptions] = useState<Options | null>(null);
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);
  const [refundTo, setRefundTo] = useState("");
  const [manual, setManual] = useState(false);
  const [evmWallets, setEvmWallets] = useState<DiscoveredWallet[]>([]);
  const [evmChoice, setEvmChoice] = useState("");
  const [wallet, setWallet] = useState<Connected | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [found, setFound] = useState<Row[]>([]);

  const listed = useMemo<Row[]>(
    () => options?.chains.flatMap((c) => c.tokens.map((t) => ({ ...t, chainId: c.id, chainName: c.name, chainLogo: c.logo }))) ?? [],
    [options],
  );
  const rows = useMemo(() => [...listed, ...found], [listed, found]);

  // A token found by its address pays through the checkout's USDC on its
  // chain: received directly when the merchant takes it, else swapped.
  const lookup = useCallback(
    async (address: string) => {
      const r = (await api({ action: "token-lookup", address })) as {
        tokens: { chain: string; chainName: string; address: string; symbol: string; name: string; price: number; logo?: string }[];
      };
      const usdcOn = (chain: string) =>
        listed.find((t) => t.chainId === chain && t.symbol === "USDC" && t.route === "direct") ??
        listed.find((t) => t.chainId === chain && t.symbol === "USDC" && t.route === "swap");
      const payable = r.tokens.flatMap((t): Row[] => {
        const via = usdcOn(t.chain);
        if (!via) return [];
        return [
          {
            key: `dex:${t.chain}:${t.address}`,
            symbol: t.symbol,
            route: "dex",
            method: via.method,
            optionId: via.optionId,
            price: t.price,
            approx: usd ? (Number(usd) / t.price).toLocaleString("en-US", { maximumSignificantDigits: 6, useGrouping: false }) : undefined,
            contract: t.address,
            wallet: t.chain === "sol" ? { family: "solana" } : swapChainId(t.chain),
            chain: t.chain,
            via,
            chainId: t.chain,
            chainName: t.chainName,
            chainLogo: via.chainLogo,
            logo: t.logo,
          },
        ];
      });
      if (!payable.length)
        return r.tokens.length
          ? "That token can't pay this checkout: there's no USDC route on its network."
          : "No token with DEX liquidity at that address on Solana or the supported EVM networks.";
      setFound((old) => [...old.filter((o) => !payable.some((p) => p.key === o.key)), ...payable]);
      return null;
    },
    [api, listed, usd],
  );
  useEffect(() => {
    let alive = true;
    api({ action: "pay-options" })
      .then((r) => {
        if (!alive) return;
        const o = r as unknown as Options;
        if (!Array.isArray(o?.chains)) throw new Error("Unexpected payment options");
        setOptions(o);
        // Start on the token most customers pay with; any other is a tap away.
        const first = ordered(o.chains.flatMap((c) => c.tokens.map((t) => ({ ...t, chainId: c.id, chainName: c.name }))))[0];
        if (first) setKey(first.key);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [api]);
  useEffect(() => {
    return discoverEvmWallets(window, (found) => {
      setEvmWallets(found);
      setEvmChoice((old) => (found.some((w) => w.id === old) ? old : found.length === 1 ? found[0].id : ""));
    });
  }, []);

  const token = rows.find((r) => r.key === key);
  const target = token?.route === "swap" || token?.route === "dex" ? token.wallet : undefined;
  // The picker renders only in the browser, after its options load.
  const solana = target?.family === "solana" && !!solanaProvider();
  const walletReady =
    !!target && (target.family === "near" || (target.family === "evm" && evmWallets.length > 0) || (target.family === "solana" && solana));
  const connected = wallet && target && wallet.family === target.family ? wallet : null;

  if (failed)
    return (
      <p role="alert" className="sc-error">
        Payment options couldn&apos;t load. Refresh the page to try again.
      </p>
    );
  if (!options) return <p role="status">Loading payment options…</p>;
  if (!rows.length) return <p>This merchant can&apos;t take crypto payments for this checkout right now.</p>;

  const choice = (t: Row, refund?: string): PayChoice => ({
    route: t.route,
    symbol: t.symbol,
    chainName: t.chainName,
    ...(t.route === "swap" ? { assetId: t.assetId, refundTo: refund } : {}),
  });
  const native = token
    ? token.route === "direct" && token.network
      ? registeredChain(token.network)?.nativeAssetSymbol
      : feeCoin[token.chainId]
    : undefined;
  const rate =
    token?.route === "swap" && token.price
      ? token.price
      : token?.route === "direct" && token.amount && usd && Number(token.amount) > 0
        ? Number(usd) / Number(token.amount)
        : undefined;

  const dollars = usd ? `$${Number(usd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "";

  async function connect() {
    if (!target) return;
    setConnecting(true);
    setMessage("");
    try {
      setWallet(await connectWallet(target, evmWallets.find((w) => w.id === evmChoice)));
    } catch (e) {
      setMessage((e as { code?: number }).code === 4001 ? "Connection was cancelled in your wallet." : (e as Error).message || "Your wallet didn't connect.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <form
      className="pc"
      onSubmit={(e) => {
        e.preventDefault();
        if (!token) return;
        if (demo) {
          if (token.route === "dex" && token.via?.assetId)
            onStart(token.via, {
              route: "dex",
              symbol: token.symbol,
              chainName: token.chainName,
              assetId: token.via.assetId,
              refundTo: "demo",
              ...(token.approx ? { approx: token.approx } : {}),
            });
          else onStart(token, choice(token, "demo"));
          return;
        }
        if (token.route === "direct") onStart(token, choice(token));
        else if (refundTo.trim().length >= 20) onStart(token, choice(token, refundTo.trim()));
      }}
    >
      <h2>What do you want to pay with?</h2>
      <div className="pc-pay">
        <div className="pc-value">
          {token && amountLabel(token) ? (
            <>
              <strong>{amountLabel(token)}</strong>
              {dollars && <span>≈ {dollars}</span>}
            </>
          ) : (
            <strong>{dollars ? `≈ ${dollars}` : "—"}</strong>
          )}
        </div>
        <button
          type="button"
          className="pc-token"
          disabled={busy}
          aria-haspopup="dialog"
          aria-label={token ? `Token: ${token.symbol} on ${token.chainName}` : "Choose a token"}
          onClick={() => setOpen(true)}
        >
          {token ? (
            <>
              <TokenIcon symbol={token.symbol} src={token.logo} chain={{ name: token.chainName, logo: token.chainLogo }} />
              <span className="pc-token-name">
                <b>{token.symbol}</b>
                <small>{token.chainName}</small>
              </span>
            </>
          ) : (
            <span className="pc-token-name">
              <b>Choose a token</b>
            </span>
          )}
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {token && (
        <details className="pc-details">
          <summary>Details</summary>
          <dl className="pc-lines">
            <div>
              <dt>Merchant receives</dt>
              <dd>
                {options.settle
                  ? `${displayTokenAmount(options.settle.amount)} ${options.settle.symbol}`
                  : `${displayTokenAmount(token.amount ?? "0")} ${token.symbol}`}
              </dd>
            </div>
            {rate !== undefined && (
              <div>
                <dt>Rate</dt>
                <dd>
                  1 {token.symbol} ≈ ${usdPrice(rate)}
                </dd>
              </div>
            )}
            {token.route === "dex" && token.contract && (
              <div>
                <dt>Token</dt>
                <dd>
                  <code>{token.contract}</code>
                </dd>
              </div>
            )}
            {fee && (
              <div>
                <dt>Processing fee</dt>
                <dd>
                  {displayTokenAmount(fee.amount)} {fee.symbol}
                </dd>
              </div>
            )}
            {native && (
              <div>
                <dt>Network fee</dt>
                <dd>Paid in {native} by your wallet</dd>
              </div>
            )}
          </dl>
        </details>
      )}
      {token && (demo || token.route === "direct") && (
        <button className="sc-primary" disabled={busy}>
          {busy ? "Preparing…" : "Continue"}
        </button>
      )}
      {!demo && token?.route === "dex" && !walletReady && (
        <p className="sc-pending">Open this checkout in a wallet that holds {token.symbol} to pay with it.</p>
      )}
      {!demo && (token?.route === "swap" || token?.route === "dex") && walletReady && !manual && (
        <>
          {connected ? (
            <>
              <p className="pc-account">
                <span>
                  {connected.name} · {shortAddress(connected.address)}
                </span>
                <button type="button" className="pc-link" onClick={() => setWallet(null)}>
                  Disconnect
                </button>
              </p>
              <button
                type="button"
                className="sc-primary"
                disabled={busy}
                onClick={() => onWalletPay(token, choice(token, connected.address), connected)}
              >
                {busy ? "Check your wallet…" : `Pay ${token.approx ? `≈ ${token.approx} ` : ""}${token.symbol}`}
              </button>
            </>
          ) : (
            <>
              {target?.family === "evm" && evmWallets.length > 1 && (
                <>
                  <label htmlFor="pay-wallet">Wallet</label>
                  <select id="pay-wallet" value={evmChoice} onChange={(e) => setEvmChoice(e.target.value)}>
                    <option value="" disabled>
                      Choose a wallet
                    </option>
                    {evmWallets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <button
                type="button"
                className="sc-primary"
                disabled={busy || connecting || (target?.family === "evm" && !evmChoice)}
                onClick={() => void connect()}
              >
                {connecting ? "Check your wallet…" : "Connect wallet"}
              </button>
            </>
          )}
          {token.route === "swap" && (
            <button type="button" className="pc-link" onClick={() => setManual(true)}>
              Send from another wallet or exchange
            </button>
          )}
        </>
      )}
      {!demo && token?.route === "swap" && (!walletReady || manual) && (
        <>
          <label htmlFor="pay-refund">Refund address on {token.chainName}</label>
          <input id="pay-refund" value={refundTo} disabled={busy} autoComplete="off" spellCheck={false} onChange={(e) => setRefundTo(e.target.value)} />
          <button className="sc-primary" disabled={busy || refundTo.trim().length < 20}>
            {busy ? "Preparing…" : "Continue"}
          </button>
          {walletReady && (
            <button type="button" className="pc-link" onClick={() => setManual(false)}>
              Pay from a connected wallet
            </button>
          )}
        </>
      )}
      {message && (
        <p role="alert" className="sc-error">
          {message}
        </p>
      )}
      <TokenPicker
        open={open}
        rows={rows}
        selected={key}
        onClose={() => setOpen(false)}
        onLookup={lookup}
        onSelect={(r) => {
          setKey(r.key);
          setManual(false);
          setMessage("");
          setOpen(false);
        }}
      />
    </form>
  );
}

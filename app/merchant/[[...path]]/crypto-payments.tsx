"use client";
import { useState } from "react";
import { cryptoAssets, cryptoAsset } from "@/lib/blockchain/crypto-assets";
import { isTestnet, networkName } from "@/lib/blockchain/chains";
import type { CheckoutAsset } from "./stablecoin-checkout";
type Account = {
  id: string;
  symbol: string;
  network: string;
  remaining: number;
};
export function CryptoPayments({
  orgId,
  environment,
  country,
  assets,
  stablecoinAssets = [],
  accounts,
  canConfigure,
}: {
  orgId: string;
  environment: string;
  country: string;
  assets: CheckoutAsset[];
  stablecoinAssets?: CheckoutAsset[];
  accounts: Account[];
  canConfigure: boolean;
}) {
  const supported = cryptoAssets.filter(
    (a) => isTestnet(a.network) === (environment === "sandbox"),
  );
  const checkoutAssets = [...stablecoinAssets, ...assets].filter(
    (a) => a.executionEnabled,
  );
  const [selected, setSelected] = useState(
    `${supported[0].network}|${supported[0].identifier}`,
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [networkFilter, setNetworkFilter] = useState("all"),
    [coinSearch, setCoinSearch] = useState("");
  const [pending, setPending] = useState<object | null>(null),
    [result, setResult] = useState<{
      checkoutPath: string;
      expiresAt: string;
    } | null>(null);
  const command = async (action: string, input: object) => {
    const response = await fetch("/api/merchant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, orgId, input }),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error || "Unable to complete request");
    return body;
  };
  const create = async (input: object) => {
    setPending(input);
    setBusy(true);
    setMessage("");
    try {
      setResult(await command("crypto-checkout", input));
    } catch (e) {
      setMessage(
        (e as Error).message +
          ". Retry uses the same quote; start a new checkout if it expired.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section>
        <h2>Crypto wallet payments</h2>
        <p>
          Accept supported native coins and original token deployments directly
          from Web3 wallets. You receive the chosen coin in your own wallet.
          Rates are powered by CoinGecko.
        </p>
        <p>
          Quotes last two minutes. Our fee is 1.5% of each payment, all in,
          billed separately. Customers pay their wallet’s network fee. Exchange
          app payments:{" "}
          <span className="merchant-status-badge">Coming soon</span>
        </p>
        {environment === "sandbox" && (
          <p>
            Use test coins only. Mainnet tokens are not advertised on test
            networks without an official test deployment.
          </p>
        )}
        <p>
          Only original or canonical native deployments are listed. Wrapped and
          bridged copies are excluded. Stellar currently has 12 qualifying
          crypto coins; its stablecoins are listed separately.
        </p>
        <label>
          Filter crypto network
          <select
            aria-label="Filter crypto network"
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value)}
          >
            <option value="all">All networks</option>
            {[...new Set(supported.map((a) => a.network))].map((network) => (
              <option key={network} value={network}>
                {networkName(network)} (
                {supported.filter((a) => a.network === network).length} coins)
              </option>
            ))}
          </select>
        </label>
        <label>
          Find crypto coin
          <input
            type="search"
            value={coinSearch}
            onChange={(e) => setCoinSearch(e.target.value)}
            placeholder="Coin name or symbol"
          />
        </label>
        <div className="p-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Coin</th>
                <th>Network</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {assets
                .filter(
                  (a) =>
                    (networkFilter === "all" || a.network === networkFilter) &&
                    `${a.symbol} ${cryptoAsset(a.network, a.identifier)?.name ?? ""}`
                      .toLowerCase()
                      .includes(coinSearch.trim().toLowerCase()),
                )
                .map((a) => (
                  <tr key={a.network + a.identifier}>
                    <td>
                      {a.symbol}
                      {cryptoAsset(a.network, a.identifier)?.name && (
                        <small>
                          {" "}
                          · {cryptoAsset(a.network, a.identifier)!.name}
                        </small>
                      )}
                    </td>
                    <td>{networkName(a.network)}</td>
                    <td>
                      {a.executionEnabled
                        ? "Ready"
                        : a.configured
                          ? "Review scope or add addresses"
                          : "Add receive addresses"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {accounts.map((a) => (
          <p key={a.id}>
            {a.symbol} · {networkName(a.network)} · {a.remaining} unused receive
            addresses
          </p>
        ))}
      </section>
      {canConfigure && (
        <>
          <section>
            <h2>Add crypto receive addresses</h2>
            <p>
              Use fresh merchant-owned addresses, one per checkout. Keep your
              recovery phrases and private keys private. Saving requires recent
              authenticator verification.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  data = new FormData(form);
                setBusy(true);
                setMessage("");
                try {
                  const [network, identifier] = selected.split("|");
                  await command("crypto-wallets", {
                    network,
                    identifier,
                    addresses: String(data.get("addresses"))
                      .trim()
                      .split(/[\s,]+/),
                  });
                  location.reload();
                } catch (error) {
                  setMessage((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  Crypto coin and network
                  <select
                    aria-label="Crypto coin and network"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {supported.map((a) => (
                      <option
                        key={a.network + a.identifier}
                        value={`${a.network}|${a.identifier}`}
                      >
                        {a.symbol} on {networkName(a.network)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Fresh crypto receive addresses
                  <textarea
                    name="addresses"
                    required
                    rows={4}
                    placeholder={
                      selected.startsWith("stellar:")
                        ? "G…"
                        : selected.startsWith("solana:")
                          ? "Solana wallet address"
                          : "0x…"
                    }
                  />
                </label>
                <button>Save crypto receive addresses</button>
              </fieldset>
            </form>
          </section>
          <section>
            <h2>Create crypto checkout</h2>
            <p>
              Enter the invoice total in USD. Your customer can choose any
              selected stablecoin or crypto coin and network. Select both to
              offer both payment types. Each amount uses its CoinGecko USD rate.
              Creating a link requires recent authenticator verification.
            </p>
            {!checkoutAssets.length ? (
              <p>
                Configure receive addresses and complete required approvals
                first.
              </p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  const options = form.getAll("cryptoOption").map((v) => {
                    const [network, identifier] = String(v).split("|");
                    return { network, identifier };
                  });
                  if (!options.length || options.length > 20) {
                    setMessage(
                      "Select between 1 and 20 coin and network options per checkout.",
                    );
                    return;
                  }
                  void create({
                    key: crypto.randomUUID(),
                    environment,
                    reference: String(form.get("reference")),
                    payerCountry: String(
                      form.get("payerCountry"),
                    ).toUpperCase(),
                    usdAmount: String(form.get("usdAmount")),
                    options,
                  });
                }}
              >
                <fieldset disabled={busy || !!pending}>
                  <label>
                    Crypto checkout reference
                    <input name="reference" required maxLength={100} />
                  </label>
                  <label>
                    Invoice total (USD)
                    <input
                      name="usdAmount"
                      required
                      inputMode="decimal"
                      pattern="(0|[1-9][0-9]{0,11})\.[0-9]{2}"
                      placeholder="10.00"
                    />
                  </label>
                  <label>
                    Crypto payer country
                    <input
                      name="payerCountry"
                      required
                      pattern="[A-Za-z]{2}"
                      maxLength={2}
                      defaultValue={country}
                    />
                  </label>
                  {checkoutAssets.map((a, index) => (
                    <label key={a.network + a.identifier}>
                      <input
                        type="checkbox"
                        name="cryptoOption"
                        value={`${a.network}|${a.identifier}`}
                        defaultChecked={index < 20}
                      />
                      {a.symbol} on {networkName(a.network)} ·{" "}
                      {a.identifier.startsWith("native:") ||
                      cryptoAsset(a.network, a.identifier)
                        ? "Crypto"
                        : "Stablecoin"}
                    </label>
                  ))}
                  <button>Create crypto checkout link</button>
                </fieldset>
              </form>
            )}
            {pending && !result && (
              <button disabled={busy} onClick={() => void create(pending)}>
                Retry crypto checkout creation
              </button>
            )}
            {result && (
              <p>
                Quote expires {new Date(result.expiresAt).toLocaleTimeString()}.{" "}
                <a href={result.checkoutPath} target="_blank" rel="noreferrer">
                  Open crypto customer checkout
                </a>
              </p>
            )}
            {pending && (
              <button
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  setResult(null);
                  setMessage("");
                }}
              >
                Start a new crypto checkout
              </button>
            )}
          </section>
        </>
      )}
      <p role="status">{message}</p>
    </>
  );
}

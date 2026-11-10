"use client";
import { useState } from "react";
import { cryptoAssets, cryptoAsset } from "@/lib/blockchain/crypto-assets";
import { isTestnet, networkName } from "@/lib/blockchain/chains";
import type { CheckoutAsset } from "./stablecoins";
import { errorText, offline } from "@/lib/error-copy";
type Account = {
  id: string;
  symbol: string;
  network: string;
  remaining: number;
};
export function CryptoPayments({
  orgId,
  environment,
  assets,
  accounts,
  canConfigure,
}: {
  orgId: string;
  environment: string;
  assets: CheckoutAsset[];
  accounts: Account[];
  canConfigure: boolean;
}) {
  const supported = cryptoAssets.filter(
    (a) => isTestnet(a.network) === (environment === "sandbox"),
  );
  const [selected, setSelected] = useState(
    `${supported[0].network}|${supported[0].identifier}`,
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [networkFilter, setNetworkFilter] = useState("all"),
    [coinSearch, setCoinSearch] = useState("");
  const command = async (action: string, input: object) => {
    const response = await fetch("/api/merchant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, orgId, input }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorText(body, response.status));
    return body;
  };
  return (
    <section>
      <h2>Other coins: ETH, SOL, XLM and more</h2>
      {canConfigure && (
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
              setMessage(error instanceof TypeError ? offline : (error as Error).message);
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
              Coin addresses, one per line
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
            <button>Save coin addresses</button>
          </fieldset>
        </form>
      )}
      <p role="status">{message}</p>
      <div className="ms-coin-filters">
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
      </div>
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
  );
}

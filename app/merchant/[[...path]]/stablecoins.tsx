"use client";
import { networkName, isTestnet, chain } from "@/lib/blockchain/chains";
import { StablecoinCheckout, type CheckoutAsset } from "./stablecoin-checkout";
import { useState } from "react";
import { tokenAssets } from "@/lib/blockchain/assets";
import { comingSoonMethods } from "@/lib/payments/launch-catalog";
type Account = {
  id: string;
  symbol: string;
  network: string;
  identifier: string;
  remaining: number;
  environment: string;
  accountReference: string;
};
export function Stablecoins({
  orgId,
  environment,
  accounts,
  canConfigure,
  country,
  readiness,
}: {
  orgId: string;
  environment: string;
  accounts: Account[];
  canConfigure: boolean;
  country: string;
  readiness: CheckoutAsset[];
}) {
  const assets = tokenAssets.filter(
    (a) => isTestnet(a.network) === (environment === "sandbox"),
  );
  const [chosen, setChosen] = useState(
      `${assets[0].network}|${assets[0].identifier}`,
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [network] = chosen.split("|");
  return (
    <>
      <section>
        <h2>Stablecoin payments</h2>
        <p>
          Customers pay directly to your receive addresses. PayRouta verifies
          the exact token, network and amount, then records settlement after
          network finality.
        </p>
        <p>
          {environment === "sandbox"
            ? "Use test tokens on the supported test networks. Sandbox platform fees are zero."
            : "Live payments require approved business evidence, receive-address ownership and a current processing scope. Our fee is 1.5% of each payment, all in, billed separately."}
        </p>
        {accounts.length ? (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Network</th>
                  <th>Unused addresses</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.symbol}</td>
                    <td>{networkName(a.network)}</td>
                    <td>{a.remaining}</td>
                    <td>
                      {a.remaining === 0
                        ? "Add receive addresses"
                        : environment === "sandbox"
                          ? "Testnet configured"
                          : "Subject to live scope approval"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No stablecoin receive addresses configured yet.</p>
        )}
        <p>
          Each checkout permanently uses one unique receive address. Provision
          fresh merchant-owned addresses before your pool runs out.
        </p>
      </section>
      <section>
        <h2>Supported stablecoins</h2>
        <div className="p-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Supported networks</th>
                <th>Availability</th>
              </tr>
            </thead>
            <tbody>
              {["USDC", "USDT", "EURC"].map((symbol) => {
                const main = tokenAssets.filter(
                  (a) => a.symbol === symbol && !isTestnet(a.network),
                );
                const enabled = readiness.filter(
                  (a) => a.symbol === symbol && a.executionEnabled,
                );
                const hasTestnet = tokenAssets.some(
                  (a) => a.symbol === symbol && isTestnet(a.network),
                );
                return (
                  <tr key={symbol}>
                    <td>{symbol}</td>
                    <td>
                      {main.map((a) => networkName(a.network)).join(", ")}
                    </td>
                    <td>
                      {environment === "sandbox" && !hasTestnet
                        ? "Mainnet only"
                        : enabled.length
                          ? `${enabled.length} ${environment === "sandbox" ? "test" : "live"} networks ready`
                          : "Receive setup or approval required"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p>
          Wrapped and bridged tokens are excluded. Customers can select only the
          exact token and network options included in their checkout.
        </p>
      </section>
      {canConfigure && (
        <StablecoinCheckout
          orgId={orgId}
          environment={environment}
          country={country}
          assets={readiness}
        />
      )}
      {canConfigure && (
        <section>
          <h2>Add receive addresses</h2>
          <p>
            Use addresses controlled by your business. Keep the wallet recovery
            details in your own custody.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                values = new FormData(form);
              setBusy(true);
              setMessage("");
              try {
                const [network, identifier] = chosen.split("|");
                const rpcKey = String(values.get("rpcKey") || "").trim();
                const response = await fetch("/api/merchant", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    action: "stablecoins",
                    orgId,
                    input: {
                      network,
                      identifier,
                      addresses: String(values.get("addresses"))
                        .trim()
                        .split(/[\s,]+/),
                      ...(rpcKey ? { rpcKey } : {}),
                    },
                  }),
                });
                const b = await response.json();
                if (!response.ok) throw new Error(b.error);
                form.reset();
                setMessage(
                  b.reviewRequired
                    ? "Saved. Operations must review this receive-address pool before live processing."
                    : "Saved. These addresses are ready for testnet checkouts.",
                );
                location.reload();
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <label htmlFor="stablecoin-token">Token and network</label>
              <select
                id="stablecoin-token"
                value={chosen}
                onChange={(e) => setChosen(e.target.value)}
              >
                {assets.map((a) => (
                  <option
                    value={`${a.network}|${a.identifier}`}
                    key={`${a.network}:${a.identifier}`}
                  >
                    {a.symbol} on {networkName(a.network)}
                  </option>
                ))}
              </select>
              <label>
                Fresh receive addresses (one per line)
                <textarea
                  name="addresses"
                  required
                  rows={5}
                  placeholder={
                    chain(network)?.family === "evm"
                      ? "0x…"
                      : chain(network)?.family === "solana"
                        ? "Solana public address"
                        : "G… Stellar public account"
                  }
                />
              </label>
              <label>
                Alchemy API key (optional override)
                <input name="rpcKey" type="password" autoComplete="off" />
              </label>
              <p>
                Your platform RPC connection is used when no override is
                entered.
              </p>
              {chain(network)?.family === "stellar" && (
                <p>
                  Each Stellar receive account must already be funded and have
                  an authorized trustline for the selected token. Keep XLM
                  available for account reserves.
                </p>
              )}
              <button disabled={busy}>
                {busy ? "Saving…" : "Save receive addresses"}
              </button>
            </fieldset>
            <p>Saving requires recent authenticator verification.</p>
          </form>
          <p role="status">{message}</p>
        </section>
      )}
      <section>
        <h2>More ways to pay</h2>
        <div className="p-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Payment method</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {comingSoonMethods.map((m) => (
                <tr key={m.method}>
                  <td>{m.label}</td>
                  <td>
                    <span className="merchant-status-badge">Coming soon</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

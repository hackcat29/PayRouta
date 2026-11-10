"use client";
import { networkName, isTestnet, chain } from "@/lib/blockchain/chains";
import { useState } from "react";
import { tokenAssets } from "@/lib/blockchain/assets";
import { errorText, offline } from "@/lib/error-copy";
// A token the merchant can be paid in, as merchantConfiguration reports it.
export type CheckoutAsset = {
  network: string;
  identifier: string;
  symbol: string;
  decimals: number;
  configured: boolean;
  executionEnabled: boolean;
  reason: string | null;
};
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
  readiness,
}: {
  orgId: string;
  environment: string;
  accounts: Account[];
  canConfigure: boolean;
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
    <section>
      <h2>Stablecoins</h2>
        {accounts.length > 0 && (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Network</th>
                  <th className="ms-num">Unused addresses</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.symbol}</td>
                    <td>{networkName(a.network)}</td>
                    <td className="ms-num">{a.remaining}</td>
                    <td>
                      {a.remaining === 0 ? (
                        <span className="ms-pill warn">Add addresses</span>
                      ) : readiness.some((r) => r.network === a.network && r.identifier === a.identifier && r.executionEnabled) ? (
                        <span className="ms-pill good">Ready</span>
                      ) : (
                        <span className="ms-pill">In review</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {canConfigure && (
        <>
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
                const b = await response.json().catch(() => null);
                if (!response.ok) throw new Error(errorText(b, response.status));
                form.reset();
                setMessage(
                  b.reviewRequired
                    ? "Saved. Operations must review this receive-address pool before live processing."
                    : "Saved. These addresses are ready for testnet checkouts.",
                );
                location.reload();
              } catch (e) {
                setMessage(e instanceof TypeError ? offline : (e as Error).message);
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
                Stablecoin addresses, one per line
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
              <details>
                <summary>Alchemy API key (optional)</summary>
                <label>
                  Alchemy API key
                  <input name="rpcKey" type="password" autoComplete="off" />
                </label>
              </details>
              {chain(network)?.family === "stellar" && (
                <p>
                  Stellar accounts must be funded and trust this token.
                </p>
              )}
              <button disabled={busy}>
                {busy ? "Saving…" : "Save stablecoin addresses"}
              </button>
            </fieldset>
          </form>
          <p role="status">{message}</p>
        </>
      )}
    </section>
  );
}

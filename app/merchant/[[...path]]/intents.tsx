"use client";
// Crypto balance: the merchant's NEAR Intents account (lib/intents/account.ts,
// payouts.ts). Connect an account you own, choose the stablecoins checkouts
// settle in, see what it holds, and pay out or refund from it to any chain by
// signing in your own wallet. PayRouta never holds the funds or the keys.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { discoverEvmWallets, type DiscoveredWallet } from "@/lib/blockchain/wallet-discovery";
import { errorText, offline } from "@/lib/error-copy";
import { connectEvm, connectNear, registerKey, signText, type Signer } from "./intents-wallet";
import { CashOut, type CashOutView, type PayoutQuote } from "./cash-out";

type Overview = {
  account: { id: string; accountId: string; standard: string; publicKey: string | null; keyRegistered: boolean; connectedAt: string } | null;
  settlement?: { integrationId: string; symbol: string; chainName: string }[];
  balances?: { assetId: string; symbol: string; chainName: string; amount: string }[] | null;
  payments?: {
    intentId: string;
    reference: string;
    amount: string;
    symbol: string;
    settlementAsset: string;
    paidWith: string;
    originAsset: string;
    refundTo: string;
    refundable: string;
    paidAt: string;
  }[];
};
type Payout = {
  id: string;
  purpose: string;
  send: string;
  receive: string;
  chainName: string;
  recipient: string;
  status: string;
  explorerUrl: string | null;
  note: string | null;
  createdAt: string;
};
type Token = { assetId: string; chain: string; chainName: string; symbol: string };
type Settle = { network: string; identifier: string; symbol: string; chainName: string };
type Quote = {
  payout: Payout;
  sign: { standard: "erc191"; payload: string } | { standard: "nep413"; payload: { message: string; nonce: string; recipient: string } };
  deadline: string;
};

const statusText: Record<string, string> = {
  AWAITING_SIGNATURE: "Waiting for your signature",
  PENDING_DEPOSIT: "Submitted",
  KNOWN_DEPOSIT_TX: "Submitted",
  PROCESSING: "Swapping and sending",
  SUCCESS: "Sent",
  INCOMPLETE_DEPOSIT: "Needs review",
  REFUNDED: "Returned to your balance",
  FAILED: "Failed, returned to your balance",
  EXPIRED: "Not signed in time",
};

export function CryptoBalance({
  orgId,
  environment,
  overview,
  payouts,
  settleOptions,
  tokens,
  canConfigure,
  cashOut,
}: {
  orgId: string;
  environment: string;
  overview: Overview;
  payouts: Payout[];
  settleOptions: Settle[];
  tokens: Token[];
  canConfigure: boolean;
  cashOut?: CashOutView;
}) {
  const router = useRouter();
  const [evmWallets, setEvmWallets] = useState<DiscoveredWallet[]>([]);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [settle, setSettle] = useState<string[]>(settleOptions.slice(0, 1).map((s) => `${s.network}|${s.identifier}`));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [form, setForm] = useState({ originAsset: "", amount: "", chain: "", destinationAsset: "", recipient: "", note: "", refundOf: "" });
  const account = overview.account;

  useEffect(() => discoverEvmWallets(window, setEvmWallets), []);
  const chains = useMemo(() => [...new Map(tokens.map((t) => [t.chain, t.chainName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [tokens]);

  async function api(action: string, input?: object) {
    let response: Response;
    try {
      response = await fetch("/api/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, orgId, ...(input ? { input } : {}) }),
      });
    } catch {
      throw new Error(offline);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorText(body, response.status));
    return body;
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  // The wallet that controls the connected account.
  async function ownSigner(make?: () => Promise<Signer>) {
    if (signer && signer.accountId === account?.accountId) return signer;
    const evm = () => {
      if (!evmWallets.length) throw new Error("Open this page in a browser with your EVM wallet installed.");
      return connectEvm(evmWallets[0].provider);
    };
    const s = await (make ?? (account?.standard === "erc191" ? evm : connectNear))();
    if (s.accountId !== account?.accountId) throw new Error(`Connect the wallet for ${account?.accountId}. This wallet is ${s.accountId}.`);
    setSigner(s);
    return s;
  }

  const connect = (make: () => Promise<Signer>) =>
    run(async () => {
      const s = await make();
      setSigner(s);
      const challenge = await api("intents-challenge", { account: s.accountId });
      const signed = await signText(s, challenge.message, { nonce: challenge.nonce, recipient: challenge.recipient });
      await api("intents-connect", {
        challengeId: challenge.id,
        ...signed,
        assets: settle.map((k) => ({ network: k.split("|")[0], identifier: k.split("|")[1] })),
      });
      setNotice("Connected. Operations review the account before live checkouts settle into it.");
      router.refresh();
    });

  if (environment !== "production")
    return (
      <section>
        <h2>Crypto balance</h2>
<p>Live mode only.</p>
      </section>
    );

  if (!account)
    return (
      <section>
        <h2>Get paid into your own NEAR Intents account</h2>
        {canConfigure ? (
          <>
            <fieldset disabled={busy}>
              <legend>Settle checkouts in</legend>
              {settleOptions.map((s) => {
                const key = `${s.network}|${s.identifier}`;
                return (
                  <label key={key} className="ms-check">
                    <input
                      type="checkbox"
                      checked={settle.includes(key)}
                      onChange={(e) => setSettle(e.target.checked ? [...settle, key] : settle.filter((k) => k !== key))}
                    />{" "}
                    {s.symbol} on {s.chainName}
                  </label>
                );
              })}
            </fieldset>
            <div className="ms-link-actions">
              <button className="ms-btn primary" disabled={busy || !settle.length} onClick={() => void connect(connectNear)}>
                {busy ? "Waiting for your wallet…" : "Connect a NEAR wallet"}
              </button>
              {evmWallets.map((w) => (
                <button key={w.id} className="ms-btn" disabled={busy || !settle.length} onClick={() => void connect(() => connectEvm(w.provider))}>
                  Connect {w.name}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p>Ask an owner or admin to connect an account.</p>
        )}
        {error && <p className="p-notice error">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </section>
    );

  const balances = overview.balances;
  const origin = balances?.find((b) => b.assetId === form.originAsset);
  const refunding = overview.payments?.find((p) => p.intentId === form.refundOf);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  return (
    <>
      <section className="ms-flush">
        <div className="ms-card-head">
          <div>
            <h2>NEAR Intents account</h2>
            <p>
              <code>{account.accountId}</code> · {account.standard === "erc191" ? "EVM wallet" : "NEAR wallet"} · connected{" "}
              {new Date(account.connectedAt).toLocaleDateString()}
            </p>
            <p>Checkouts settle in {overview.settlement?.map((s) => `${s.symbol} on ${s.chainName}`).join(", ") || "no stablecoins yet"}.</p>
          </div>
          {canConfigure && (
            <button
              className="ms-btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!confirm("Disconnect this account? New checkouts stop settling into it; the funds stay in your account.")) return;
                  await api("intents-disconnect");
                  router.refresh();
                })
              }
            >
              Disconnect
            </button>
          )}
        </div>
        {!account.keyRegistered && (
          <div className="p-notice">
            <button
              className="ms-btn"
              disabled={busy || !canConfigure}
              onClick={() =>
                void run(async () => {
                  await registerKey(await ownSigner(connectNear), account.publicKey!);
                  setNotice("Key registered. You can pay out now.");
                  router.refresh();
                })
              }
            >
              Register wallet key to pay out
            </button>
          </div>
        )}
        <h3>Balance</h3>
        {balances === null ? (
          <p className="ms-empty-line">The balance can&apos;t be read right now. Try again shortly.</p>
        ) : !balances?.length ? (
          <p className="ms-empty-line">Nothing yet.</p>
        ) : (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Held as</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.assetId}>
                    <td>{b.symbol}</td>
                    <td>{b.chainName}</td>
                    <td>{b.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canConfigure && !!balances?.length && (
        <section>
          <h2>{refunding ? `Refund ${refunding.reference}` : "Pay out"}</h2>
          {quote ? (
            <div className="ms-link-created" role="status">
              <p>
                Send <strong>{quote.payout.send}</strong> from your balance. <strong>{quote.payout.recipient}</strong> receives{" "}
                <strong>{quote.payout.receive}</strong> on {quote.payout.chainName}.
              </p>
              <p>Sign before {new Date(quote.deadline).toLocaleTimeString()}.</p>
              <div className="ms-link-actions">
                <button
                  className="ms-btn primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const s = await ownSigner();
                      const i = quote.sign;
                      const signed =
                        i.standard === "erc191"
                          ? await signText(s, i.payload, { nonce: "", recipient: "" })
                          : await signText(s, i.payload.message, { nonce: i.payload.nonce, recipient: i.payload.recipient });
                      await api("intents-payout-submit", { id: quote.payout.id, ...signed });
                      setQuote(null);
                      setForm({ originAsset: "", amount: "", chain: "", destinationAsset: "", recipient: "", note: "", refundOf: "" });
                      setNotice(refunding ? "Refund sent." : "Payout sent. It usually arrives within a minute.");
                      router.refresh();
                    })
                  }
                >
                  {busy ? "Waiting for your wallet…" : "Sign and send"}
                </button>
                <button className="ms-btn" disabled={busy} onClick={() => setQuote(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <form
              className="ms-link-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  setQuote(
                    await api("intents-payout-quote", {
                      originAsset: form.originAsset,
                      amount: form.amount.replace(/[,\s]/g, ""),
                      destinationAsset: form.destinationAsset,
                      recipient: form.recipient.trim(),
                      ...(form.note ? { note: form.note } : {}),
                      ...(form.refundOf ? { refundOf: form.refundOf } : {}),
                    }),
                  );
                });
              }}
            >
              <label>
                Pay from
                <select required value={form.originAsset} disabled={!!refunding} onChange={(e) => set({ originAsset: e.target.value })}>
                  <option value="">Choose a balance</option>
                  {balances.map((b) => (
                    <option key={b.assetId} value={b.assetId}>
                      {b.symbol} ({b.chainName}) · {b.amount}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Amount{origin ? ` in ${origin.symbol}` : ""}
                <input
                  required
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                  placeholder={refunding ? `Up to ${refunding.refundable}` : "250"}
                />
              </label>
              <label>
                Network they receive on
                <select
                  required
                  value={form.chain}
                  disabled={!!refunding}
                  onChange={(e) => set({ chain: e.target.value, destinationAsset: "" })}
                >
                  <option value="">Choose a network</option>
                  {chains.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Token they receive
                <select
                  required
                  value={form.destinationAsset}
                  disabled={!form.chain || !!refunding}
                  onChange={(e) => set({ destinationAsset: e.target.value })}
                >
                  <option value="">Choose a token</option>
                  {tokens
                    .filter((t) => t.chain === form.chain)
                    .map((t) => (
                      <option key={t.assetId} value={t.assetId}>
                        {t.symbol}
                      </option>
                    ))}
                </select>
              </label>
              <label className="ms-link-wide">
                Their address on that network
                <input
                  required
                  value={form.recipient}
                  readOnly={!!refunding}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => set({ recipient: e.target.value })}
                />
              </label>
              <label className="ms-link-wide">
                Note for your records (optional)
                <input maxLength={200} value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="October payroll" />
              </label>
              <div className="ms-link-actions">
                <button className="ms-btn primary" disabled={busy}>
                  {busy ? "Getting a quote…" : "Review"}
                </button>
                {refunding && (
                  <button
                    type="button"
                    className="ms-btn"
                    onClick={() => setForm({ originAsset: "", amount: "", chain: "", destinationAsset: "", recipient: "", note: "", refundOf: "" })}
                  >
                    Cancel refund
                  </button>
                )}
              </div>
            </form>
          )}
        </section>
      )}
      {canConfigure && account && cashOut && (
        <CashOut
          view={cashOut}
          balances={balances ?? []}
          api={api}
          run={run}
          busy={busy}
          signAndSubmit={async (q: PayoutQuote) => {
            const s = await ownSigner();
            const i = q.sign;
            const signed =
              i.standard === "erc191"
                ? await signText(s, i.payload, { nonce: "", recipient: "" })
                : await signText(s, i.payload.message, { nonce: i.payload.nonce, recipient: i.payload.recipient });
            await api("intents-payout-submit", { id: q.payout.id, ...signed });
          }}
        />
      )}
      {(error || notice) && (
        <section>
          {error && <p className="p-notice error">{error}</p>}
          {notice && <p role="status">{notice}</p>}
        </section>
      )}

      <section className="ms-flush">
        <div className="ms-card-head">
          <div>
            <h2>Payments settled here</h2>
          </div>
        </div>
        {!overview.payments?.length ? (
          <p className="ms-empty-line">No intents payments yet.</p>
        ) : (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Received</th>
                  <th>Customer paid with</th>
                  <th>Refundable</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {overview.payments.map((p) => (
                  <tr key={p.intentId}>
                    <td>{p.reference}</td>
                    <td>
                      {p.amount} {p.symbol}
                    </td>
                    <td>{p.paidWith}</td>
                    <td>
                      {p.refundable} {p.symbol}
                    </td>
                    <td>
                      {canConfigure && Number(p.refundable) > 0 && balances?.some((b) => b.assetId === p.settlementAsset) && (
                        <button
                          className="ms-btn"
                          onClick={() => {
                            const t = tokens.find((x) => x.assetId === p.originAsset);
                            setQuote(null);
                            setForm({
                              originAsset: p.settlementAsset,
                              amount: p.refundable,
                              chain: t?.chain ?? "",
                              destinationAsset: p.originAsset,
                              recipient: p.refundTo,
                              note: `Refund ${p.reference}`,
                              refundOf: p.intentId,
                            });
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          Refund
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="ms-flush">
        <div className="ms-card-head">
          <div>
            <h2>Payouts and refunds</h2>
          </div>
        </div>
        {!payouts.length ? (
          <p className="ms-empty-line">None yet.</p>
        ) : (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Sent</th>
                  <th>Received</th>
                  <th>To</th>
                  <th>Note</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                    <td>{p.purpose === "refund" ? "Refund" : "Payout"}</td>
                    <td>{p.send}</td>
                    <td>
                      {p.receive} on {p.chainName}
                    </td>
                    <td>
                      <code>{p.recipient}</code>
                    </td>
                    <td>{p.note}</td>
                    <td>
                      {p.explorerUrl ? (
                        <a href={p.explorerUrl} target="_blank" rel="noreferrer">
                          {statusText[p.status] ?? p.status}
                        </a>
                      ) : (
                        (statusText[p.status] ?? p.status)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

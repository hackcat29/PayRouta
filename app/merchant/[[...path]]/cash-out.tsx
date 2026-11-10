"use client";
// Cash out to a bank or mobile money (lib/treasury/offramp/cashout.ts), in
// the Crypto balance page: Bridge for US and SEPA banks, Yellow Card for
// local currency. A cash out is a payout of USDC on Base from the NEAR
// Intents account, signed like any payout (intents.tsx), that the partner
// converts and pays.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { alpha3 } from "@/lib/treasury/offramp/iso3";

type Account = {
  id: string;
  partner: string;
  status: string;
  country: string;
  currency: string;
  label: string;
  kycUrl?: string | null;
  tosUrl?: string | null;
  verified: boolean;
  depositAddress?: string;
};
type CashOutRow = { id: string; partner: string; amountUsd: string; currency: string; localAmount: string | null; status: string; failure: string | null; createdAt: string };
export type CashOutView = {
  accounts: Account[];
  cashOuts: CashOutRow[];
  yellowCardFunding: boolean;
  available?: { bridge: boolean; yellowcard: boolean };
};
type Balance = { assetId: string; symbol: string; chainName: string; amount: string };
export type PayoutQuote = {
  payout: { id: string; send: string; receive: string };
  sign: { standard: "erc191"; payload: string } | { standard: "nep413"; payload: { message: string; nonce: string; recipient: string } };
  deadline: string;
};
type Api = (action: string, input?: object) => Promise<Record<string, unknown>>;

// Yellow Card countries whose payouts need no fields beyond the account.
const localCurrencies: Record<string, [string, string]> = {
  NG: ["Nigeria", "NGN"],
  GH: ["Ghana", "GHS"],
  KE: ["Kenya", "KES"],
  ZA: ["South Africa", "ZAR"],
  UG: ["Uganda", "UGX"],
  TZ: ["Tanzania", "TZS"],
  ZM: ["Zambia", "ZMW"],
  MX: ["Mexico", "MXN"],
};
const partnerName = { bridge: "Bridge", yellowcard: "Yellow Card" } as const;

export function CashOut({
  view,
  balances,
  api,
  run,
  busy,
  signAndSubmit,
}: {
  view: CashOutView;
  balances: Balance[];
  api: Api;
  run: (work: () => Promise<void>) => Promise<void>;
  busy: boolean;
  signAndSubmit: (quote: PayoutQuote) => Promise<void>;
}) {
  const router = useRouter();
  const bridge = view.accounts.find((a) => a.partner === "bridge");
  const yellow = view.accounts.find((a) => a.partner === "yellowcard");
  const ready = view.accounts.filter(
    (a) =>
      a.status === "Ready" &&
      (a.partner === "bridge" || view.yellowCardFunding) &&
      view.available?.[a.partner as "bridge" | "yellowcard"] !== false,
  );
  const [currency, setCurrency] = useState<"usd" | "eur">("usd");
  const [bank, setBank] = useState({ bankName: "", accountName: "", routingNumber: "", accountNumber: "", checkingOrSavings: "checking", rail: "ach", iban: "", bic: "" });
  const [local, setLocal] = useState({ country: "", networkId: "", accountNumber: "", accountName: "" });
  const [networks, setNetworks] = useState<{ id: string; name: string; channelType: "bank" | "momo" }[]>([]);
  const [editLocal, setEditLocal] = useState(!yellow);
  const [form, setForm] = useState<{ partner: string; originAsset: string; amount: string }>({ partner: ready[0]?.partner ?? "", originAsset: "", amount: "" });
  const [quote, setQuote] = useState<(PayoutQuote & { cashOut: CashOutRow }) | null>(null);
  const [done, setDone] = useState("");

  const network = networks.find((n) => n.id === local.networkId);
  const bankCurrency = (bridge?.currency ?? currency.toUpperCase()).toLowerCase() as "usd" | "eur";

  return (
    <>
      <section>
        <h2>Cash out to your bank</h2>
        <div className="ms-grid-2">
          <div className="ms-cashout-card">
            <h3>
              US and EU banks
              {view.available?.bridge === false && <span className="ms-na">Not available</span>}
            </h3>
            {view.available?.bridge === false && !bridge ? null : !bridge ? (
              <div className="ms-inline-form">
                <label htmlFor="bridge-currency">Paid in</label>
                <select id="bridge-currency" value={currency} onChange={(e) => setCurrency(e.target.value as "usd" | "eur")}>
                  <option value="usd">US dollars (ACH or wire)</option>
                  <option value="eur">Euros (SEPA)</option>
                </select>
                <button className="ms-btn primary" disabled={busy} onClick={() => void run(async () => (await api("cashout-bridge-start", { currency }), router.refresh()))}>
                  Verify your business with Bridge
                </button>
              </div>
            ) : bridge.status === "Rejected" ? (
              <p className="p-notice error">Bridge didn&apos;t approve the business. Contact PayRouta.</p>
            ) : !bridge.verified ? (
              <>
                <ol>
                  <li>
                    <a href={bridge.kycUrl ?? "#"} target="_blank" rel="noreferrer">
                      Verify your business
                    </a>
                  </li>
                  <li>
                    <a href={bridge.tosUrl ?? "#"} target="_blank" rel="noreferrer">
                      Accept Bridge&apos;s terms
                    </a>
                  </li>
                </ol>
                <button className="ms-btn" disabled={busy} onClick={() => router.refresh()}>
                  Check again
                </button>
              </>
            ) : bridge.status !== "Ready" ? (
              <form
                className="ms-link-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await api(
                      "cashout-bridge-bank",
                      bankCurrency === "usd"
                        ? {
                            currency: "usd",
                            rail: bank.rail,
                            bankName: bank.bankName,
                            accountName: bank.accountName,
                            routingNumber: bank.routingNumber.trim(),
                            accountNumber: bank.accountNumber.trim(),
                            checkingOrSavings: bank.checkingOrSavings,
                          }
                        : {
                            currency: "eur",
                            rail: "sepa",
                            bankName: bank.bankName,
                            accountName: bank.accountName,
                            iban: bank.iban.replace(/\s/g, "").toUpperCase(),
                            bic: bank.bic.trim().toUpperCase(),
                            ibanCountry: alpha3[bank.iban.trim().slice(0, 2).toUpperCase()] ?? "",
                          },
                    );
                    router.refresh();
                  });
                }}
              >
                <label>
                  Bank name
                  <input required value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} />
                </label>
                <label>
                  Account name
                  <input required value={bank.accountName} onChange={(e) => setBank({ ...bank, accountName: e.target.value })} />
                </label>
                {bankCurrency === "usd" ? (
                  <>
                    <label>
                      Routing number
                      <input required inputMode="numeric" value={bank.routingNumber} onChange={(e) => setBank({ ...bank, routingNumber: e.target.value })} />
                    </label>
                    <label>
                      Account number
                      <input required inputMode="numeric" value={bank.accountNumber} onChange={(e) => setBank({ ...bank, accountNumber: e.target.value })} />
                    </label>
                    <label>
                      Account type
                      <select value={bank.checkingOrSavings} onChange={(e) => setBank({ ...bank, checkingOrSavings: e.target.value })}>
                        <option value="checking">Checking</option>
                        <option value="savings">Savings</option>
                      </select>
                    </label>
                    <label>
                      Paid by
                      <select value={bank.rail} onChange={(e) => setBank({ ...bank, rail: e.target.value })}>
                        <option value="ach">ACH</option>
                        <option value="wire">Wire</option>
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      IBAN
                      <input required value={bank.iban} onChange={(e) => setBank({ ...bank, iban: e.target.value })} />
                    </label>
                    <label>
                      BIC
                      <input required value={bank.bic} onChange={(e) => setBank({ ...bank, bic: e.target.value })} />
                    </label>
                  </>
                )}
                <div className="ms-link-wide">
                  <button className="ms-btn primary" disabled={busy}>
                    Add bank account
                  </button>
                </div>
              </form>
            ) : (
              <dl className="ms-props">
                <dt>Paid to</dt>
                <dd>{bridge.label}</dd>
                <dt>USDC on Base sent here is paid to that bank</dt>
                <dd>
                  <code>{bridge.depositAddress}</code>
                </dd>
              </dl>
            )}
          </div>

          <div className="ms-cashout-card">
            <h3>
              Local currency
              {view.available?.yellowcard === false && <span className="ms-na">Not available</span>}
            </h3>
            {view.available?.yellowcard === false && !yellow ? null : yellow && !editLocal ? (
              <>
                <dl className="ms-props">
                  <dt>Paid to</dt>
                  <dd>{yellow.label}</dd>
                </dl>
                <button className="ms-btn" onClick={() => setEditLocal(true)}>
                  Change
                </button>
              </>
            ) : (
              <form
                className="ms-link-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!network) return;
                  void run(async () => {
                    await api("cashout-yellowcard-account", {
                      country: local.country,
                      currency: localCurrencies[local.country][1],
                      channelType: network.channelType,
                      networkId: network.id,
                      networkName: network.name,
                      accountNumber: local.accountNumber,
                      accountName: local.accountName,
                    });
                    setEditLocal(false);
                    router.refresh();
                  });
                }}
              >
                <label>
                  Country
                  <select
                    required
                    value={local.country}
                    onChange={(e) => {
                      const country = e.target.value;
                      setLocal({ ...local, country, networkId: "" });
                      setNetworks([]);
                      if (country)
                        void run(async () => setNetworks(((await api("cashout-yellowcard-networks", { country })).networks as typeof networks) ?? []));
                    }}
                  >
                    <option value="">Choose a country</option>
                    {Object.entries(localCurrencies).map(([id, [name, cur]]) => (
                      <option key={id} value={id}>
                        {name} ({cur})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Bank or mobile money
                  <select required disabled={!networks.length} value={local.networkId} onChange={(e) => setLocal({ ...local, networkId: e.target.value })}>
                    <option value="">Choose one</option>
                    {networks.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} {n.channelType === "momo" ? "(mobile money)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {network?.channelType === "momo" ? "Phone number" : "Account number"}
                  <input required value={local.accountNumber} onChange={(e) => setLocal({ ...local, accountNumber: e.target.value })} />
                </label>
                <label>
                  Account name
                  <input required value={local.accountName} onChange={(e) => setLocal({ ...local, accountName: e.target.value })} />
                </label>
                <div className="ms-link-wide">
                  <button className="ms-btn primary" disabled={busy || !network}>
                    Save
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      {ready.length > 0 && balances.length > 0 && (
        <section>
          <h2>Cash out</h2>
          {quote ? (
            <div className="ms-link-created" role="status">
              <p>
                Send <strong>{quote.payout.send}</strong> from your balance. <strong>{quote.payout.receive}</strong> arrives at{" "}
                {partnerName[quote.cashOut.partner as keyof typeof partnerName]}, which pays <strong>${quote.cashOut.amountUsd}</strong> to{" "}
                {ready.find((a) => a.partner === quote.cashOut.partner)?.label}.
              </p>
              <div className="ms-link-actions">
                <button
                  className="ms-btn primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await signAndSubmit(quote);
                      setQuote(null);
                      setDone("Cash out started.");
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
                void run(async () =>
                  setQuote(
                    (await api("cashout-quote", { partner: form.partner, originAsset: form.originAsset, amount: form.amount.replace(/[,\s]/g, "") })) as unknown as PayoutQuote & {
                      cashOut: CashOutRow;
                    },
                  ),
                );
              }}
            >
              <label>
                Paid to
                <select required value={form.partner} onChange={(e) => setForm({ ...form, partner: e.target.value })}>
                  {ready.map((a) => (
                    <option key={a.partner} value={a.partner}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Pay from
                <select required value={form.originAsset} onChange={(e) => setForm({ ...form, originAsset: e.target.value })}>
                  <option value="">Choose a balance</option>
                  {balances.map((b) => (
                    <option key={b.assetId} value={b.assetId}>
                      {b.symbol} ({b.chainName}) · {b.amount}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Amount
                <input required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </label>
              <div className="ms-link-actions">
                <button className="ms-btn primary" disabled={busy}>
                  {busy ? "Getting a quote…" : "Review"}
                </button>
              </div>
            </form>
          )}
          {done && <p role="status">{done}</p>}
        </section>
      )}

      {view.cashOuts.length > 0 && (
        <section className="ms-flush">
          <div className="ms-card-head">
            <div>
              <h2>Cash outs</h2>
            </div>
          </div>
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Started (UTC)</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Paid in</th>
                  <th scope="col">Through</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {view.cashOuts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td>${c.amountUsd}</td>
                    <td>{c.localAmount ? `${Number(c.localAmount).toLocaleString()} ${c.currency}` : c.currency}</td>
                    <td>{partnerName[c.partner as keyof typeof partnerName] ?? c.partner}</td>
                    <td>
                      {c.status}
                      {c.failure ? ` · ${c.failure}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

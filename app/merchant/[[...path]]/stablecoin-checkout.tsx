"use client";
import { useState } from "react";
import { networkName } from "@/lib/blockchain/chains";
export type CheckoutAsset = {
  network: string;
  identifier: string;
  symbol: string;
  decimals: number;
  configured: boolean;
  executionEnabled: boolean;
  reason: string | null;
};
export function StablecoinCheckout({
  orgId,
  environment,
  country,
  assets,
}: {
  orgId: string;
  environment: string;
  country: string;
  assets: CheckoutAsset[];
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [pending, setPending] = useState<object | null>(null);
  const [result, setResult] = useState<{
    checkoutPath: string;
    expiresAt: string;
  } | null>(null);
  async function submit(input: object) {
    setPending(input);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/merchant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "stablecoin-checkout", orgId, input }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Checkout could not be created");
      setResult(body);
    } catch (error) {
      setMessage(
        (error as Error).message + ". Retry to retrieve the same checkout.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Create stablecoin checkout</h2>
      <p>
        Choose the tokens and networks your customer can pay with. Enter an
        exact amount for each option; EURC amounts are priced separately.
      </p>
      {!assets.some((a) => a.executionEnabled) ? (
        <p>
          Configure receive addresses and complete the required approvals before
          creating a checkout.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const options = assets
              .filter(
                (a) =>
                  a.executionEnabled &&
                  amounts[a.network + "|" + a.identifier]?.trim(),
              )
              .map((a) => ({
                network: a.network,
                identifier: a.identifier,
                amount: amounts[a.network + "|" + a.identifier].trim(),
              }));
            if (!options.length) {
              setMessage("Enter an amount for at least one payment option.");
              return;
            }
            void submit({
              key: crypto.randomUUID(),
              environment,
              reference: String(form.get("reference")),
              payerCountry: String(form.get("payerCountry"))
                .trim()
                .toUpperCase(),
              options,
            });
          }}
        >
          <fieldset disabled={busy || !!pending}>
            <label>
              Checkout reference
              <input name="reference" required maxLength={100} />
            </label>
            <label>
              Payer country (two-letter code)
              <input
                name="payerCountry"
                required
                defaultValue={country}
                pattern="[A-Za-z]{2}"
                minLength={2}
                maxLength={2}
              />
            </label>
            {assets
              .filter((a) => a.executionEnabled)
              .map((asset) => {
                const key = asset.network + "|" + asset.identifier;
                return (
                  <label key={key}>
                    {asset.symbol} on {networkName(asset.network)} amount
                    <input
                      inputMode="decimal"
                      placeholder="Leave blank to exclude"
                      value={amounts[key] || ""}
                      pattern={`(0|[1-9][0-9]*)(\\.[0-9]{1,${asset.decimals}})?`}
                      maxLength={100}
                      onChange={(event) =>
                        setAmounts({ ...amounts, [key]: event.target.value })
                      }
                    />
                  </label>
                );
              })}
            <button>Create checkout link</button>
          </fieldset>
          <p>
            Checkout links expire after 30 minutes. Creating one requires recent
            authenticator verification.
          </p>
        </form>
      )}
      {pending && !result && (
        <button disabled={busy} onClick={() => void submit(pending)}>
          {busy ? "Creating…" : "Retry checkout creation"}
        </button>
      )}
      <p role="status">{message}</p>
      {result && (
        <div>
          <p>
            Your checkout is ready. Expires{" "}
            {new Date(result.expiresAt).toLocaleString()}.
          </p>
          <a href={result.checkoutPath} target="_blank" rel="noreferrer">
            Open customer checkout
          </a>{" "}
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  new URL(result.checkoutPath, location.origin).href,
                );
                setMessage("Checkout link copied.");
              } catch {
                setMessage("Open customer checkout and copy its address.");
              }
            }}
          >
            Copy checkout link
          </button>{" "}
        </div>
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
          Start a new checkout
        </button>
      )}
    </section>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { errorText, offline } from "@/lib/error-copy";

// Who pays fees by default. Each payment can override it via the API
// (`feeBearer`), so a merchant can absorb fees on some products only.
export function FeeBearerSetting({
  orgId,
  feeBearer,
  surchargeBanned,
}: {
  orgId: string;
  feeBearer: string;
  surchargeBanned: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(feeBearer);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section>
      <h2>Who pays fees</h2>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            const response = await fetch("/api/merchant", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "fee-bearer", orgId, input: { feeBearer: value } }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(errorText(data, response.status));
            setMessage("Saved. New payments use this setting.");
            router.refresh();
          } catch (error) {
            setMessage(error instanceof TypeError ? offline : error instanceof Error ? error.message : offline);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="ms-choices">
          <legend className="sr-only">Who pays fees</legend>
          <label>
            <input type="radio" name="feeBearer" value="merchant" checked={value === "merchant"} onChange={() => setValue("merchant")} />
            <span>
              <strong>I absorb the fees.</strong> Customers pay your price; fees come out of what you receive.
            </span>
          </label>
          <label>
            <input type="radio" name="feeBearer" value="customer" checked={value === "customer"} onChange={() => setValue("customer")} />
            <span>
              <strong>Customers pay the fees.</strong> The fee is added at checkout, so you receive your full price.
            </span>
          </label>
        </fieldset>
        {surchargeBanned && value === "customer" && (
          <p role="note" className="ms-note">
            Your business is in the EU or UK, where adding card and bank fees for customers isn&apos;t allowed.
            Card and bank payments will be refused while this is on; only stablecoin and crypto fees are passed on.
          </p>
        )}
        <p>
          Customers who pay the fees see them at checkout before paying. Changing this needs a recent authenticator
          check and doesn&apos;t affect payments already created. You can override it per payment with{" "}
          <code>feeBearer</code> in the API.
        </p>
        <button disabled={busy || value === feeBearer}>{busy ? "Saving…" : "Save"}</button>
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}

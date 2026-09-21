"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function MerchantEvidence({
  orgId,
  country,
  requirements,
  evidence,
}: {
  orgId: string;
  country: string;
  requirements: {
    id: string;
    name: string;
    version: number;
    illustrative: boolean;
  }[];
  evidence: {
    id: string;
    filename: string;
    scanStatus: string;
    reviewStatus: string;
  }[];
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <section>
      <h2>Verification documents</h2>
      <p>
        Files use the existing private quarantine, scanner, review, and
        expiring-download workflow. PDF, PNG, or JPEG; maximum 5 MB.
      </p>
      {!requirements.length ? (
        <p>
          No merchant requirements match the saved application yet. An operator
          must configure the appropriate versioned requirements before live
          review.
        </p>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            const data = new FormData(event.currentTarget);
            const requirement = requirements.find(
              (r) => r.id === data.get("requirementId"),
            );
            data.set("documentType", requirement?.name || "Merchant evidence");
            data.set("jurisdiction", country);
            data.set("identifier", "");
            data.set("issueDate", "");
            data.set("capabilities", "");
            try {
              const response = await fetch(
                `/api/portal/evidence?org=${encodeURIComponent(orgId)}&audience=merchant`,
                { method: "POST", body: data },
              );
              const body = await response.json();
              setMessage(response.ok ? body.message : body.error);
              if (response.ok) router.refresh();
            } catch {
              setMessage("Upload unavailable");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Requirement
            <select name="requirementId">
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · v{r.version}
                  {r.illustrative ? " (illustrative)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            File
            <input
              name="file"
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              required
            />
          </label>
          <label>
            Expiry date, if applicable
            <input name="expiryDate" type="date" />
          </label>
          <button disabled={busy}>Upload privately</button>
        </form>
      )}
      <p role="status">{message}</p>
      <ul>
        {evidence.map((e) => (
          <li key={e.id}>
            {e.filename} · {e.scanStatus} · {e.reviewStatus}
            {e.scanStatus === "Clean" && (
              <button
                onClick={async () => {
                  try {
                    const response = await fetch(
                      `/api/portal/evidence/${e.id}`,
                      { method: "POST" },
                    );
                    const body = await response.json();
                    if (response.ok) window.location.assign(body.url);
                    else setMessage(body.error);
                  } catch {
                    setMessage("Download unavailable");
                  }
                }}
              >
                Download {e.filename}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

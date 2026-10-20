"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Approve (creates the provider organization and emails an owner invitation)
// or decline (emails the applicant, with the note if one is given).
export function ReviewRequest({ requestId, company }: { requestId: string; company: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function review(form: HTMLFormElement, decision: "approve" | "decline") {
    if (decision === "approve" ? !form.reportValidity() : !confirm(`Decline ${company}'s request?`)) return;
    const f = new FormData(form);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/portal/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ops-provider-access",
          decision,
          requestId,
          orgName: f.get("orgName"),
          note: f.get("note") || undefined,
        }),
      });
      const body = await response.json();
      setMessage(body.message || body.error || "Unable to save");
      if (response.ok) router.refresh();
    } catch {
      setMessage("Request unavailable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => (e.preventDefault(), void review(e.currentTarget, "approve"))}>
      <label>
        Organization name
        <input name="orgName" required minLength={2} maxLength={120} defaultValue={company} />
      </label>
      <label>
        Note (optional; sent to the applicant if you decline)
        <textarea name="note" maxLength={1000} />
      </label>
      <div className="p-toolbar">
        <button className="p-button" disabled={busy}>
          Approve and send invitation
        </button>
        <button
          type="button"
          className="p-button danger"
          disabled={busy}
          onClick={(e) => void review(e.currentTarget.form!, "decline")}
        >
          Decline
        </button>
      </div>
      <p role="status">{message}</p>
    </form>
  );
}

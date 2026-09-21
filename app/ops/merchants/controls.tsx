"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function OperatorAction({
  label,
  command,
}: {
  label: string;
  command: Record<string, unknown>;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const form = new FormData(event.currentTarget);
        try {
          const response = await fetch("/api/merchant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...command, reason: form.get("reason") }),
          });
          const body = await response.json();
          setMessage(response.ok ? "Saved." : body.error || "Unable to save");
          if (response.ok) router.refresh();
        } catch {
          setMessage("Request unavailable");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Reason
        <input name="reason" required minLength={10} maxLength={1000} />
      </label>
      <button disabled={busy}>{label}</button>
      <p role="status">{message}</p>
    </form>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function QualificationForm({
  label,
  command,
  initial,
}: {
  label: string;
  command: Record<string, unknown>;
  initial: unknown;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        try {
          const value = JSON.parse(String(form.get("configuration")));
          const response = await fetch("/api/merchant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...command,
              ...(command.action === "rollout-transition"
                ? { rollout: value }
                : { input: value }),
              reason: form.get("reason"),
            }),
          });
          const data = await response.json();
          setMessage(
            response.ok
              ? "Saved. Processing remains subject to qualification gates."
              : data.error || "Unable to save",
          );
          if (response.ok) router.refresh();
        } catch {
          setMessage(
            "Configuration must be valid JSON and the service must be available.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {label} configuration
        <textarea
          name="configuration"
          rows={18}
          required
          defaultValue={JSON.stringify(initial, null, 2)}
        />
      </label>
      <label>
        Reason
        <input name="reason" minLength={10} maxLength={1000} required />
      </label>
      <button disabled={busy}>{label}</button>
      <p role="status">{message}</p>
    </form>
  );
}

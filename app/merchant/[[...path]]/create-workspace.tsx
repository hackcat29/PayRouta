"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { countries } from "@/lib/portal/domain";

export function CreateWorkspace() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section>
      <h1>Create your merchant workspace</h1>
      <p>
        Your workspace starts in the sandbox, where every payment is simulated.
        When you are ready, apply to payment providers from inside the
        workspace; each account is opened in your own name.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setMessage("");
          try {
            const response = await fetch("/api/merchant", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "create-workspace",
                input: {
                  name: String(form.get("name") || "").trim(),
                  country: String(form.get("country") || ""),
                  returnOrigin: String(form.get("returnOrigin") || "").trim(),
                },
              }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Request failed");
            router.push(`/merchant/overview?orgId=${encodeURIComponent(data.orgId)}`);
            router.refresh();
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Request failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Business name
          <input name="name" required minLength={2} maxLength={120} />
        </label>
        <label>
          Country
          <select name="country" required defaultValue="">
            <option value="" disabled>
              Choose a country
            </option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Website customers return to after checkout
          <input
            name="returnOrigin"
            type="url"
            required
            placeholder="https://shop.example"
          />
        </label>
        <button disabled={busy}>Create workspace</button>
      </form>
      <p role="status">{message}</p>
    </section>
  );
}

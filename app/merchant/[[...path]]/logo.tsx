"use client";
// The logo customers see on checkout, payment links and invoices
// (lib/merchant/branding.ts, POST/DELETE /api/merchant/logo).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { errorText, offline } from "@/lib/error-copy";

export function LogoSetting({ orgId, logo, name }: { orgId: string; logo: string | null; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function send(method: "POST" | "DELETE", body?: FormData) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/logo?org=${encodeURIComponent(orgId)}`, { method, body });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(result, response.status));
      router.refresh();
    } catch (e) {
      setMessage(e instanceof TypeError ? offline : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Logo</h2>
      <div className="ms-logo-setting">
        <div className="ms-logo-preview">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the merchant's own upload
            <img src={logo} alt={`${name} logo`} />
          ) : (
            <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <form
          className="ms-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            void send("POST", new FormData(form)).then(() => form.reset());
          }}
        >
          <label htmlFor="logo-file">PNG, JPEG or WebP, up to 256 KB</label>
          <input id="logo-file" name="file" type="file" accept="image/png,image/jpeg,image/webp" required disabled={busy} />
          <button className="ms-btn primary" disabled={busy}>
            {busy ? "Uploading…" : logo ? "Replace" : "Upload"}
          </button>
          {logo && (
            <button type="button" className="ms-btn" disabled={busy} onClick={() => void send("DELETE")}>
              Remove
            </button>
          )}
        </form>
      </div>
      {message && (
        <p className="p-notice error" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}

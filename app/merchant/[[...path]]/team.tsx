"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
const roles = ["Owner", "Admin", "Developer", "Finance", "Analyst"];
export function MerchantTeam({
  orgId,
  members,
}: {
  orgId: string;
  members: { id: string; name: string; role: string }[];
}) {
  const [message, setMessage] = useState("");
  const router = useRouter();
  async function send(body: unknown) {
    try {
      const response = await fetch("/api/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      setMessage(response.ok ? "Saved." : result.error || "Unable to save");
      if (response.ok) router.refresh();
    } catch {
      setMessage("Request unavailable");
    }
  }
  return (
    <section>
      <h2>Merchant team</h2>
      <p>
        Merchant roles are separate from provider roles. Changes require recent
        authenticator verification.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void send({
            action: "merchant-invite",
            orgId,
            email: data.get("email"),
            role: data.get("role"),
          });
        }}
      >
        <label>
          Email
          <input type="email" name="email" required />
        </label>
        <label>
          Role
          <select name="role" defaultValue="Analyst">
            {roles.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </label>
        <button>Invite</button>
      </form>
      <ul>
        {members.map((m) => (
          <li key={m.id}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void send({
                  action: "merchant-role",
                  orgId,
                  memberId: m.id,
                  role: data.get("role") || null,
                });
              }}
            >
              <label>
                {m.name}
                <select name="role" defaultValue={m.role}>
                  {roles.map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                  <option value="">Remove merchant access</option>
                </select>
              </label>
              <button>Update role</button>
            </form>
          </li>
        ))}
      </ul>
      <p role="status">{message}</p>
    </section>
  );
}
export function AcceptMerchantInvitation({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <section>
      <h1>Merchant invitation</h1>
      <p>Accept using the verified account matching the invitation email.</p>
      <button
        onClick={async () => {
          try {
            const response = await fetch("/api/portal/command", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "accept-invitation", token }),
            });
            const result = await response.json();
            if (response.ok)
              router.replace(
                `/merchant/team?orgId=${encodeURIComponent(result.orgId)}`,
              );
            else setMessage(result.error || "Unable to accept");
          } catch {
            setMessage("Request unavailable");
          }
        }}
      >
        Accept invitation
      </button>
      <p role="status">{message}</p>
    </section>
  );
}

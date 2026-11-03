"use client";
// Activation forms. Each asks only for what the merchant's capabilities need
// (lib/merchant/requirements.ts): a name and country for crypto, then more
// for cards and bank payments as type and volume call for it.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { countries } from "@/lib/portal/domain";
import { errorText, offline } from "@/lib/error-copy";

export type ActivationProfile = {
  legalName?: string;
  tradingName?: string;
  businessType?: string;
  country?: string;
  registrationNumber?: string;
  taxId?: string;
  website?: string;
  productDescription?: string;
  industry?: string;
  supportEmail?: string;
  address?: { line1?: string; line2?: string; city?: string; region?: string; postalCode?: string; country?: string };
  representative?: { givenName?: string; familyName?: string; email?: string; title?: string };
  owners?: { givenName: string; familyName: string; country: string; ownershipPercent: number }[];
  monthlyVolume?: string;
  settlementCurrency?: string;
};

const sellerTypes = [
  ["individual", "Individual, no registered business"],
  ["sole-proprietor", "Sole proprietor (registered business name)"],
  ["company", "Registered company"],
  ["partnership", "Partnership"],
  ["non-profit", "Non-profit"],
] as const;
const volumes = [
  ["under-10k", "Under $10k a month"],
  ["10k-50k", "$10k–$50k a month"],
  ["50k-250k", "$50k–$250k a month"],
  ["250k-1m", "$250k–$1m a month"],
  ["over-1m", "Over $1m a month"],
] as const;

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v || undefined;
};
// Drops empty values so optional fields stay unset rather than blank.
function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T;
  if (value && typeof value === "object") {
    const out = Object.fromEntries(
      Object.entries(value).flatMap(([k, v]) => {
        const c = clean(v);
        return c === undefined || (c && typeof c === "object" && !Array.isArray(c) && !Object.keys(c).length) ? [] : [[k, c]];
      }),
    );
    return out as T;
  }
  return value;
}

function useCommand(orgId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function send(path: string, body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...body }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ text: errorText(data, response.status), error: true });
        return null;
      }
      setMessage({ text: done, error: false });
      router.refresh();
      return data ?? {};
    } catch {
      setMessage({ text: offline, error: true });
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { send, busy, message };
}

function Message({ message }: { message: { text: string; error: boolean } | null }) {
  if (!message) return null;
  return (
    <p role={message.error ? "alert" : "status"} className={`tr-message ${message.error ? "error" : ""}`}>
      {message.text}
    </p>
  );
}

// The profile is saved whole, so every form sends what is already there.
function saveProfile(send: ReturnType<typeof useCommand>["send"], profile: ActivationProfile, changes: ActivationProfile) {
  return send("/api/partners", { action: "profile", input: clean({ ...profile, ...changes }) }, "Saved.");
}

export function BasicDetailsForm({ orgId, profile }: { orgId: string; profile: ActivationProfile }) {
  const { send, busy, message } = useCommand(orgId);
  const [open, setOpen] = useState(!profile.legalName);
  if (!open)
    return (
      <div className="tr-saved">
        <p>
          <strong>{profile.legalName}</strong> · {countries.find((c) => c.id === profile.country)?.name ?? profile.country} ·{" "}
          {sellerTypes.find(([id]) => id === profile.businessType)?.[1]}
        </p>
        <button type="button" className="tr-secondary" onClick={() => setOpen(true)}>
          Edit
        </button>
      </div>
    );
  return (
    <form
      className="tr-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void saveProfile(send, profile, {
          legalName: str(f, "legalName"),
          businessType: str(f, "businessType"),
          country: str(f, "country"),
          monthlyVolume: str(f, "monthlyVolume"),
        }).then((ok) => ok && setOpen(false));
      }}
    >
      <div className="tr-grid">
        <label>
          Seller type
          <select name="businessType" required defaultValue={profile.businessType ?? "individual"}>
            {sellerTypes.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Your name or business name
          <input name="legalName" required maxLength={200} defaultValue={profile.legalName} autoComplete="organization" />
        </label>
        <label>
          Country
          <select name="country" required defaultValue={profile.country ?? ""}>
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
          Expected sales
          <select name="monthlyVolume" required defaultValue={profile.monthlyVolume ?? "under-10k"}>
            {volumes.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="tr-actions">
        <button disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        {profile.legalName && (
          <button type="button" className="tr-secondary" onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
      </div>
      <Message message={message} />
    </form>
  );
}

export function BusinessDetailsForm({
  orgId,
  profile,
  registered,
  owners,
}: {
  orgId: string;
  profile: ActivationProfile;
  registered: boolean;
  owners: boolean;
}) {
  const { send, busy, message } = useCommand(orgId);
  const [ownerRows, setOwnerRows] = useState(Math.max(1, profile.owners?.length ?? 0));
  return (
    <form
      className="tr-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void saveProfile(send, profile, {
          productDescription: str(f, "productDescription"),
          supportEmail: str(f, "supportEmail"),
          website: str(f, "website"),
          ...(registered
            ? {
                registrationNumber: str(f, "registrationNumber"),
                taxId: str(f, "taxId"),
                address: {
                  line1: str(f, "line1"),
                  city: str(f, "city"),
                  region: str(f, "region"),
                  postalCode: str(f, "postalCode"),
                  country: profile.country,
                },
                representative: {
                  givenName: str(f, "repGiven"),
                  familyName: str(f, "repFamily"),
                  email: str(f, "repEmail") ?? str(f, "supportEmail"),
                  title: str(f, "repTitle"),
                },
              }
            : {}),
          ...(owners
            ? {
                owners: Array.from({ length: ownerRows }, (_, i) => ({
                  givenName: str(f, `owner${i}Given`) ?? "",
                  familyName: str(f, `owner${i}Family`) ?? "",
                  country: str(f, `owner${i}Country`) ?? "",
                  ownershipPercent: Number(f.get(`owner${i}Percent`) || 0),
                })).filter((o) => o.givenName || o.familyName),
              }
            : {}),
        });
      }}
    >
      <div className="tr-grid">
        <label className="tr-wide">
          What you sell
          <textarea name="productDescription" required minLength={10} maxLength={1000} defaultValue={profile.productDescription} />
        </label>
        <label>
          Customer support email
          <input name="supportEmail" type="email" required defaultValue={profile.supportEmail} />
        </label>
        <label>
          Website or social page (optional)
          <input name="website" type="url" placeholder="https://" defaultValue={profile.website} />
        </label>
        {registered && (
          <>
            <label>
              Registration number
              <input name="registrationNumber" required maxLength={60} defaultValue={profile.registrationNumber} />
            </label>
            <label>
              Tax ID (optional)
              <input name="taxId" maxLength={60} defaultValue={profile.taxId} />
            </label>
            <label className="tr-wide">
              Business address
              <input name="line1" required maxLength={200} defaultValue={profile.address?.line1} autoComplete="address-line1" />
            </label>
            <label>
              City
              <input name="city" required maxLength={100} defaultValue={profile.address?.city} />
            </label>
            <label>
              State or region
              <input name="region" maxLength={100} defaultValue={profile.address?.region} />
            </label>
            <label>
              Postal code
              <input name="postalCode" maxLength={20} defaultValue={profile.address?.postalCode} />
            </label>
            <label>
              Director first name
              <input name="repGiven" required maxLength={100} defaultValue={profile.representative?.givenName} />
            </label>
            <label>
              Director last name
              <input name="repFamily" required maxLength={100} defaultValue={profile.representative?.familyName} />
            </label>
            <label>
              Director email
              <input name="repEmail" type="email" defaultValue={profile.representative?.email} />
            </label>
            <label>
              Director job title
              <input name="repTitle" maxLength={100} defaultValue={profile.representative?.title} />
            </label>
          </>
        )}
      </div>
      {owners && (
        <fieldset className="tr-fieldset">
          <legend>Owners with 25% or more</legend>
          {Array.from({ length: ownerRows }, (_, i) => (
            <div key={i} className="tr-grid" role="group" aria-label={`Owner ${i + 1}`}>
              <label>
                First name
                <input name={`owner${i}Given`} maxLength={100} defaultValue={profile.owners?.[i]?.givenName} />
              </label>
              <label>
                Last name
                <input name={`owner${i}Family`} maxLength={100} defaultValue={profile.owners?.[i]?.familyName} />
              </label>
              <label>
                Country
                <select name={`owner${i}Country`} defaultValue={profile.owners?.[i]?.country ?? ""}>
                  <option value="">—</option>
                  {countries.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ownership %
                <input name={`owner${i}Percent`} type="number" min={25} max={100} defaultValue={profile.owners?.[i]?.ownershipPercent} />
              </label>
            </div>
          ))}
          {ownerRows < 4 && (
            <button type="button" className="tr-secondary" onClick={() => setOwnerRows((n) => n + 1)}>
              Add owner
            </button>
          )}
        </fieldset>
      )}
      <div className="tr-actions">
        <button disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
      <Message message={message} />
    </form>
  );
}

export function DocumentUpload({
  orgId,
  country,
  requirementId,
  label,
}: {
  orgId: string;
  country: string;
  requirementId: string;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  return (
    <form
      className="tr-inline"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        const data = new FormData(e.currentTarget);
        data.set("requirementId", requirementId);
        data.set("documentType", label);
        data.set("jurisdiction", country);
        data.set("identifier", "");
        data.set("issueDate", "");
        data.set("capabilities", "");
        try {
          const response = await fetch(`/api/portal/evidence?org=${encodeURIComponent(orgId)}&audience=merchant`, {
            method: "POST",
            body: data,
          });
          const body = await response.json().catch(() => null);
          setMessage(response.ok ? { text: "Uploaded.", error: false } : { text: errorText(body, response.status), error: true });
          if (response.ok) router.refresh();
        } catch {
          setMessage({ text: offline, error: true });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {label}
        <input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required />
      </label>
      <button disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
      <Message message={message} />
    </form>
  );
}

export function GoLiveWithCrypto({ orgId }: { orgId: string }) {
  const { send, busy, message } = useCommand(orgId);
  const router = useRouter();
  return (
    <div>
      <div className="tr-actions">
        <button
          disabled={busy}
          onClick={() =>
            void send("/api/treasury", { action: "go-live-crypto" }, "You're live.").then(
              (ok) => ok && router.push(`/merchant/crypto-balance?${new URLSearchParams({ orgId, environment: "production" })}`),
            )
          }
        >
          {busy ? "Going live…" : "Go live with crypto"}
        </button>
      </div>
      <Message message={message} />
    </div>
  );
}

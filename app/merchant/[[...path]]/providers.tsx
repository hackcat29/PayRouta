"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { countries } from "@/lib/portal/domain";
import { labelOf } from "@/lib/providers/normalized";
import { errorText, offline } from "@/lib/error-copy";

type Profile = {
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
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  representative?: {
    givenName?: string;
    familyName?: string;
    email?: string;
    title?: string;
  };
  owners?: {
    givenName: string;
    familyName: string;
    country: string;
    ownershipPercent: number;
  }[];
  monthlyVolume?: string;
  settlementCurrency?: string;
};

export type ProvidersOverview = {
  environment: string;
  profile: { version: number; data: Profile } | null;
  draft: Profile | null;
  partners: {
    id: string;
    name: string;
    methods: readonly string[];
    onboarding: string;
    fields: { id: string; label: string }[];
    disclosureFingerprint: string | null;
  }[];
  applications: {
    partnerId: string;
    state: string;
    requirements: unknown;
    paymentsEnabled: boolean;
    payoutsEnabled: boolean;
    profileVersion: number;
    canContinue: boolean;
    notice: string | null;
    updatedAt: string;
  }[];
};

const reapplyStates = ["Rejected", "Disconnected", "Failed"];
const businessTypes = [
  ["company", "Registered company"],
  ["sole-proprietor", "Sole proprietor"],
  ["partnership", "Partnership"],
  ["non-profit", "Non-profit"],
] as const;
const volumes = [
  ["under-10k", "Under $10k / month"],
  ["10k-50k", "$10k–$50k / month"],
  ["50k-250k", "$50k–$250k / month"],
  ["250k-1m", "$250k–$1m / month"],
  ["over-1m", "Over $1m / month"],
] as const;

function str(form: FormData, key: string) {
  const v = String(form.get(key) ?? "").trim();
  return v || undefined;
}

export function Providers({
  orgId,
  overview,
  canConfigure,
  returnedFrom,
  sandboxAccount,
  profileOnly = false,
}: {
  orgId: string;
  overview: ProvidersOverview;
  canConfigure: boolean;
  returnedFrom?: string;
  sandboxAccount?: string;
  profileOnly?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const refreshed = useRef(false);
  const [ownerRows, setOwnerRows] = useState(
    Math.max(
      1,
      (overview.profile?.data ?? overview.draft)?.owners?.length ?? 0,
    ),
  );
  const profile = overview.profile?.data ?? overview.draft ?? {};
  const byPartner = new Map(overview.applications.map((a) => [a.partnerId, a]));

  async function command(body: Record<string, unknown>, done = "Saved.") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...body }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(data, response.status));
      setMessage(done);
      router.refresh();
      return data;
    } catch (error) {
      setMessage(error instanceof TypeError ? offline : error instanceof Error ? error.message : offline);
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Returning from a provider's hosted onboarding: ask for a fresh status read.
  useEffect(() => {
    if (!returnedFrom || refreshed.current) return;
    refreshed.current = true;
    void command(
      { action: "refresh", partnerId: returnedFrom },
      "Checking status with the provider…",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnedFrom]);

  function saveProfile(form: FormData) {
    const owners = [0, 1, 2, 3]
      .map((i) => ({
        givenName: str(form, `owner${i}Given`),
        familyName: str(form, `owner${i}Family`),
        country: str(form, `owner${i}Country`),
        ownershipPercent: Number(form.get(`owner${i}Percent`) || 0),
      }))
      .filter((o) => o.givenName || o.familyName);
    void command(
      {
        action: "profile",
        input: {
          legalName: str(form, "legalName"),
          tradingName: str(form, "tradingName"),
          businessType: str(form, "businessType"),
          country: str(form, "country"),
          registrationNumber: str(form, "registrationNumber"),
          taxId: str(form, "taxId"),
          website: str(form, "website"),
          productDescription: str(form, "productDescription"),
          industry: str(form, "industry"),
          supportEmail: str(form, "supportEmail"),
          address: {
            line1: str(form, "line1"),
            line2: str(form, "line2"),
            city: str(form, "city"),
            region: str(form, "region"),
            postalCode: str(form, "postalCode"),
            country: str(form, "country"),
          },
          representative: {
            givenName: str(form, "repGiven"),
            familyName: str(form, "repFamily"),
            email: str(form, "repEmail"),
            title: str(form, "repTitle"),
          },
          owners,
          monthlyVolume: str(form, "monthlyVolume"),
          settlementCurrency: str(form, "settlementCurrency")?.toUpperCase(),
        },
      },
      "Business profile saved. Review what each provider receives below.",
    );
  }

  function apply() {
    if (!overview.profile) return;
    const disclosures = Object.fromEntries(
      overview.partners
        .filter((p) => selected.includes(p.id) && p.disclosureFingerprint)
        .map((p) => [p.id, p.disclosureFingerprint]),
    );
    void command(
      {
        action: "request",
        input: { profileVersion: overview.profile.version, disclosures },
      },
      "Applications queued. We will screen your business, then prepare each provider account.",
    ).then((ok) => ok && setSelected([]));
  }

  async function continueWith(partnerId: string) {
    const data = await command(
      { action: "link", partnerId },
      "Opening the provider…",
    );
    if (data?.url) window.location.assign(data.url);
  }

  const owners = profile.owners ?? [];
  const saved = !!overview.profile;
  const applicable = overview.partners.some((p) => {
    const a = byPartner.get(p.id);
    return !a || reapplyStates.includes(a.state);
  });
  const providersSection = (
    <section>
      <h2>Payment providers</h2>
      {!overview.partners.length && (
        <p>No providers are available for {overview.environment} yet.</p>
      )}
      <ul className="provider-list">
        {overview.partners.map((p) => {
          const application = byPartner.get(p.id);
          const canApply =
            canConfigure &&
            !!overview.profile &&
            (!application || reapplyStates.includes(application.state));
          const requirements = Array.isArray(application?.requirements)
            ? (application.requirements as string[])
            : [];
          return (
            <li key={p.id}>
              <h3>{p.name}</h3>
              <p>{p.methods.map((m) => labelOf(m)).join(" · ")}</p>
              {application ? (
                <p>
                  <strong>{application.state}</strong>
                  {application.notice ? ` — ${application.notice}` : ""}
                  {application.state === "Approved" &&
                    ` — payments ${application.paymentsEnabled ? "enabled" : "not yet enabled"}, payouts ${application.payoutsEnabled ? "enabled" : "not yet enabled"}`}
                </p>
              ) : (
                <p>Not applied</p>
              )}
              {requirements.length > 0 && (
                <p>
                  {p.name} still needs: {requirements.join(", ")}
                </p>
              )}
              {canApply && (
                <details>
                  <summary>What {p.name} will receive from PayRouta</summary>
                  <ul>
                    {p.fields.map((f) => (
                      <li key={f.id}>{f.label}</li>
                    ))}
                  </ul>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={(e) =>
                        setSelected((s) =>
                          e.target.checked
                            ? [...s, p.id]
                            : s.filter((x) => x !== p.id),
                        )
                      }
                    />{" "}
                    I agree to PayRouta sharing these details with {p.name} to
                    open my own {p.name} account.
                  </label>
                </details>
              )}
              {canConfigure && application?.canContinue && (
                <button disabled={busy} onClick={() => void continueWith(p.id)}>
                  Continue with {p.name}
                </button>
              )}
              {application &&
                !reapplyStates.includes(application.state) &&
                application.state !== "Queued" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void command(
                        { action: "refresh", partnerId: p.id },
                        "Status check queued.",
                      )
                    }
                  >
                    Check status
                  </button>
                )}
              {canConfigure &&
                application &&
                !reapplyStates.includes(application.state) && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Stop sharing with ${p.name} and disconnect it from PayRouta? Your ${p.name} account itself stays open and remains yours.`,
                        )
                      )
                        void command(
                          { action: "revoke", partnerId: p.id },
                          "Disconnected.",
                        );
                    }}
                  >
                    Disconnect
                  </button>
                )}
            </li>
          );
        })}
      </ul>
      {canConfigure && overview.profile && applicable && (
        <>
          <button disabled={busy || !selected.length} onClick={apply}>
            Apply to {selected.length || "selected"} provider
            {selected.length === 1 ? "" : "s"}
          </button>
        </>
      )}
      {!overview.profile && canConfigure && (
        <p>Save your business profile to choose providers.</p>
      )}
    </section>
  );
  const profileForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        saveProfile(new FormData(event.currentTarget));
      }}
    >
      <fieldset disabled={!canConfigure || busy}>
        <legend>Business</legend>
        <label>
          Legal business name
          <input
            name="legalName"
            required
            maxLength={200}
            defaultValue={profile.legalName}
          />
        </label>
        <label>
          Trading name (optional)
          <input
            name="tradingName"
            maxLength={200}
            defaultValue={profile.tradingName}
          />
        </label>
        <label>
          Business type
          <select
            name="businessType"
            required
            defaultValue={profile.businessType ?? "company"}
          >
            {businessTypes.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Country of registration
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
          Company registration number
          <input
            name="registrationNumber"
            maxLength={60}
            defaultValue={profile.registrationNumber}
          />
        </label>
        <label>
          Tax ID (optional)
          <input name="taxId" maxLength={60} defaultValue={profile.taxId} />
        </label>
        <label>
          Website
          <input
            name="website"
            type="url"
            required
            placeholder="https://"
            defaultValue={profile.website}
          />
        </label>
        <label>
          What you sell
          <textarea
            name="productDescription"
            required
            minLength={20}
            maxLength={1000}
            defaultValue={profile.productDescription}
          />
        </label>
        <label>
          Industry
          <input
            name="industry"
            required
            maxLength={100}
            defaultValue={profile.industry}
          />
        </label>
        <label>
          Customer support email
          <input
            name="supportEmail"
            type="email"
            required
            defaultValue={profile.supportEmail}
          />
        </label>
        <label>
          Expected monthly volume
          <select
            name="monthlyVolume"
            required
            defaultValue={profile.monthlyVolume ?? "under-10k"}
          >
            {volumes.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {profileOnly ? "Billing currency" : "Settlement currency"}
          <input
            name="settlementCurrency"
            required
            pattern="[A-Za-z]{3}"
            maxLength={3}
            defaultValue={profile.settlementCurrency}
          />
        </label>
      </fieldset>
      <fieldset disabled={!canConfigure || busy}>
        <legend>Registered address</legend>
        <label>
          Address line 1
          <input
            name="line1"
            required
            maxLength={200}
            defaultValue={profile.address?.line1}
          />
        </label>
        <label>
          Address line 2 (optional)
          <input
            name="line2"
            maxLength={200}
            defaultValue={profile.address?.line2}
          />
        </label>
        <label>
          City
          <input
            name="city"
            required
            maxLength={100}
            defaultValue={profile.address?.city}
          />
        </label>
        <label>
          State or region (optional)
          <input
            name="region"
            maxLength={100}
            defaultValue={profile.address?.region}
          />
        </label>
        <label>
          Postal code (optional)
          <input
            name="postalCode"
            maxLength={20}
            defaultValue={profile.address?.postalCode}
          />
        </label>
      </fieldset>
      <fieldset disabled={!canConfigure || busy}>
        <legend>Representative</legend>
        <label>
          First name
          <input
            name="repGiven"
            required
            maxLength={100}
            defaultValue={profile.representative?.givenName}
          />
        </label>
        <label>
          Last name
          <input
            name="repFamily"
            required
            maxLength={100}
            defaultValue={profile.representative?.familyName}
          />
        </label>
        <label>
          Email
          <input
            name="repEmail"
            type="email"
            required
            defaultValue={profile.representative?.email}
          />
        </label>
        <label>
          Job title
          <input
            name="repTitle"
            required
            maxLength={100}
            defaultValue={profile.representative?.title}
          />
        </label>
      </fieldset>
      <fieldset disabled={!canConfigure || busy}>
        <legend>Owners with 25% or more (names only)</legend>
        {Array.from({ length: ownerRows }, (_, i) => (
          <div key={i} role="group" aria-label={`Owner ${i + 1}`}>
            <label>
              First name
              <input
                name={`owner${i}Given`}
                maxLength={100}
                defaultValue={owners[i]?.givenName}
              />
            </label>
            <label>
              Last name
              <input
                name={`owner${i}Family`}
                maxLength={100}
                defaultValue={owners[i]?.familyName}
              />
            </label>
            <label>
              Country
              <select
                name={`owner${i}Country`}
                defaultValue={owners[i]?.country ?? ""}
              >
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
              <input
                name={`owner${i}Percent`}
                type="number"
                min={25}
                max={100}
                defaultValue={owners[i]?.ownershipPercent}
              />
            </label>
          </div>
        ))}
        {ownerRows < 4 && (
          <button type="button" onClick={() => setOwnerRows((n) => n + 1)}>
            Add owner
          </button>
        )}
      </fieldset>
      {canConfigure && <button disabled={busy}>Save business profile</button>}
    </form>
  );
  const profileSection = (
    <section>
      {(!profileOnly || saved) && (
        <h2>
          {profileOnly
            ? "Business profile"
            : "One business profile for every provider"}
        </h2>
      )}
      {saved ? (
        <details>
          <summary>Edit business profile</summary>
          {profileForm}
        </details>
      ) : (
        profileForm
      )}
    </section>
  );
  if (profileOnly)
    return (
      <>
        {profileSection}
        <p role="status">{message}</p>
      </>
    );
  return (
    <>
      {sandboxAccount && (
        <section role="note">
          <h2>Fictional sandbox onboarding</h2>
        </section>
      )}
      {saved ? providersSection : profileSection}
      {saved ? profileSection : providersSection}
      <p role="status">{message}</p>
    </>
  );
}

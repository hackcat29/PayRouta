"use client";
import { useState, useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  capabilitySchema,
  CapabilityDefinition,
  countries,
  Draft,
  fiat,
  providerTypes,
} from "@/lib/portal/domain";
import { Field, JsonView, Panel } from "./ui";
export type Execute = (data: Record<string, unknown>) => Promise<unknown>;
export function CountrySelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const listId = useId();
  return (
    <Field label={label}>
      <input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search country or code"
        autoComplete="off"
      />
      <datalist id={listId}>
        {countries.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </datalist>
    </Field>
  );
}
export function CountryMany({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  return (
    <fieldset className="p-country-many">
      <legend>{label}</legend>
      <input
        aria-label={`Search ${label}`}
        placeholder="Search countries"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div>
        {countries
          .filter((c) =>
            (c.name + c.id).toLowerCase().includes(search.toLowerCase()),
          )
          .map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={value.includes(c.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...value, c.id]
                      : value.filter((v) => v !== c.id),
                  )
                }
              />
              {c.name} <small>{c.id}</small>
            </label>
          ))}
      </div>
    </fieldset>
  );
}
export function CompanyForm({
  draft,
  version,
  execute,
  disabled,
}: {
  draft: Draft;
  version: number;
  execute: Execute;
  disabled: boolean;
}) {
  const f = useForm({
    defaultValues: {
      legalName: "",
      tradingName: "",
      website: "",
      country: "",
      registration: "",
      address: "",
      providerType: "PSP",
      description: "",
      businessContact: "",
      technicalContact: "",
      complianceContact: "",
      ...draft.company,
    },
  });
  const currentCountry = useWatch({ control: f.control, name: "country" });
  return (
    <Panel title="Organization details">
      <p>
        Save an incomplete draft at any time. Required details are checked when
        you submit.
      </p>
      <form
        onSubmit={f.handleSubmit((v) =>
          execute({
            action: "save-section",
            section: "company",
            version,
            value: v,
          }),
        )}
      >
        <fieldset disabled={disabled}>
          <div className="p-form-grid">
            {(
              [
                ["legalName", "Legal name"],
                ["tradingName", "Trading name"],
                ["website", "Website"],
                ["registration", "Registration number"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <input {...f.register(k)} />
              </Field>
            ))}
            <CountrySelect
              label="Incorporation country"
              value={currentCountry || ""}
              onChange={(v) => f.setValue("country", v)}
            />
            <Field label="Provider type">
              <select {...f.register("providerType")}>
                {providerTypes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Registered address">
              <textarea {...f.register("address")} />
            </Field>
            <Field label="Business description">
              <textarea {...f.register("description")} />
            </Field>
            {(
              [
                ["businessContact", "Business contact email"],
                ["technicalContact", "Technical contact email"],
                ["complianceContact", "Compliance contact email"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <input type="email" {...f.register(k)} />
              </Field>
            ))}
          </div>
          <button className="p-button" disabled={f.formState.isSubmitting}>
            Save company details
          </button>
        </fieldset>
      </form>
    </Panel>
  );
}
export function CoverageForm({
  draft,
  version,
  execute,
  disabled,
}: {
  draft: Draft;
  version: number;
  execute: Execute;
  disabled: boolean;
}) {
  const [value, setValue] = useState({
    payerOrigins: [] as string[],
    merchantDestinations: [] as string[],
    jurisdictions: [] as string[],
    payIn: [] as string[],
    payout: [] as string[],
    ...draft.coverage,
  });
  return (
    <Panel title="Coverage">
      <p>
        These lists describe your footprint. Each supported direction is
        declared separately in a capability.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void execute({
            action: "save-section",
            section: "coverage",
            version,
            value,
          });
        }}
      >
        <fieldset disabled={disabled}>
          <div className="p-form-grid">
            {(
              [
                ["payerOrigins", "Payer origins"],
                ["merchantDestinations", "Merchant destinations"],
                ["jurisdictions", "Operating jurisdictions"],
                ["payIn", "Pay-in coverage"],
                ["payout", "Payout coverage"],
              ] as const
            ).map(([key, label]) => (
              <CountryMany
                key={key}
                label={label}
                value={value[key]}
                onChange={(v) => setValue({ ...value, [key]: v })}
              />
            ))}
          </div>
          <button className="p-button">Save coverage</button>
        </fieldset>
      </form>
    </Panel>
  );
}
const initialCapability: CapabilityDefinition = {
  capabilityId: "",
  version: 1,
  family: "bank",
  rail: "",
  operation: "pay-in",
  origin: "NG",
  destination: "NG",
  input: { kind: "fiat", identifier: "NGN", network: "" },
  minimum: "100",
  maximum: "1000000",
  daily: "5000000",
  limitAsset: "NGN",
  settlement: "T+1",
  hours: "Monday–Friday 09:00–17:00",
  timezone: "Africa/Lagos",
  availability: "webhook",
  conditions: "Verified customer",
  endpoint: "bank.payin",
  environment: "sandbox",
};
export function CapabilityForm({
  value,
  version,
  execute,
  environment,
  integrations = [],
}: {
  integrations?: { id: string; version: number; environment: string }[];
  value?: CapabilityDefinition;
  version: number;
  execute: Execute;
  environment: string;
}) {
  const f = useForm<CapabilityDefinition>({
    resolver: zodResolver(capabilitySchema),
    defaultValues: value || {
      ...initialCapability,
      environment: environment as "sandbox" | "production",
    },
  });
  const [conversion, setConversion] = useState(!!value?.output);
  const errors = f.formState.errors;
  const watched = useWatch({ control: f.control });
  return (
    <form
      onSubmit={f.handleSubmit((v) =>
        execute({ action: "save-capability", version, value: v }),
      )}
    >
      <div className="p-form-grid">
        <Field
          label="Capability identifier"
          hint="Stable lowercase identifier, e.g. ng-bank-payin"
        >
          <input {...f.register("capabilityId")} readOnly={!!value} />
        </Field>
        <Field label="Payment family">
          <select {...f.register("family")}>
            {[
              "bank",
              "card",
              "mobile-money",
              "stablecoin",
              "crypto",
              "local",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Specific rail or method">
          <input
            {...f.register("rail")}
            placeholder="e.g. NIBSS bank transfer"
          />
        </Field>
        <Field label="Operation">
          <select {...f.register("operation")}>
            {[
              "pay-in",
              "payout",
              "conversion",
              "authorization",
              "settlement",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <CountrySelect
          label="Payer origin"
          value={watched.origin || ""}
          onChange={(v) => f.setValue("origin", v)}
        />
        <CountrySelect
          label="Merchant destination"
          value={watched.destination || ""}
          onChange={(v) => f.setValue("destination", v)}
        />
      </div>
      <h3>Assets and direction</h3>
      <div className="p-form-grid">
        <Field label="Input asset type">
          <select {...f.register("input.kind")}>
            <option value="fiat">Fiat currency</option>
            <option value="blockchain">Blockchain asset</option>
          </select>
        </Field>
        <Field
          label="Input asset identifier"
          hint="ISO code, or namespaced asset identifier (e.g. erc20:0x…)."
        >
          <input list="portal-fiat" {...f.register("input.identifier")} />
          <datalist id="portal-fiat">
            {fiat.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </datalist>
        </Field>
        <Field
          label="Input network"
          hint="For blockchain assets, use a chain identifier such as eip155:1."
        >
          <input {...f.register("input.network")} />
        </Field>
      </div>
      <label className="p-check">
        <input
          type="checkbox"
          checked={conversion}
          onChange={(e) => {
            setConversion(e.target.checked);
            f.setValue(
              "output",
              e.target.checked
                ? { kind: "fiat", identifier: "NGN", network: "" }
                : undefined,
            );
          }}
        />
        This capability has a different output asset
      </label>
      {conversion && (
        <div className="p-form-grid">
          <Field label="Output asset type">
            <select {...f.register("output.kind")}>
              <option value="fiat">Fiat currency</option>
              <option value="blockchain">Blockchain asset</option>
            </select>
          </Field>
          <Field label="Output asset identifier">
            <input list="portal-fiat" {...f.register("output.identifier")} />
          </Field>
          <Field label="Output network">
            <input {...f.register("output.network")} />
          </Field>
        </div>
      )}
      <p className="p-direction">
        {watched.input?.identifier || "Input"} →{" "}
        {watched.output?.identifier || watched.input?.identifier || "Output"} ·{" "}
        {watched.operation} · {watched.origin} → {watched.destination}
      </p>
      <p className="p-muted">
        This declaration does not enable the reverse direction or other
        operations.
      </p>
      <h3>Approved fulfillment profile</h3>
      <p className="p-muted">
        A profile explicitly covers this operation through settlement. Legacy
        declarations without a profile require review before they can serve a
        payment.
      </p>
      <label className="p-check">
        <input
          type="checkbox"
          checked={!!watched.fulfillment}
          onChange={(e) => {
            if (e.target.checked) {
              f.setValue("family", "bank");
              f.setValue("rail", "ng-nibss");
            }
            f.setValue(
              "fulfillment",
              e.target.checked
                ? {
                    profileId: `${watched.capabilityId || "payment"}-profile`,
                    method: "bank-transfer",
                    integrationId:
                      integrations.find((i) => i.environment === environment)
                        ?.id || "",
                    adapterVersion: "1",
                    inputPrecision: 2,
                    settlementAsset: {
                      kind: "fiat",
                      identifier: "NGN",
                      network: "",
                    },
                    settlementPrecision: 2,
                    operations: [watched.operation || "pay-in", "settlement"],
                    verification: "verified",
                    checks: ["health", "availability", "capacity"],
                    schedule: [],
                    provenance: "provider-declared",
                  }
                : undefined,
            );
          }}
        />
        Declare complete fulfillment
      </label>
      {watched.fulfillment && (
        <div className="p-form-grid">
          <Field label="Profile identifier">
            <input {...f.register("fulfillment.profileId")} />
          </Field>
          <Field label="Customer payment method">
            <select
              {...f.register("fulfillment.method")}
              onChange={(e) => {
                const method = e.target.value as
                  "bank-transfer" | "card" | "stablecoin";
                f.setValue("fulfillment.method", method);
                f.setValue(
                  "family",
                  method === "bank-transfer" ? "bank" : method,
                );
                f.setValue(
                  "rail",
                  method === "bank-transfer"
                    ? "ng-nibss"
                    : method === "card"
                      ? "card-network"
                      : "onchain",
                );
              }}
            >
              <option value="bank-transfer">Bank transfer (ng-nibss)</option>
              <option value="card">Card (card-network)</option>
              <option value="stablecoin">Stablecoin (onchain)</option>
            </select>
          </Field>
          <Field label="Integration configuration">
            <select {...f.register("fulfillment.integrationId")}>
              <option value="">Select configuration</option>
              {integrations
                .filter((i) => i.environment === environment)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    Configuration v{i.version}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Input precision">
            <input
              type="number"
              min={0}
              max={18}
              {...f.register("fulfillment.inputPrecision", {
                valueAsNumber: true,
              })}
            />
          </Field>
          <Field label="Settlement asset type">
            <select {...f.register("fulfillment.settlementAsset.kind")}>
              <option value="fiat">Fiat</option>
              <option value="blockchain">Blockchain</option>
            </select>
          </Field>
          <Field label="Settlement asset identifier">
            <input {...f.register("fulfillment.settlementAsset.identifier")} />
          </Field>
          <Field label="Settlement network">
            <input {...f.register("fulfillment.settlementAsset.network")} />
          </Field>
          <Field label="Settlement precision">
            <input
              type="number"
              min={0}
              max={18}
              {...f.register("fulfillment.settlementPrecision", {
                valueAsNumber: true,
              })}
            />
          </Field>
          <Field label="Required verification">
            <select {...f.register("fulfillment.verification")}>
              <option value="none">None</option>
              <option value="verified">Verified customer</option>
            </select>
          </Field>
          <Field label="Approved operating schedule">
            <select
              value={
                watched.fulfillment.schedule?.length ? "weekdays" : "always"
              }
              onChange={(e) =>
                f.setValue(
                  "fulfillment.schedule",
                  e.target.value === "always"
                    ? []
                    : [{ days: [1, 2, 3, 4, 5], start: 540, end: 1020 }],
                )
              }
            >
              <option value="always">24/7</option>
              <option value="weekdays">
                Monday–Friday 09:00–17:00 in declared timezone
              </option>
            </select>
          </Field>
          <Field label="Explicit conversion included">
            <input
              type="checkbox"
              checked={
                watched.fulfillment.operations?.includes("conversion") || false
              }
              onChange={(e) =>
                f.setValue("fulfillment.operations", [
                  ...new Set([
                    watched.operation || "pay-in",
                    "settlement",
                    ...(e.target.checked ? ["conversion"] : []),
                  ]),
                ] as NonNullable<
                  CapabilityDefinition["fulfillment"]
                >["operations"])
              }
            />
          </Field>
        </div>
      )}
      <h3>Limits and operating conditions</h3>
      <div className="p-form-grid">
        {(
          [
            ["minimum", "Minimum transaction"],
            ["maximum", "Maximum transaction"],
            ["daily", "Daily limit"],
            ["limitAsset", "Limit asset identifier"],
            ["settlement", "Settlement characteristics"],
            ["hours", "Operating hours"],
            ["timezone", "Timezone"],
            ["conditions", "Verification / customer conditions"],
            ["endpoint", "Integration operation reference"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <input {...f.register(key)} />
          </Field>
        ))}
        <Field label="Availability reporting">
          <select {...f.register("availability")}>
            {["webhook", "poll", "manual"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Environment">
          <select {...f.register("environment")}>
            <option value="sandbox">Sandbox</option>
            <option value="production">Production proposal</option>
          </select>
        </Field>
      </div>
      {Object.keys(errors).length > 0 && (
        <div className="p-notice error" role="alert">
          {Object.entries(errors).map(([key, error]) => (
            <p key={key}>
              {key}:{" "}
              {error?.message || "Check asset type, network, and identifier."}
            </p>
          ))}
        </div>
      )}
      <JsonView value={watched} />
      <button className="p-button" disabled={f.formState.isSubmitting}>
        Save proposed capability
      </button>
    </form>
  );
}
export function SettlementForm({
  draft,
  version,
  execute,
  disabled,
}: {
  draft: Draft;
  version: number;
  execute: Execute;
  disabled: boolean;
}) {
  const defaults = {
    assets: [{ kind: "fiat" as const, identifier: "NGN", network: "" }],
    countries: ["NG"],
    schedule: "",
    minHours: 0,
    maxHours: 24,
    cutoff: "17:00",
    timezone: "Africa/Lagos",
    holidays: "",
    fees: "",
    reconciliation: "",
    reporting: "",
    ...draft.settlement,
  };
  const [value, setValue] = useState(defaults);
  return (
    <Panel title="Settlement capabilities">
      <p>
        Describe supported settlement. Beneficiary collection is unconfigured;
        do not enter bank credentials.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void execute({
            action: "save-section",
            section: "settlement",
            version,
            value,
          });
        }}
      >
        <fieldset disabled={disabled}>
          <div className="p-form-grid">
            {value.assets.map((asset, index) => (
              <div className="p-settlement-asset" key={index}>
                <Field label={`Settlement asset ${index + 1} type`}>
                  <select
                    value={asset.kind}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        assets: value.assets.map((a, i) =>
                          i === index
                            ? {
                                ...a,
                                kind: e.target.value as "fiat" | "blockchain",
                              }
                            : a,
                        ),
                      })
                    }
                  >
                    <option value="fiat">Fiat</option>
                    <option value="blockchain">Blockchain</option>
                  </select>
                </Field>
                <Field label={`Settlement asset ${index + 1} identifier`}>
                  <input
                    value={asset.identifier}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        assets: value.assets.map((a, i) =>
                          i === index
                            ? { ...a, identifier: e.target.value }
                            : a,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label={`Settlement asset ${index + 1} network`}>
                  <input
                    value={asset.network}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        assets: value.assets.map((a, i) =>
                          i === index ? { ...a, network: e.target.value } : a,
                        ),
                      })
                    }
                  />
                </Field>
                {value.assets.length > 1 && (
                  <button
                    type="button"
                    className="p-link"
                    onClick={() =>
                      setValue({
                        ...value,
                        assets: value.assets.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove asset {index + 1}
                  </button>
                )}
              </div>
            ))}
            <div>
              <button
                className="p-button secondary"
                type="button"
                onClick={() =>
                  setValue({
                    ...value,
                    assets: [
                      ...value.assets,
                      { kind: "fiat", identifier: "", network: "" },
                    ],
                  })
                }
              >
                Add settlement asset
              </button>
            </div>
            {(
              [
                ["schedule", "Schedule"],
                ["cutoff", "Cutoff time"],
                ["timezone", "Timezone"],
                ["holidays", "Holidays / non-operating periods"],
                ["fees", "Fees or quote mechanism"],
                ["reconciliation", "Reconciliation reference format"],
                ["reporting", "Settlement report mechanism"],
              ] as const
            ).map(([key, label]) => (
              <Field label={label} key={key}>
                <input
                  value={value[key]}
                  onChange={(e) =>
                    setValue({ ...value, [key]: e.target.value })
                  }
                />
              </Field>
            ))}
            {(
              [
                ["minHours", "Minimum expected hours"],
                ["maxHours", "Maximum expected hours"],
              ] as const
            ).map(([key, label]) => (
              <Field label={label} key={key}>
                <input
                  type="number"
                  min={0}
                  value={value[key]}
                  onChange={(e) =>
                    setValue({ ...value, [key]: Number(e.target.value) })
                  }
                />
              </Field>
            ))}
          </div>
          <CountryMany
            label="Settlement countries"
            value={value.countries}
            onChange={(countries) => setValue({ ...value, countries })}
          />
          <button className="p-button">Save settlement capabilities</button>
        </fieldset>
      </form>
    </Panel>
  );
}
export function IntegrationForm({
  value,
  version,
  environment,
  execute,
  disabled,
}: {
  value?: Draft["integration"];
  version: number;
  environment: string;
  execute: Execute;
  disabled: boolean;
}) {
  const f = useForm({
    defaultValues: value || {
      adapter: "simulator",
      baseUrl: "",
      auth: "bearer",
      mappings: "bank.payin → /payments",
      healthPath: "/health",
      events: "webhook",
      signing: "HMAC-SHA256",
      timeoutMs: 8000,
      retries: 0,
    },
  });
  return (
    <Panel
      title={`${environment === "sandbox" ? "Sandbox" : "Production"} connection`}
    >
      <form
        onSubmit={f.handleSubmit((value) =>
          execute({
            action: "save-section",
            section: "integration",
            environment,
            version,
            value,
          }),
        )}
      >
        <fieldset disabled={disabled}>
          <div className="p-form-grid">
            <Field label="Adapter">
              <select {...f.register("adapter")}>
                <option value="simulator">
                  Local simulator — fictional results
                </option>
                <option value="provider">Provider endpoint</option>
              </select>
            </Field>
            <Field label="API base URL">
              <input
                {...f.register("baseUrl")}
                placeholder="https://api.provider.example"
              />
            </Field>
            <Field label="Authentication">
              <select {...f.register("auth")}>
                {["bearer", "api-key", "mTLS"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Health endpoint path">
              <input {...f.register("healthPath")} />
            </Field>
            <Field label="Capability endpoint mappings">
              <textarea {...f.register("mappings")} />
            </Field>
            <Field label="Events">
              <select {...f.register("events")}>
                <option value="webhook">Webhook</option>
                <option value="poll">Polling</option>
              </select>
            </Field>
            <Field label="Webhook verification">
              <select {...f.register("signing")}>
                <option>HMAC-SHA256</option>
              </select>
            </Field>
            <Field label="Request timeout (ms)">
              <input
                type="number"
                min={500}
                max={15000}
                {...f.register("timeoutMs", { valueAsNumber: true })}
              />
            </Field>
            <Field
              label="Safe read retries"
              hint="Execution is never blindly retried after an uncertain outcome."
            >
              <input
                type="number"
                min={0}
                max={2}
                {...f.register("retries", { valueAsNumber: true })}
              />
            </Field>
          </div>
          <button className="p-button">Save {environment} connection</button>
        </fieldset>
      </form>
    </Panel>
  );
}

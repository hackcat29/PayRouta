import {
  capabilitySchema,
  units,
  scenarios,
  PortalError,
  CapabilityDefinition,
} from "./domain";
import { createHmac, timingSafeEqual } from "node:crypto";
export interface ProviderAdapter {
  name: string;
  run(scenario: string): Promise<{
    outcome: string;
    steps: { at: string; action: string; result: string }[];
  }>;
}
const fixture: CapabilityDefinition = {
  capabilityId: "fixture-bank-payin",
  version: 1,
  family: "bank",
  rail: "Fictional bank transfer",
  operation: "pay-in",
  origin: "NG",
  destination: "NG",
  input: { kind: "fiat", identifier: "NGN", network: "" },
  minimum: "1",
  maximum: "1000",
  daily: "5000",
  limitAsset: "NGN",
  settlement: "T+1",
  hours: "24/7",
  timezone: "UTC",
  availability: "webhook",
  conditions: "Fictional verified customer",
  endpoint: "fixture.payin",
  environment: "sandbox",
};
export class SimulatedProvider {
  available = true;
  healthy = true;
  executionCount = 0;
  eventSequence = 0;
  settlement = "Pending";
  requests = new Map<string, { state: string; reference: string }>();
  authenticate(secret: string) {
    return secret === "fixture-credential";
  }
  manifest(value: unknown) {
    return capabilitySchema.safeParse(value).success;
  }
  execute(key: string, amount: string, uncertain = false) {
    const existing = this.requests.get(key);
    if (existing) return existing;
    if (!this.available) return { state: "Method unavailable", reference: "" };
    if (!this.healthy) return { state: "Provider unavailable", reference: "" };
    if (units(amount) > units(fixture.maximum))
      return { state: "Limit exceeded", reference: "" };
    this.executionCount++;
    const response = {
      state: uncertain ? "Uncertain" : "Confirmed",
      reference: `fixture-${this.executionCount}`,
    };
    this.requests.set(key, response);
    return response;
  }
  reconcile(key: string) {
    return this.requests.get(key) || { state: "Unknown", reference: "" };
  }
  signature(payload: string) {
    return createHmac("sha256", "fixture-event-secret")
      .update(payload)
      .digest();
  }
  event(sequence: number, state: string, signature: Buffer) {
    const payload = JSON.stringify({ sequence, state });
    const expected = this.signature(payload);
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(signature, expected)
    )
      return "Invalid signature";
    if (sequence <= this.eventSequence) return "Ignored";
    this.eventSequence = sequence;
    this.settlement = state;
    return "Applied";
  }
}
export const simulator: ProviderAdapter = {
  name: "Local simulator",
  async run(scenario) {
    if (!(scenarios as readonly string[]).includes(scenario))
      throw new PortalError("Unknown scenario");
    const provider = new SimulatedProvider();
    const steps: { at: string; action: string; result: string }[] = [];
    const record = (action: string, result: string) =>
      steps.push({ at: new Date().toISOString(), action, result });
    const check = (condition: boolean, action: string, result: string) => {
      if (!condition)
        throw new PortalError(`Simulator assertion failed: ${action}`);
      record(action, result);
    };
    record("Environment", "Fictional local simulator. No payment sent.");
    switch (scenario) {
      case "Authentication succeeds":
        check(
          provider.authenticate("fixture-credential"),
          "Authenticate",
          "Accepted fixture credential",
        );
        break;
      case "Authentication fails":
        check(
          !provider.authenticate("invalid-fixture"),
          "Authenticate",
          "Invalid fixture credential rejected; execution blocked",
        );
        break;
      case "Manifest valid":
        check(
          provider.manifest(fixture),
          "Validate",
          "Directional fixture capability accepted",
        );
        break;
      case "Manifest invalid":
        check(
          !provider.manifest({
            ...fixture,
            operation: "conversion",
            output: undefined,
          }),
          "Validate",
          "Missing explicit conversion output rejected",
        );
        break;
      case "Selected method unavailable":
        provider.available = false;
        check(
          provider.execute("one", "10").state === "Method unavailable" &&
            provider.executionCount === 0,
          "Availability",
          "Selected bank transfer unavailable; no provider chosen",
        );
        break;
      case "Declared limit exceeded":
        check(
          provider.execute("one", "1000.000000000000000001").state ===
            "Limit exceeded" && provider.executionCount === 0,
          "Limits",
          "Rejected before execution using exact decimal limits",
        );
        break;
      case "Provider unavailable before execution":
        provider.healthy = false;
        check(
          provider.execute("one", "10").state === "Provider unavailable" &&
            provider.executionCount === 0,
          "Health",
          "Provider excluded within selected method before initiation",
        );
        break;
      case "Timeout with uncertain outcome":
        check(
          provider.execute("one", "10", true).state === "Uncertain",
          "Execute",
          "Timeout; outcome uncertain",
        );
        check(
          provider.executionCount === 1,
          "Safety",
          "No retry or failover issued",
        );
        check(
          provider.reconcile("one").state === "Uncertain",
          "Reconcile",
          "Status query required before any next execution decision; provider still reports uncertainty",
        );
        break;
      case "Duplicate idempotency key": {
        const first = provider.execute("same-key", "10");
        const second = provider.execute("same-key", "10");
        check(
          first.reference === second.reference && provider.executionCount === 1,
          "Idempotency",
          "1 execution for 2 identical requests",
        );
        break;
      }
      case "Duplicate and out-of-order events": {
        let accepted = 0;
        for (const sequence of [2, 2, 1, 3]) {
          const state = sequence === 3 ? "Completed" : "Pending";
          if (
            provider.event(
              sequence,
              state,
              provider.signature(JSON.stringify({ sequence, state })),
            ) === "Applied"
          )
            accepted++;
        }
        check(
          accepted === 2 && provider.settlement === "Completed",
          "Event ordering",
          "2 applied; duplicate and stale sequence ignored",
        );
        break;
      }
      case "Invalid event signature":
        check(
          provider.event(1, "Completed", Buffer.alloc(32)) ===
            "Invalid signature" && provider.settlement === "Pending",
          "Signature",
          "Rejected before processing",
        );
        break;
      case "Settlement pending then complete":
        check(
          provider.execute("one", "10").state === "Confirmed" &&
            provider.settlement === "Pending",
          "Execution",
          "Confirmed; settlement still pending",
        );
        provider.event(
          1,
          "Completed",
          provider.signature(
            JSON.stringify({ sequence: 1, state: "Completed" }),
          ),
        );
        check(
          provider.settlement === "Completed",
          "Settlement event",
          "Fixture reconciliation confirms completion; no funds moved",
        );
        break;
    }
    return { outcome: "Passed", steps };
  },
};

// Persistent customer-payment operations share the simulator registration.
export { persistentSimulator } from "../payments/execution";

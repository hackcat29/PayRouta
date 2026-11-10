"use client";
// A page that needs a fresh confirmation (operations): opens "Confirm it's
// you" straight away and reloads once confirmed. Any other refusal shows
// its message.
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errorText } from "@/lib/error-copy";
import { useStepUp } from "./step-up";

const confirmable = (code: string) => code === "STEP_UP_REQUIRED" || code === "TWO_STEP_REQUIRED";

function Gate({ code }: { code: string }) {
  const stepUp = useStepUp();
  const router = useRouter();
  useEffect(() => {
    if (confirmable(code)) void stepUp?.request(code === "TWO_STEP_REQUIRED" ? "setup" : "confirm").then((ok) => ok && router.refresh());
  }, [code, stepUp, router]);
  return (
    <div className="portal p-simple">
      <h1>{confirmable(code) ? "Confirm it's you" : "Access required"}</h1>
      <p>{errorText({ error: code }, 403)}</p>
      {confirmable(code) ? (
        <button
          type="button"
          className="p-button"
          onClick={() => void stepUp?.request(code === "TWO_STEP_REQUIRED" ? "setup" : "confirm").then((ok) => ok && router.refresh())}
        >
          Confirm it&apos;s you
        </button>
      ) : (
        <Link className="p-button" href="/account/security">
          Account security
        </Link>
      )}
    </div>
  );
}

// Inside a StepUpProvider (app/ops/layout.tsx).
export function VerifyGate({ code }: { code: string }) {
  return <Gate code={code} />;
}

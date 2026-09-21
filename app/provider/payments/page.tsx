import Link from "next/link";
import { member } from "@/lib/portal/access";
import { localMode } from "@/lib/portal/adapters";
import { PortalError } from "@/lib/portal/domain";
import { notFound, redirect } from "next/navigation";
import { DemoCheckout } from "./view";
import "@/components/portal/portal.css";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!localMode()) notFound();
  try {
    await member("payment-demo-merchant", "integration");
  } catch (error) {
    if (error instanceof PortalError && error.status === 401)
      redirect("/provider/sign-in");
    if (error instanceof PortalError)
      return (
        <div className="portal p-simple">
          <h1>Merchant access required</h1>
          <p>Sign in with the seeded merchant owner account.</p>
          <Link href="/provider/sign-in">Sign in</Link>
        </div>
      );
    throw error;
  }
  return (
    <div className="portal p-simple">
      <Link href="/provider">← Provider workspace</Link>
      <h1>Sandbox checkout</h1>
      <p>
        Create a fictional NGN 100.00 order for Fictional Market. No real
        payment is sent.
      </p>
      <DemoCheckout />
    </div>
  );
}

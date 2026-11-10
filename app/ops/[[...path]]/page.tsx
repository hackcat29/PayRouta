import { VerifyGate } from "@/components/portal/verify-gate";
import { notFound, redirect } from "next/navigation";
import { Ops } from "@/components/portal/ops";
import { opsData } from "@/lib/portal/queries";
import { PortalError } from "@/lib/portal/domain";
import "@/components/portal/portal.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Internal operations",
  robots: { index: false, follow: false },
};
export default async function OpsPage({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const parts = (await params).path || ["applications"];
  if (
    !["applications", "providers", "requirements", "audit-log"].includes(
      parts[0],
    ) ||
    parts.length > 2
  )
    notFound();
  let data;
  try {
    data = await opsData(parts[1], await searchParams);
  } catch (e) {
    if (e instanceof PortalError) {
      if (e.status === 401) redirect("/provider/sign-in");
      if (e.status === 404) notFound();
      return <VerifyGate code={e.message} />;
    }
    throw e;
  }
  return <Ops data={data} route={parts.join("/")} />;
}

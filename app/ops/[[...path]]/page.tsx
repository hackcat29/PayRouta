import Link from "next/link";
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
      return (
        <div className="portal p-simple">
          <h1>Internal access requires verification</h1>
          <p>{e.message}</p>
          <Link className="p-button" href="/provider/settings">
            Open account security
          </Link>
        </div>
      );
    }
    throw e;
  }
  return <Ops data={data} route={parts.join("/")} />;
}

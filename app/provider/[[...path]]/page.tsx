import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { AuthScreen, ResetPassword } from "@/components/portal/auth-screen";
import { safeNext } from "@/lib/portal/next-path";
import { Workspace } from "@/components/portal/workspace";
import { workspaceData, transactionDetail } from "@/lib/portal/queries";
import { localMode } from "@/lib/portal/adapters";
import { PortalError, allowedRoute } from "@/lib/portal/domain";
import "@/components/portal/portal.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Provider workspace",
  robots: { index: false, follow: false },
};
const routes = [
  "overview",
  "onboarding",
  "onboarding/company",
  "onboarding/coverage",
  "onboarding/capabilities",
  "onboarding/settlement",
  "onboarding/compliance",
  "onboarding/integration",
  "onboarding/review",
  "application",
  "capabilities",
  "integration",
  "integration/credentials",
  "integration/events",
  "sandbox",
  "availability",
  "transactions",
  "settlements",
  "performance",
  "team",
  "settings",
  "audit-log",
  "organizations/new",
];
export default async function ProviderPage({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const route = (await params).path?.join("/") || "overview";
  const query = await searchParams;
  if (route === "sign-in" || route === "sign-up")
    return (
      <AuthScreen
        signUp={route === "sign-up"}
        local={localMode()}
        next={safeNext(query.next)}
      />
    );
  if (route === "reset-password")
    return <ResetPassword token={query.token || ""} />;
  if (route === "dev-mail") {
    if (
      !localMode() ||
      !(await headers()).get("host")?.startsWith("127.0.0.1:")
    )
      notFound();
    const dir = path.resolve(
      process.env.LOCAL_DATA_DIR || ".local/portal",
      "mail",
    );
    const files = await readdir(dir).catch(() => []);
    const messages = await Promise.all(
      files
        .sort()
        .reverse()
        .slice(0, 30)
        .map(
          async (file) =>
            JSON.parse(await readFile(path.join(dir, file), "utf8")) as {
              to: string;
              subject: string;
              text: string;
              at: string;
            },
        ),
    );
    return (
      <div className="portal p-simple">
        <h1>Local mail capture</h1>
        <p>
          Development only. These messages were captured locally; no email was
          sent.
        </p>
        <Link className="p-link" href="/provider/sign-in">
          Return to sign in
        </Link>
        {messages.map((m, i) => (
          <section className="p-panel" key={i}>
            <h2>{m.subject}</h2>
            <p>
              To: {m.to} · {m.at}
            </p>
            {m.text.startsWith("http://127.0.0.1:") ? (
              <a className="p-link p-wrap" href={m.text}>
                {m.text}
              </a>
            ) : (
              <pre>{m.text}</pre>
            )}
          </section>
        ))}
      </div>
    );
  }
  if (!routes.includes(route) && !/^transactions\/[^/]+$/.test(route))
    notFound();
  const environment = query.env === "production" ? "production" : "sandbox";
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(query.page)) || 1),
  );
  let data;
  let detail;
  try {
    data = await workspaceData(
      query.org,
      environment,
      (query.q || "").slice(0, 200),
      page,
    );
    if (data.role && !allowedRoute(data.role, route))
      throw new PortalError(
        "Your role does not include this workspace page",
        403,
      );
    detail =
      route.startsWith("transactions/") && data.org
        ? await transactionDetail(data.org.id, route.split("/")[1], environment)
        : undefined;
  } catch (e) {
    if (e instanceof PortalError) {
      if (e.status === 401) redirect("/provider/sign-in");
      if (e.status === 404) notFound();
      return (
        <div className="portal p-simple">
          <h1>Access restricted</h1>
          <p>{e.message}</p>
          <Link href="/provider/overview">Return to your workspace</Link>
        </div>
      );
    }
    throw e;
  }
  return (
    <Workspace
      key={`${data.org?.id}:${environment}:${route}`}
      data={data}
      route={route}
      environment={environment}
      query={(query.q || "").slice(0, 200)}
      page={page}
      detail={detail}
      invitation={query.invitation}
    />
  );
}

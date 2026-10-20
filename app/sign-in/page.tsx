import { AuthScreen } from "@/components/portal/auth-screen";
import { safeNext } from "@/lib/portal/next-path";
import { localMode } from "@/lib/portal/adapters";
import { googleEnabled } from "@/lib/portal/auth";
import "@/components/portal/portal.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in", robots: { index: false, follow: true } };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { next } = await searchParams;
  return <AuthScreen base="" google={googleEnabled()} local={localMode()} next={safeNext(next)} />;
}

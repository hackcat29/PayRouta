import { ResetPassword } from "@/components/portal/auth-screen";
import "@/components/portal/portal.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset your password", robots: { index: false, follow: false } };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { token, error } = await searchParams;
  return <ResetPassword base="" token={token || ""} error={error} />;
}

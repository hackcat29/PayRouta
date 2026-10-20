"use client";
import { useRouter } from "next/navigation";
import { authClient } from "./auth-screen";

export function SignOutButton({ to = "/sign-in", className }: { to?: string; className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await authClient.signOut();
        router.push(to);
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}

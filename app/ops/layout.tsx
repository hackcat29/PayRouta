// Every operations page can confirm it's you in place when a sensitive
// action asks (components/portal/step-up.tsx).
import type { ReactNode } from "react";
import { StepUpProvider } from "@/components/portal/step-up";
import { themeScript } from "@/components/portal/theme-script";

export default function OpsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      <StepUpProvider securityHref="/account/security">{children}</StepUpProvider>
    </>
  );
}

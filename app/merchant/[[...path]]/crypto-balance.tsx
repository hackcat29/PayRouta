"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";
import {
  CryptoBalance as ExternalBalance,
  type CryptoBalanceProps,
} from "./intents";

// Keep the wallet SDK out of checkout, sign-in, and other merchant pages.
const PrivyBalance = dynamic(() => import("./privy-balance"), {
  ssr: false,
  loading: () => <p role="status">Loading your wallet options…</p>,
});

class WalletFallback extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <>
        <p role="status">
          Embedded wallets are unavailable. You can still use your external
          wallet.
        </p>
        {this.props.fallback}
      </>
    ) : (
      this.props.children
    );
  }
}

export function CryptoBalance({
  portalUserId,
  ...props
}: CryptoBalanceProps & { portalUserId: string }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  if (!appId || props.environment !== "production")
    return <ExternalBalance {...props} />;
  return (
    <WalletFallback
      key={`${portalUserId}:${props.orgId}`}
      fallback={<ExternalBalance {...props} />}
    >
      <PrivyBalance
        {...props}
        portalUserId={portalUserId}
        appId={appId}
        clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || undefined}
      />
    </WalletFallback>
  );
}

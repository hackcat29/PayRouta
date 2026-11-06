"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  PrivyProvider,
  getEmbeddedConnectedWallet,
  useCreateWallet,
  useExportWallet,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { CryptoBalance, type CryptoBalanceProps } from "./intents";
import { connectEvm, type Signer } from "./intents-wallet";
import { embeddedEvmSigner } from "@/lib/blockchain/embedded-signer";

export default function PrivyBalance({
  appId,
  clientId,
  portalUserId,
  ...props
}: CryptoBalanceProps & {
  appId: string;
  clientId?: string;
  portalUserId: string;
}) {
  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId}
      config={{
        loginMethods: ["email"],
        appearance: {
          theme: "light",
          accentColor: "#5046e5",
          walletChainType: "ethereum-only",
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          showWalletUIs: true,
        },
      }}
    >
      <WalletSession
        portalUserId={portalUserId}
        fallback={<CryptoBalance {...props} />}
      >
        <MerchantWallet {...props} />
      </WalletSession>
    </PrivyProvider>
  );
}

// Privy authentication is separate from the portal session. Clear a saved
// wallet session before exposing it to a different PayRouta user on this browser.
function WalletSession({
  portalUserId,
  children,
  fallback,
}: {
  portalUserId: string;
  children: ReactNode;
  fallback: ReactNode;
}) {
  const { ready, authenticated, logout } = usePrivy();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    async function check() {
      if (!ready) return;
      const key = "payrouta.privy.portal-user";
      if (localStorage.getItem(key) !== portalUserId) {
        if (authenticated) await logout();
        if (!active) return;
        localStorage.setItem(key, portalUserId);
      }
      if (active) setChecked(true);
    }
    void check().catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
    };
  }, [ready, authenticated, logout, portalUserId]);
  if (error) throw new Error("Wallet session could not be verified");
  return checked ? (
    children
  ) : (
    <>
      <p role="status">Checking your wallet session…</p>
      {fallback}
    </>
  );
}

function MerchantWallet(props: CryptoBalanceProps) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { exportWallet } = useExportWallet();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const embedded = getEmbeddedConnectedWallet(wallets);
  const accountId = props.overview.account?.accountId;
  // Match the saved business account, never whichever wallet happens to be first.
  const matching = wallets.find(
    (wallet) =>
      getEmbeddedConnectedWallet([wallet]) &&
      wallet.address.toLowerCase() === accountId?.toLowerCase(),
  );
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Your wallet could not complete this request. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function embeddedSigner(address: string): Promise<Signer | null> {
    return embeddedEvmSigner(
      authenticated,
      ready && walletsReady,
      wallets,
      address,
    );
  }
  return (
    <CryptoBalance
      {...props}
      embeddedSigner={embeddedSigner}
      walletControls={(connect, disabled) => (
        <div className="ms-callout">
          <h3>Your PayRouta wallet</h3>
          <p>
            Create a wallet with your email, or keep using an external wallet.
            You approve signatures; PayRouta does not hold your private key.
          </p>
          {authenticated && (
            <p>Wallet sign-in: {user?.email?.address || "Signed in"}</p>
          )}
          {embedded && (
            <p>
              Signing wallet: <code>{embedded.address}</code>
            </p>
          )}
          {embedded && (
            <p>
              Your checkout balance is held in your NEAR Intents account.
              Transfers sent directly to this wallet are not included in that
              balance.
            </p>
          )}
          {!accountId && embedded && (
            <p>
              Connecting this wallet makes it the receive account for this
              business. It belongs to your wallet login, not every member of
              your team.
            </p>
          )}
          {accountId && authenticated && !matching && (
            <p>
              This wallet does not control the connected receive account. Sign
              in with its wallet login or use the matching external wallet.
            </p>
          )}
          <div className="ms-link-actions">
            {!authenticated ? (
              <button
                type="button"
                className="ms-btn"
                disabled={!ready || busy}
                onClick={() => login()}
              >
                {ready ? "Sign in to your wallet" : "Loading wallet…"}
              </button>
            ) : (
              <>
                {!embedded && (
                  <button
                    type="button"
                    className="ms-btn"
                    disabled={!walletsReady || busy}
                    onClick={() => void run(() => createWallet())}
                  >
                    {busy ? "Creating wallet…" : "Create a wallet"}
                  </button>
                )}
                {!accountId && embedded && (
                  <button
                    type="button"
                    className="ms-btn primary"
                    disabled={disabled || busy || !walletsReady}
                    onClick={() =>
                      void run(() =>
                        connect(async () => ({
                          ...(await connectEvm(
                            await embedded.getEthereumProvider(),
                          )),
                          source: "privy",
                        })),
                      )
                    }
                  >
                    Connect this wallet
                  </button>
                )}
                {embedded && (
                  <button
                    type="button"
                    className="ms-btn"
                    disabled={busy || !walletsReady}
                    onClick={() =>
                      void run(() =>
                        exportWallet({
                          address: (matching ?? embedded).address,
                        }),
                      )
                    }
                  >
                    Export wallet
                  </button>
                )}
                <button
                  type="button"
                  className="ms-btn"
                  disabled={busy}
                  onClick={() => void run(() => logout())}
                >
                  Sign out of wallet
                </button>
              </>
            )}
          </div>
          {message && <p role="alert">{message}</p>}
        </div>
      )}
    />
  );
}

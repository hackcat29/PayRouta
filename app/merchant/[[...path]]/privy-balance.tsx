"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  PrivyProvider,
  getEmbeddedConnectedWallet,
  useConnectWallet,
  useCreateWallet,
  useExportWallet,
  usePrivy,
  useWallets,
  type BaseConnectedEthereumWallet,
  type BaseConnectedSolanaWallet,
} from "@privy-io/react-auth";
import { toSolanaWalletConnectors, useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { CryptoBalance, type CryptoBalanceProps } from "./intents";
import { Sparkles, WalletCards } from "lucide-react";
import { connectEvm, solanaSigner, walletErrorText, type Signer } from "./intents-wallet";
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
        // Social sign-in creates a new wallet; each method must also be on
        // in the Privy dashboard (docs/privy-wallets.md).
        loginMethods: ["google", "apple", "twitter", "email"],
        appearance: {
          theme: "light",
          accentColor: "#2e37a4",
          // Existing wallets on EVM chains and Solana.
          walletChainType: "ethereum-and-solana",
        },
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
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

// A Solana address's NEAR Intents account: its key in hex.
const solanaAccount = (address: string) => {
  try {
    return solanaSigner(address, async () => ({ signature: new Uint8Array() })).accountId;
  } catch {
    return null;
  }
};

function MerchantWallet(props: CryptoBalanceProps) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { createWallet } = useCreateWallet();
  const { exportWallet } = useExportWallet();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // "create": signing in to create a wallet; "connect": choosing a wallet.
  const [pending, setPending] = useState<null | "create" | "connect">(null);
  // Read by Privy's connect callback, which may hold an older render.
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  const connectRef = useRef<((make: () => Promise<Signer>) => Promise<void>) | null>(null);
  const embedded = getEmbeddedConnectedWallet(wallets);
  const account = props.overview.account;
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage(walletErrorText(error));
    } finally {
      setBusy(false);
    }
  }
  // A wallet Privy connected, as the signer for an intents account.
  const asSigner = async (w: BaseConnectedEthereumWallet | BaseConnectedSolanaWallet): Promise<Signer> =>
    w.type === "solana"
      ? solanaSigner(w.address, async (message) => {
          const out = await w.provider.signMessage({ message });
          return { signature: out.signature, signedMessage: out.signedMessage };
        })
      : connectEvm(await w.getEthereumProvider());
  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet }) => {
      const connect = connectRef.current;
      if (pendingRef.current !== "connect" || !connect) return;
      setPending(null);
      void connect(() => asSigner(wallet));
    },
    onError: () => setPending(null),
  });
  // After social sign-in: create the wallet if there isn't one, then use it.
  useEffect(() => {
    if (pending !== "create" || !authenticated || !walletsReady || busy) return;
    const connect = connectRef.current;
    if (!connect) return;
    // Continue once this render has settled.
    const next = setTimeout(() => {
      if (!embedded) {
        void run(() => createWallet());
        return;
      }
      setPending(null);
      void connect(async () => ({ ...(await connectEvm(await embedded.getEthereumProvider())), source: "privy" as const }));
    });
    return () => clearTimeout(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, authenticated, walletsReady, embedded, busy]);

  // The wallet that owns the connected account, if Privy has it.
  async function signer(target: { accountId: string; standard: string }): Promise<Signer | null> {
    if (target.standard === "raw_ed25519") {
      const w = solanaWallets.find((x) => solanaAccount(x.address) === target.accountId);
      return w
        ? solanaSigner(w.address, async (message) => {
            const out = await w.signMessage({ message });
            return { signature: out.signature, signedMessage: out.signedMessage };
          })
        : null;
    }
    if (target.standard !== "erc191") return null;
    const own = await embeddedEvmSigner(authenticated, ready && walletsReady, wallets, target.accountId);
    if (own) return own;
    const external = wallets.find((w) => w.address.toLowerCase() === target.accountId);
    return external ? connectEvm(await external.getEthereumProvider()) : null;
  }

  const tiles = (connect: (make: () => Promise<Signer>) => Promise<void>, disabled: boolean) => {
    connectRef.current = connect;
    return (
      <>
        <button
          type="button"
          className="ms-wallet"
          disabled={!ready || busy || disabled}
          onClick={() => {
            setPending("create");
            if (!authenticated) login();
          }}
        >
          <Sparkles size={20} aria-hidden />
          {pending === "create" && busy ? "Creating wallet…" : "Create a wallet"}
        </button>
        <button
          type="button"
          className="ms-wallet"
          disabled={!ready || busy || disabled}
          onClick={() => {
            setPending("connect");
            connectWallet();
          }}
        >
          <WalletCards size={20} aria-hidden />
          Connect a wallet
        </button>
      </>
    );
  };
  const owned = account && (account.standard === "raw_ed25519"
    ? solanaWallets.some((w) => solanaAccount(w.address) === account.accountId)
    : wallets.some((w) => w.address.toLowerCase() === account.accountId));
  const manage = (
    <div className="ms-wallet-manage">
      {account && account.standard !== "nep413" && !owned && (
        <button
          type="button"
          className="ms-btn"
          disabled={!ready || busy}
          onClick={() => (account.standard === "erc191" && embedded === undefined && !authenticated ? login() : connectWallet())}
        >
          Connect the wallet that owns this account
        </button>
      )}
      {authenticated && (
        <>
          <span className="ms-dim">{user?.email?.address ?? user?.google?.email ?? user?.apple?.email ?? user?.twitter?.username}</span>
          {embedded && (
            <button
              type="button"
              className="ms-btn"
              disabled={busy || !walletsReady}
              onClick={() => void run(() => exportWallet({ address: embedded.address }))}
            >
              Export wallet
            </button>
          )}
          <button type="button" className="ms-btn" disabled={busy} onClick={() => void run(() => logout())}>
            Sign out of wallet
          </button>
        </>
      )}
      {message && (
        <p className="p-notice error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
  return <CryptoBalance {...props} privy={{ tiles, manage, signer }} />;
}

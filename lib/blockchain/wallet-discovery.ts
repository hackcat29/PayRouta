import type { WalletProvider } from "./wallet-payment";

export type DiscoveredWallet = {
  id: string;
  name: string;
  provider: WalletProvider;
  // EIP-6963 icon, kept only when it is an image data URI.
  icon?: string;
};
const safeIcon = (icon: unknown) =>
  typeof icon === "string" && icon.length < 100_000 && /^data:image\/(svg\+xml|png|webp|jpeg|gif)[;,]/.test(icon)
    ? icon
    : undefined;
type Host = EventTarget & {
  ethereum?: unknown;
  phantom?: { ethereum?: unknown };
};
const provider = (value: unknown): value is WalletProvider =>
  !!value &&
  typeof value === "object" &&
  typeof (value as WalletProvider).request === "function";
const legacyName = (value: WalletProvider) => {
  const flags = value as WalletProvider & Record<string, unknown>;
  return flags.isRabby === true
    ? "Rabby"
    : flags.isPhantom === true
      ? "Phantom"
      : flags.isCoinbaseWallet === true
        ? "Coinbase Wallet"
        : flags.isMetaMask === true
          ? "MetaMask"
          : "Browser wallet";
};

// Discovery requests metadata only. Connecting accounts and sending transactions
// always use the exact provider the customer selects.
export function discoverEvmWallets(
  host: Host,
  update: (wallets: DiscoveredWallet[]) => void,
) {
  const announced = new Map<WalletProvider, DiscoveredWallet>();
  const legacy = new Map<WalletProvider, DiscoveredWallet>();
  const ids = new Map<WalletProvider, string>();
  let stopped = false;
  const id = (wallet: WalletProvider) => {
    if (!ids.has(wallet)) ids.set(wallet, `wallet-${ids.size + 1}`);
    return ids.get(wallet)!;
  };
  const publish = () => {
    if (!stopped)
      update(Array.from((announced.size ? announced : legacy).values()));
  };
  const announce = (event: Event) => {
    try {
      const detail = (event as CustomEvent).detail;
      if (
        !detail ||
        !provider(detail.provider) ||
        !detail.info ||
        typeof detail.info.name !== "string" ||
        !detail.info.name.trim() ||
        detail.info.name.length > 80 ||
        typeof detail.info.uuid !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          detail.info.uuid,
        )
      )
        return;
      if (announced.size >= 32 && !announced.has(detail.provider)) return;
      const icon = safeIcon(detail.info.icon);
      announced.set(detail.provider, {
        id: id(detail.provider),
        name: detail.info.name.trim(),
        provider: detail.provider,
        ...(icon ? { icon } : {}),
      });
      publish();
    } catch {
      /* Ignore malformed extension announcements. */
    }
  };
  const fallback = () => {
    if (stopped || announced.size) return;
    try {
      const ethereum = host.ethereum as { providers?: unknown[] } | undefined;
      const children = Array.isArray(ethereum?.providers)
        ? ethereum.providers.slice(0, 32)
        : [];
      const candidates = [
        ...(children.length ? children : [host.ethereum]),
        host.phantom?.ethereum,
      ];
      for (const wallet of candidates)
        if (provider(wallet) && legacy.size < 32)
          legacy.set(wallet, {
            id: id(wallet),
            name: legacyName(wallet),
            provider: wallet,
          });
      publish();
    } catch {
      /* Manual transfer instructions remain available. */
    }
  };
  host.addEventListener("eip6963:announceProvider", announce);
  host.addEventListener("ethereum#initialized", fallback);
  host.dispatchEvent(new Event("eip6963:requestProvider"));
  queueMicrotask(fallback);
  return () => {
    stopped = true;
    host.removeEventListener("eip6963:announceProvider", announce);
    host.removeEventListener("ethereum#initialized", fallback);
  };
}

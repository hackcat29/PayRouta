"use client";
import { useState, useEffect, useRef } from "react";
import {
  submitDeposit,
  type DepositPayment,
} from "@/lib/blockchain/wallet-payment";
import { chain } from "@/lib/blockchain/chains";
import {
  browserNativeWallet,
  submitNativeDeposit,
  type CheckoutApi,
} from "@/lib/blockchain/wallet-native";
import {
  discoverEvmWallets,
  type DiscoveredWallet,
} from "@/lib/blockchain/wallet-discovery";
export function WalletButton({
  payment,
  api,
  onSubmitted,
  disabled,
  expiresAt,
}: {
  payment: DepositPayment;
  api: CheckoutApi;
  onSubmitted: () => void;
  disabled: boolean;
  expiresAt?: string;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [submitted, setSubmitted] = useState(false),
    [ready, setReady] = useState(false);
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState("");
  const manualChoice = useRef(false);
  const evm = chain(payment.network)?.family === "evm";
  useEffect(() => {
    if (!evm) return;
    return discoverEvmWallets(window, (choices) => {
      setWallets(choices);
      setSelectedWallet((old) => {
        if (manualChoice.current && choices.some((wallet) => wallet.id === old))
          return old;
        manualChoice.current = false;
        return choices.length === 1 ? choices[0].id : "";
      });
    });
  }, [evm]);
  const storageKey = `payrouta-transfer:${payment.network}:${payment.address}:${payment.amount}`;
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => {
      if (!alive) return;
      try {
        const old = localStorage.getItem(storageKey);
        if (old) {
          setSubmitted(true);
          setMessage(old);
        }
      } catch {}
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [storageKey]);
  function remember(text: string) {
    setSubmitted(true);
    setMessage(text);
    try {
      localStorage.setItem(storageKey, text);
    } catch {}
  }

  return (
    <>
      {evm && wallets.length > 0 && (
        <p>
          <label htmlFor="checkout-wallet">Choose your wallet</label>
          <select
            id="checkout-wallet"
            value={selectedWallet}
            disabled={disabled || busy || submitted}
            onChange={(event) => {
              manualChoice.current = true;
              setSelectedWallet(event.target.value);
            }}
          >
            <option value="" disabled>
              Select a wallet
            </option>
            {wallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.name}
              </option>
            ))}
          </select>
        </p>
      )}
      <button
        className="sc-primary"
        disabled={
          disabled ||
          busy ||
          submitted ||
          !ready ||
          (evm && wallets.length > 0 && !selectedWallet)
        }
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            let hash: string;
            if (chain(payment.network)?.family === "evm") {
              const wallet = wallets.find(
                (choice) => choice.id === selectedWallet,
              )?.provider;
              if (!wallet)
                throw new Error(
                  "Open this checkout in your wallet browser, or send using the address below",
                );
              hash = await submitDeposit(wallet, payment, expiresAt);
            } else
              hash = await submitNativeDeposit(
                payment,
                api,
                await browserNativeWallet(payment.network),
                expiresAt,
              );
            remember(
              `Transaction sent: ${hash}. Waiting for network finality.`,
            );
            onSubmitted();
          } catch (e) {
            const error = e as {
              code?: number;
              message?: string;
              mayHaveSent?: boolean;
            };
            if (error.mayHaveSent)
              remember(
                error.message || "Check wallet activity before sending again.",
              );
            else
              setMessage(
                error.code === 4001
                  ? "Payment was cancelled in your wallet."
                  : error.message || "Unable to open your wallet",
              );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Check your wallet…"
          : submitted
            ? "Waiting for transfer confirmation"
            : "Pay with wallet"}
      </button>
      <p role="status" className="sc-wallet-message">
        {message}
      </p>
    </>
  );
}

// The merchant's payments CSV (Payments → Export): one row per payment, in
// words an accountant can read without asking. What the invoice was, what the
// customer paid with, PayRouta's fee and how it was collected, what the
// merchant received, any refund, and a link to the transaction.
//
// exportCsv() builds the file from rows already loaded, so it can be tested
// without a database; paymentsCsv() loads them.
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { networkName, transactionExplorer } from "../blockchain/chains";
import { paymentAsset } from "../blockchain/crypto-assets";
import { chainNames, destinations } from "../intents/oneclick";
import { csvCell } from "./csv";

export type ExportPayment = {
  id: string;
  reference: string;
  amount: string;
  asset: { kind?: string; network?: string; identifier: string };
  precision: number;
  state: string;
  selectedMethod: string | null;
  createdAt: Date;
  expiresAt: Date;
};
export type ExportSwap = {
  intentId: string;
  status: string;
  originSymbol: string;
  originChain: string;
  amountInFormatted: string;
  amountOut: string;
  appFeeMinor: string | null;
  destinationAsset: string;
  depositAddress: string;
  createdAt: Date;
};
export type ExportFee = { intentId: string; amountMinor: string; precision: number; currency: string; collection: string };
export type ExportRefund = { intentId: string; text: string };
export type ExportClaim = { intentId: string; network: string; txHash: string };

export const exportColumns = [
  "Date (UTC)",
  "Payment ID",
  "Order reference",
  "Status",
  "Invoice amount",
  "Currency",
  "Network",
  "Paid with",
  "PayRouta fee",
  "Fee collected",
  "Merchant received",
  "Refunded",
  "Transaction link",
] as const;

const methodLabels: Record<string, string> = {
  card: "Card",
  "digital-wallet": "Digital wallet",
  "bank-transfer": "Bank transfer",
  "direct-debit": "Direct debit",
  "mobile-money": "Mobile money",
  ussd: "USSD",
  bnpl: "Credit",
  stablecoin: "Stablecoin",
  "crypto-app": "Crypto app",
};
const swapSettled = new Set(["SUCCESS"]);
const swapStarted = new Set(["KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT", "SUCCESS", "REFUNDED", "FAILED"]);

// Minor units as a decimal: at least two places, trailing zeros trimmed.
export function decimal(minor: string | bigint, places: number) {
  const units = BigInt(minor);
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(places + 1, "0");
  const whole = places ? digits.slice(0, -places) : digits;
  let fraction = places ? digits.slice(-places).replace(/0+$/, "") : "";
  if (fraction.length < 2) fraction = fraction.padEnd(Math.min(2, places), "0");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function status(p: ExportPayment, now: Date) {
  if (p.state === "Confirmed") return "Paid";
  if (p.state === "Processing") return "Processing";
  if (p.state === "Review required") return "Needs review";
  if (p.state === "Cancelled") return "Cancelled";
  if (p.state === "Open" || p.state === "Requires action") return p.expiresAt <= now ? "Expired, unpaid" : "Awaiting payment";
  return p.state;
}

export function exportCsv(
  payments: ExportPayment[],
  related: { swaps: ExportSwap[]; fees: ExportFee[]; refunds: ExportRefund[]; claims: ExportClaim[] },
  now = new Date(),
) {
  const rows = payments.map((p) => {
    const symbol =
      p.asset.kind === "fiat" || !p.asset.network ? p.asset.identifier : (paymentAsset(p.asset.network, p.asset.identifier)?.symbol ?? p.asset.identifier);
    const paid = p.state === "Confirmed";
    // The swap that paid this checkout, or the latest one started for it.
    const swaps = related.swaps.filter((s) => s.intentId === p.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const swap = swaps.find((s) => swapSettled.has(s.status)) ?? swaps.find((s) => swapStarted.has(s.status));
    const swapPlaces = swap ? (destinations.find((d) => d.assetId === swap.destinationAsset)?.decimals ?? p.precision) : p.precision;
    const fee = related.fees.find((f) => f.intentId === p.id);
    const claim = related.claims.find((c) => c.intentId === p.id);
    const refunds = related.refunds.filter((r) => r.intentId === p.id).map((r) => r.text);

    const paidWith = swap
      ? `${swap.amountInFormatted} ${swap.originSymbol} on ${chainNames[swap.originChain] ?? swap.originChain}`
      : paid && p.asset.network
        ? `${p.amount} ${symbol} on ${networkName(p.asset.network)}`
        : paid && p.selectedMethod
          ? (methodLabels[p.selectedMethod] ?? p.selectedMethod)
          : "";
    // PayRouta's fee: withheld in the NEAR Intents swap, or on the monthly
    // statement for payments that settle in full.
    const withheld = swap && swapSettled.has(swap.status) && swap.appFeeMinor ? decimal(swap.appFeeMinor, swapPlaces) : "";
    const statementFee = fee ? decimal(fee.amountMinor, fee.precision) + (fee.currency === symbol ? "" : ` ${fee.currency}`) : "";
    const feeText = withheld || (paid ? statementFee : "");
    const collected = withheld ? "Withheld at source" : feeText ? (fee?.collection === "invoice" ? "On the monthly statement" : (fee?.collection ?? "")) : "";
    const received = !paid ? "" : swap && swapSettled.has(swap.status) ? decimal(swap.amountOut, swapPlaces) : p.amount;
    const link = swap
      ? `https://explorer.near-intents.org/transactions/${swap.depositAddress}`
      : claim
        ? (transactionExplorer(claim.network, claim.txHash) ?? claim.txHash)
        : "";
    return [
      p.createdAt.toISOString().replace("T", " ").slice(0, 19),
      p.id,
      p.reference,
      status(p, now),
      p.amount,
      symbol,
      p.asset.network ? networkName(p.asset.network) : "",
      paidWith,
      feeText,
      collected,
      received,
      refunds.join("; "),
      link,
    ];
  });
  return [[...exportColumns], ...rows].map((r) => r.map((c) => csvCell(String(c))).join(",")).join("\r\n") + "\r\n";
}

export async function paymentsCsv(scope: { orgId: string; environment: string }, from: Date, to: Date, now = new Date()) {
  const payments = await db.paymentIntent.findMany({
    where: { ...scope, createdAt: { gte: from, lt: to } },
    select: { id: true, reference: true, amount: true, asset: true, precision: true, state: true, selectedMethod: true, createdAt: true, expiresAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1001,
  });
  if (payments.length > 1000) throw new PortalError("EXPORT_TOO_LARGE_NARROW_DATE_RANGE", 413);
  const ids = payments.map((p) => p.id);
  const [swaps, attempts, fees, intentsRefunds] = await Promise.all([
    db.crossChainPayment.findMany({
      where: { intentId: { in: ids } },
      select: { intentId: true, status: true, originSymbol: true, originChain: true, amountInFormatted: true, amountOut: true, appFeeMinor: true, destinationAsset: true, depositAddress: true, createdAt: true },
    }),
    db.paymentAttempt.findMany({ where: { intentId: { in: ids } }, select: { id: true, intentId: true } }),
    db.paymentFee.findMany({ where: { intentId: { in: ids } }, select: { intentId: true, amountMinor: true, precision: true, currency: true, collection: true } }),
    db.intentsPayout.findMany({
      where: { ...scope, purpose: "refund", status: "SUCCESS", intentId: { in: ids } },
      select: { intentId: true, amountOutFormatted: true, destinationSymbol: true, destinationChain: true },
    }),
  ]);
  const attemptIntent = new Map(attempts.map((a) => [a.id, a.intentId]));
  const [claims, platformRefunds] = await Promise.all([
    db.depositClaim.findMany({ where: { attemptId: { in: [...attemptIntent.keys()] } }, select: { attemptId: true, network: true, txHash: true } }),
    db.platformRefund.findMany({ where: { ...scope, state: "Succeeded", attemptId: { in: [...attemptIntent.keys()] } }, select: { attemptId: true, asset: true, amountMinor: true } }),
  ]);
  const precision = new Map(payments.map((p) => [p.id, p.precision]));
  return exportCsv(
    payments.map((p) => ({ ...p, asset: p.asset as ExportPayment["asset"] })),
    {
      swaps,
      fees: fees.map((f) => ({ ...f, amountMinor: f.amountMinor.toFixed(0) })),
      claims: claims.map((c) => ({ intentId: attemptIntent.get(c.attemptId)!, network: c.network, txHash: c.txHash })),
      refunds: [
        ...intentsRefunds
          .filter((r): r is typeof r & { intentId: string } => !!r.intentId)
          .map((r) => ({ intentId: r.intentId, text: `${r.amountOutFormatted} ${r.destinationSymbol} on ${chainNames[r.destinationChain] ?? r.destinationChain}` })),
        ...platformRefunds.map((r) => {
          const intentId = attemptIntent.get(r.attemptId)!;
          return { intentId, text: `${decimal(r.amountMinor.toFixed(0), precision.get(intentId) ?? 2)} ${r.asset}` };
        }),
      ],
    },
    now,
  );
}

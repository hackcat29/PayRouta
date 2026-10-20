import { detailTable, esc, greeting, renderBaseTemplate, stripHtmlToText } from "./base";

export interface TransactionReceiptProps {
  intentId: string;
  amount: string;
  currency: string;
  recipientName?: string;
  merchantName?: string;
  method: string;
  provider: string;
  status: "succeeded" | "failed" | "routed" | "refunded";
  timestamp: string;
  txHashOrRef?: string;
  siteUrl?: string;
}

const statusLabel = {
  succeeded: "Paid",
  failed: "Failed",
  routed: "Processing",
  refunded: "Refunded",
} as const;

export function renderTransactionReceiptEmail(props: TransactionReceiptProps): {
  subject: string;
  html: string;
  text: string;
} {
  const { merchantName = "the merchant", status } = props;
  const paid = status === "succeeded";
  const subject = paid
    ? `Payment Receipt for ${props.currency} ${props.amount} to ${merchantName}`
    : `Payment ${statusLabel[status].toLowerCase()}: ${props.currency} ${props.amount} to ${merchantName}`;

  const bodyContent = `<p>${greeting(props.recipientName)}</p>
<p>${paid ? "Thanks for your payment to" : "An update on your payment to"} <strong>${esc(merchantName)}</strong>.</p>
${detailTable([
  ["Amount", `${props.currency} ${props.amount}`],
  ["Status", statusLabel[status]],
  ["Paid with", props.method],
  ["Payment ID", props.intentId],
  ["Reference", props.txHashOrRef],
  ["Date", props.timestamp],
])}
<p style="font-size:13px;color:#6b7a80;">Questions about this payment? Contact ${esc(merchantName)} directly. PayRouta processes payments on their behalf.</p>`;

  const html = renderBaseTemplate({
    previewText: `${props.currency} ${props.amount} to ${merchantName}: ${statusLabel[status]}.`,
    headline: paid ? "Payment received" : "Payment update",
    bodyContent,
  });
  return { subject, html, text: stripHtmlToText(html) };
}

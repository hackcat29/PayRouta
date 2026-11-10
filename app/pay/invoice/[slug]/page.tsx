// A subscription invoice: what it's for and a Pay button that opens (or
// reopens) this invoice's checkout. Checkout returns here once paid.
import { MerchantContact, MerchantMark } from "@/components/merchant-mark";
import { VerifiedTick } from "@/components/verified-tick";
import { notFound } from "next/navigation";
import { formatMoney, publicInvoice } from "@/lib/subscriptions/service";
import "../../pay.css";

export const dynamic = "force-dynamic";

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const invoice = await publicInvoice((await params).slug);
  return {
    title: invoice ? `Invoice ${invoice.number} · ${invoice.merchant}` : "Invoice",
    robots: { index: false, follow: false },
    // AI agents: the invoice's terms as JSON (402 Payment Required).
    ...(invoice ? { alternates: { types: { "application/json": `/api/agent/v1/invoices/${invoice.slug}` } } } : {}),
    referrer: "same-origin" as const,
  };
}

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const invoice = await publicInvoice(slug);
  if (!invoice) notFound();
  const failed = (await searchParams).error === "1";
  const total = formatMoney(invoice.amount, invoice.currency);
  const paid = invoice.state === "Paid";
  return (
    <main className="pl">
      {invoice.environment === "sandbox" && <div className="pl-test">Test mode · no real money moves</div>}
      <form className="pl-card" method="post" action={`/api/pay/invoice/${invoice.slug}`}>
        <p className="pl-merchant">
          <MerchantMark className="pl-avatar" name={invoice.merchant} logo={invoice.logo} />
          {invoice.merchant}
          {invoice.verified && <VerifiedTick />}
        </p>
        <h1 className="pl-title">{invoice.plan}</h1>
        <p className="pl-desc">
          {day(invoice.periodStart)} – {day(invoice.periodEnd)}
        </p>
        <dl className="pl-lines">
          {invoice.lines.map((l, i) => (
            <div key={i}>
              <dt>
                {l.description}
                {l.quantity !== "1" && <small> × {l.quantity}</small>}
              </dt>
              <dd>{formatMoney(l.amount, invoice.currency)}</dd>
            </div>
          ))}
        </dl>
        <p className="pl-amount">{total}</p>
        {paid ? (
          <p className="pl-paid" role="status">
            Paid
          </p>
        ) : (
          <>
            {failed && (
              <p className="pl-error" role="alert">
                We couldn&apos;t open the checkout. Please try again.
              </p>
            )}
            <button className="pl-pay" type="submit">
              Pay {total}
            </button>
            <p className="pl-desc">Due {day(invoice.dueAt)}</p>
          </>
        )}
        <MerchantContact className="pl-contact" name={invoice.merchant} website={invoice.website} supportEmail={invoice.supportEmail} />
        <p className="pl-foot">
          Secured by <strong>PayRouta</strong>
        </p>
      </form>
    </main>
  );
}

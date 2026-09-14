import {
  Globe2,
  Landmark,
  Smartphone,
  CreditCard,
  Coins,
  Route,
  Wallet,
  Zap,
  Receipt,
  CalendarClock,
  QrCode,
  TrendingUp,
} from "lucide-react";
import { ButtonLink, ClosingCTA, TextLink, Flow } from "@/components/shared";
import { RoutingDemo } from "@/components/routing-demo";
import { MerchantIntegrationVisual } from "@/components/merchant-integration-visual";
import { CodeBlock } from "@/components/code-block";
import { intentExample, trustedOrigin, paths } from "@/lib/site-config";
export const metadata = {
  alternates: trustedOrigin() ? { canonical: "/" } : undefined,
};
const methods = [
  ["Instant bank transfers (iDEAL, FedNow, Pix, UPI, NIP)", Zap],
  ["Digital wallets (Apple Pay, Google Pay, PayPal, OPay, PalmPay, Alipay)", Wallet],
  ["Cards & domestic schemes (Visa, Mastercard, Verve, CB, JCB, RuPay)", CreditCard],
  ["Direct debit & wire transfers (ACH, SEPA, Bacs, Wire)", Landmark],
  ["Cash vouchers (OXXO, Konbini, Paysafecard, Boleto)", Receipt],
  ["Buy now, pay later & installments (Klarna, Affirm, Tabby)", CalendarClock],
  ["Mobile money & phone bills (M-Pesa, MTN MoMo, Airtel)", Smartphone],
  ["Stablecoins (Circle USDC on Avalanche, Base, Solana)", Coins],
  ["Crypto apps & exchanges (Binance Pay, Coinbase)", QrCode],
  ["Real-World Assets (RWAs) (Ondo, Paxos Gold, T-Bills)", TrendingUp],
] as const;
const faq = [
  [
    "Who chooses the payment method?",
    "The customer does. PayRouta first determines which methods are available, then compares providers only within the method the customer selects.",
  ],
  [
    "Can any merchant accept payments from any country?",
    "Yes. PayRouta is designed so merchants anywhere can accept payments from customers worldwide. That includes instant bank transfers across every continent (like iDEAL and SEPA in Europe, FedNow and RTP in the US, Interac in Canada, Pix in Brazil, UPI in India, PayNow in Singapore, and NIP in Nigeria), digital wallets (Apple Pay, Google Pay, PayPal, OPay, PalmPay, Alipay), domestic and global card schemes (Visa, Mastercard, Verve, CB, JCB, RuPay), direct debits and wire transfers (ACH, SEPA Direct Debit, Bacs), cash vouchers (OXXO, Konbini, Boleto), buy now pay later & installments (Klarna, Affirm, Tabby), mobile money (M-Pesa, MTN MoMo), stablecoins (Circle USDC on Avalanche, Base, Solana, and Ethereum), crypto apps (Binance Pay), and Real-World Assets (RWAs like Ondo USDY and tokenized commodities).",
  ],
  [
    "How does the dynamic payment explorer determine which payment methods and providers are available?",
    "PayRouta evaluates the customer’s country, currency, order size, provider integrations, and live operational status. The Payment Explorer automatically detects the visitor’s region and displays all available payment categories with their specific local rails, confirmation speeds, and settlement options. Provider selection and failover routing run dynamically in the backend without exposing raw provider details to customers.",
  ],
  [
    "What is the difference between instant bank transfers and direct debits?",
    "Instant bank transfers (such as iDEAL in the Netherlands, FedNow / RTP in the US, Blik in Poland, Swish in Sweden, PayNow in Singapore, Pix in Brazil, UPI in India, and NIP in Nigeria) move money directly between bank accounts within seconds, 24/7. Direct debits and wire transfers (such as ACH in the US, SEPA Direct Debit in Europe, Bacs in the UK, and Pre-Authorized Debits in Canada) are typically used for recurring subscriptions or large invoices and settle through bank clearing batches over 1 to 3 business days.",
  ],
  [
    "Which category do PayPal, Cash App, Google Pay, OPay, and PalmPay belong to?",
    "They belong to Digital Wallets. This category includes global wallets like Apple Pay, Google Pay, and PayPal, prominent African wallets like OPay and PalmPay in Nigeria, Asian wallets like Alipay, WeChat Pay, PayPay in Japan, and GCash in the Philippines, and Americas wallets like Cash App, Venmo, and Mercado Pago. They allow customers to pay with one tap using linked bank accounts, cards, or stored wallet balances.",
  ],
  [
    "How do crypto app payments like Binance Pay and Coinbase work?",
    "Customers can pay directly using balances in supported crypto apps or exchange wallets, while merchants can choose to receive local bank deposits or stablecoins.",
  ],
  [
    "What are Real-World Asset (RWA) payments?",
    "Real-World Assets (RWAs) are digital tokens representing physical or traditional financial assets on a blockchain. Customers can pay using supported RWAs—such as tokenized US Treasuries, yield coins (like Ondo USDY), or tokenized commodities (like Paxos Gold). Merchants can choose to receive settlement in supported RWAs or convert to local bank currency.",
  ],
  [
    "Does PayRouta replace payment providers?",
    "No. Providers process the payments they support. PayRouta coordinates availability checks, provider routing, transaction status, and settlement reconciliation.",
  ],
  [
    "What determines availability?",
    "Location is one input. Currency, provider capability, transaction limits, applicable compliance requirements, liquidity, and real-time operating status also matter.",
  ],
  [
    "Is settlement fixed, or can merchants choose how they get settled?",
    "Settlement is not fixed. Merchants can choose to be settled in any preferred method that is available to them—including local bank accounts, multi-currency accounts, stablecoins, crypto exchange balances, or Real-World Assets (RWAs)—independent of how the customer chose to pay.",
  ],
  [
    "Is pay-in the same as settlement?",
    "Pay-in is how the customer pays. Settlement is what the merchant receives. Settlement is not fixed: merchants choose their preferred available settlement method, and if it differs from the customer’s payment method or currency, a conversion happens as part of the payment flow.",
  ],
  [
    "How do I get early access?",
    "Use the merchant or provider enquiry form to share your requirements. Scope, coverage, and pilot readiness need to be confirmed together.",
  ],
];
export default function Home() {
  return (
    <>
      <section className="home-hero dark">
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="early-access">Early access · In development</p>
            <h1>
              Any merchant. Any country.
              <br />
              <span>Every way</span> your customers pay.
            </h1>
            <p>
              Connect instant bank transfers, digital wallets, cards, direct debits,
              cash vouchers, installments, mobile money, stablecoins, crypto apps,
              and Real-World Assets (RWAs) through one integration. Show customers
              the methods available to them, then route their chosen method through
              an eligible provider.
            </p>
            <div className="actions">
              <ButtonLink href="/contact?intent=merchant">
                Request access
              </ButtonLink>
              <ButtonLink href={paths.docs} secondary>
                Explore the docs
              </ButtonLink>
            </div>
          </div>
          <RoutingDemo />
        </div>
      </section>
      <section className="section">
        <div className="container split">
          <div>
            <h2>Separate providers mean separate integration work.</h2>
            <p>
              Every new payment method can mean another API, another set of
              provider rules, and another reconciliation process.
              With PayRouta, your business integrates once to accept any payment
              method your customers use worldwide—and receives automated settlement
              in whichever available method fits your treasury, from local bank
              deposits and fiat currencies to stablecoins and Real-World Assets.
            </p>
            <TextLink href={paths.paymentFlow}>See the payment flow</TextLink>
          </div>
          <MerchantIntegrationVisual />
        </div>
      </section>
      <section className="section cloud">
        <div className="container">
          <div className="section-heading">
            <div>
              <h2>Availability, customer choice, then routing.</h2>
            </div>
            <TextLink href={paths.paymentFlow}>
              Follow the payment flow
            </TextLink>
          </div>
          <div className="decision-grid">
            {[
              [
                "01",
                "What’s available?",
                "PayRouta checks which methods can serve the customer and merchant for this transaction.",
              ],
              [
                "02",
                "How do you want to pay?",
                "The customer decides how to pay from the available methods.",
              ],
              [
                "03",
                "Who can execute it?",
                "PayRouta compares eligible providers within the customer’s selected method, using the merchant’s routing preferences.",
              ],
            ].map(([n, h, p]) => (
              <article key={n}>
                <h3>{h}</h3>
                <p>{p}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <div className="section-heading">
            <div>
              <h2>Payment methods your customers recognize.</h2>
            </div>
          </div>
          <div className="method-grid">
            {methods.map(([name, Icon]) => (
              <div key={name}>
                <Icon size={27} />
                <h3>{name}</h3>
              </div>
            ))}
          </div>
          <TextLink href={paths.paymentMethods}>
            Explore payment methods
          </TextLink>
        </div>
      </section>
      <section className="section audience-section">
        <div className="container audience-grid">
          <article>
            <h2>For merchants: one payment workflow.</h2>
            <p>
              One integration to display the right payment options, route to
              eligible providers, set your payout currency, and receive clear
              transaction updates.
            </p>
            <TextLink href={paths.merchants}>
              Build your payment experience
            </TextLink>
            <Flow
              steps={["Your checkout", "Customer choice", "Settlement updates"]}
            />
          </article>
          <article>
            <h2>For providers: connect what you can execute.</h2>
            <p>
              Declare what you can execute. Participate in transaction flow
              where your methods, currencies, limits, and current availability
              match.
            </p>
            <TextLink href={paths.providers}>
              Explore provider participation
            </TextLink>
          </article>
        </div>
      </section>
      <section className="section">
        <div className="container split">
          <div>
            <h2>Start with a payment intent.</h2>
            <p>
              Start with a payment intent: what’s owed, which methods you
              accept, and how you prefer to settle. Keep provider-specific logic
              behind a shared interface.
            </p>
            <p className="note">
              Proposed interface preview. A public API and SDK are not yet
              available.
            </p>
            <ButtonLink href={paths.developers}>
              Explore the developer workflow
            </ButtonLink>
          </div>
          <CodeBlock code={intentExample} />
        </div>
      </section>
      <section className="section cloud">
        <div className="container">
          <h2>Payment needs across different businesses.</h2>
          <div className="usecase-grid">
            {[
              [
                Globe2,
                "Domestic bank transfers worldwide",
                "Accept leading domestic bank transfers—from iDEAL in Europe and FedNow in the US to Pix in Brazil, PayNow in Singapore, and NIP in Nigeria—with instant confirmation and direct bank clearing.",
              ],
              [
                Wallet,
                "Digital wallets & super-apps",
                "Let customers check out with one tap using Apple Pay, Google Pay, OPay and PalmPay in Nigeria, Alipay and WeChat Pay in China, or Mercado Pago in Latin America.",
              ],
              [
                QrCode,
                "Crypto app checkouts",
                "Let customers pay directly from accounts on supported exchanges and crypto apps like Binance Pay.",
              ],
              [
                TrendingUp,
                "Real-World Asset (RWA) payments",
                "Accept payments in supported tokenized assets like Ondo USDY or tokenized gold, with settlement in any available method you prefer.",
              ],
              [
                Receipt,
                "Cash vouchers at retail stores",
                "Serve buyers who prefer paying cash at convenience stores using barcodes like OXXO, Konbini, Boleto, and Fawry.",
              ],
              [
                Route,
                "Automatic backup providers",
                "If a payment provider is unavailable before checkout starts, switch to another provider for that same payment method.",
              ],
            ].map(([Icon, title, copy]) => {
              const I = Icon as typeof Globe2;
              return (
                <article key={String(title)}>
                  <I />
                  <h3>{String(title)}</h3>
                  <p>{String(copy)}</p>
                  <TextLink href={paths.useCases}>Explore scenario</TextLink>
                </article>
              );
            })}
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container faq-layout">
          <div>
            <h2>Questions about PayRouta.</h2>
          </div>
          <div className="faq">
            {faq.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      <ClosingCTA />
    </>
  );
}

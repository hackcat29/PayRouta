# Pay with credit

Most payment companies compete on how many ways a customer can pay. In much of the world the harder problem is affordability: few people have a credit card, so a phone, a laptop or a year of software is out of reach in one payment. PayRouta puts credit inside the checkout as one more way to pay.

> **Status.** Built, and testable end to end in sandbox with a test lender. Live credit opens country by country as licensed lenders join PayRouta. No lender is live yet; this page will list them as they are.

## How it works

1. You offer `bnpl` ("Pay with credit") in your checkout's `methods`, alongside cards, digital wallets, bank transfer, mobile money and the rest.
2. The customer chooses **Pay with credit**. Checkout shows every plan the lenders in the customer's country offer **for this exact amount**: how many payments, how often, what is due today, the total repaid, the cost of credit and the APR where the lender quotes one, and the lender's name and terms.
3. The customer picks a plan and continues to the lender, which checks who they are and approves (or declines) them. A decline leaves the checkout open for another method.
4. Once the lender approves, the payment is confirmed like any other: you get `payment.confirmed`, and the lender pays you the full price less its merchant fee. The customer repays the lender.

**Who carries the risk:** the lender. A missed repayment is between the customer and the lender; it never comes back to you, and PayRouta never lends.

**Fees:** PayRouta's usual fee for partner-processed payments (see [pricing](billing.md)), plus the lender's merchant fee, which each lender sets and PayRouta shows you before you enable it.

## Selling subscriptions on credit

Subscriptions on credit work the way lenders fund them: the customer takes an annual (or other term) plan and repays the lender monthly, and you are paid the whole term upfront. Create the checkout for the term price, for example a 12-month plan, and fulfil the term when the payment is confirmed.

## What customers see

- The plans are the lender's offer, priced by the lender for this payment. PayRouta does not set interest or fees.
- The lender is named before the customer agrees, because the customer enters a credit agreement with the lender, not with you or PayRouta.
- Only plans the lender offers in the customer's country are shown (from `payerCountry` on the checkout). With no lender there, credit isn't shown.

## Test in sandbox

Ask PayRouta to connect your sandbox business to **Sandbox Credit (test lender)**. Its plans, for any amount from 10.00 to 5,000,000.00 in the payment currency:

| Plan | Payments | Cost of credit |
| --- | --- | --- |
| `sbxc-p4` | 4, every two weeks, first one today | none |
| `sbxc-pl30` | 1, in 30 days | none |
| `sbxc-m3` | 3, monthly | 4.5% |
| `sbxc-m6` | 6, monthly (from 50,000.00) | 12% |

Approve the test credit on the checkout to confirm the payment. A `reference` containing `[decline]` is declined by the test lender, so you can test that path. No credit check runs and nobody owes anything.

## Continental Self-Serve BNPL & Open-Banking Switches

PayRouta includes five continental BNPL & Open-Banking platform modules (`lib/treasury/platforms/`) alongside the Global Credit Intent state machine (`lib/payments/credit-intents.ts` and `POST /api/v1/credit-intents`):

| Continent | Platform Module | Primary BNPL Networks | Open Banking / Card Scheme Backdoor |
| --- | --- | --- | --- |
| **Europe** (`GB`, `EU`) | `adyen-klarna-bnpl` | Klarna, Clearpay, PayPal Credit, Alma | Tink (Visa Company) Open Banking PSD2 overdraft mandates |
| **Latin America** (`BR`, `MX`, `CO`, `AR`, `CL`) | `mercadopago-bnpl` | Mercado Crédito, Kueski Pay, Addi, NuPay | Belvo Open Finance neobank credit draw |
| **Africa** (`NG`, `KE`, `GH`, `ZA`) | `migo-bnpl` | Migo Credit, Carbon POS, CredPal, CDL | Mono Open Banking / Wallet Relay (OPay, FairMoney, Kuda) |
| **Asia-Pacific** (`ID`, `SG`, `MY`, `PH`, `TH`, `IN`, `AU`) | `xendit-bnpl` | Kredivo, Akulaku, Atome, Grab PayLater | NPCI UPI Credit Line (RuPay Credit on UPI) |

All credit intents progress through a 4-stage asynchronous state machine (`checkout.initiated` -> `credit.pending_approval` -> `credit.disbursed` -> `payment.succeeded`) so long-running credit underwriting and open-banking mandates never fail due to standard 30-second card timeouts.

## For lenders: the credit partner contract

Licensed lenders and consumer-credit providers connect as PayRouta platform modules (`lib/treasury/platforms`). A credit module:

- declares `methods: ["bnpl"]` and a `credit` disclosure: legal lender name, terms URL, and the payer countries it lends to;
- answers `creditOffers({ amount, precision, currency, payerCountry })` with the plans it offers for that amount, using the shared arithmetic in `lib/treasury/credit.ts`, so plans read the same from every lender: instalments, interval, due today, each instalment, total, cost of credit and APR;
- accepts `createPayment` with `credit: { offerId }`, re-prices the plan, and refuses if it no longer offers it;
- returns the customer's approval step as a redirect to the lender's own pages, reports approval through `paymentStatus`, and reports when it has paid the merchant through `fundsAvailability`.

Credit and repayment risk, affordability checks and consumer-credit disclosures are the lender's, under its licence. To become a credit partner, request access on the [partners page](https://payrouta.com/partners#request) and choose "Lender / consumer-credit provider".

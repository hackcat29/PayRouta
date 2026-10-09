# Klarna

> **Implementation status:** Provider code path: stripe, adyen. Not live-qualified by code alone. Merchant account enablement, credentials and sandbox qualification are required. See [current coverage](provider-coverage.md).

**Category**: [Buy Now, Pay Later](providers/bnpl/README.md)  
**Provider**: Klarna Bank AB  
**Method ID**: `bnpl`  
**Integration Mode**: `NATIVE` / `STANDARD`

Klarna is a global payments and shopping service powering flexible payment solutions for over 150 million active shoppers across Europe and North America.

---

## Consumer Payment Options

- **Pay in 4**: 4 interest-free bi-weekly installments automatically debited from the customer's card.
- **Pay in 30 Days (Klarna Rechnung)**: Popular in Germany, Austria, and the Nordics; payment due 30 days after goods dispatch.
- **Financing**: Monthly financing for larger cart sizes ($250 to $10,000).

---

## Direct Merchant Settlement

Klarna remits funds upfront according to your merchant payout schedule regardless of whether the customer pays on time.

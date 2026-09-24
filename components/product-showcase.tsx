"use client";
import { useState } from "react";
import Link from "next/link";
import {
  CreditCard,
  Building2,
  Smartphone,
  Coins,
  CheckCircle2,
  Copy,
  Check,
  ArrowRight,
  TrendingUp,
  Terminal,
  Activity,
} from "lucide-react";

export function ProductShowcase() {
  const [activeTab, setActiveTab] = useState<"checkout" | "merchant" | "code">("checkout");
  const [selectedMethod, setSelectedMethod] = useState<"bank" | "card" | "mobile" | "usdc">("bank");
  const [paid, setPaid] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeCodeLang, setActiveCodeLang] = useState<"node" | "python">("node");
  const [codeCopied, setCodeCopied] = useState(false);

  function copyText(text: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function copyCode(text: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  }

  const nodeCode = `import { PayRouta } from "@payrouta/server";

const payrouta = new PayRouta({
  apiKey: process.env.PAYROUTA_SECRET_KEY,
});

// Create a normalized payment intent
const intent = await payrouta.paymentIntents.create({
  amount: "25000.00",
  currency: "NGN",
  customer: { email: "customer@example.com" },
  acceptedMethods: ["bank_transfer", "card", "mobile_money", "stablecoin"],
  settlementCurrency: "NGN",
});

// Customer completes checkout with automatic failover
console.log("Checkout URL:", intent.checkoutUrl);`;

  const pythonCode = `from payrouta import PayRouta
import os

client = PayRouta(api_key=os.environ["PAYROUTA_SECRET_KEY"])

# Create a normalized payment intent
intent = client.payment_intents.create(
    amount="25000.00",
    currency="NGN",
    customer={"email": "customer@example.com"},
    accepted_methods=["bank_transfer", "card", "mobile_money", "stablecoin"],
    settlement_currency="NGN"
)

# Customer completes checkout with automatic failover
print("Checkout URL:", intent.checkout_url)`;

  return (
    <div className="product-showcase-card" aria-label="PayRouta Product Showcase">
      {/* Top Showcase Navigation Bar */}
      <div className="showcase-nav-header">
        <div className="showcase-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "checkout"}
            className={`showcase-tab ${activeTab === "checkout" ? "active" : ""}`}
            onClick={() => setActiveTab("checkout")}
          >
            <CreditCard size={14} />
            <span>Customer Checkout</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "merchant"}
            className={`showcase-tab ${activeTab === "merchant" ? "active" : ""}`}
            onClick={() => setActiveTab("merchant")}
          >
            <Activity size={14} />
            <span>Merchant Console</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "code"}
            className={`showcase-tab ${activeTab === "code" ? "active" : ""}`}
            onClick={() => setActiveTab("code")}
          >
            <Terminal size={14} />
            <span>Developer SDK</span>
          </button>
        </div>
        <div className="showcase-badge">
          <span className="live-dot" /> Live Interactive Preview
        </div>
      </div>

      {/* TAB 1: CUSTOMER CHECKOUT */}
      {activeTab === "checkout" && (
        <div className="showcase-body checkout-preview">
          <div className="checkout-widget-frame">
            <div className="checkout-summary-bar">
              <div>
                <span className="checkout-store-name">Acme Store</span>
                <h3 className="checkout-amount-display">₦25,000.00 <small>NGN</small></h3>
              </div>
              <span className="checkout-order-pill">Order #PR-8942</span>
            </div>

            {paid ? (
              <div className="checkout-success-view">
                <CheckCircle2 size={48} className="success-icon" />
                <h4>Payment Confirmed</h4>
                <p>Your payment of ₦25,000.00 was verified instantly.</p>
                <div className="success-details-box">
                  <div className="detail-row">
                    <span>Reference</span>
                    <strong>PR-8942-TXN</strong>
                  </div>
                  <div className="detail-row">
                    <span>Settlement</span>
                    <strong>Unified Treasury Account</strong>
                  </div>
                </div>
                <button
                  type="button"
                  className="reset-demo-btn"
                  onClick={() => setPaid(false)}
                >
                  Test Another Payment
                </button>
              </div>
            ) : (
              <div className="checkout-active-methods">
                <p className="checkout-prompt">How would you like to pay?</p>
                <div className="checkout-methods-grid">
                  <button
                    type="button"
                    className={`method-select-btn ${selectedMethod === "bank" ? "active" : ""}`}
                    onClick={() => setSelectedMethod("bank")}
                  >
                    <Building2 size={16} />
                    <span>Bank Transfer</span>
                  </button>
                  <button
                    type="button"
                    className={`method-select-btn ${selectedMethod === "card" ? "active" : ""}`}
                    onClick={() => setSelectedMethod("card")}
                  >
                    <CreditCard size={16} />
                    <span>Card</span>
                  </button>
                  <button
                    type="button"
                    className={`method-select-btn ${selectedMethod === "mobile" ? "active" : ""}`}
                    onClick={() => setSelectedMethod("mobile")}
                  >
                    <Smartphone size={16} />
                    <span>Mobile Money</span>
                  </button>
                  <button
                    type="button"
                    className={`method-select-btn ${selectedMethod === "usdc" ? "active" : ""}`}
                    onClick={() => setSelectedMethod("usdc")}
                  >
                    <Coins size={16} />
                    <span>USDC (Base)</span>
                  </button>
                </div>

                {/* Method Details */}
                <div className="method-instruction-panel">
                  {selectedMethod === "bank" && (
                    <div className="bank-transfer-details">
                      <div className="bank-meta">
                        <span>Bank Name</span>
                        <strong>Wema Bank</strong>
                      </div>
                      <div className="bank-meta">
                        <span>Account Number</span>
                        <div className="copyable-account">
                          <strong>0123456789</strong>
                          <button
                            type="button"
                            className="copy-btn"
                            onClick={() => copyText("0123456789")}
                          >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </div>
                      <p className="instant-notice">
                        ⚡ Automatic transfer confirmation via NIP instant clearing.
                      </p>
                    </div>
                  )}

                  {selectedMethod === "card" && (
                    <div className="card-input-mock">
                      <div className="mock-input">
                        <span>Card Number</span>
                        <code>4084 0000 0000 1234</code>
                      </div>
                      <div className="mock-input-row">
                        <div className="mock-input">
                          <span>Expires</span>
                          <code>12/28</code>
                        </div>
                        <div className="mock-input">
                          <span>CVV</span>
                          <code>•••</code>
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedMethod === "mobile" && (
                    <div className="mobile-money-mock">
                      <div className="mock-input">
                        <span>Phone Number (MTN / M-Pesa)</span>
                        <code>+234 803 000 1234</code>
                      </div>
                      <p className="instant-notice">You will receive an instant payment prompt on your phone.</p>
                    </div>
                  )}

                  {selectedMethod === "usdc" && (
                    <div className="stablecoin-mock">
                      <div className="mock-input">
                        <span>Deposit 25 USDC on Base</span>
                        <code>0x71C...49A2</code>
                      </div>
                      <p className="instant-notice">Instant on-chain confirmation with zero gas volatility.</p>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="checkout-primary-cta"
                  onClick={() => setPaid(true)}
                >
                  Pay ₦25,000.00
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
          <div className="checkout-footer-note">
            <span>Customer never sees provider hops or failovers. They experience a single uninterrupted payment flow.</span>
          </div>
        </div>
      )}

      {/* TAB 2: MERCHANT CONSOLE */}
      {activeTab === "merchant" && (
        <div className="showcase-body merchant-preview">
          <div className="merchant-stats-row">
            <div className="stat-card">
              <span className="stat-label">Total Volume (30d)</span>
              <strong className="stat-val">₦4,850,000</strong>
              <span className="stat-delta positive">
                <TrendingUp size={12} /> +18.4%
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Network Success Rate</span>
              <strong className="stat-val">99.4%</strong>
              <span className="stat-sub">Across 3 providers</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Failovers Recovered</span>
              <strong className="stat-val">₦420,000</strong>
              <span className="stat-sub">14 transactions saved</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Next Settlement</span>
              <strong className="stat-val">₦1,240,000</strong>
              <span className="stat-sub">Today at 18:00 UTC</span>
            </div>
          </div>

          <div className="recent-tx-preview">
            <div className="table-header-line">
              <h4>Recent Live Transactions</h4>
              <Link href="/merchant" className="view-all-link">
                Open Merchant Dashboard →
              </Link>
            </div>
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Route / Execution</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>PR-9012</code></td>
                  <td>Bank Transfer</td>
                  <td><strong>₦45,000.00</strong></td>
                  <td><span className="route-tag">Monnify NIP</span></td>
                  <td><span className="status-pill confirmed">Confirmed</span></td>
                </tr>
                <tr>
                  <td><code>PR-9011</code></td>
                  <td>Card (Visa)</td>
                  <td><strong>₦12,500.00</strong></td>
                  <td><span className="route-tag failover">Paystack (Recovered)</span></td>
                  <td><span className="status-pill confirmed">Confirmed</span></td>
                </tr>
                <tr>
                  <td><code>PR-9010</code></td>
                  <td>USDC (Base)</td>
                  <td><strong>$150.00</strong></td>
                  <td><span className="route-tag">Alchemy Direct</span></td>
                  <td><span className="status-pill confirmed">Confirmed</span></td>
                </tr>
                <tr>
                  <td><code>PR-9009</code></td>
                  <td>Mobile Money</td>
                  <td><strong>₦8,000.00</strong></td>
                  <td><span className="route-tag">Flutterwave MoMo</span></td>
                  <td><span className="status-pill pending">Pending</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: DEVELOPER CODE */}
      {activeTab === "code" && (
        <div className="showcase-body code-preview">
          <div className="code-lang-selector">
            <div className="lang-buttons">
              <button
                type="button"
                className={`lang-btn ${activeCodeLang === "node" ? "active" : ""}`}
                onClick={() => setActiveCodeLang("node")}
              >
                TypeScript / Node.js
              </button>
              <button
                type="button"
                className={`lang-btn ${activeCodeLang === "python" ? "active" : ""}`}
                onClick={() => setActiveCodeLang("python")}
              >
                Python SDK
              </button>
            </div>
            <button
              type="button"
              className="copy-code-btn"
              onClick={() => copyCode(activeCodeLang === "node" ? nodeCode : pythonCode)}
            >
              {codeCopied ? <Check size={14} /> : <Copy size={14} />}
              {codeCopied ? "Copied" : "Copy Code"}
            </button>
          </div>

          <pre className="code-pre-block">
            <code>{activeCodeLang === "node" ? nodeCode : pythonCode}</code>
          </pre>

          <div className="code-meta-footer">
            <div className="sdk-installs">
              <span>Install SDK:</span>
              <code>{activeCodeLang === "node" ? "npm install @payrouta/server" : "pip install payrouta"}</code>
            </div>
            <Link href="/docs" className="read-docs-link">
              Explore API Reference →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

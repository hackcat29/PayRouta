"use client";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  Coins,
  Globe2,
  Landmark,
  Route,
  TrendingUp,
  Wallet,
  Zap,
  CreditCard,
  Smartphone,
  ShieldCheck,
  Receipt,
  CalendarClock,
  QrCode,
} from "lucide-react";

interface SettlementOption {
  id: string;
  name: string;
  category: string;
  icon: typeof Landmark;
  speed: string;
  summary: string;
  badgeText: string;
}

const SETTLEMENT_OPTIONS: SettlementOption[] = [
  {
    id: "bank",
    name: "Local bank account",
    category: "Instant Fiat",
    icon: Landmark,
    speed: "Instant / Same-day",
    summary: "Automated deposit into your corporate bank account (FedNow, NIP, FPS, Pix, SEPA).",
    badgeText: "Direct clearing",
  },
  {
    id: "stablecoins",
    name: "Stablecoins",
    category: "Circle USDC",
    icon: Coins,
    speed: "Sub-second finality",
    summary: "Direct payout in Circle USDC across supported chains including Avalanche, Base, Solana, and Ethereum.",
    badgeText: "On-chain clearing",
  },
  {
    id: "rwa",
    name: "Real-World Assets (RWAs)",
    category: "Yield-bearing",
    icon: TrendingUp,
    speed: "Auto-yielding",
    summary: "Receive earnings in Ondo USDY or tokenized T-bills with 5%+ short-term Treasury yield.",
    badgeText: "Treasury yield",
  },
  {
    id: "multi_currency",
    name: "Multi-currency treasury",
    category: "Cross-border",
    icon: Globe2,
    speed: "Instant allocation",
    summary: "Retain customer payments in original currencies (USD, EUR, GBP, NGN, BRL) without forced FX.",
    badgeText: "Multi-currency",
  },
  {
    id: "wallet",
    name: "Digital wallet & mobile",
    category: "Direct Wallet",
    icon: Wallet,
    speed: "Instant push",
    summary: "Direct credit to verified business wallet balances (OPay, PalmPay, PayPal, Chipper).",
    badgeText: "Instant wallet",
  },
];

const CUSTOMER_PAYIN_CATEGORIES = [
  { name: "Bank transfers", icon: Zap },
  { name: "Digital wallets", icon: Wallet },
  { name: "Cards & schemes", icon: CreditCard },
  { name: "Mobile money", icon: Smartphone },
  { name: "Direct debits", icon: Landmark },
  { name: "Stablecoins", icon: Coins },
  { name: "Crypto apps", icon: QrCode },
  { name: "Real-World Assets", icon: TrendingUp },
  { name: "Cash vouchers", icon: Receipt },
  { name: "Installments (BNPL)", icon: CalendarClock },
];

export function MerchantIntegrationVisual() {
  const [selectedSettlement, setSelectedSettlement] = useState<string>("bank");

  const currentOption =
    SETTLEMENT_OPTIONS.find((opt) => opt.id === selectedSettlement) ||
    SETTLEMENT_OPTIONS[0];

  const CurrentIcon = currentOption.icon;

  return (
    <div
      className="merchant-diagram-card"
      aria-label="Merchant payment acceptance and settlement flow"
    >
      <div className="merchant-diagram-header">
        <div>
          <span className="merchant-diagram-pill">MERCHANT ARCHITECTURE</span>
          <h3 className="merchant-diagram-title">
            Accept in any method. Settle in your choice.
          </h3>
        </div>
        <p className="merchant-diagram-caption">
          Customers pay with whatever rail is available to them. Your business receives settlement in whichever method fits your treasury.
        </p>
      </div>

      <div className="merchant-diagram-pipeline">
        {/* Column 1: Customer Pay-ins */}
        <div className="pipeline-col payin-col">
          <div className="pipeline-col-header">
            <span className="step-num">01</span>
            <div>
              <strong>Customers pay</strong>
              <small>Web, Mobile, POS &amp; USSD</small>
            </div>
          </div>
          <div className="payin-pills-list">
            {CUSTOMER_PAYIN_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <div className="payin-pill-item" key={cat.name}>
                  <Icon size={13} className="payin-icon" aria-hidden="true" />
                  <span>{cat.name}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Central Connector */}
        <div className="pipeline-connector-block">
          <div className="connector-line-glow" />
          <ArrowRight size={18} className="connector-arrow-icon" aria-hidden="true" />
        </div>

        {/* Column 2: PayRouta Core Engine */}
        <div className="pipeline-col core-col">
          <div className="core-hub-box">
            <div className="core-hub-badge">
              <Route size={15} aria-hidden="true" />
              <span>One unified API</span>
            </div>
            <strong className="core-hub-title">PayRouta Engine</strong>
            <ul className="core-capabilities-list">
              <li>
                <Check size={12} aria-hidden="true" /> Smart routing & failover
              </li>
              <li>
                <Check size={12} aria-hidden="true" /> Omnichannel: Web, POS &amp; USSD
              </li>
              <li>
                <Check size={12} aria-hidden="true" /> In-flight auto-conversion
              </li>
              <li>
                <Check size={12} aria-hidden="true" /> Real-time compliance check
              </li>
              <li>
                <Check size={12} aria-hidden="true" /> Single unified reconciliation
              </li>
            </ul>
          </div>
        </div>

        {/* Central Connector */}
        <div className="pipeline-connector-block">
          <div className="connector-line-glow" />
          <ArrowRight size={18} className="connector-arrow-icon" aria-hidden="true" />
        </div>

        {/* Column 3: Merchant Settlement */}
        <div className="pipeline-col settlement-col">
          <div className="pipeline-col-header">
            <span className="step-num">02</span>
            <div>
              <strong>Your business receives</strong>
              <small>Click preferred settlement</small>
            </div>
          </div>

          <div
            className="settlement-options-group"
            role="group"
            aria-label="Merchant settlement options"
          >
            {SETTLEMENT_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isSelected = selectedSettlement === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`settlement-option-btn ${isSelected ? "active" : ""}`}
                  onClick={() => setSelectedSettlement(opt.id)}
                  aria-pressed={isSelected}
                >
                  <div className="settlement-btn-left">
                    <Icon size={14} className="settlement-icon" aria-hidden="true" />
                    <div>
                      <span className="settlement-name">{opt.name}</span>
                      <small className="settlement-speed">{opt.speed}</small>
                    </div>
                  </div>
                  {isSelected && <Check size={14} className="settlement-check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Dynamic Resolution Banner */}
      <div className="settlement-resolution-banner">
        <div className="resolution-lead">
          <CurrentIcon size={16} className="resolution-icon" aria-hidden="true" />
          <span>
            Active merchant settlement: <strong>{currentOption.name}</strong>
          </span>
        </div>
        <p className="resolution-summary">
          {currentOption.summary} Customers can pay via web checkout, in-person POS terminals, or offline USSD across 10 global rails—PayRouta handles conversion and settles directly to this method.
        </p>
        <div className="resolution-meta">
          <span className="resolution-meta-item">
            <ShieldCheck size={13} aria-hidden="true" /> Settlement is never fixed
          </span>
          <span className="resolution-meta-item">
            <Check size={13} aria-hidden="true" /> Zero separate provider accounts required
          </span>
        </div>
      </div>
    </div>
  );
}

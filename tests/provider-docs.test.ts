import { test } from "node:test";
import assert from "node:assert/strict";
import { readDocs, findDoc, docEntries } from "../lib/docs";
import { generateStaticParams, generateMetadata } from "../app/docs/[[...slug]]/page";

test("provider docs: all docEntries load valid markdown content", () => {
  const docs = readDocs();
  assert.ok(docs.length >= docEntries.length);
  for (const doc of docs) {
    assert.ok(doc.slug, "Doc has slug");
    assert.ok(doc.title, `Doc ${doc.slug} has title`);
    assert.ok(doc.href.startsWith("/docs"), `Doc ${doc.slug} has valid href`);
    assert.ok(doc.content.length > 50, `Doc ${doc.slug} has substantial content`);
    assert.ok(doc.content.includes("# "), `Doc ${doc.slug} has heading`);
  }
});

test("provider docs: dedicated provider subroutes exist under their category", () => {
  // Category: Stablecoins
  const usdc = findDoc("providers/stablecoins/usdc");
  assert.ok(usdc, "Circle USDC doc exists under providers/stablecoins/usdc");
  assert.equal(usdc?.category, "Stablecoins");
  assert.ok(usdc?.content.includes("Base"), "USDC includes Base network");
  assert.ok(usdc?.content.includes("Ethereum"), "USDC includes Ethereum network");
  assert.ok(usdc?.content.includes("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"), "USDC includes Base contract");

  const usdt = findDoc("providers/stablecoins/usdt");
  assert.ok(usdt, "Tether USDT doc exists under providers/stablecoins/usdt");

  const eurc = findDoc("providers/stablecoins/eurc");
  assert.ok(eurc, "Circle EURC doc exists under providers/stablecoins/eurc");

  // Category: Cards
  const visa = findDoc("providers/cards/visa");
  assert.ok(visa, "Visa doc exists under providers/cards/visa");
  assert.equal(visa?.category, "Cards");

  // Category: Bank Transfer
  const paystack = findDoc("providers/bank-transfer/paystack");
  assert.ok(paystack, "Paystack doc exists under providers/bank-transfer/paystack");
  assert.equal(paystack?.category, "Bank Transfer");

  // Category: Mobile Money
  const mpesa = findDoc("providers/mobile-money/mpesa");
  assert.ok(mpesa, "M-Pesa doc exists under providers/mobile-money/mpesa");
  assert.equal(mpesa?.category, "Mobile Money");

  // Category: Crypto Apps
  const binancePay = findDoc("providers/crypto-apps/binance-pay");
  assert.ok(binancePay, "Binance Pay doc exists under providers/crypto-apps/binance-pay");
  assert.equal(binancePay?.category, "Crypto Apps");

  // Category: Real-World Assets
  const ondoUsdy = findDoc("providers/real-world-assets/ondo-usdy");
  assert.ok(ondoUsdy, "Ondo USDY doc exists under providers/real-world-assets/ondo-usdy");
  assert.equal(ondoUsdy?.category, "Real-World Assets");

  // Category: BNPL
  const klarna = findDoc("providers/bnpl/klarna");
  assert.ok(klarna, "Klarna doc exists under providers/bnpl/klarna");
  assert.equal(klarna?.category, "BNPL");
});

test("provider docs: global regional digital wallets exist with dedicated pages", () => {
  // Global & Big Tech
  const applePay = findDoc("providers/digital-wallets/apple-pay");
  assert.ok(applePay, "Apple Pay doc exists");
  assert.equal(applePay?.category, "Digital Wallets");

  const googlePay = findDoc("providers/digital-wallets/google-pay");
  assert.ok(googlePay, "Google Pay doc exists");

  const paypal = findDoc("providers/digital-wallets/paypal");
  assert.ok(paypal, "PayPal doc exists");

  // East Asia
  const alipay = findDoc("providers/digital-wallets/alipay");
  assert.ok(alipay, "Alipay doc exists");
  assert.ok(alipay?.content.includes("1 billion"), "Alipay mentions scale");

  const wechatPay = findDoc("providers/digital-wallets/wechat-pay");
  assert.ok(wechatPay, "WeChat Pay doc exists");

  const paypay = findDoc("providers/digital-wallets/paypay");
  assert.ok(paypay, "PayPay Japan doc exists");

  const kakaopay = findDoc("providers/digital-wallets/kakaopay");
  assert.ok(kakaopay, "KakaoPay South Korea doc exists");

  // Southeast Asia
  const grabpay = findDoc("providers/digital-wallets/grabpay");
  assert.ok(grabpay, "GrabPay doc exists");

  const gcash = findDoc("providers/digital-wallets/gcash");
  assert.ok(gcash, "GCash Philippines doc exists");

  const shopeepay = findDoc("providers/digital-wallets/shopeepay");
  assert.ok(shopeepay, "ShopeePay doc exists");

  // South Asia
  const phonepe = findDoc("providers/digital-wallets/phonepe");
  assert.ok(phonepe, "PhonePe India doc exists");

  const paytm = findDoc("providers/digital-wallets/paytm");
  assert.ok(paytm, "Paytm India doc exists");

  // Latin America
  const mercadoPago = findDoc("providers/digital-wallets/mercado-pago");
  assert.ok(mercadoPago, "Mercado Pago LatAm doc exists");

  const picpay = findDoc("providers/digital-wallets/picpay");
  assert.ok(picpay, "PicPay Brazil doc exists");

  // Europe & UK
  const revolutPay = findDoc("providers/digital-wallets/revolut-pay");
  assert.ok(revolutPay, "Revolut Pay UK/EU doc exists");

  const wero = findDoc("providers/digital-wallets/wero");
  assert.ok(wero, "Wero EPI Europe doc exists");

  // North America
  const cashApp = findDoc("providers/digital-wallets/cash-app");
  assert.ok(cashApp, "Cash App Pay US doc exists");

  const venmo = findDoc("providers/digital-wallets/venmo");
  assert.ok(venmo, "Venmo US doc exists");

  // Africa & Diaspora
  const opay = findDoc("providers/digital-wallets/opay");
  assert.ok(opay, "OPay Nigeria doc exists");

  const palmpay = findDoc("providers/digital-wallets/palmpay");
  assert.ok(palmpay, "PalmPay Nigeria doc exists");

  const chipperCash = findDoc("providers/digital-wallets/chipper-cash");
  assert.ok(chipperCash, "Chipper Cash Africa doc exists");
});

test("provider docs: category routes and subroute aliases work interchangeably", () => {
  // Alias support for USDC subroute under stablecoins: both paths resolve to USDC doc
  const directUsdc = findDoc("providers/stablecoins/usdc");
  const aliasUsdc = findDoc("stablecoins/usdc");
  assert.ok(directUsdc, "Direct slug resolves");
  assert.ok(aliasUsdc, "Alias slug resolves");
  assert.equal(directUsdc?.slug, aliasUsdc?.slug);
  assert.equal(directUsdc?.title, aliasUsdc?.title);

  // Digital wallet aliases
  const directAlipay = findDoc("providers/digital-wallets/alipay");
  const aliasAlipay = findDoc("digital-wallets/alipay");
  assert.ok(directAlipay, "Direct Alipay resolves");
  assert.ok(aliasAlipay, "Alias Alipay resolves");

  const directMercadoPago = findDoc("providers/digital-wallets/mercado-pago");
  const aliasMercadoPago = findDoc("digital-wallets/mercado-pago");
  assert.ok(directMercadoPago, "Direct Mercado Pago resolves");
  assert.ok(aliasMercadoPago, "Alias Mercado Pago resolves");

  // Category route
  const directCategory = findDoc("providers/stablecoins");
  const aliasCategory = findDoc("stablecoins");
  assert.ok(directCategory, "Direct category resolves");
  assert.ok(aliasCategory, "Alias category resolves");
  assert.equal(directCategory?.slug, aliasCategory?.slug);
});

test("provider docs: generateStaticParams and metadata generate clean paths", async () => {
  const staticParams = generateStaticParams();
  const paths = staticParams.map((p) => p.slug.join("/"));

  assert.ok(paths.includes("providers/stablecoins/usdc"));
  assert.ok(paths.includes("stablecoins/usdc"));
  assert.ok(paths.includes("providers/digital-wallets/alipay"));
  assert.ok(paths.includes("digital-wallets/alipay"));
  assert.ok(paths.includes("providers/digital-wallets/mercado-pago"));
  assert.ok(paths.includes("providers/digital-wallets/phonepe"));
  assert.ok(paths.includes("providers/digital-wallets/paypay"));

  const meta = await generateMetadata({
    params: Promise.resolve({ slug: ["providers", "digital-wallets", "alipay"] }),
  });
  assert.ok(meta.title?.includes("Alipay"));
});

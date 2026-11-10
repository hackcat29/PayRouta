// Shopify and WooCommerce, side by side: what the buyer sees in each store,
// how a merchant sets it up, and the way in (plugin download, Shopify
// connect). Below them, every other way in: links, button, SDKs, MCP, CLI.
import Link from "next/link";
import { ArrowUpRight, Bot, Braces, Download, Link2, MousePointerClick, SquareTerminal, type LucideIcon } from "lucide-react";
import { docsUrl, paths } from "@/lib/site-config";

const connectShopify = `${paths.signUp}?next=${encodeURIComponent("/merchant/developers/integrations")}`;

function WooCheckout() {
  return (
    <div className="sp-mock" aria-hidden="true">
      <div className="sp-mock-bar">
        <i />
        <i />
        <i />
        <span>shop.example/checkout</span>
      </div>
      <div className="sp-mock-body">
        <b className="sp-mock-h">Checkout</b>
        <span className="sp-line" />
        <span className="sp-line short" />
        <b className="sp-mock-label">Payment</b>
        <span className="sp-radio on">
          <i />
          PayRouta
          <em>
            <s>Card</s>
            <s>Bank</s>
            <s>Wallet</s>
            <s>Crypto</s>
          </em>
        </span>
        <span className="sp-radio">
          <i />
          Cash on delivery
        </span>
        <span className="sp-btn">Place order</span>
      </div>
    </div>
  );
}

function ShopifyThankYou() {
  return (
    <div className="sp-mock" aria-hidden="true">
      <div className="sp-mock-bar">
        <i />
        <i />
        <i />
        <span>store.myshopify.com/thank-you</span>
      </div>
      <div className="sp-mock-body">
        <b className="sp-mock-h">Thank you, Ada!</b>
        <span className="sp-order">
          Order #1042 <em>Payment pending</em>
        </span>
        <span className="sp-total">
          Total <b>$120.00</b>
        </span>
        <span className="sp-btn kola">Pay now</span>
        <span className="sp-line" />
        <span className="sp-line short" />
      </div>
    </div>
  );
}

const channels: { icon: LucideIcon; label: string; href: string }[] = [
  { icon: Link2, label: "Payment links", href: paths.paymentLinks },
  { icon: MousePointerClick, label: "Checkout button", href: paths.checkout },
  { icon: Braces, label: "Node and Python SDKs", href: docsUrl("sdks") },
  { icon: Bot, label: "MCP server", href: docsUrl("mcp") },
  { icon: SquareTerminal, label: "Command line", href: docsUrl("cli") },
  { icon: Bot, label: "Agent payments", href: paths.agents },
];

export function StorePlatforms({ withChannels = true }: { withChannels?: boolean }) {
  return (
    <>
      <div className="sp" data-reveal="stagger">
        <article className="sp-card sp-woo" data-tilt>
          <div className="sp-text">
            <h3>WooCommerce</h3>
            <ol className="sp-steps">
              <li>Upload the plugin</li>
              <li>Add your API key</li>
              <li>Take payments</li>
            </ol>
            <div className="sp-actions">
              <a className="mk-btn primary" href="/downloads/payrouta-checkout.zip" download>
                <Download size={17} aria-hidden="true" /> Download the plugin
              </a>
              <a className="hp-link" href={docsUrl("woocommerce")}>
                Setup guide <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
          <WooCheckout />
        </article>
        <article className="sp-card sp-shopify" data-tilt>
          <div className="sp-text">
            <h3>Shopify</h3>
            <ol className="sp-steps">
              <li>Connect your store</li>
              <li>Add the payment method</li>
              <li>Add the Pay button</li>
            </ol>
            <div className="sp-actions">
              <Link className="mk-btn primary" href={connectShopify}>
                Connect Shopify <span aria-hidden="true">→</span>
              </Link>
              <a className="hp-link" href={docsUrl("shopify")}>
                Setup guide <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
          <ShopifyThankYou />
        </article>
      </div>
      {withChannels && (
        <ul className="sp-channels" aria-label="Other ways to take payments" data-reveal="stagger">
          {channels.map(({ icon: Icon, label, href }) => (
            <li key={label}>
              {href.startsWith("http") ? (
                <a href={href}>
                  <Icon size={18} aria-hidden="true" />
                  {label}
                  <ArrowUpRight size={15} aria-hidden="true" className="sp-go" />
                </a>
              ) : (
                <Link href={href}>
                  <Icon size={18} aria-hidden="true" />
                  {label}
                  <ArrowUpRight size={15} aria-hidden="true" className="sp-go" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

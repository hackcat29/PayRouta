// The merchant as customers see them on checkout, payment links and
// invoices (lib/merchant/branding.ts): their logo, or their initial when
// they haven't added one; and how to reach them.

export function MerchantMark({ name, logo, className }: { name: string; logo?: string | null; className: string }) {
  return logo ? (
    // eslint-disable-next-line @next/next/no-img-element -- a merchant upload served by /api/brand
    <img className={`${className} merchant-logo`} src={logo} alt="" />
  ) : (
    <span className={className} aria-hidden="true">
      {(name || "P").slice(0, 1).toUpperCase()}
    </span>
  );
}

const host = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
};

export function MerchantContact({
  name,
  website,
  supportEmail,
  className,
}: {
  name: string;
  website?: string | null;
  supportEmail?: string | null;
  className: string;
}) {
  const site = website?.startsWith("https://") ? host(website) : null;
  if (!site && !supportEmail) return null;
  return (
    <p className={className}>
      <span className="sr-only">Contact {name}: </span>
      {site && (
        <a href={website!} target="_blank" rel="noopener noreferrer">
          {site}
        </a>
      )}
      {supportEmail && <a href={`mailto:${supportEmail}`}>{supportEmail}</a>}
    </p>
  );
}

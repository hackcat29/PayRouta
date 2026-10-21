import Image from "next/image";

// Bumped whenever the artwork in public/brand changes, so browsers and CDNs
// that cached the old files under the same names fetch the new ones.
export const brandVersion = "adire-1";

export function BrandLogo({ reverse = false }: { reverse?: boolean }) {
  return (
    <Image
      src={`/brand/payrouta-horizontal-${reverse ? "reverse" : "color"}.svg?v=${brandVersion}`}
      alt="PayRouta"
      width={160}
      height={40}
      priority
      unoptimized
      className="brand-logo"
    />
  );
}

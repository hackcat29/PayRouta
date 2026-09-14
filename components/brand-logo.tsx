import Image from "next/image";
export function BrandLogo({ reverse = false }: { reverse?: boolean }) {
  return (
    <Image
      src={`/brand/payrouta-horizontal-${reverse ? "reverse" : "color"}.svg`}
      alt="PayRouta"
      width={160}
      height={42}
      priority
      className="brand-logo"
    />
  );
}

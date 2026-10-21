import sharp from "sharp";
import fs from "node:fs/promises";
// public/social.png: the default share card (per-page cards come from app/og).
const logo = await sharp("public/brand/payrouta-horizontal-reverse.svg", { density: 600 }).resize(300).png().toBuffer();
const grid = Array.from({ length: 22 }, (_, i) => `<path d="M${i * 56} 0V630M0 ${i * 56}H1200" stroke="#F26B1D" stroke-opacity="0.08"/>`).join("");
const graphic = Buffer.from(
  `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="630" fill="#1E2466"/>${grid}<path d="M860 630V380Q860 330 910 330H1080" fill="none" stroke="#F26B1D" stroke-width="4" stroke-dasharray="14 10"/><circle cx="1080" cy="330" r="12" fill="#F26B1D"/><text x="72" y="300" font-family="Arial,sans-serif" font-size="70" font-weight="700" fill="white">One checkout for</text><text x="72" y="384" font-family="Arial,sans-serif" font-size="70" font-weight="700" fill="white">every way the</text><text x="72" y="468" font-family="Arial,sans-serif" font-size="70" font-weight="700" fill="white">world pays.</text><text x="74" y="560" font-family="Arial,sans-serif" font-size="22" fill="#C9CCEB">Payment links · Checkout · Credit · Crypto</text></svg>`,
);
await sharp(graphic)
  .composite([{ input: logo, left: 72, top: 64 }])
  .png()
  .toFile("public/social.png");
await fs.stat("public/social.png");

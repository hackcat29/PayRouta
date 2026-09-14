import sharp from "sharp";
import fs from "node:fs/promises";
const logo = await sharp("public/brand/payrouta-horizontal-reverse.svg")
  .resize(300)
  .png()
  .toBuffer();
const graphic = Buffer.from(
  `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="630" fill="#102C3A"/><path d="M850 0V205Q850 255 900 255H1200M900 255V630" fill="none" stroke="#2C4F5F" stroke-width="2"/><path d="M900 255H1040Q1090 255 1090 305V445" fill="none" stroke="#BDF4DC" stroke-width="3"/><circle cx="1090" cy="445" r="8" fill="#BDF4DC"/><text x="72" y="278" font-family="Arial,sans-serif" font-size="66" font-weight="500" fill="white">One integration.</text><text x="72" y="358" font-family="Arial,sans-serif" font-size="66" font-weight="500" fill="#BDF4DC">Every way your</text><text x="72" y="438" font-family="Arial,sans-serif" font-size="66" font-weight="500" fill="white">customers pay.</text><text x="74" y="548" font-family="Arial,sans-serif" font-size="19" fill="#B6CCD5">THE UNIVERSAL PAYMENT ROUTING NETWORK</text><text x="984" y="548" font-family="Arial,sans-serif" font-size="16" fill="#BDF4DC">Early access</text></svg>`,
);
await sharp(graphic)
  .composite([{ input: logo, left: 72, top: 64 }])
  .png()
  .toFile("public/social.png");
await fs.stat("public/social.png");

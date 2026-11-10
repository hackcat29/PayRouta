import test from "node:test";
import assert from "node:assert/strict";
import { logoType } from "../lib/merchant/branding";

test("logos are recognised by their bytes; SVG and anything else are refused", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(logoType(png), "image/png");
  assert.equal(logoType(jpeg), "image/jpeg");
  assert.equal(logoType(webp), "image/webp");
  assert.equal(logoType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), null);
  assert.equal(logoType(new TextEncoder().encode("GIF89a........")), null);
  assert.equal(logoType(png.slice(0, 8)), null, "too short to be an image");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { privyLoginMethods, resetPrivyConfig } from "../lib/merchant/privy-config";

const app = "cmw51vn5102370hjvg2bresn6";
const reply = (status: number, body: unknown) => async () => ({ status, headers: {}, body: JSON.stringify(body), bytes: 0 });

test("privy: the wallet dialog offers only the sign-in methods the Privy app has on", async () => {
  resetPrivyConfig();
  let asked = "";
  const http = async (base: string, o: { path: string; headers?: Record<string, string> }) => {
    asked = `${base}${o.path} ${o.headers?.["privy-app-id"]}`;
    return reply(200, { google_oauth: true, apple_oauth: false, twitter_oauth: false, email_auth: true, sms_auth: false })();
  };
  assert.deepEqual(await privyLoginMethods(app, http as never, 1000), ["google", "email"]);
  assert.equal(asked, `https://auth.privy.io/api/v1/apps/${app} ${app}`);
  // Read for five minutes at a time.
  assert.deepEqual(await privyLoginMethods(app, reply(200, { twitter_oauth: true }) as never, 2000), ["google", "email"]);
  assert.deepEqual(await privyLoginMethods(app, reply(200, { twitter_oauth: true }) as never, 302000), ["twitter"]);
  // Privy unreachable or odd: every method PayRouta asks for, as before.
  resetPrivyConfig();
  assert.deepEqual(await privyLoginMethods(app, reply(503, {}) as never), ["google", "apple", "twitter", "email"]);
  assert.deepEqual(await privyLoginMethods(app, reply(200, { google_oauth: "yes" }) as never), ["google", "apple", "twitter", "email"]);
  assert.deepEqual(await privyLoginMethods("../x", reply(200, {}) as never), ["google", "apple", "twitter", "email"]);
  resetPrivyConfig();
});

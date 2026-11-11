// Which sign-in methods the Privy app has turned on, read from Privy's
// public app config (the one its own login dialog loads). The wallet dialog
// offers only these, so a merchant never picks one Privy refuses ("Login
// with Twitter not allowed"). Read for a few minutes at a time; if Privy
// can't be reached, the methods PayRouta asks for are offered as before.
import { z } from "zod";
import { providerRequest } from "../providers/adapters/http";

export const privyLogins = ["google", "apple", "twitter", "email"] as const;
export type PrivyLogin = (typeof privyLogins)[number];
const flags: Record<PrivyLogin, string> = { google: "google_oauth", apple: "apple_oauth", twitter: "twitter_oauth", email: "email_auth" };

const config = z.object(Object.fromEntries(Object.values(flags).map((f) => [f, z.boolean().optional()]))).passthrough();
type Http = typeof providerRequest;

let cached: { at: number; appId: string; methods: PrivyLogin[] } | null = null;

export async function privyLoginMethods(appId: string, http: Http = providerRequest, now = Date.now()): Promise<PrivyLogin[]> {
  if (!/^[a-z0-9]{10,40}$/.test(appId)) return [...privyLogins];
  if (cached && cached.appId === appId && now - cached.at < 300000) return cached.methods;
  try {
    const r = await http("https://auth.privy.io", {
      method: "GET",
      path: `/api/v1/apps/${appId}`,
      headers: { "privy-app-id": appId, Accept: "application/json" },
      timeoutMs: 4000,
      maxResponseBytes: 262144,
    });
    if (r.status !== 200) throw new Error(`privy ${r.status}`);
    const on = config.parse(JSON.parse(r.body)) as Record<string, boolean | undefined>;
    const methods = privyLogins.filter((m) => on[flags[m]] === true);
    cached = { at: now, appId, methods };
    return methods;
  } catch {
    return [...privyLogins];
  }
}
export const resetPrivyConfig = () => {
  cached = null;
};

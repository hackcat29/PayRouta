// Cloudflare Turnstile on the public forms. The browser sends the widget's
// token in the `x-captcha-response` header (the header Better Auth's captcha
// plugin reads too) and each route checks it here before doing any work.
//
// Enforced as soon as TURNSTILE_SECRET_KEY is set. Without it the check is
// off and the forms behave as before, so the keys can be added after deploy.
export const turnstileHeader = "x-captcha-response";
const siteVerify = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const turnstileEnforced = () => !!process.env.TURNSTILE_SECRET_KEY;

// True when the request carries a token Cloudflare accepts. Any failure to
// reach Cloudflare counts as a refusal.
export async function verifyTurnstile(request: Request) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  const token = request.headers.get(turnstileHeader);
  if (!token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret, response: token });
  const ip = request.headers.get("x-real-ip")?.trim();
  if (ip) body.set("remoteip", ip);
  try {
    const response = await fetch(siteVerify, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}

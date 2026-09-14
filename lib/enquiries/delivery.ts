import type { Enquiry } from "./schema";
export function webhookDestination(value: string | undefined) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export async function deliver(
  enquiry: Enquiry,
  config: { url?: string; token?: string },
  fetcher: typeof fetch = fetch,
  timeoutMs = 8000,
) {
  const url = webhookDestination(config.url);
  if (!url)
    return {
      ok: false,
      status: 503,
      message:
        "Online submission is not yet available. Your enquiry has not been sent.",
    };
  const { companyFax, ...fields } = enquiry;
  void companyFax;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": enquiry.submissionId,
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify({
        ...fields,
        timestamp: new Date().toISOString(),
        page: "/contact",
      }),
    });
    if (response.body) await response.body.cancel();
    return response.ok
      ? {
          ok: true,
          status: 200,
          message:
            "Your enquiry was accepted for delivery. Thank you for sharing your requirements.",
        }
      : {
          ok: false,
          status: 502,
          message:
            "Delivery was not confirmed. Your details are still here; please try again.",
        };
  } catch {
    return {
      ok: false,
      status: controller.signal.aborted ? 504 : 502,
      message:
        "Delivery could not be confirmed. It may have reached the recipient. Retry uses the same submission reference.",
    };
  } finally {
    clearTimeout(timer);
  }
}

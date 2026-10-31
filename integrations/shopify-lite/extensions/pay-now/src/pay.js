// Asks PayRouta for a checkout for this order. The session token proves the
// shop; PayRouta reads the order itself.
export const APP_ORIGIN = "https://APP_ORIGIN";

export async function checkout(order, country) {
  const token = await shopify.sessionToken.get();
  const response = await fetch(`${APP_ORIGIN}/api/integrations/shopify-lite/pay`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ order, ...(country ? { country } : {}) }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "UNAVAILABLE");
  return body;
}

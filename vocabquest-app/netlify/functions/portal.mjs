/* POST /api/portal
   Opens Stripe's customer portal, where parents can switch plan, update their card or cancel. */
import { json, siteUrl, stripe, getUser, getSubByUser } from "../lib/shared.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const user = await getUser(req);
    if (!user) return json({ error: "Please log in again." }, 401);

    const row = await getSubByUser(user.id);
    if (!row || !row.stripe_customer_id) return json({ error: "There's no subscription on this account yet." }, 404);

    const portal = await stripe("billing_portal/sessions", { customer: row.stripe_customer_id, return_url: `${siteUrl()}/` });
    return json({ url: portal.url });
  } catch (err) {
    console.error(err);
    return json({ error: "Couldn't open subscription settings. Please try again in a moment." }, 500);
  }
};

export const config = { path: "/api/portal" };

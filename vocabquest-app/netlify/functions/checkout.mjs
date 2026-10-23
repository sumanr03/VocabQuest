/* POST /api/checkout  { plan: "monthly" | "annual" }
   Starts a Stripe Checkout session for the logged-in parent and returns its URL. */
import { json, env, siteUrl, stripe, getUser, getSubByUser, upsertSub, ACTIVE } from "../lib/shared.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const user = await getUser(req);
    if (!user) return json({ error: "Please log in again." }, 401);

    const { plan } = await req.json().catch(() => ({}));
    const price = plan === "annual" ? env("STRIPE_PRICE_ANNUAL") : plan === "monthly" ? env("STRIPE_PRICE_MONTHLY") : null;
    if (!price) return json({ error: "Please choose a plan." }, 400);

    const row = await getSubByUser(user.id);
    if (row && ACTIVE.includes(row.status)) {
      return json({ error: "You already have an active plan. You can change it from the Parents tab." }, 409);
    }

    let customer = row && row.stripe_customer_id;
    if (!customer) {
      const c = await stripe("customers", { email: user.email, metadata: { user_id: user.id } });
      customer = c.id;
      await upsertSub({ user_id: user.id, stripe_customer_id: customer });
    }

    const site = siteUrl();
    const session = await stripe("checkout/sessions", {
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { user_id: user.id } },
      allow_promotion_codes: "true",
      // UK only: always ask for the billing address so the webhook can check the country.
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
      locale: "en-GB",
      success_url: `${site}/?checkout=success`,
      cancel_url: `${site}/?checkout=cancel`
    });
    return json({ url: session.url });
  } catch (err) {
    console.error(err);
    return json({ error: "Payment couldn't be started. Please try again in a moment." }, 500);
  }
};

export const config = { path: "/api/checkout" };

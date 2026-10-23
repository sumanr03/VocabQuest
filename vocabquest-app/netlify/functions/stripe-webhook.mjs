/* POST /api/stripe-webhook
   Stripe calls this whenever a subscription starts, renews, changes or ends.
   It records the latest status in Supabase, which is what unlocks the app.
   VocabQuest is sold in the UK only: a new subscription with a non-UK billing address
   or card is cancelled and refunded straight away. */
import crypto from "node:crypto";
import { json, env, stripe, planForPrice, getSubByCustomer, getSubByUser, upsertSub, ACTIVE } from "../lib/shared.mjs";

export const ALLOWED_COUNTRIES = ["GB"];
export const REGION_BLOCKED = "region_blocked";

export function verifySignature(payload, header, secret, toleranceSec = 300, now = Date.now()) {
  if (!header) return false;
  let t = null; const v1 = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=");
    if (k === "t") t = v;
    if (k === "v1" && v) v1.push(v);
  }
  if (!t || !v1.length) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return v1.some((sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

const idOf = (x) => (x && typeof x === "object" ? x.id : x) || null;

/* Countries we know about for this subscription: billing address and card. */
export function countriesFor(s) {
  const out = [];
  const addr = s.customer && typeof s.customer === "object" && s.customer.address;
  if (addr && addr.country) out.push(addr.country);
  const pm = s.default_payment_method && typeof s.default_payment_method === "object" && s.default_payment_method;
  if (pm && pm.card && pm.card.country) out.push(pm.card.country);
  return out;
}

async function refundLatestPayment(s) {
  const inv = s.latest_invoice && typeof s.latest_invoice === "object" ? s.latest_invoice : null;
  if (!inv || !inv.amount_paid) return;
  let pi = idOf(inv.payment_intent), ch = idOf(inv.charge);
  if (!pi && !ch) {
    // Newer Stripe API versions list invoice payments separately.
    try {
      const list = await stripe(`invoice_payments?invoice=${encodeURIComponent(inv.id)}`, null, "GET");
      const p = list && list.data && list.data[0] && list.data[0].payment;
      pi = p && idOf(p.payment_intent); ch = p && idOf(p.charge);
    } catch (err) { console.error("Couldn't list invoice payments", err.message); }
  }
  try {
    if (pi) await stripe("refunds", { payment_intent: pi, reason: "requested_by_customer" });
    else if (ch) await stripe("refunds", { charge: ch, reason: "requested_by_customer" });
    else console.warn("No payment found to refund for", inv.id);
  } catch (err) { console.error("Refund failed (it may already be refunded)", err.message); }
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const payload = await req.text();
  if (!verifySignature(payload, req.headers.get("stripe-signature"), env("STRIPE_WEBHOOK_SECRET"))) {
    return json({ error: "Invalid signature" }, 400);
  }

  let event;
  try { event = JSON.parse(payload); } catch { return json({ error: "Invalid JSON" }, 400); }

  try {
    let subscriptionId = null;
    if (event.type && event.type.startsWith("customer.subscription.")) subscriptionId = event.data.object.id;
    else if (event.type === "checkout.session.completed" && event.data.object.mode === "subscription") subscriptionId = event.data.object.subscription;
    if (!subscriptionId) return json({ received: true });

    // Always read the latest version from Stripe, so events arriving out of order can't overwrite newer data.
    const s = await stripe(
      `subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=customer&expand[]=default_payment_method&expand[]=latest_invoice`,
      null, "GET"
    );
    const customerId = idOf(s.customer);
    let userId = s.metadata && s.metadata.user_id;
    if (!userId) {
      const row = await getSubByCustomer(customerId);
      userId = row && row.user_id;
    }
    if (!userId) { console.warn("No user for subscription", s.id); return json({ received: true }); }

    const existing = await getSubByUser(userId);
    const item = s.items && s.items.data && s.items.data[0];
    const end = s.current_period_end || (item && item.current_period_end);
    const row = {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: s.id,
      status: s.status,
      plan: planForPrice(item && item.price && item.price.id),
      current_period_end: end ? new Date(end * 1000).toISOString() : null,
      cancel_at_period_end: !!s.cancel_at_period_end
    };

    // UK only.
    if (ACTIVE.includes(s.status)) {
      const countries = countriesFor(s);
      if (countries.some((c) => !ALLOWED_COUNTRIES.includes(c))) {
        console.warn(`Blocking subscription ${s.id}: countries ${countries.join(",")}`);
        try { await stripe(`subscriptions/${encodeURIComponent(s.id)}`, null, "DELETE"); }
        catch (err) { console.error("Cancel failed (it may already be cancelled)", err.message); }
        await refundLatestPayment(s);
        await upsertSub({ ...row, status: REGION_BLOCKED, cancel_at_period_end: false });
        return json({ received: true, blocked: true });
      }
    }

    // Keep the "UK only" status once a subscription was blocked, so the parent sees why.
    if (existing && existing.status === REGION_BLOCKED && existing.stripe_subscription_id === s.id && !ACTIVE.includes(s.status)) {
      return json({ received: true });
    }

    await upsertSub(row);
    return json({ received: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Webhook handling failed" }, 500);   // Stripe will retry
  }
};

export const config = { path: "/api/stripe-webhook" };

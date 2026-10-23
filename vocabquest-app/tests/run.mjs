/* Tests for the server functions, using a fake Stripe and a fake Supabase.
   Run with: npm test */
import http from "node:http";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const db = new Map();            // user_id -> subscription row
const stripeCalls = [];
const ukSub = (id, extra = {}) => ({
  id, status: "active", cancel_at_period_end: false, metadata: { user_id: "user-1" },
  customer: { id: "cus_1", address: { country: "GB" } },
  default_payment_method: { card: { country: "GB" } },
  latest_invoice: { id: `in_${id}`, amount_paid: 1000, payment_intent: `pi_${id}` },
  items: { data: [{ price: { id: "price_annual" }, current_period_end: 1893456000 }] },
  ...extra
});
const subs = { sub_1: ukSub("sub_1") };

const server = http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const url = new URL(req.url, "http://x");
  const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

  if (url.pathname === "/auth/v1/user") {
    return req.headers.authorization === "Bearer good-token" ? send(200, { id: "user-1", email: "parent@example.com" }) : send(401, { msg: "bad jwt" });
  }
  if (url.pathname === "/rest/v1/subscriptions") {
    assert.equal(req.headers.apikey, "service-key");
    if (req.method === "GET") {
      const [field, val] = [...url.searchParams].find(([k]) => k !== "select");
      const id = val.replace(/^eq\./, "");
      const rows = [...db.values()].filter((r) => r[field] === id);
      return send(200, rows);
    }
    if (req.method === "POST") {
      const row = JSON.parse(body);
      db.set(row.user_id, { ...(db.get(row.user_id) || {}), ...row });
      return send(201, [db.get(row.user_id)]);
    }
  }
  if (url.pathname.startsWith("/v1/")) {
    assert.equal(req.headers.authorization, "Bearer sk_test_123");
    const params = Object.fromEntries(new URLSearchParams(body));
    stripeCalls.push({ path: url.pathname, method: req.method, params });
    if (url.pathname === "/v1/customers") return send(200, { id: "cus_1" });
    if (url.pathname === "/v1/checkout/sessions") return send(200, { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    if (url.pathname === "/v1/billing_portal/sessions") return send(200, { url: "https://billing.stripe.com/p/session/1" });
    if (url.pathname === "/v1/refunds") return send(200, { id: "re_1", status: "succeeded" });
    const m = url.pathname.match(/^\/v1\/subscriptions\/(.+)$/);
    if (m && subs[m[1]]) {
      if (req.method === "DELETE") { subs[m[1]] = { ...subs[m[1]], status: "canceled" }; return send(200, subs[m[1]]); }
      const s = subs[m[1]];
      // Unexpanded fields come back as plain IDs, like the real API.
      const exp = url.searchParams.getAll("expand[]");
      return send(200, {
        ...s,
        customer: exp.includes("customer") ? s.customer : s.customer.id,
        default_payment_method: exp.includes("default_payment_method") ? s.default_payment_method : "pm_1",
        latest_invoice: exp.includes("latest_invoice") ? s.latest_invoice : s.latest_invoice.id
      });
    }
  }
  send(404, { error: { message: "not found" } });
});

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
Object.assign(process.env, {
  STRIPE_API_BASE: base, STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: "whsec_test",
  STRIPE_PRICE_MONTHLY: "price_monthly", STRIPE_PRICE_ANNUAL: "price_annual",
  SUPABASE_URL: base, SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key",
  SITE_URL: "https://vocabquest.example/"
});

const checkout = (await import("../netlify/functions/checkout.mjs")).default;
const portal = (await import("../netlify/functions/portal.mjs")).default;
const webhookMod = await import("../netlify/functions/stripe-webhook.mjs");
const webhook = webhookMod.default;

const post = (path, body, token) => new Request(`https://site${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: typeof body === "string" ? body : JSON.stringify(body || {})
});
const sign = (payload, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac("sha256", "whsec_test").update(`${t}.${payload}`).digest("hex")}`;

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("  ✓", name); }

console.log("VocabQuest server tests");

await test("checkout refuses requests without a login", async () => {
  const r = await checkout(post("/api/checkout", { plan: "annual" }));
  assert.equal(r.status, 401);
});

await test("checkout rejects an unknown plan", async () => {
  const r = await checkout(post("/api/checkout", { plan: "weekly" }, "good-token"));
  assert.equal(r.status, 400);
});

await test("checkout creates a customer and a subscription session for the annual price", async () => {
  const r = await checkout(post("/api/checkout", { plan: "annual" }, "good-token"));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).url, "https://checkout.stripe.com/c/pay/cs_1");
  const sess = stripeCalls.find((c) => c.path === "/v1/checkout/sessions").params;
  assert.equal(sess.mode, "subscription");
  assert.equal(sess["line_items[0][price]"], "price_annual");
  assert.equal(sess["line_items[0][quantity]"], "1");
  assert.equal(sess["subscription_data[metadata][user_id]"], "user-1");
  assert.equal(sess.customer, "cus_1");
  assert.equal(sess.success_url, "https://vocabquest.example/?checkout=success");
  assert.equal(sess.billing_address_collection, "required");
  assert.equal(sess["customer_update[address]"], "auto");
  assert.equal(db.get("user-1").stripe_customer_id, "cus_1");
});

await test("checkout reuses the existing customer for the monthly price", async () => {
  stripeCalls.length = 0;
  const r = await checkout(post("/api/checkout", { plan: "monthly" }, "good-token"));
  assert.equal(r.status, 200);
  assert.ok(!stripeCalls.some((c) => c.path === "/v1/customers"));
  assert.equal(stripeCalls.find((c) => c.path === "/v1/checkout/sessions").params["line_items[0][price]"], "price_monthly");
});

await test("webhook rejects a bad signature", async () => {
  const payload = JSON.stringify({ type: "customer.subscription.created", data: { object: { id: "sub_1" } } });
  const r = await webhook(new Request("https://site/api/stripe-webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=abc" }, body: payload }));
  assert.equal(r.status, 400);
});

await test("webhook rejects an old timestamp", async () => {
  const payload = "{}";
  assert.equal(webhookMod.verifySignature(payload, sign(payload, 1000), "whsec_test"), false);
});

await test("webhook records an active annual subscription", async () => {
  const payload = JSON.stringify({ type: "customer.subscription.created", data: { object: { id: "sub_1" } } });
  const r = await webhook(new Request("https://site/api/stripe-webhook", { method: "POST", headers: { "stripe-signature": sign(payload) }, body: payload }));
  assert.equal(r.status, 200);
  const row = db.get("user-1");
  assert.equal(row.status, "active");
  assert.equal(row.plan, "annual");
  assert.equal(row.stripe_subscription_id, "sub_1");
  assert.equal(row.current_period_end, new Date(1893456000 * 1000).toISOString());
});

await test("checkout refuses a second plan while one is active", async () => {
  const r = await checkout(post("/api/checkout", { plan: "monthly" }, "good-token"));
  assert.equal(r.status, 409);
});

await test("webhook records a cancellation", async () => {
  subs.sub_1 = { ...subs.sub_1, status: "canceled" };
  const payload = JSON.stringify({ type: "customer.subscription.deleted", data: { object: { id: "sub_1" } } });
  const r = await webhook(new Request("https://site/api/stripe-webhook", { method: "POST", headers: { "stripe-signature": sign(payload) }, body: payload }));
  assert.equal(r.status, 200);
  assert.equal(db.get("user-1").status, "canceled");
});

await test("portal returns a Stripe billing link", async () => {
  const r = await portal(post("/api/portal", {}, "good-token"));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).url, "https://billing.stripe.com/p/session/1");
});

const sendEvent = (type, id) => {
  const payload = JSON.stringify({ type, data: { object: { id } } });
  return webhook(new Request("https://site/api/stripe-webhook", { method: "POST", headers: { "stripe-signature": sign(payload) }, body: payload }));
};

await test("webhook cancels and refunds a non-UK card", async () => {
  stripeCalls.length = 0;
  subs.sub_2 = ukSub("sub_2", { default_payment_method: { card: { country: "US" } } });
  const r = await sendEvent("customer.subscription.created", "sub_2");
  assert.equal((await r.json()).blocked, true);
  assert.ok(stripeCalls.some((c) => c.method === "DELETE" && c.path === "/v1/subscriptions/sub_2"), "subscription cancelled");
  const refund = stripeCalls.find((c) => c.path === "/v1/refunds");
  assert.ok(refund, "refund created");
  assert.equal(refund.params.payment_intent, "pi_sub_2");
  assert.equal(db.get("user-1").status, "region_blocked");
});

await test("the UK-only status is kept when Stripe reports the cancellation", async () => {
  const r = await sendEvent("customer.subscription.deleted", "sub_2");
  assert.equal(r.status, 200);
  assert.equal(db.get("user-1").status, "region_blocked");
});

await test("webhook also blocks a non-UK billing address with a UK card", async () => {
  subs.sub_3 = ukSub("sub_3", { customer: { id: "cus_1", address: { country: "FR" } } });
  const r = await sendEvent("customer.subscription.created", "sub_3");
  assert.equal((await r.json()).blocked, true);
});

await test("a UK family can subscribe again after being blocked", async () => {
  subs.sub_4 = ukSub("sub_4");
  await sendEvent("customer.subscription.created", "sub_4");
  assert.equal(db.get("user-1").status, "active");
  assert.equal(db.get("user-1").stripe_subscription_id, "sub_4");
});

server.close();
console.log(`\n${passed} tests passed`);

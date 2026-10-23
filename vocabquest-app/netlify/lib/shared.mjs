/* Helpers shared by the VocabQuest server functions.
   Talks to Stripe and Supabase over their REST APIs, so there are no packages to install. */

export function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const ACTIVE = ["active", "trialing"];

export function siteUrl() {
  return env("SITE_URL").replace(/\/$/, "");
}

/* ---------- Stripe ---------- */
const stripeBase = () => (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/$/, "");

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === "object") flatten(v, key, out);
    else if (v !== undefined) out[key] = String(v);
  }
  return out;
}

export async function stripe(path, params, method = "POST") {
  const res = await fetch(`${stripeBase()}/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params && method !== "GET" ? new URLSearchParams(flatten(params)).toString() : undefined
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${path}: ${body.error ? body.error.message : res.status}`);
  return body;
}

export function planForPrice(priceId) {
  if (priceId && priceId === process.env.STRIPE_PRICE_ANNUAL) return "annual";
  if (priceId && priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  return null;
}

/* ---------- Supabase ---------- */
export async function getUser(req) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const res = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: env("SUPABASE_ANON_KEY"), Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user : null;
}

async function rest(method, query, body) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/subscriptions${query}`, {
    method,
    headers: {
      apikey: key,
      // Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys must not.
      ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Supabase ${method} subscriptions: ${res.status} ${JSON.stringify(out)}`);
  return out;
}

export async function getSubByUser(userId) {
  const rows = await rest("GET", `?user_id=eq.${encodeURIComponent(userId)}&select=*`);
  return rows && rows[0] ? rows[0] : null;
}

export async function getSubByCustomer(customerId) {
  const rows = await rest("GET", `?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=*`);
  return rows && rows[0] ? rows[0] : null;
}

export async function upsertSub(row) {
  return rest("POST", "?on_conflict=user_id", { ...row, updated_at: new Date().toISOString() });
}

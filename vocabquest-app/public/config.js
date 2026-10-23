/* VocabQuest settings.
   Fill in the two Supabase values from your Supabase project (Project Settings → API Keys):
   the Project URL, and the anon key (Legacy API keys tab) or the publishable key (sb_publishable_...).
   Both are safe to publish: the anon key only allows what the database rules permit.
   While they still say YOUR_..., the app runs without login or payment (useful for testing). */
window.VQ_CONFIG = {
  supabaseUrl: "YOUR_SUPABASE_URL",          // e.g. https://abcdefgh.supabase.co
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  apiBase: "/api",                            // where the Netlify functions live
  prices: {
    monthly: { amount: 0.99, label: "£0.99", per: "month" },
    annual:  { amount: 10,   label: "£10",   per: "year" }
  }
};

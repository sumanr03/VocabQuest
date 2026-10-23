# VocabQuest

VocabQuest is an installable web app for children, with parent accounts and paid plans:

- **Monthly:** £0.99 a month
- **Annual:** £10 a year

Parents create an account and log in, choose a plan, and pay through Stripe. The app unlocks once Stripe confirms the payment. Progress is saved to the account, so it carries across phones and tablets.

## What's in the folder

| Path | What it does |
|---|---|
| `public/` | The app itself (this is what gets published) |
| `public/index.html` | Quests, word library, progress and Parents tab |
| `public/account.js` | Login, plans, parental gate, account settings and progress saving |
| `public/config.js` | **Your Supabase settings go here** |
| `public/words.js` | The word list (2,337 words) |
| `public/sw.js` | Offline support |
| `netlify/functions/checkout.mjs` | Starts a Stripe payment for the chosen plan |
| `netlify/functions/portal.mjs` | Opens Stripe's page for changing plan, updating a card or cancelling |
| `netlify/functions/stripe-webhook.mjs` | Receives payment updates from Stripe and records them |
| `supabase/schema.sql` | Creates the database tables and their security rules |
| `tests/run.mjs` | Tests for the payment functions (`npm test`) |

## How it fits together

1. A parent logs in. **Supabase** handles accounts, passwords and password resets.
2. The parent picks a plan and answers a "grown-ups only" question. The app asks `/api/checkout` for a payment link.
3. The parent pays on **Stripe's** own secure page. VocabQuest never sees card details.
4. Stripe tells `/api/stripe-webhook` that the subscription is active. The function saves this in Supabase.
5. The app reads the status from Supabase and unlocks.

Renewals, plan changes and cancellations all go through the same webhook. If a payment fails or the plan ends, the app shows the plans again. Progress is kept.

Until you fill in `public/config.js`, the app runs **without** login or payment, so you can still try it out.

---

## Setup (about 45 minutes)

Do everything in **Stripe test mode** first, so no real money moves.

### Step 1: Supabase (accounts and data)

1. Create a free project at https://supabase.com.
2. Open **SQL Editor → New query**, paste in all of `supabase/schema.sql`, and click **Run**.
3. Go to **Authentication → URL Configuration**:
   - Set **Site URL** to your app's address, such as `https://vocabquest.netlify.app`.
   - Under **Redirect URLs**, add the same address followed by `/**`.
4. Go to **Project Settings → API** and copy three values:
   - **Project URL** and the **anon public** key. Put both in `public/config.js`.
   - The **service_role** key. This one is secret: never put it in `public/`. It goes into Netlify in step 3.

### Step 2: Stripe (payments)

1. Create an account at https://stripe.com and make sure **Test mode** is switched on.
2. Go to **Product catalogue → Add product**, name it "VocabQuest", and add two prices:
   - £0.99 GBP, recurring, **monthly**
   - £10.00 GBP, recurring, **yearly**

   Copy each price's ID. They start with `price_`.
3. Go to **Settings → Billing → Customer portal** and turn on:
   - cancelling subscriptions
   - switching plans (add both VocabQuest prices)
   - updating payment methods

   Then save.
4. Go to **Developers → API keys** and copy the **Secret key**, which starts with `sk_test_`.
5. You'll create the webhook after the site is online (step 4).

### Step 3: Netlify (hosting and payment functions)

Netlify Drop (drag and drop) **can't run the payment functions**. Use one of these instead:

- **GitHub:** put this folder in a GitHub repository. In Netlify, choose **Add new site → Import an existing project** and pick the repository. The build settings come from `netlify.toml` automatically.
- **Netlify CLI:** from this folder, run `npx netlify-cli deploy --prod`.

Then go to **Site configuration → Environment variables** and add:

| Name | Value |
|---|---|
| `SITE_URL` | Your app's address, such as `https://vocabquest.netlify.app` |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_ANON_KEY` | Supabase anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key (secret) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_PRICE_MONTHLY` | The £0.99 price ID |
| `STRIPE_PRICE_ANNUAL` | The £10 price ID |
| `STRIPE_WEBHOOK_SECRET` | Added in step 4 |

Redeploy after adding them.

### Step 4: Connect Stripe to your site

1. In Stripe, go to **Developers → Webhooks → Add endpoint**.
2. Set the endpoint URL to `https://YOUR-SITE/api/stripe-webhook`.
3. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the **Signing secret**, which starts with `whsec_`. Add it to Netlify as `STRIPE_WEBHOOK_SECRET`, then redeploy.

### Step 5: Test it

1. Open your site, create an account, and confirm it from the email.
2. Choose a plan, answer the grown-ups question, and pay with Stripe's test card: `4242 4242 4242 4242`, any future date, any CVC.
3. You should come back to the app, see "Confirming your payment…" for a few seconds, and then the app unlocks.
4. In the **Parents** tab, try **Manage or cancel subscription**.

### Step 6: Go live

1. Switch Stripe to live mode and create the same two prices there.
2. Add a live webhook with the same events.
3. In Netlify, replace `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` and `STRIPE_WEBHOOK_SECRET` with the live values, then redeploy.

---

## UK only

VocabQuest is sold to families in the UK only:

- Checkout always asks for a billing address and shows prices in pounds.
- If a new subscription has a **non-UK billing address or a non-UK card**, the webhook cancels it straight away and refunds the payment in full. The parent sees a message explaining that VocabQuest is UK only.
- Stripe's tax tools aren't needed. You don't charge VAT until your UK turnover passes the registration threshold (£90,000 a year at the time of writing). Check this with an accountant.

**Optional extra.** If your Stripe account lets you add custom Radar rules, you can block non-UK cards before they're charged at all. Go to **Radar → Rules → Add rule** and enter `Block if :card_country: != 'GB'`. The refund check above still works without it.

**Recommended.** Switch on **Apple Pay**, **Google Pay** and **Link** under **Settings → Payment methods** in Stripe, so parents can pay in a couple of taps. No code changes are needed.

## Install it on a phone

**iPhone / iPad:** open the link in **Safari**, tap **Share**, then **Add to Home Screen**.

**Android:** open the link in **Chrome**, then tap **Install app** (or ⋮ → **Add to Home screen**).

## Adding more words

Add lines to the end of `public/words.js` in the same format:

```js
{w:"word",p:"adjective",lv:2,d:"a short child-friendly definition",e:"An example sentence that uses the word.",s:["synonym","synonym"],a:["opposite","opposite"]},
```

Follow these rules so the quiz keeps working:

- The example sentence must contain the word exactly as written.
- Give at least two synonyms. Leave `a:[]` if the word has no clear opposites.
- Set `lv` to `2` for intermediate or `3` for difficult. Leave it out for core words.

## Publishing an update

1. Edit the files.
2. In `public/sw.js`, change the version, for example `vocabquest-v4` to `vocabquest-v5`.
3. Push to GitHub, or run the deploy command again.

## Good to know

- **Fees.** Stripe charges 1.5% + 20p per standard UK card payment, plus 0.7% for subscriptions billing. That's about 22p of each £0.99 payment (around 22%), but only about 42p of each £10 payment (around 4%). The annual plan is much better value for you, so you may want to make it the highlighted option (it already is).
- **App stores.** This setup is for the web app installed from a link. If you later put VocabQuest in Apple's App Store or Google Play, both have their own rules for selling digital subscriptions inside apps, and these differ by country and are changing in the UK. Check the current rules before submitting.
- **The paywall runs in the browser.** That's normal for apps like this, but a technically skilled person could get around it, because the word list is part of the app's public files. Fixing that would mean serving words from the server only to paying accounts.
- **Children's privacy.** Accounts are for parents. Only the parent's email address is collected, plus the child's name if a parent types one in. Before launching you'll need a privacy policy, and you should check the ICO's Children's Code, because the app is used by children.
- **Tests.** Run `npm test` to check the payment functions against a fake Stripe and Supabase, including the UK-only checks.

-- VocabQuest database setup.
-- Paste this into Supabase → SQL Editor → New query, then click Run.

-- Subscriptions: written only by the server (Stripe webhook), readable by the account owner.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  status text,                       -- active, trialing, past_due, canceled, ...
  plan text,                         -- monthly or annual
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  updated_at timestamptz default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists "Parents can read their own subscription" on public.subscriptions;
create policy "Parents can read their own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);
-- No insert/update/delete policies: only the server (service role key) can change subscriptions.

-- Progress: each account can read and save only its own progress.
create table if not exists public.progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz default now()
);

alter table public.progress enable row level security;

drop policy if exists "Read own progress" on public.progress;
create policy "Read own progress" on public.progress
  for select using (auth.uid() = user_id);

drop policy if exists "Create own progress" on public.progress;
create policy "Create own progress" on public.progress
  for insert with check (auth.uid() = user_id);

drop policy if exists "Update own progress" on public.progress;
create policy "Update own progress" on public.progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.pf_app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.pf_app_config (key, value)
values ('active_season_id', 'season-1')
on conflict (key) do nothing;

alter table public.pf_seasons
  add column if not exists daily_prize_lamports bigint not null default 0;

create table if not exists public.pf_score_snapshots (
  season_id text not null references public.pf_seasons(id),
  boundary smallint not null check (boundary between 0 and 2),
  captured_at timestamptz not null,
  source_url text not null,
  pnl_by_wallet jsonb not null check (jsonb_typeof(pnl_by_wallet) = 'object'),
  missing_wallets jsonb not null default '[]'::jsonb,
  primary key (season_id, boundary)
);

create table if not exists public.pf_daily_awards (
  id uuid primary key default gen_random_uuid(),
  season_id text not null references public.pf_seasons(id),
  day_number smallint not null check (day_number in (1, 2)),
  winner_wallet text check (winner_wallet is null or winner_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  score_usd numeric,
  prize_lamports bigint not null default 0,
  status text not null check (status in ('awaiting_data', 'awaiting_funding', 'pending_payment', 'paid', 'no_eligible_entries')),
  payment_signature text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (season_id, day_number)
);

create index if not exists pf_daily_awards_winner_idx on public.pf_daily_awards (winner_wallet, created_at desc);

-- These tables are server-only and reachable through the private application database role.

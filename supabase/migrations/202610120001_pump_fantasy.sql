-- Apply in the Supabase SQL editor before setting PF_ACTIVE_SEASON_ID.
create extension if not exists pgcrypto;

create table if not exists public.pf_nonces (
  wallet text primary key check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  nonce text not null,
  expires_at timestamptz not null
);

create table if not exists public.pf_seasons (
  id text primary key,
  title text not null,
  status text not null check (status in ('draft', 'open', 'locked', 'complete')) default 'draft',
  opens_at timestamptz,
  locked_at timestamptz,
  closes_at timestamptz,
  source_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.pf_players (
  id text primary key,
  season_id text not null references public.pf_seasons(id),
  rank integer not null check (rank between 1 and 50),
  wallet text not null check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  display_name text,
  profile_url text,
  avatar_url text,
  -- Pump.fun one-month PnL captured at the contest's opening snapshot.
  pnl_usd numeric not null,
  -- Closing 1M PnL less opening 1M PnL for the active daily round.
  contest_change_usd numeric,
  source_url text not null,
  snapshot_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists pf_players_season_rank_idx on public.pf_players (season_id, rank);
create unique index if not exists pf_players_season_wallet_idx on public.pf_players (season_id, wallet);

create table if not exists public.pf_entries (
  season_id text not null references public.pf_seasons(id),
  wallet text not null check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  picks jsonb not null check (jsonb_typeof(picks) = 'array' and jsonb_array_length(picks) = 5),
  token_balance_raw numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (season_id, wallet)
);

create table if not exists public.pf_snapshots (
  id uuid primary key default gen_random_uuid(),
  season_id text references public.pf_seasons(id),
  source_url text not null,
  observed_at timestamptz not null,
  player_count integer not null check (player_count between 1 and 50),
  created_at timestamptz not null default now()
);

alter table public.pf_nonces enable row level security;
alter table public.pf_seasons enable row level security;
alter table public.pf_players enable row level security;
alter table public.pf_entries enable row level security;
alter table public.pf_snapshots enable row level security;

-- There are deliberately no anon/authenticated policies. Access is through
-- server routes using the service role; never place that key in client code.
revoke all on public.pf_nonces, public.pf_seasons, public.pf_players, public.pf_entries, public.pf_snapshots from anon, authenticated;
grant all on public.pf_nonces, public.pf_seasons, public.pf_players, public.pf_entries, public.pf_snapshots to service_role;

create index if not exists pf_entries_season_updated_idx on public.pf_entries (season_id, updated_at desc);
create index if not exists pf_players_snapshot_idx on public.pf_players (season_id, snapshot_at desc);

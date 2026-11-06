create table pf_community_players (
  wallet text primary key check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  display_name text not null check (length(display_name) between 1 and 100),
  avatar_url text,
  profile_url text not null,
  pnl_usd numeric not null,
  registered_at timestamptz not null default clock_timestamp()
);
create table pf_player_burns (
  id uuid primary key,
  wallet text not null unique,
  intent jsonb not null,
  prepared jsonb not null,
  profile jsonb not null,
  signature text unique,
  signed_wire text,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check ((signature is null) = (signed_wire is null))
);
create table pf_community_source_budget (
  id integer primary key check(id=1),
  day date not null default current_date,
  calls integer not null default 0,
  next_call timestamptz not null default '-infinity'
);
insert into pf_community_source_budget(id) values(1);
create table pf_community_requests (
  wallet text primary key,
  next_request timestamptz not null
);
create table pf_community_pnl_cache (
  wallet text primary key,
  observation jsonb,
  next_attempt timestamptz not null default '-infinity'
);

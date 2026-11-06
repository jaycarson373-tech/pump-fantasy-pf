create table pf_roster_cache (
  id smallint primary key check (id=1),
  players jsonb not null check (jsonb_typeof(players)='array' and jsonb_array_length(players)=50),
  observed_at timestamptz not null,
  last_refresh_attempt_at timestamptz
);

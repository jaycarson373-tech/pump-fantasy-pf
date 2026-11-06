-- Additive versioned competition tables. Historical pf_* results and money remain unchanged.
create table pfl_seasons (
 id text primary key, title text not null, number integer not null unique,
 mint text not null, starts_at timestamptz not null, ends_at timestamptz not null,
 weeks integer not null check(weeks between 1 and 52),
 status text not null default 'scheduled' check(status in ('scheduled','active','complete','paused')),
 format text not null default 'starting-seven-v1', created_at timestamptz not null default now()
);
create table pfl_rounds (
 id text primary key, season_id text not null references pfl_seasons(id), week integer not null,
 opens_at timestamptz not null, locks_at timestamptz not null, ends_at timestamptz not null,
 status text not null default 'awaiting_data' check(status in ('awaiting_data','open','locked','complete')),
 pool jsonb, pool_hash text, pool_source text, pool_observed_at timestamptz, methodology text,
 last_error text, unique(season_id,week), check(opens_at<locks_at and locks_at<ends_at),
 check(pool is null or jsonb_array_length(pool)=100)
);
create table pfl_rosters (
 round_id text not null references pfl_rounds(id), wallet text not null,
 picks jsonb not null check(jsonb_array_length(picks)=7), captain text not null,
 balance_raw numeric(78,0) not null, disqualified_at timestamptz, disqualification_reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(round_id,wallet), check(picks ? captain)
);
create table pfl_eligibility_events (
 id bigint generated always as identity primary key, round_id text not null, wallet text not null,
 checked_at timestamptz not null default now(), slot bigint, raw_balance numeric(78,0), eligible boolean,
 status text not null check(status in ('verified','unavailable')), source text not null,
 foreign key(round_id,wallet) references pfl_rosters(round_id,wallet)
);
create table pfl_days (
 round_id text not null references pfl_rounds(id), day integer not null check(day between 1 and 7),
 starts_at timestamptz not null, ends_at timestamptz not null, source text not null, methodology text not null,
 inputs jsonb not null, input_hash text not null, points jsonb not null,
 finalized_at timestamptz not null default now(), primary key(round_id,day)
);
create table pfl_scores (
 round_id text not null, day integer not null, wallet text not null, points2 integer not null,
 primary key(round_id,day,wallet), foreign key(round_id,day) references pfl_days(round_id,day),
 foreign key(round_id,wallet) references pfl_rosters(round_id,wallet)
);
create table pfl_weekly_standings (
 round_id text not null references pfl_rounds(id), wallet text not null, rank integer not null,
 points2 integer not null, season_points_bps integer not null check(season_points_bps between 0 and 10000),
 primary key(round_id,wallet)
);
create table pfl_coverage (
 round_id text not null references pfl_rounds(id), wallet text not null, through_at timestamptz not null,
 source text not null, input_hash text not null, primary key(round_id,wallet)
);
create table pfl_fee_allocations (
 receipt_signature text primary key references pf_creator_fee_receipts(signature),
 season_id text not null references pfl_seasons(id), daily_raw bigint not null check(daily_raw>=0),
 season_raw bigint not null check(season_raw>=0), champion_raw bigint not null check(champion_raw>=0),
 created_at timestamptz not null default now()
);
create table pfl_conversions (
 signature text primary key, receipt_signature text not null references pfl_fee_allocations(receipt_signature),
 pool text not null check(pool in ('daily','season','champion')), sol_raw bigint not null check(sol_raw>0),
 token_raw numeric(78,0) not null check(token_raw>0), mint text not null,
 status text not null check(status in ('pending','verified','failed','unknown')), confirmed_slot bigint,
 created_at timestamptz not null default now(), unique(receipt_signature,pool)
);
create table pfl_entitlements (
 id uuid primary key default gen_random_uuid(), season_id text not null references pfl_seasons(id),
 round_id text references pfl_rounds(id), wallet text not null, pool text not null,
 period text not null, amount_raw numeric(78,0) not null check(amount_raw>0),
 status text not null default 'pending' check(status in ('pending','available','claimed','forfeited')),
 created_at timestamptz not null default now(), unique(season_id,wallet,pool,period)
);
create table pfl_claims (
 entitlement_id uuid primary key references pfl_entitlements(id), signature text unique,
 status text not null check(status in ('prepared','unknown','confirmed','failed')),
 created_at timestamptz not null default now(), confirmed_slot bigint
);
create table pfl_jobs (
 id text primary key, status text not null, last_error text, updated_at timestamptz not null default now()
);
create function pfl_immutable() returns trigger language plpgsql as $$ begin raise exception 'Finalized league records are immutable'; end $$;
create trigger pfl_days_immutable before update or delete on pfl_days for each row execute function pfl_immutable();
create trigger pfl_weekly_immutable before update or delete on pfl_weekly_standings for each row execute function pfl_immutable();
create function pfl_protect_pool() returns trigger language plpgsql as $$ begin
 if old.pool_hash is not null and (new.pool is distinct from old.pool or new.pool_hash is distinct from old.pool_hash or new.pool_source is distinct from old.pool_source or new.pool_observed_at is distinct from old.pool_observed_at or new.methodology is distinct from old.methodology or new.opens_at<>old.opens_at or new.locks_at<>old.locks_at or new.ends_at<>old.ends_at) then raise exception 'Published pool and schedule are immutable'; end if; return new; end $$;
create trigger pfl_pool_immutable before update on pfl_rounds for each row execute function pfl_protect_pool();
create function pfl_roster_lock() returns trigger language plpgsql as $$ declare r pfl_rounds; begin
 if TG_OP='UPDATE' and (new.round_id<>old.round_id or new.wallet<>old.wallet) then raise exception 'Roster identity is immutable'; end if;
 select * into r from pfl_rounds where id=new.round_id for share;
 if TG_OP='INSERT' or new.picks is distinct from old.picks or new.captain is distinct from old.captain then
 if r.status<>'open' or clock_timestamp()<r.opens_at or clock_timestamp()>=r.locks_at then raise exception 'Draft is locked'; end if;
 end if; return new; end $$;
create trigger pfl_enforce_lock before insert or update on pfl_rosters for each row execute function pfl_roster_lock();
-- Private DB connection only. Public access goes through authenticated, filtered API routes.
alter table pfl_rosters enable row level security;
alter table pfl_eligibility_events enable row level security;
alter table pfl_entitlements enable row level security;
alter table pfl_claims enable row level security;

-- A receipt belongs to one accounting generation. Preserve already obligated legacy receipts.
alter table pf_creator_fee_receipts add column competition_format text not null default 'legacy';
create function pfl_reserve_receipt() returns trigger language plpgsql as $$
declare r pf_creator_fee_receipts; begin
 select * into r from pf_creator_fee_receipts where signature=new.receipt_signature for update;
 if r.competition_format<>'legacy' or r.award_id is not null or r.season_award_id is not null then raise exception 'Receipt already allocated'; end if;
 if new.daily_raw+new.season_raw+new.champion_raw<>r.gross_lamports then raise exception 'Receipt allocation must reconcile'; end if;
 update pf_creator_fee_receipts set competition_format='starting-seven-v1' where signature=r.signature;
 return new; end $$;
create trigger pfl_claim_receipt before insert on pfl_fee_allocations for each row execute function pfl_reserve_receipt();
create function pfl_guard_legacy_receipt() returns trigger language plpgsql as $$ begin
 if old.competition_format='starting-seven-v1' and (new.competition_format<>old.competition_format or new.award_id is not null or new.season_award_id is not null or new.gross_lamports<>old.gross_lamports) then raise exception 'Receipt belongs to Starting Seven'; end if; return new; end $$;
create trigger pfl_receipt_guard before update on pf_creator_fee_receipts for each row execute function pfl_guard_legacy_receipt();
create trigger pfl_allocation_immutable before update or delete on pfl_fee_allocations for each row execute function pfl_immutable();
create trigger pfl_score_immutable before update or delete on pfl_scores for each row execute function pfl_immutable();
create table pfl_settlements (
 season_id text not null references pfl_seasons(id), pool text not null, period text not null,
 budget_raw numeric(78,0) not null, retained_raw numeric(78,0) not null,
 input_hash text not null, created_at timestamptz not null default now(),
 primary key(season_id,pool,period)
);
create trigger pfl_settlement_immutable before update or delete on pfl_settlements for each row execute function pfl_immutable();
create function pfl_conversion_guard() returns trigger language plpgsql as $$ declare allocation pfl_fee_allocations; expected_mint text; limit_raw bigint; begin
 select * into allocation from pfl_fee_allocations where receipt_signature=new.receipt_signature for share;
 select mint into expected_mint from pfl_seasons where id=allocation.season_id;
 limit_raw:=case new.pool when 'daily' then allocation.daily_raw when 'season' then allocation.season_raw else allocation.champion_raw end;
 if new.mint<>expected_mint or new.sol_raw>limit_raw then raise exception 'Conversion exceeds its pool or uses a different mint'; end if;
 if new.status='verified' and new.confirmed_slot is null then raise exception 'Verified conversion requires chain confirmation'; end if;
 if TG_OP='UPDATE' and old.status='verified' then raise exception 'Confirmed conversion is immutable'; end if;
 return new; end $$;
create trigger pfl_check_conversion before insert or update on pfl_conversions for each row execute function pfl_conversion_guard();

alter table pf_seasons add column if not exists mint_address text;
alter table pf_seasons add column if not exists prize_mode text not null default 'fixed';
create table if not exists pf_creator_claims (
 signature text primary key,
 mint_address text not null,
 creator_wallet text not null,
 transaction_base64 text not null,
 last_valid_block_height bigint not null,
 status text not null check(status in ('prepared','finalized','failed','unknown')),
 created_at timestamptz not null default now()
);
create table if not exists pf_creator_fee_receipts (
 signature text primary key references pf_creator_claims(signature),
 mint_address text not null,
 gross_lamports bigint not null check(gross_lamports > 0),
 daily_lamports bigint not null check(daily_lamports >= 0),
 reserve_lamports bigint not null check(reserve_lamports >= 0),
 collected_at timestamptz not null default now(),
 award_id uuid references pf_daily_awards(id),
 check(daily_lamports + reserve_lamports = gross_lamports),
 check(daily_lamports = floor(gross_lamports::numeric * 6500 / 10000))
);
create index if not exists pf_fee_receipts_available_idx on pf_creator_fee_receipts(mint_address,collected_at) where award_id is null;

alter table pf_daily_awards drop constraint if exists pf_daily_awards_status_check;
alter table pf_daily_awards add constraint pf_daily_awards_status_check check (status in ('awaiting_data','awaiting_funding','pending_payment','payment_prepared','payment_failed','payment_unknown','paid','no_eligible_entries','no_creator_fees'));

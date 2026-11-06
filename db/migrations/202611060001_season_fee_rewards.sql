-- Preserve historical 65/35 receipts; new receipts use 30/50/20.
alter table pf_creator_fee_receipts
  add column season_lamports bigint not null default 0 check (season_lamports >= 0),
  add column split_version smallint not null default 1,
  add column season_award_id uuid references pf_daily_awards(id);
alter table pf_creator_fee_receipts alter column split_version set default 2;
alter table pf_creator_fee_receipts drop constraint pf_creator_fee_receipts_check;
alter table pf_creator_fee_receipts drop constraint pf_creator_fee_receipts_check1;
alter table pf_creator_fee_receipts add constraint pf_fee_receipts_conservation
  check (daily_lamports + season_lamports + reserve_lamports = gross_lamports);
alter table pf_creator_fee_receipts add constraint pf_fee_receipts_split
  check (
    (split_version = 1 and season_lamports = 0 and daily_lamports = floor(gross_lamports::numeric * 6500 / 10000))
    or (split_version = 2 and daily_lamports = floor(gross_lamports::numeric * 3000 / 10000)
        and season_lamports = floor(gross_lamports::numeric * 5000 / 10000))
  );
create index pf_fee_receipts_season_available_idx
  on pf_creator_fee_receipts(mint_address,collected_at) where season_award_id is null and season_lamports > 0;

-- Both award kinds use the existing durable payout queue and shared season cap.
alter table pf_daily_awards add column award_kind text not null default 'daily';
alter table pf_daily_awards alter column day_number drop not null;
alter table pf_daily_awards drop constraint pf_daily_awards_day_number_check;
alter table pf_daily_awards add constraint pf_award_kind_window
  check ((award_kind = 'daily' and day_number is not null and day_number in (1,2))
      or (award_kind = 'season' and day_number is null));
create unique index pf_one_season_award on pf_daily_awards(season_id) where award_kind = 'season';

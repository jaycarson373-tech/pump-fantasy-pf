alter table public.pf_daily_awards
  drop constraint if exists pf_daily_awards_status_check;

alter table public.pf_daily_awards
  add constraint pf_daily_awards_status_check
  check (status in (
    'awaiting_data', 'awaiting_funding', 'pending_payment', 'payment_prepared',
    'payment_failed', 'payment_unknown', 'paid', 'no_eligible_entries'
  ));

alter table public.pf_daily_awards
  add column if not exists payment_tx_base64 text,
  add column if not exists payment_blockhash text,
  add column if not exists payment_last_valid_block_height bigint,
  add column if not exists payment_network text,
  add column if not exists payment_attempts integer not null default 0,
  add column if not exists payment_updated_at timestamptz;

alter table public.pf_daily_awards
  add constraint pf_daily_awards_payment_tx_pair_check
  check (status <> 'payment_prepared' or (
    payment_tx_base64 is not null and payment_signature is not null and
    payment_blockhash is not null and payment_last_valid_block_height is not null and
    payment_network is not null
  ));

create index if not exists pf_daily_awards_payout_queue_idx
  on public.pf_daily_awards (created_at)
  where status in ('pending_payment', 'payment_prepared');

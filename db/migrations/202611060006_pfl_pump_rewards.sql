-- Null records the original convert-SOL-to-base-token generation. Do not retarget it.
alter table pfl_seasons add column reward_mint text check(reward_mint is null or reward_mint='pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn');
alter table pfl_fee_allocations add column reward_asset text not null default 'SOL' check(reward_asset in ('SOL','PUMP'));
alter table pfl_entitlements add column reward_mint text;
update pfl_entitlements e set reward_mint=coalesce(s.reward_mint,s.mint) from pfl_seasons s where s.id=e.season_id;
alter table pfl_entitlements alter column reward_mint set not null;

create function pfl_preserve_season_binding() returns trigger language plpgsql as $$ begin
 if new.id is distinct from old.id or new.mint is distinct from old.mint or new.reward_mint is distinct from old.reward_mint then
  raise exception 'League season asset identity is immutable; create a new season';
 end if;
 return new;
end $$;
create trigger pfl_season_binding before update on pfl_seasons for each row execute function pfl_preserve_season_binding();

create or replace function pfl_reserve_receipt() returns trigger language plpgsql as $$
declare r pf_creator_fee_receipts; s pfl_seasons; expected_asset text; begin
 select * into r from pf_creator_fee_receipts where signature=new.receipt_signature for update;
 select * into s from pfl_seasons where id=new.season_id for share;
 if r.signature is null or s.id is null then raise exception 'Allocation requires an existing receipt and season'; end if;
 if r.competition_format<>'legacy' or r.award_id is not null or r.season_award_id is not null then raise exception 'Receipt already allocated'; end if;
 expected_asset:=case when s.reward_mint is null then 'SOL' else 'PUMP' end;
 if new.reward_asset<>expected_asset or r.reward_asset<>expected_asset or r.mint_address<>s.mint then
  raise exception 'Allocation receipt must match the season mint and reward asset';
 end if;
 if new.daily_raw<>r.daily_raw or new.season_raw<>r.season_raw or new.champion_raw<>r.reserve_raw then
  raise exception 'Receipt allocation must preserve each recorded pool';
 end if;
 update pf_creator_fee_receipts set competition_format='starting-seven-v1' where signature=r.signature;
 return new;
end $$;

create function pfl_bind_entitlement() returns trigger language plpgsql as $$
declare expected_mint text; begin
 if TG_OP='UPDATE' then
  if new.id is distinct from old.id or new.season_id is distinct from old.season_id or new.round_id is distinct from old.round_id
   or new.wallet is distinct from old.wallet or new.pool is distinct from old.pool or new.period is distinct from old.period
   or new.amount_raw is distinct from old.amount_raw or new.reward_mint is distinct from old.reward_mint then
   raise exception 'Entitlement payment identity is immutable; preserve its original recipient, amount and mint';
  end if;
  return new;
 end if;
 select coalesce(reward_mint,mint) into expected_mint from pfl_seasons where id=new.season_id for share;
 if expected_mint is null then raise exception 'Entitlement requires an existing reward season'; end if;
 if new.reward_mint is not null and new.reward_mint<>expected_mint then raise exception 'Entitlement mint must match its season'; end if;
 if new.round_id is not null and not exists(select 1 from pfl_rounds where id=new.round_id and season_id=new.season_id) then
  raise exception 'Entitlement round must belong to its season';
 end if;
 new.reward_mint:=expected_mint;
 return new;
end $$;
create trigger pfl_entitlement_binding before insert or update on pfl_entitlements for each row execute function pfl_bind_entitlement();
create trigger pfl_entitlement_preserve before delete on pfl_entitlements for each row execute function pfl_immutable();

-- Signed bytes are journaled before send; recovery always uses this same binding.
alter table pfl_claims
 add column transaction_base64 text,
 add column blockhash text,
 add column last_valid_block_height bigint,
 add column source_wallet text,
 add column amount_raw numeric(78,0),
 add column mint text,
 add column prepared_at timestamptz;
create function pfl_bind_claim() returns trigger language plpgsql as $$
declare e pfl_entitlements; begin
 if TG_OP='UPDATE' then
  if new.entitlement_id is distinct from old.entitlement_id or new.signature is distinct from old.signature
   or new.transaction_base64 is distinct from old.transaction_base64 or new.blockhash is distinct from old.blockhash
   or new.last_valid_block_height is distinct from old.last_valid_block_height or new.source_wallet is distinct from old.source_wallet
   or new.amount_raw is distinct from old.amount_raw or new.mint is distinct from old.mint
   or new.created_at is distinct from old.created_at or new.prepared_at is distinct from old.prepared_at then
   raise exception 'Claim signed payment binding is immutable; reconcile the original transaction';
  end if;
  if old.status in ('confirmed','failed') and (new.status is distinct from old.status or new.confirmed_slot is distinct from old.confirmed_slot) then
   raise exception 'Terminal claim outcome is immutable';
  end if;
  if old.status='unknown' and new.status='prepared' then raise exception 'Unknown claim cannot be replaced; reconcile its original transaction'; end if;
  if new.status='confirmed' and new.confirmed_slot is null then raise exception 'Confirmed claim requires a finalized slot'; end if;
  return new;
 end if;
 select * into e from pfl_entitlements where id=new.entitlement_id for share;
 if e.id is null then raise exception 'Claim requires an existing entitlement'; end if;
 if new.status<>'prepared' or new.signature is null or new.signature='' or new.transaction_base64 is null or new.transaction_base64=''
  or new.blockhash is null or new.blockhash='' or new.last_valid_block_height is null or new.last_valid_block_height<=0
  or new.source_wallet is null or new.source_wallet='' or new.amount_raw is distinct from e.amount_raw
  or new.mint is distinct from e.reward_mint or new.prepared_at is null then
  raise exception 'Prepared claim requires its complete signed transaction, source, amount, mint and lifetime';
 end if;
 if e.status<>'available' then raise exception 'Only available entitlements may prepare a claim'; end if;
 return new;
end $$;
create trigger pfl_claim_binding before insert or update on pfl_claims for each row execute function pfl_bind_claim();
create trigger pfl_claim_preserve before delete on pfl_claims for each row execute function pfl_immutable();
-- New seasons use PUMP; existing null rows retain their base-token conversion path.
alter table pfl_seasons alter column reward_mint set default 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn';
create or replace function pfl_conversion_guard() returns trigger language plpgsql as $$
declare allocation pfl_fee_allocations; expected_mint text; limit_raw bigint; begin
 select * into allocation from pfl_fee_allocations where receipt_signature=new.receipt_signature for share;
 if allocation.reward_asset<>'SOL' then raise exception 'PUMP allocations pay directly and cannot create SOL conversions'; end if;
 select mint into expected_mint from pfl_seasons where id=allocation.season_id;
 limit_raw:=case new.pool when 'daily' then allocation.daily_raw when 'season' then allocation.season_raw else allocation.champion_raw end;
 if new.mint<>expected_mint or new.sol_raw>limit_raw then raise exception 'Conversion exceeds its pool or uses a different mint'; end if;
 if new.status='verified' and new.confirmed_slot is null then raise exception 'Verified conversion requires chain confirmation'; end if;
 if TG_OP='UPDATE' and old.status='verified' then raise exception 'Confirmed conversion is immutable'; end if;
 return new;
end $$;

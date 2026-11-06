-- Existing integer amounts remain native SOL; only their unit-neutral names change.
alter table pf_seasons rename column daily_prize_lamports to daily_prize_raw;
alter table pf_daily_awards rename column prize_lamports to prize_raw;
alter table pf_creator_fee_receipts rename column gross_lamports to gross_raw;
alter table pf_creator_fee_receipts rename column daily_lamports to daily_raw;
alter table pf_creator_fee_receipts rename column season_lamports to season_raw;
alter table pf_creator_fee_receipts rename column reserve_lamports to reserve_raw;

alter table pf_seasons add column reward_asset text not null default 'SOL' check (reward_asset in ('SOL','PUMP'));
alter table pf_daily_awards add column reward_asset text not null default 'SOL' check (reward_asset in ('SOL','PUMP'));
alter table pf_creator_claims add column reward_asset text not null default 'SOL' check (reward_asset in ('SOL','PUMP'));
alter table pf_creator_fee_receipts add column reward_asset text not null default 'SOL' check (reward_asset in ('SOL','PUMP'));

alter table pf_seasons add constraint pf_season_asset_key unique(id,reward_asset);
alter table pf_creator_claims add constraint pf_claim_asset_key unique(signature,mint_address,reward_asset);
alter table pf_daily_awards add constraint pf_award_season_asset foreign key(season_id,reward_asset) references pf_seasons(id,reward_asset);
alter table pf_creator_fee_receipts add constraint pf_receipt_claim_asset foreign key(signature,mint_address,reward_asset) references pf_creator_claims(signature,mint_address,reward_asset);

create function pf_preserve_reward_binding() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME = 'pf_seasons' then
    if (OLD.status <> 'draft' or exists(select 1 from pf_daily_awards where season_id=OLD.id)) and (NEW.reward_asset is distinct from OLD.reward_asset or NEW.mint_address is distinct from OLD.mint_address) then
      raise exception 'Opened season reward binding is immutable; create a new season';
    end if;
  elsif NEW.signature is distinct from OLD.signature or NEW.reward_asset is distinct from OLD.reward_asset or NEW.mint_address is distinct from OLD.mint_address then
    raise exception 'Claim/receipt reward binding is immutable; preserve its recorded asset and mint';
  end if;
  return NEW;
end $$;
create trigger pf_season_reward_binding before update on pf_seasons for each row execute function pf_preserve_reward_binding();
create trigger pf_claim_reward_binding before update on pf_creator_claims for each row execute function pf_preserve_reward_binding();
create trigger pf_receipt_reward_binding before update on pf_creator_fee_receipts for each row execute function pf_preserve_reward_binding();

create function pf_preserve_award_binding() returns trigger language plpgsql as $$
begin
  if NEW.reward_asset is distinct from OLD.reward_asset or NEW.season_id is distinct from OLD.season_id or NEW.award_kind is distinct from OLD.award_kind then
    raise exception 'Award reward binding is immutable; preserve its recorded season, asset and kind';
  end if;
  return NEW;
end $$;
create trigger pf_award_reward_binding before update on pf_daily_awards for each row execute function pf_preserve_award_binding();

create function pf_check_receipt_awards() returns trigger language plpgsql as $$
begin
  if TG_OP='UPDATE' then
    if NEW.signature is distinct from OLD.signature
      or (OLD.award_id is not null and NEW.award_id is distinct from OLD.award_id)
      or (OLD.season_award_id is not null and NEW.season_award_id is distinct from OLD.season_award_id) then
      raise exception 'Receipt claim and completed allocations are immutable; preserve historical binding';
    end if;
  end if;
  if NEW.award_id is not null and not exists (
    select 1 from pf_daily_awards a join pf_seasons s on s.id=a.season_id
    where a.id=NEW.award_id and a.award_kind='daily' and a.reward_asset=NEW.reward_asset and s.mint_address=NEW.mint_address
  ) then
    raise exception 'Daily receipt allocation must match the award asset, mint and kind';
  end if;
  if NEW.season_award_id is not null and not exists (
    select 1 from pf_daily_awards a join pf_seasons s on s.id=a.season_id
    where a.id=NEW.season_award_id and a.award_kind='season' and a.reward_asset=NEW.reward_asset and s.mint_address=NEW.mint_address
  ) then
    raise exception 'Season receipt allocation must match the award asset, mint and kind';
  end if;
  return NEW;
end $$;
create trigger pf_receipt_award_assets before insert or update on pf_creator_fee_receipts for each row execute function pf_check_receipt_awards();
create index pf_receipt_asset_available on pf_creator_fee_receipts(mint_address,reward_asset,collected_at);

-- Lock the season while inserting an award so a concurrent draft rebind cannot
-- change the mint after the award/receipt consistency checks have run.
create function pf_lock_award_season() returns trigger language plpgsql as $$
begin
  perform 1 from pf_seasons where id=NEW.season_id for share;
  return NEW;
end $$;
create trigger pf_award_lock_season before insert on pf_daily_awards for each row execute function pf_lock_award_season();


-- PL/pgSQL stores function text: column renames do not rewrite these bodies.
create or replace function pfl_reserve_receipt() returns trigger language plpgsql as $$
declare r pf_creator_fee_receipts; begin
 select * into r from pf_creator_fee_receipts where signature=new.receipt_signature for update;
 if r.competition_format<>'legacy' or r.award_id is not null or r.season_award_id is not null then raise exception 'Receipt already allocated'; end if;
 if new.daily_raw+new.season_raw+new.champion_raw<>r.gross_raw then raise exception 'Receipt allocation must reconcile'; end if;
 update pf_creator_fee_receipts set competition_format='starting-seven-v1' where signature=r.signature;
 return new; end $$;
create or replace function pfl_guard_legacy_receipt() returns trigger language plpgsql as $$ begin
 if old.competition_format='starting-seven-v1' and (new.competition_format<>old.competition_format or new.award_id is not null or new.season_award_id is not null or new.gross_raw<>old.gross_raw) then raise exception 'Receipt belongs to Starting Seven'; end if; return new; end $$;
update pf_creator_fee_receipts set reward_asset=reward_asset;

-- Operator-requested mint correction for the empty, open first draft only.
-- Fresh databases and already-corrected seasons require no data changes.
do $$
declare
  old_mint constant text := 'FntsyveWSihAySCYY9j3qr64LTE2FVM6JT3dbELpBhZo';
  new_mint constant text := 'FnTSYWv39UTMLaVPF3cKFKjamhGBadNs3NAmDZCFuEp5';
  season pf_seasons%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('pump-fantasy-season-tick'));
  perform pg_advisory_xact_lock(hashtext('pump-fantasy-season-start'));
  select * into season from pf_seasons where id='season-1' for update;
  if season.mint_address is distinct from old_mint then return; end if;
  if season.status <> 'open' or season.locked_at is null or season.locked_at <= now()
     or not exists(select 1 from pf_app_config where key='active_season_id' and value=season.id) then
    raise exception 'Mint correction requires the active open first draft. Review the season before retrying.';
  end if;
  if exists(select 1 from pf_entries where season_id=season.id)
     or exists(select 1 from pf_daily_awards where season_id=season.id)
     or exists(select 1 from pf_score_snapshots where season_id=season.id)
     or exists(select 1 from pf_creator_claims where mint_address=old_mint) then
    raise exception 'Mint correction found entries, scoring, awards or old-token claims. Reconcile them before changing the mint.';
  end if;
  update pf_seasons set mint_address=new_mint where id=season.id;
end $$;

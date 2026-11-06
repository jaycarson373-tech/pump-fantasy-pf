-- Existing seasons remain five-player contests. New seasons choose size at open.
alter table public.pf_seasons add column squad_size integer not null default 5 check(squad_size in (5,6));
alter table public.pf_players drop constraint pf_players_rank_check;
alter table public.pf_players add constraint pf_players_rank_check check(rank >= 1);
alter table public.pf_entries drop constraint pf_entries_picks_check;
alter table public.pf_entries add constraint pf_entries_picks_check check(jsonb_typeof(picks)='array' and jsonb_array_length(picks) in (5,6));

-- Enforce trusted season size and identity/band uniqueness for every writer.
create function public.pf_validate_entry_squad() returns trigger language plpgsql as $$
declare required_size integer; found_count integer; wallet_count integer; band_count integer; ranked_count integer;
begin
  select squad_size into required_size from public.pf_seasons where id=new.season_id for share;
  if jsonb_array_length(new.picks) is distinct from required_size then
    raise exception 'Entry size must match the season squad size';
  end if;
  select count(*),count(distinct p.wallet),count(distinct ((p.rank-1)/10)) filter(where p.rank<=50),count(*) filter(where p.rank<=50)
    into found_count,wallet_count,band_count,ranked_count
    from public.pf_players p where p.season_id=new.season_id and p.id in(select jsonb_array_elements_text(new.picks));
  if found_count<>required_size or wallet_count<>required_size or ranked_count<>5 or band_count<>5 then
    raise exception 'Choose five distinct ranked bands and the required community pick';
  end if;
  return new;
end $$;
create trigger pf_entries_validate_squad before insert or update of picks,season_id on public.pf_entries for each row execute function public.pf_validate_entry_squad();

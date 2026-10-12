insert into public.pf_seasons (id, title, status)
values ('season-1', 'Season 1', 'draft')
on conflict (id) do nothing;

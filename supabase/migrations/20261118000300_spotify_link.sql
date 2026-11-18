create table public.veluna_spotify_links (
    user_id uuid primary key references auth.users(id) on delete cascade,
    spotify_id text not null check(length(spotify_id) between 1 and 256),
    display_name text not null check(length(display_name) between 1 and 256),
    linked_at timestamptz not null default now()
);
alter table public.veluna_spotify_links enable row level security;
revoke all on public.veluna_spotify_links from public, anon, authenticated;
grant select, delete on public.veluna_spotify_links to authenticated;
grant select, insert, update, delete on public.veluna_spotify_links to service_role;
create policy read_link on public.veluna_spotify_links for select to authenticated using ((select auth.uid())=user_id);
create policy remove_link on public.veluna_spotify_links for delete to authenticated using ((select auth.uid())=user_id);

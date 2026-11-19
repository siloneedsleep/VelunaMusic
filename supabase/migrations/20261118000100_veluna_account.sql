create table public.veluna_devices (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    device_id uuid not null,
    label text not null check (length(label) between 1 and 80),
    platform text not null check (platform in ('android', 'windows')),
    last_seen timestamptz not null default now(),
    primary key (user_id, device_id)
);

create table public.veluna_library (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    kind text not null check (kind in ('theme', 'playlist', 'favorite', 'queue')),
    item_id uuid not null,
    revision bigint not null default 1 check (revision > 0),
    payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 262144),
    deleted boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (user_id, kind, item_id)
);

alter table public.veluna_devices enable row level security;
alter table public.veluna_library enable row level security;
revoke all on public.veluna_devices, public.veluna_library from public, anon, authenticated;
grant select, insert, update, delete on public.veluna_devices to authenticated;
grant select on public.veluna_library to authenticated;
create policy device_owner on public.veluna_devices for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy library_owner on public.veluna_library for select to authenticated
    using ((select auth.uid()) = user_id);

-- A concurrent edit or stale offline replay must not overwrite a newer document.
create function public.veluna_save_item(p_kind text, p_item_id uuid, p_expected_revision bigint, p_payload jsonb, p_deleted boolean)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
    uid uuid := auth.uid();
    new_revision bigint;
begin
    if uid is null then raise insufficient_privilege; end if;
    if p_expected_revision = 0 then
        insert into public.veluna_library (user_id, kind, item_id, payload, deleted)
        values (uid, p_kind, p_item_id, p_payload, p_deleted)
        on conflict do nothing returning revision into new_revision;
    else
        update public.veluna_library set payload = p_payload, deleted = p_deleted,
            revision = revision + 1, updated_at = now()
        where user_id = uid and kind = p_kind and item_id = p_item_id and revision = p_expected_revision
        returning revision into new_revision;
    end if;
    if new_revision is null then raise exception 'revision_conflict' using errcode = '40001'; end if;
    return new_revision;
end;
$$;
revoke all on function public.veluna_save_item(text, uuid, bigint, jsonb, boolean) from public, anon;
grant execute on function public.veluna_save_item(text, uuid, bigint, jsonb, boolean) to authenticated;

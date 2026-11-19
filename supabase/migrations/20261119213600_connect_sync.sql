alter table public.veluna_handoff
    add column if not exists updated_at timestamptz not null default now();

create or replace function public.veluna_advance(p_id uuid, p_device uuid, p_phase text, p_position bigint default 0, p_playing boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare h public.veluna_handoff; uid uuid := auth.uid();
begin
    if uid is null then raise insufficient_privilege; end if;
    select * into h from public.veluna_handoff where user_id=uid and transfer_id=p_id for update;
    if not found or p_device not in (h.source_device,h.target_device) or p_device is null then raise exception 'unknown_handoff'; end if;
    if h.phase=p_phase then return h.phase; end if;
    if h.expires_at < now() then raise exception 'expired_handoff'; end if;
    if not (
        (p_device=h.target_device and p_phase='ready' and h.phase='offered') or
        (p_device=h.source_device and p_phase='released' and h.phase='ready') or
        (p_device=h.target_device and p_phase='received' and h.phase='released') or
        (p_phase='cancelled' and (h.phase in ('offered','ready') or (p_device=h.target_device and h.phase='released')))
    ) then raise exception 'invalid_transition'; end if;
    update public.veluna_handoff set phase=p_phase,
        position_ms=case when p_phase='released' then p_position else position_ms end,
        playing=case when p_phase='released' then p_playing else playing end,
        updated_at=now(),
        expires_at=now()+interval '3 minutes' where user_id=uid;
    return p_phase;
end;
$$;

alter table public.veluna_library drop constraint if exists veluna_library_kind_check;
alter table public.veluna_library add constraint veluna_library_kind_check
    check (kind in ('theme', 'playlist', 'favorite', 'queue', 'history'));

alter table public.veluna_commands drop constraint if exists veluna_commands_action_check;
alter table public.veluna_commands add constraint veluna_commands_action_check
    check (action in ('play','pause','next','previous','seek','select','volume','move','shuffle','repeat'));

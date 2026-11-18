-- One pending handoff per account; users can send only between their registered devices.
create table public.veluna_handoff (
    user_id uuid primary key references auth.users(id) on delete cascade,
    transfer_id uuid not null,
    source_device uuid not null,
    target_device uuid not null,
    digest text not null check (digest ~ '^[a-f0-9]{64}$'),
    title text not null check (length(title) between 1 and 512),
    phase text not null check (phase in ('offered','ready','released','received','cancelled')),
    position_ms bigint not null default 0 check (position_ms >= 0),
    playing boolean not null default false,
    expires_at timestamptz not null,
    check (source_device <> target_device),
    foreign key (user_id, source_device) references public.veluna_devices on delete cascade,
    foreign key (user_id, target_device) references public.veluna_devices on delete cascade
);
alter table public.veluna_handoff enable row level security;
revoke all on public.veluna_handoff from public, anon, authenticated;
grant select on public.veluna_handoff to authenticated;
create policy read_own_transfer on public.veluna_handoff for select to authenticated using ((select auth.uid()) = user_id);

create function public.veluna_offer(p_id uuid,p_source uuid,p_target uuid,p_digest text,p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); chosen uuid;
begin
    if uid is null then raise insufficient_privilege; end if;
    insert into public.veluna_handoff as h
        (user_id,transfer_id,source_device,target_device,digest,title,phase,expires_at)
    values (uid,p_id,p_source,p_target,p_digest,p_title,'offered',now()+interval '3 minutes')
    on conflict (user_id) do update set transfer_id=excluded.transfer_id, source_device=excluded.source_device,
        target_device=excluded.target_device, digest=excluded.digest, title=excluded.title,
        position_ms=0, playing=false, phase='offered', expires_at=excluded.expires_at
    where h.transfer_id <> p_id and (h.phase in ('received','cancelled') or h.expires_at < now())
    returning transfer_id into chosen;
    if chosen is null then
        select transfer_id into chosen from public.veluna_handoff
        where user_id=uid and transfer_id=p_id and source_device=p_source and target_device=p_target and digest=p_digest;
        if chosen is null then raise exception 'handoff_busy'; end if;
    end if;
    return chosen;
end;
$$;

create function public.veluna_advance(p_id uuid, p_device uuid, p_phase text, p_position bigint default 0, p_playing boolean default false)
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
        (p_phase='cancelled' and h.phase in ('offered','ready'))
    ) then raise exception 'invalid_transition'; end if;
    update public.veluna_handoff set phase=p_phase,
        position_ms=case when p_phase='released' then p_position else position_ms end,
        playing=case when p_phase='released' then p_playing else playing end,
        expires_at=now()+interval '3 minutes' where user_id=uid;
    return p_phase;
end;
$$;
revoke all on function public.veluna_offer(uuid,uuid,uuid,text,text),public.veluna_advance(uuid,uuid,text,bigint,boolean) from public,anon;
grant execute on function public.veluna_offer(uuid,uuid,uuid,text,text),public.veluna_advance(uuid,uuid,text,bigint,boolean) to authenticated;

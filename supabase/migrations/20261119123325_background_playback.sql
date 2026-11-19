alter table public.veluna_handoff drop constraint veluna_handoff_digest_check;
alter table public.veluna_handoff add check (digest ~ '^([a-f0-9]{64}|ytmusic://[A-Za-z0-9_-]{11})$');

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
        expires_at=now()+interval '3 minutes' where user_id=uid;
    return p_phase;
end;
$$;

create table public.veluna_commands (
    user_id uuid not null default auth.uid() references auth.users on delete cascade,
    id uuid not null,
    sender uuid not null,
    recipient uuid not null,
    instance uuid not null,
    version uuid not null,
    action text not null check (action in ('play','pause','next','previous','seek','select','volume','move')),
    value double precision not null check (value between 0 and 864000),
    destination integer not null default 0 check (destination between 0 and 999),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    result text,
    primary key(user_id,id),
    foreign key(user_id,sender) references public.veluna_devices on delete cascade,
    foreign key(user_id,recipient) references public.veluna_devices on delete cascade,
    check (sender <> recipient),
    check (result is null or length(result) <= 256)
);
create index veluna_commands_pending on public.veluna_commands(user_id,recipient,created_at) where result is null;
alter table public.veluna_commands enable row level security;
revoke all on public.veluna_commands from public,anon,authenticated;
grant select on public.veluna_commands to authenticated;
create policy read_account_commands on public.veluna_commands for select to authenticated using(user_id=(select auth.uid()));

create function public.veluna_command(p_id uuid,p_sender uuid,p_recipient uuid,p_instance uuid,p_version uuid,
    p_action text,p_value double precision,p_destination integer,p_deadline timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
    if uid is null then raise insufficient_privilege; end if;
    if p_deadline <= now() then raise exception 'expired_command'; end if;
    delete from public.veluna_commands where user_id=uid and expires_at < now()-interval '1 day';
    insert into public.veluna_commands(user_id,id,sender,recipient,instance,version,action,value,destination,expires_at)
    values(uid,p_id,p_sender,p_recipient,p_instance,p_version,p_action,p_value,p_destination,
        least(p_deadline,now() + case when p_action='move' then interval '1 day' else interval '30 seconds' end))
    on conflict(user_id,id) do nothing;
end;
$$;
create function public.veluna_command_ack(p_id uuid,p_recipient uuid,p_result text)
returns void language sql security definer set search_path='' as $$
    update public.veluna_commands set result=left(p_result,256)
    where user_id=(select auth.uid()) and id=p_id and recipient=p_recipient and result is null;
$$;
revoke all on function public.veluna_command(uuid,uuid,uuid,uuid,uuid,text,double precision,integer,timestamptz),
    public.veluna_command_ack(uuid,uuid,text) from public,anon;
grant execute on function public.veluna_command(uuid,uuid,uuid,uuid,uuid,text,double precision,integer,timestamptz),
    public.veluna_command_ack(uuid,uuid,text) to authenticated;

alter publication supabase_realtime add table public.veluna_handoff, public.veluna_commands;

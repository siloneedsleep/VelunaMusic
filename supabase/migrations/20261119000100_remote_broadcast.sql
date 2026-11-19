create policy veluna_remote_listen on realtime.messages
for select to authenticated using (
    extension = 'broadcast' and (select realtime.topic()) = 'veluna-remote-' || (select auth.uid())::text
);

create policy veluna_remote_send on realtime.messages
for insert to authenticated with check (
    extension = 'broadcast' and (select realtime.topic()) = 'veluna-remote-' || (select auth.uid())::text
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_messages'
  ) then
    alter publication supabase_realtime add table public.project_messages;
  end if;
end;
$$;

create table if not exists public.project_message_reads (
  workspace_id uuid not null,
  project_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (project_id, user_id),
  foreign key (workspace_id, project_id)
    references public.projects(workspace_id, id) on delete cascade
);

alter table public.project_message_reads enable row level security;
revoke all on public.project_message_reads from anon, public;
grant select, insert, update on public.project_message_reads to authenticated;

drop policy if exists "participants read own project message cursor"
  on public.project_message_reads;
create policy "participants read own project message cursor"
  on public.project_message_reads for select
  using (
    user_id = auth.uid()
    and (public.is_workspace_member(workspace_id)
      or public.has_client_access(project_id))
  );

drop policy if exists "participants manage own project message cursor"
  on public.project_message_reads;
create policy "participants manage own project message cursor"
  on public.project_message_reads for insert
  with check (
    user_id = auth.uid()
    and (public.is_workspace_member(workspace_id)
      or public.has_client_access(project_id))
  );

drop policy if exists "participants update own project message cursor"
  on public.project_message_reads;
create policy "participants update own project message cursor"
  on public.project_message_reads for update
  using (
    user_id = auth.uid()
    and (public.is_workspace_member(workspace_id)
      or public.has_client_access(project_id))
  )
  with check (
    user_id = auth.uid()
    and (public.is_workspace_member(workspace_id)
      or public.has_client_access(project_id))
  );

create or replace function public.get_unread_project_message_counts()
returns table (project_id uuid, unread_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select m.project_id, count(*)
  from public.project_messages m
  where m.sender_id <> auth.uid()
    and not exists (
      select 1
      from public.project_message_reads r
      where r.project_id = m.project_id
        and r.user_id = auth.uid()
        and r.last_read_at >= m.created_at
    )
  group by m.project_id;
$$;

revoke all on function public.get_unread_project_message_counts() from public;
grant execute on function public.get_unread_project_message_counts() to authenticated;

notify pgrst, 'reload schema';

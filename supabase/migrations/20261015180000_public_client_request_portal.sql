alter table public.inquiries
  add column status text not null default 'new'
    check (status in ('new', 'contacted', 'accepted', 'declined')),
  add column client_id uuid references public.clients(id) on delete set null,
  add column project_id uuid references public.projects(id) on delete set null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace uuid;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;

  if new.raw_user_meta_data->>'account_type' = 'client'
    or exists (
      select 1
      from public.invitations
      where lower(email) = lower(new.email)
        and accepted_at is null
    ) then
    return new;
  end if;

  insert into public.workspaces (owner_id, studio_name, slug, contact_email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'studio_name', ''), 'GLYPH Creative Studio'),
    'glyph-' || replace(new.id::text, '-', ''),
    new.email
  )
  on conflict (owner_id) do nothing
  returning id into new_workspace;

  if new_workspace is null then
    select id into new_workspace from public.workspaces where owner_id = new.id;
  end if;

  insert into public.members (workspace_id, user_id, role)
  values (new_workspace, new.id, 'owner')
  on conflict do nothing;

  return new;
end;
$$;

create or replace function public.claim_client_project_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record public.inquiries;
  target_workspace uuid;
  target_client uuid;
  target_user_email text;
  claimed_count integer := 0;
begin
  select lower(email) into target_user_email
  from auth.users
  where id = auth.uid();

  if target_user_email is null then
    raise exception 'Sign in before opening your client requests';
  end if;

  for request_record in
    select *
    from public.inquiries
    where lower(email) = target_user_email
      and client_id is null
      and project_id is null
    order by created_at
    for update
  loop
    target_workspace := request_record.workspace_id;
    target_client := null;

    select client_id into target_client
    from public.client_access
    where workspace_id = target_workspace
      and user_id = auth.uid()
    order by granted_at desc
    limit 1;

    if target_client is null then
      insert into public.clients (workspace_id, name, email)
      values (target_workspace, request_record.name, target_user_email)
      returning id into target_client;

      insert into public.client_access (workspace_id, client_id, user_id)
      values (target_workspace, target_client, auth.uid())
      on conflict do nothing;
    end if;

    insert into public.projects (
      workspace_id,
      client_id,
      name,
      service,
      brief,
      status,
      share_with_client
    )
    values (
      target_workspace,
      target_client,
      coalesce(nullif(trim(request_record.service), ''), 'Creative') || ' project request',
      coalesce(request_record.service, ''),
      request_record.message,
      'inquiry',
      true
    )
    returning id into request_record.project_id;

    update public.inquiries
    set client_id = target_client,
        project_id = request_record.project_id
    where id = request_record.id;

    claimed_count := claimed_count + 1;
  end loop;

  return claimed_count;
end;
$$;

create or replace function public.set_project_request_status(
  target_request uuid,
  new_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  request_workspace uuid;
  request_project uuid;
begin
  if new_status not in ('new', 'contacted', 'accepted', 'declined') then
    raise exception 'Invalid request status';
  end if;

  select workspace_id, project_id
  into request_workspace, request_project
  from public.inquiries
  where id = target_request;

  if not found then
    raise exception 'Project request not found';
  end if;
  if not public.is_workspace_member(request_workspace) then
    raise exception 'Workspace access required';
  end if;

  update public.inquiries
  set status = new_status
  where id = target_request;

  if request_project is not null and new_status = 'accepted' then
    update public.projects
    set status = 'planning',
        updated_at = now()
    where id = request_project
      and workspace_id = request_workspace
      and status = 'inquiry';
  elsif request_project is not null and new_status = 'declined' then
    update public.projects
    set status = 'archived',
        share_with_client = false,
        updated_at = now()
    where id = request_project
      and workspace_id = request_workspace;
  end if;

  return true;
end;
$$;

revoke all on function public.claim_client_project_requests() from public;
grant execute on function public.claim_client_project_requests() to authenticated;
revoke all on function public.set_project_request_status(uuid, text) from public;
grant execute on function public.set_project_request_status(uuid, text) to authenticated;

notify pgrst, 'reload schema';

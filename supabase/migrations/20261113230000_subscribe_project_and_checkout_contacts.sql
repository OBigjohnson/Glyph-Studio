create or replace function public.submit_inquiry(
  inquiry_name text,
  inquiry_email text,
  inquiry_service text,
  inquiry_message text
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  target_workspace uuid;
  new_inquiry uuid;
begin
  if length(trim(coalesce(inquiry_name, ''))) not between 1 and 120
    or length(trim(coalesce(inquiry_email, ''))) not between 3 and 254
    or position('@' in trim(coalesce(inquiry_email, ''))) < 2
    or length(trim(coalesce(inquiry_message, ''))) not between 10 and 5000 then
    raise exception 'Please provide a name, valid email, and a message between 10 and 5000 characters';
  end if;
  select id into target_workspace from public.workspaces order by created_at limit 1;
  if target_workspace is null then
    raise exception 'Studio is not configured to receive inquiries';
  end if;
  insert into public.inquiries (workspace_id, name, email, service, message)
  values (target_workspace, trim(inquiry_name), lower(trim(inquiry_email)), trim(inquiry_service), trim(inquiry_message))
  returning id into new_inquiry;
  insert into public.newsletter_subscribers (workspace_id, email, confirmed_at)
  values (target_workspace, lower(trim(inquiry_email)), now())
  on conflict (workspace_id, email) do nothing;
  return new_inquiry;
end;
$$;

revoke all on function public.submit_inquiry(text, text, text, text) from public;
grant execute on function public.submit_inquiry(text, text, text, text) to anon, authenticated;

create or replace function public.submit_client_project_request(
  request_service text,
  request_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  client_record public.clients;
  current_user_email text;
  new_project uuid;
  service_name text;
  project_brief text;
begin
  select lower(u.email)
  into current_user_email
  from auth.users u
  where u.id = auth.uid()
    and u.email_confirmed_at is not null;

  if current_user_email is null then
    raise exception 'Confirm your email address before requesting a project';
  end if;

  service_name := left(trim(coalesce(request_service, '')), 80);
  project_brief := trim(coalesce(request_message, ''));
  if service_name = '' then
    raise exception 'Choose a service for your project request';
  end if;
  if length(project_brief) not between 10 and 5000 then
    raise exception 'Tell the studio about your project in 10 to 5000 characters';
  end if;

  select c.*
  into client_record
  from public.client_access a
  join public.clients c
    on c.workspace_id = a.workspace_id
   and c.id = a.client_id
  where a.user_id = auth.uid()
    and lower(trim(c.email)) = current_user_email
  order by c.created_at desc
  limit 1;

  if client_record.id is null then
    raise exception 'No client record is linked to this account';
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
    client_record.workspace_id,
    client_record.id,
    service_name || ' project request',
    service_name,
    project_brief,
    'inquiry',
    true
  )
  returning id into new_project;

  insert into public.inquiries (
    workspace_id,
    name,
    email,
    service,
    message,
    status,
    client_id,
    project_id
  )
  values (
    client_record.workspace_id,
    client_record.name,
    current_user_email,
    service_name,
    project_brief,
    'new',
    client_record.id,
    new_project
  );

  insert into public.newsletter_subscribers (workspace_id, email, confirmed_at)
  values (client_record.workspace_id, current_user_email, now())
  on conflict (workspace_id, email) do nothing;

  return new_project;
end;
$$;

revoke all on function public.submit_client_project_request(text, text) from public;
grant execute on function public.submit_client_project_request(text, text) to authenticated;

notify pgrst, 'reload schema';

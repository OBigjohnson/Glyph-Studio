create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare new_workspace uuid;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;

  if exists (
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

create or replace function public.get_client_invitation_email(invitation_token uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(i.email)
  from public.invitations i
  where i.token = invitation_token
  limit 1;
$$;

revoke all on function public.get_client_invitation_email(uuid) from public;
grant execute on function public.get_client_invitation_email(uuid) to anon, authenticated;

create or replace function public.is_primary_studio_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.members m on m.workspace_id = w.id
    where m.user_id = auth.uid()
      and m.role = 'owner'
      and w.owner_id = auth.uid()
      and w.id = (select id from public.workspaces order by created_at limit 1)
  );
$$;

revoke all on function public.is_primary_studio_owner() from public;
grant execute on function public.is_primary_studio_owner() to authenticated;

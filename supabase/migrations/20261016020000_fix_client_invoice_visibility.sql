create or replace function public.claim_client_access_by_email()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_email text;
  claimed_count integer;
begin
  select lower(u.email)
  into current_user_email
  from auth.users u
  where u.id = auth.uid()
    and u.email_confirmed_at is not null;

  if current_user_email is null then
    return 0;
  end if;

  insert into public.client_access (workspace_id, client_id, user_id)
  select c.workspace_id, c.id, auth.uid()
  from public.clients c
  where lower(trim(c.email)) = current_user_email
  on conflict (client_id, user_id) do nothing;

  get diagnostics claimed_count = row_count;
  return claimed_count;
end;
$$;

revoke all on function public.claim_client_access_by_email() from public;
grant execute on function public.claim_client_access_by_email() to authenticated;

update public.invoices i
set shared_with_client = true
where i.client_id is not null
  and not i.shared_with_client;

notify pgrst, 'reload schema';

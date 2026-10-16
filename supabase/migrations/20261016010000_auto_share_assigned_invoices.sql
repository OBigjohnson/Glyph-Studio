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
    and u.email_confirmed_at is not null
    and u.raw_user_meta_data->>'account_type' = 'client';

  if current_user_email is null then
    return 0;
  end if;

  insert into public.client_access (workspace_id, client_id, user_id)
  select c.workspace_id, c.id, auth.uid()
  from public.clients c
  where lower(c.email) = current_user_email
  on conflict (client_id, user_id) do nothing;

  get diagnostics claimed_count = row_count;
  return claimed_count;
end;
$$;

revoke all on function public.claim_client_access_by_email() from public;
grant execute on function public.claim_client_access_by_email() to authenticated;

create or replace function public.get_client_invoice_payment_details(target_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payment_details jsonb;
begin
  select jsonb_build_object(
    'payment_bank_name', w.payment_bank_name,
    'payment_account_name', w.payment_account_name,
    'payment_account_number', w.payment_account_number,
    'payment_reference_note', w.payment_reference_note,
    'payment_note', w.payment_note
  )
  into payment_details
  from public.invoices i
  join public.workspaces w on w.id = i.workspace_id
  where i.id = target_invoice
    and i.shared_with_client
    and public.has_client_record_access(i.workspace_id, i.client_id);

  if payment_details is null then
    raise exception 'Invoice not found or not shared with this client';
  end if;

  return payment_details;
end;
$$;

revoke all on function public.get_client_invoice_payment_details(uuid) from public;
grant execute on function public.get_client_invoice_payment_details(uuid) to authenticated;

notify pgrst, 'reload schema';

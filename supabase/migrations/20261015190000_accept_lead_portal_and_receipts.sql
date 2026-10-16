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
    select i.*
    from public.inquiries i
    where lower(i.email) = target_user_email
      and i.status <> 'declined'
      and not exists (
        select 1 from public.client_access a
        where a.workspace_id = i.workspace_id
          and a.client_id = i.client_id
          and a.user_id = auth.uid()
      )
    order by i.created_at
    for update
  loop
    target_workspace := request_record.workspace_id;
    target_client := request_record.client_id;

    if target_client is null then
      select c.id into target_client
      from public.clients c
      where c.workspace_id = target_workspace
        and lower(c.email) = target_user_email
      order by c.created_at
      limit 1;
    end if;

    if target_client is null then
      insert into public.clients (workspace_id, name, email)
      values (target_workspace, request_record.name, target_user_email)
      returning id into target_client;
    end if;

    insert into public.client_access (workspace_id, client_id, user_id)
    values (target_workspace, target_client, auth.uid())
    on conflict do nothing;

    if request_record.project_id is null then
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
    end if;

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
  request_record public.inquiries;
  target_client uuid;
  target_project uuid;
begin
  if new_status not in ('new', 'contacted', 'accepted', 'declined') then
    raise exception 'Invalid request status';
  end if;

  select * into request_record
  from public.inquiries
  where id = target_request
  for update;

  if not found then
    raise exception 'Project request not found';
  end if;
  if not public.is_workspace_member(request_record.workspace_id) then
    raise exception 'Workspace access required';
  end if;

  target_client := request_record.client_id;
  target_project := request_record.project_id;

  if new_status = 'accepted' and target_project is null then
    if target_client is null then
      select c.id into target_client
      from public.clients c
      where c.workspace_id = request_record.workspace_id
        and lower(c.email) = lower(request_record.email)
      order by c.created_at
      limit 1;

      if target_client is null then
        insert into public.clients (workspace_id, name, email)
        values (request_record.workspace_id, request_record.name, lower(request_record.email))
        returning id into target_client;
      end if;
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
      request_record.workspace_id,
      target_client,
      coalesce(nullif(trim(request_record.service), ''), 'Creative') || ' project request',
      coalesce(request_record.service, ''),
      request_record.message,
      'inquiry',
      true
    )
    returning id into target_project;
  end if;

  update public.inquiries
  set status = new_status,
      client_id = coalesce(target_client, client_id),
      project_id = coalesce(target_project, project_id)
  where id = target_request;

  if target_project is not null and new_status = 'accepted' then
    update public.projects
    set status = 'planning',
        share_with_client = true,
        updated_at = now()
    where id = target_project
      and workspace_id = request_record.workspace_id;
  elsif target_project is not null and new_status = 'declined' then
    update public.projects
    set status = 'archived',
        share_with_client = false,
        updated_at = now()
    where id = target_project
      and workspace_id = request_record.workspace_id;
  end if;

  return true;
end;
$$;

revoke all on function public.claim_client_project_requests() from public;
grant execute on function public.claim_client_project_requests() to authenticated;
revoke all on function public.set_project_request_status(uuid, text) from public;
grant execute on function public.set_project_request_status(uuid, text) to authenticated;

alter table public.payments
  add column if not exists note text not null default '';

create or replace function public.record_manual_payment(
  target_invoice uuid,
  amount_received numeric,
  payment_reference text,
  paid_on timestamptz,
  payment_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_record public.invoices;
  payment_id uuid := gen_random_uuid();
  payment_date timestamptz;
  receipt_number text;
  total_paid numeric;
  updated_status text;
begin
  select * into invoice_record
  from public.invoices
  where id = target_invoice;

  if invoice_record.id is null then
    raise exception 'Invoice not found';
  end if;
  if not public.is_workspace_member(invoice_record.workspace_id) then
    raise exception 'Workspace access required';
  end if;
  if amount_received is null or amount_received <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  payment_date := coalesce(paid_on, now());
  if payment_reference is null or btrim(payment_reference) = '' then
    payment_reference := 'MANUAL-' || invoice_record.number || '-' ||
      to_char(payment_date, 'YYYYMMDDHH24MISS') || '-' ||
      left(replace(payment_id::text, '-', ''), 8);
  end if;

  insert into public.payments (
    id,
    invoice_id,
    provider,
    provider_reference,
    amount,
    currency,
    status,
    paid_at,
    note
  )
  values (
    payment_id,
    invoice_record.id,
    'manual_bank_transfer',
    trim(payment_reference),
    amount_received,
    invoice_record.currency,
    'succeeded',
    payment_date,
    coalesce(payment_note, '')
  );

  receipt_number := 'RCPT-' ||
    coalesce(nullif(regexp_replace(invoice_record.number, '[^A-Za-z0-9]', '', 'g'), ''), 'INVOICE') ||
    '-' || to_char(payment_date, 'YYYYMMDDHH24MISS') || '-' ||
    left(replace(payment_id::text, '-', ''), 8);

  insert into public.receipts (id, payment_id, receipt_number, issued_at)
  values (gen_random_uuid(), payment_id, receipt_number, payment_date);

  select coalesce(sum(p.amount), 0) into total_paid
  from public.payments p
  where p.invoice_id = invoice_record.id
    and p.status = 'succeeded';
  updated_status := case when total_paid >= invoice_record.amount then 'paid' else 'open' end;

  update public.invoices
  set status = updated_status
  where id = invoice_record.id;

  return jsonb_build_object(
    'payment_id', payment_id,
    'receipt_number', receipt_number,
    'paid_at', payment_date,
    'status', updated_status
  );
end;
$$;

revoke all on function public.record_manual_payment(uuid, numeric, text, timestamptz, text) from public;
grant execute on function public.record_manual_payment(uuid, numeric, text, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';

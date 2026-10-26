alter table public.invoices
  add column checkout_token uuid unique default gen_random_uuid();

alter table public.payments
  alter column provider set default 'bachs';

create table public.bachs_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  expected_amount numeric(12, 2) not null check (expected_amount > 0),
  currency text not null,
  requested_percentage smallint not null check (requested_percentage in (25, 50, 75, 100)),
  bachs_checkout_id text unique,
  checkout_url text,
  status text not null default 'creating'
    check (status in ('creating', 'pending', 'succeeded', 'failed', 'expired')),
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index bachs_checkout_sessions_invoice_status_idx
  on public.bachs_checkout_sessions (invoice_id, status, created_at desc);

create table public.bachs_webhook_events (
  event_id text primary key,
  event_type text not null,
  status text not null check (status in ('processed', 'duplicate', 'rejected')),
  error text,
  created_at timestamptz not null default now()
);

alter table public.bachs_checkout_sessions enable row level security;
alter table public.bachs_webhook_events enable row level security;
revoke all on public.bachs_checkout_sessions, public.bachs_webhook_events
  from public, anon, authenticated;
grant all on public.bachs_checkout_sessions, public.bachs_webhook_events to service_role;

create or replace function public.create_invoice_checkout_link(target_invoice uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_record public.invoices;
  result_token uuid;
begin
  select * into invoice_record
  from public.invoices
  where id = target_invoice
  for update;

  if not found then
    raise exception 'Invoice not found';
  end if;
  if not public.is_workspace_member(invoice_record.workspace_id) then
    raise exception 'Workspace access required';
  end if;
  if invoice_record.status not in ('open', 'overdue') then
    raise exception 'Only unpaid invoices can have a checkout link';
  end if;

  update public.invoices
  set checkout_token = coalesce(checkout_token, gen_random_uuid())
  where id = invoice_record.id
  returning checkout_token into result_token;

  return result_token;
end;
$$;

revoke all on function public.create_invoice_checkout_link(uuid) from public, anon;
grant execute on function public.create_invoice_checkout_link(uuid) to authenticated;

create or replace function public.get_public_checkout_invoice(target_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_record public.invoices;
  client_record public.clients;
  workspace_record public.workspaces;
  amount_paid numeric(12, 2);
begin
  select * into invoice_record
  from public.invoices
  where checkout_token = target_token;

  if not found then
    return null;
  end if;

  select * into client_record
  from public.clients
  where id = invoice_record.client_id;

  select * into workspace_record
  from public.workspaces
  where id = invoice_record.workspace_id;

  select coalesce(sum(p.amount), 0)::numeric(12, 2) into amount_paid
  from public.payments p
  where p.invoice_id = invoice_record.id
    and p.status = 'succeeded';

  return jsonb_build_object(
    'invoice_id', invoice_record.id,
    'number', invoice_record.number,
    'amount', to_char(invoice_record.amount, 'FM9999999990.00'),
    'currency', invoice_record.currency,
    'status', invoice_record.status,
    'due_date', invoice_record.due_date,
    'created_at', invoice_record.created_at,
    'amount_paid', to_char(amount_paid, 'FM9999999990.00'),
    'amount_remaining', to_char(greatest(invoice_record.amount - amount_paid, 0), 'FM9999999990.00'),
    'client_name', client_record.name,
    'client_email', client_record.email,
    'studio_name', workspace_record.studio_name,
    'studio_email', workspace_record.contact_email,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'description', ii.description,
        'quantity', ii.quantity,
        'unit_amount', ii.unit_amount
      ) order by ii.sort_order, ii.id)
      from public.invoice_items ii
      where ii.invoice_id = invoice_record.id
    ), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'receipt_number', r.receipt_number,
        'issued_at', r.issued_at,
        'amount', to_char(p.amount, 'FM9999999990.00'),
        'paid_at', p.paid_at
      ) order by p.paid_at, r.issued_at)
      from public.payments p
      join public.receipts r on r.payment_id = p.id
      where p.invoice_id = invoice_record.id
        and p.status = 'succeeded'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_public_checkout_invoice(uuid) from public, anon, authenticated;
grant execute on function public.get_public_checkout_invoice(uuid) to service_role;

create or replace function public.begin_bachs_checkout(
  target_token uuid,
  requested_percentage smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_record public.invoices;
  active_checkout public.bachs_checkout_sessions;
  total_paid numeric(12, 2);
  remaining_amount numeric(12, 2);
  checkout_amount numeric(12, 2);
  new_checkout public.bachs_checkout_sessions;
begin
  if requested_percentage not in (25, 50, 75, 100) then
    raise exception 'Choose a 25%%, 50%%, 75%%, or remaining-balance payment';
  end if;

  select * into invoice_record
  from public.invoices
  where checkout_token = target_token
  for update;

  if not found then
    raise exception 'This invoice checkout link is invalid';
  end if;
  if invoice_record.status not in ('open', 'overdue') then
    raise exception 'This invoice is not available for payment';
  end if;

  select coalesce(sum(p.amount), 0)::numeric(12, 2) into total_paid
  from public.payments p
  where p.invoice_id = invoice_record.id
    and p.status = 'succeeded';
  remaining_amount := greatest(invoice_record.amount - total_paid, 0);
  if remaining_amount <= 0 then
    raise exception 'This invoice has already been paid';
  end if;

  if requested_percentage = 100 then
    checkout_amount := remaining_amount;
  else
    checkout_amount := least(
      round(invoice_record.amount * requested_percentage / 100, 2),
      remaining_amount
    );
  end if;
  if checkout_amount <= 0 then
    raise exception 'The selected payment amount is not valid';
  end if;

  update public.bachs_checkout_sessions
  set status = 'expired'
  where invoice_id = invoice_record.id
    and status = 'pending'
    and expires_at <= now();

  select * into active_checkout
  from public.bachs_checkout_sessions
  where invoice_id = invoice_record.id
    and (
      (status = 'pending' and expires_at > now())
      or (status = 'creating' and created_at > now() - interval '10 minutes')
    )
  order by created_at desc
  limit 1
  for update;

  if found then
    if active_checkout.requested_percentage <> requested_percentage
      or active_checkout.expected_amount <> checkout_amount then
      raise exception 'A checkout is already in progress for this invoice. Finish it or wait for it to expire.';
    end if;
    return jsonb_build_object(
      'reservation_id', active_checkout.id,
      'amount', to_char(active_checkout.expected_amount, 'FM9999999990.00'),
      'currency', active_checkout.currency,
      'checkout_id', active_checkout.bachs_checkout_id,
      'checkout_url', active_checkout.checkout_url,
      'expires_at', active_checkout.expires_at,
      'status', active_checkout.status
    );
  end if;

  update public.bachs_checkout_sessions
  set status = 'expired'
  where invoice_id = invoice_record.id
    and status = 'creating'
    and created_at <= now() - interval '10 minutes';

  insert into public.bachs_checkout_sessions (
    invoice_id,
    expected_amount,
    currency,
    requested_percentage
  )
  values (
    invoice_record.id,
    checkout_amount,
    invoice_record.currency,
    requested_percentage
  )
  returning * into new_checkout;

  return jsonb_build_object(
    'reservation_id', new_checkout.id,
    'amount', to_char(new_checkout.expected_amount, 'FM9999999990.00'),
    'currency', new_checkout.currency,
    'status', new_checkout.status
  );
end;
$$;

revoke all on function public.begin_bachs_checkout(uuid, smallint) from public, anon, authenticated;
grant execute on function public.begin_bachs_checkout(uuid, smallint) to service_role;

create or replace function public.finish_bachs_checkout(
  reservation_id uuid,
  provider_checkout_id text,
  hosted_checkout_url text,
  checkout_expiry timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  checkout_record public.bachs_checkout_sessions;
begin
  if provider_checkout_id is null or btrim(provider_checkout_id) = ''
    or hosted_checkout_url is null or checkout_expiry is null then
    raise exception 'Bachs returned incomplete checkout details';
  end if;

  select * into checkout_record
  from public.bachs_checkout_sessions
  where id = reservation_id
  for update;

  if not found then
    raise exception 'Checkout reservation not found';
  end if;

  if checkout_record.status = 'pending'
    and checkout_record.bachs_checkout_id = provider_checkout_id then
    return true;
  end if;
  if checkout_record.status <> 'creating' then
    raise exception 'Checkout reservation is no longer active';
  end if;

  update public.bachs_checkout_sessions
  set bachs_checkout_id = provider_checkout_id,
      checkout_url = hosted_checkout_url,
      expires_at = checkout_expiry,
      status = 'pending'
  where id = reservation_id;

  return true;
end;
$$;

revoke all on function public.finish_bachs_checkout(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finish_bachs_checkout(uuid, text, text, timestamptz)
  to service_role;

create or replace function public.process_bachs_collection(
  provider_event_id text,
  provider_checkout_id text,
  provider_charge_id text,
  received_amount numeric,
  received_currency text,
  provider_paid_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  checkout_record public.bachs_checkout_sessions;
  invoice_record public.invoices;
  existing_event public.bachs_webhook_events;
  payment_id uuid;
  receipt_number text;
  payment_date timestamptz;
  total_paid numeric(12, 2);
  updated_status text;
begin
  if provider_event_id is null or btrim(provider_event_id) = ''
    or provider_checkout_id is null or btrim(provider_checkout_id) = ''
    or provider_charge_id is null or btrim(provider_charge_id) = ''
    or received_amount is null or received_amount <= 0
    or received_currency is null or btrim(received_currency) = '' then
    raise exception 'Bachs collection event is missing required payment details';
  end if;

  select * into existing_event
  from public.bachs_webhook_events
  where event_id = provider_event_id;
  if found then
    return jsonb_build_object('status', existing_event.status);
  end if;

  select * into checkout_record
  from public.bachs_checkout_sessions
  where bachs_checkout_id = provider_checkout_id
  for update;
  if not found then
    raise exception 'Bachs checkout session is not associated with an invoice';
  end if;

  if checkout_record.status = 'succeeded' then
    insert into public.bachs_webhook_events (event_id, event_type, status)
    values (provider_event_id, 'collection.succeeded', 'duplicate')
    on conflict (event_id) do nothing;
    return jsonb_build_object('status', 'duplicate');
  end if;

  if checkout_record.expected_amount <> received_amount
    or upper(checkout_record.currency) <> upper(received_currency) then
    insert into public.bachs_webhook_events (event_id, event_type, status, error)
    values (
      provider_event_id,
      'collection.succeeded',
      'rejected',
      'The paid amount or currency does not match the invoice checkout'
    )
    on conflict (event_id) do nothing;
    return jsonb_build_object('status', 'rejected');
  end if;

  select * into invoice_record
  from public.invoices
  where id = checkout_record.invoice_id
  for update;

  if exists (
    select 1 from public.payments where provider_reference = provider_charge_id
  ) then
    insert into public.bachs_webhook_events (event_id, event_type, status)
    values (provider_event_id, 'collection.succeeded', 'duplicate')
    on conflict (event_id) do nothing;
    return jsonb_build_object('status', 'duplicate');
  end if;

  payment_date := coalesce(provider_paid_at, now());
  payment_id := gen_random_uuid();
  receipt_number := 'RCPT-' ||
    regexp_replace(invoice_record.number, '[^A-Za-z0-9]', '', 'g') || '-' ||
    to_char(payment_date, 'YYYYMMDDHH24MISS') || '-' ||
    substr(replace(payment_id::text, '-', ''), 1, 6);

  insert into public.payments (
    id,
    invoice_id,
    provider,
    provider_reference,
    amount,
    currency,
    status,
    paid_at
  )
  values (
    payment_id,
    invoice_record.id,
    'bachs',
    provider_charge_id,
    received_amount,
    upper(received_currency),
    'succeeded',
    payment_date
  );

  insert into public.receipts (payment_id, receipt_number, issued_at)
  values (payment_id, receipt_number, payment_date);

  select coalesce(sum(p.amount), 0)::numeric(12, 2) into total_paid
  from public.payments p
  where p.invoice_id = invoice_record.id
    and p.status = 'succeeded';

  updated_status := case when total_paid >= invoice_record.amount then 'paid' else 'open' end;
  update public.invoices
  set status = updated_status
  where id = invoice_record.id;

  update public.bachs_checkout_sessions
  set status = 'succeeded',
      paid_at = payment_date
  where id = checkout_record.id;

  insert into public.bachs_webhook_events (event_id, event_type, status)
  values (provider_event_id, 'collection.succeeded', 'processed')
  on conflict (event_id) do nothing;

  return jsonb_build_object(
    'status', 'processed',
    'payment_id', payment_id,
    'receipt_number', receipt_number,
    'paid_at', payment_date,
    'amount_paid', to_char(total_paid, 'FM9999999990.00'),
    'amount_remaining', to_char(greatest(invoice_record.amount - total_paid, 0), 'FM9999999990.00'),
    'invoice_status', updated_status
  );
end;
$$;

revoke all on function public.process_bachs_collection(text, text, text, numeric, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_bachs_collection(text, text, text, numeric, text, timestamptz)
  to service_role;

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
  payment_id uuid;
  payment_date timestamptz;
  receipt_number text;
  total_paid numeric(12, 2);
  updated_status text;
begin
  select * into invoice_record
  from public.invoices
  where id = target_invoice
  for update;

  if not found then
    raise exception 'Invoice not found';
  end if;
  if not public.is_workspace_member(invoice_record.workspace_id) then
    raise exception 'Workspace access required';
  end if;
  if invoice_record.status not in ('open', 'overdue') then
    raise exception 'Only unpaid invoices can receive a payment';
  end if;
  if amount_received is null or amount_received <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  select coalesce(sum(p.amount), 0)::numeric(12, 2) into total_paid
  from public.payments p
  where p.invoice_id = invoice_record.id
    and p.status = 'succeeded';
  if amount_received > invoice_record.amount - total_paid then
    raise exception 'Payment amount cannot exceed the remaining invoice balance';
  end if;

  payment_date := coalesce(paid_on, now());
  if payment_reference is null or btrim(payment_reference) = '' then
    payment_reference := 'MANUAL-' || invoice_record.number || '-' ||
      to_char(payment_date, 'YYYYMMDDHH24MISS');
  end if;

  payment_id := gen_random_uuid();
  insert into public.payments (
    id, invoice_id, provider, provider_reference, amount, currency, status, paid_at
  )
  values (
    payment_id,
    invoice_record.id,
    'manual_bank_transfer',
    trim(payment_reference) || '-' || payment_id::text,
    amount_received,
    invoice_record.currency,
    'succeeded',
    payment_date
  );

  receipt_number := 'RCPT-' ||
    regexp_replace(invoice_record.number, '[^A-Za-z0-9]', '', 'g') || '-' ||
    to_char(payment_date, 'YYYYMMDDHH24MISS') || '-' ||
    substr(replace(payment_id::text, '-', ''), 1, 6);

  insert into public.receipts (payment_id, receipt_number, issued_at)
  values (payment_id, receipt_number, payment_date);

  total_paid := total_paid + amount_received;
  updated_status := case when total_paid >= invoice_record.amount then 'paid' else 'open' end;
  update public.invoices
  set status = updated_status
  where id = invoice_record.id;

  return jsonb_build_object(
    'payment_id', payment_id,
    'receipt_number', receipt_number,
    'paid_at', payment_date,
    'status', updated_status,
    'amount_paid', total_paid,
    'amount_remaining', greatest(invoice_record.amount - total_paid, 0)
  );
end;
$$;

revoke all on function public.record_manual_payment(uuid, numeric, text, timestamptz, text) from public;
grant execute on function public.record_manual_payment(uuid, numeric, text, timestamptz, text) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoices'
    ) then
      alter publication supabase_realtime add table public.invoices;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payments'
    ) then
      alter publication supabase_realtime add table public.payments;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'receipts'
    ) then
      alter publication supabase_realtime add table public.receipts;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';

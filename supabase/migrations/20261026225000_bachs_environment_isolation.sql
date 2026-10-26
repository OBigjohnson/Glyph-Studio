alter table public.bachs_checkout_sessions
  add column checkout_environment text not null default 'sandbox'
    check (checkout_environment in ('sandbox', 'live'));

alter table public.bachs_checkout_sessions
  add column checkout_organization_id text not null default 'legacy-sandbox'
    check (length(btrim(checkout_organization_id)) > 0);

create index bachs_checkout_sessions_environment_status_idx
  on public.bachs_checkout_sessions (
    invoice_id,
    checkout_environment,
    checkout_organization_id,
    status,
    created_at desc
  );

create or replace function public.begin_bachs_checkout(
  target_token uuid,
  requested_percentage smallint,
  requested_environment text,
  requested_organization_id text
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
  if requested_environment not in ('sandbox', 'live') then
    raise exception 'Choose the sandbox or live Bachs environment';
  end if;
  if requested_organization_id is null or btrim(requested_organization_id) = '' then
    raise exception 'A Bachs organization ID is required';
  end if;
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
    and checkout_environment = requested_environment
    and checkout_organization_id = requested_organization_id
    and status = 'pending'
    and expires_at <= now();

  select * into active_checkout
  from public.bachs_checkout_sessions
  where invoice_id = invoice_record.id
    and checkout_environment = requested_environment
    and checkout_organization_id = requested_organization_id
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
    and checkout_environment = requested_environment
    and checkout_organization_id = requested_organization_id
    and status = 'creating'
    and created_at <= now() - interval '10 minutes';

  insert into public.bachs_checkout_sessions (
    invoice_id,
    expected_amount,
    currency,
    requested_percentage,
    checkout_environment,
    checkout_organization_id
  )
  values (
    invoice_record.id,
    checkout_amount,
    invoice_record.currency,
    requested_percentage,
    requested_environment,
    requested_organization_id
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

create or replace function public.begin_bachs_checkout(
  target_token uuid,
  requested_percentage smallint,
  requested_environment text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.begin_bachs_checkout(
    target_token,
    requested_percentage,
    requested_environment,
    'legacy-sandbox'
  );
$$;

create or replace function public.begin_bachs_checkout(
  target_token uuid,
  requested_percentage smallint
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.begin_bachs_checkout(
    target_token,
    requested_percentage,
    'sandbox',
    'legacy-sandbox'
  );
$$;

revoke all on function public.begin_bachs_checkout(uuid, smallint, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_bachs_checkout(uuid, smallint, text, text)
  to service_role;
revoke all on function public.begin_bachs_checkout(uuid, smallint, text)
  from public, anon, authenticated;
grant execute on function public.begin_bachs_checkout(uuid, smallint, text)
  to service_role;
revoke all on function public.begin_bachs_checkout(uuid, smallint)
  from public, anon, authenticated;
grant execute on function public.begin_bachs_checkout(uuid, smallint)
  to service_role;

create or replace function public.process_bachs_collection(
  provider_event_id text,
  provider_checkout_id text,
  provider_charge_id text,
  received_amount numeric,
  received_currency text,
  provider_paid_at timestamptz,
  requested_environment text,
  requested_organization_id text
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
  remaining_amount numeric(12, 2);
  updated_status text;
begin
  if requested_environment not in ('sandbox', 'live') then
    raise exception 'Choose the sandbox or live Bachs environment';
  end if;
  if requested_organization_id is null or btrim(requested_organization_id) = '' then
    raise exception 'A Bachs organization ID is required';
  end if;
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
    and checkout_environment = requested_environment
    and checkout_organization_id = requested_organization_id
  for update;
  if not found then
    raise exception 'Bachs checkout session is not associated with this environment';
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
  if not found then
    raise exception 'The invoice for this Bachs checkout no longer exists';
  end if;

  if exists (
    select 1 from public.payments where provider_reference = provider_charge_id
  ) then
    insert into public.bachs_webhook_events (event_id, event_type, status)
    values (provider_event_id, 'collection.succeeded', 'duplicate')
    on conflict (event_id) do nothing;
    return jsonb_build_object('status', 'duplicate');
  end if;

  select coalesce(sum(p.amount), 0)::numeric(12, 2) into total_paid
  from public.payments p
  where p.invoice_id = invoice_record.id
    and p.status = 'succeeded';
  remaining_amount := greatest(invoice_record.amount - total_paid, 0);
  if received_amount > remaining_amount then
    insert into public.bachs_webhook_events (event_id, event_type, status, error)
    values (
      provider_event_id,
      'collection.succeeded',
      'rejected',
      'The invoice balance changed while this checkout was pending'
    )
    on conflict (event_id) do nothing;
    return jsonb_build_object('status', 'rejected');
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

  total_paid := total_paid + received_amount;
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

create or replace function public.process_bachs_collection(
  provider_event_id text,
  provider_checkout_id text,
  provider_charge_id text,
  received_amount numeric,
  received_currency text,
  provider_paid_at timestamptz
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.process_bachs_collection(
    provider_event_id,
    provider_checkout_id,
    provider_charge_id,
    received_amount,
    received_currency,
    provider_paid_at,
    'sandbox',
    'legacy-sandbox'
  );
$$;

create or replace function public.process_bachs_collection(
  provider_event_id text,
  provider_checkout_id text,
  provider_charge_id text,
  received_amount numeric,
  received_currency text,
  provider_paid_at timestamptz,
  requested_environment text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.process_bachs_collection(
    provider_event_id,
    provider_checkout_id,
    provider_charge_id,
    received_amount,
    received_currency,
    provider_paid_at,
    requested_environment,
    'legacy-sandbox'
  );
$$;

revoke all on function public.process_bachs_collection(text, text, text, numeric, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.process_bachs_collection(text, text, text, numeric, text, timestamptz, text, text)
  to service_role;
revoke all on function public.process_bachs_collection(text, text, text, numeric, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.process_bachs_collection(text, text, text, numeric, text, timestamptz, text)
  to service_role;
revoke all on function public.process_bachs_collection(text, text, text, numeric, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_bachs_collection(text, text, text, numeric, text, timestamptz)
  to service_role;

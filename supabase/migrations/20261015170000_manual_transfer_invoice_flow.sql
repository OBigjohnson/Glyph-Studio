alter table public.workspaces
  add column if not exists payment_bank_name text,
  add column if not exists payment_account_name text,
  add column if not exists payment_account_number text,
  add column if not exists payment_reference_note text,
  add column if not exists payment_note text;

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
    payment_reference := 'MANUAL-' || invoice_record.number || '-' || to_char(payment_date, 'YYYYMMDDHH24MISS');
  end if;

  payment_id := gen_random_uuid();

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
    'manual_bank_transfer',
    trim(payment_reference),
    amount_received,
    invoice_record.currency,
    'succeeded',
    payment_date
  );

  receipt_number := 'RCPT-' || regexp_replace(invoice_record.number, '[^A-Za-z0-9]', '', 'g') || '-' || to_char(payment_date, 'YYYYMMDDHH24MISS');

  insert into public.receipts (id, payment_id, receipt_number, issued_at)
  values (gen_random_uuid(), payment_id, receipt_number, payment_date);

  update public.invoices
  set status = case when amount_received >= invoice_record.amount then 'paid' else 'open' end
  where id = invoice_record.id;

  return jsonb_build_object(
    'payment_id', payment_id,
    'receipt_number', receipt_number,
    'paid_at', payment_date,
    'status', case when amount_received >= invoice_record.amount then 'paid' else 'open' end
  );
end;
$$;

revoke all on function public.record_manual_payment(uuid, numeric, text, timestamptz, text) from public;
grant execute on function public.record_manual_payment(uuid, numeric, text, timestamptz, text) to authenticated;

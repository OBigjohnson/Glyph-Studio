alter table public.invoice_items
  add column sort_order integer not null default 0;

create or replace function public.create_studio_invoice(
  target_workspace uuid,
  target_client uuid,
  target_project uuid,
  invoice_number text,
  invoice_due_date date,
  invoice_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_invoice uuid;
  item_record jsonb;
  item_description text;
  item_quantity numeric;
  item_unit_amount numeric;
  invoice_total numeric := 0;
  item_index integer := 0;
begin
  if not public.is_workspace_member(target_workspace) then
    raise exception 'Workspace access required';
  end if;
  if length(trim(invoice_number)) not between 1 and 80 then
    raise exception 'Enter an invoice number';
  end if;
  if jsonb_typeof(invoice_items) is distinct from 'array' then
    raise exception 'Add at least one invoice line item';
  end if;
  if jsonb_array_length(invoice_items) = 0 then
    raise exception 'Add at least one invoice line item';
  end if;
  if target_client is not null and not exists (
    select 1 from public.clients c where c.id = target_client and c.workspace_id = target_workspace
  ) then
    raise exception 'Client is not in this workspace';
  end if;
  if target_project is not null and not exists (
    select 1 from public.projects p where p.id = target_project and p.workspace_id = target_workspace
  ) then
    raise exception 'Project is not in this workspace';
  end if;

  for item_record in select value from jsonb_array_elements(invoice_items)
  loop
    if jsonb_typeof(item_record->'description') is distinct from 'string'
      or jsonb_typeof(item_record->'unit_amount') is distinct from 'number'
      or (
        item_record ? 'quantity'
        and jsonb_typeof(item_record->'quantity') is distinct from 'number'
      ) then
      raise exception 'Each line item needs a description, quantity, and unit price';
    end if;

    item_description := btrim(item_record->>'description');
    item_quantity := coalesce((item_record->>'quantity')::numeric, 1);
    item_unit_amount := (item_record->>'unit_amount')::numeric;
    if length(item_description) not between 1 and 500
      or item_quantity <= 0
      or item_unit_amount < 0 then
      raise exception 'Line item descriptions, quantities, or prices are invalid';
    end if;

    invoice_total := invoice_total + round(round(item_quantity, 2) * round(item_unit_amount, 2), 2);
  end loop;

  if invoice_total <= 0 then
    raise exception 'The invoice total must be greater than zero';
  end if;

  insert into public.invoices (
    workspace_id,
    client_id,
    project_id,
    number,
    amount,
    currency,
    status,
    due_date
  )
  values (
    target_workspace,
    target_client,
    target_project,
    trim(invoice_number),
    invoice_total,
    'NGN',
    'open',
    invoice_due_date
  )
  returning id into new_invoice;

  item_index := 0;
  for item_record in select value from jsonb_array_elements(invoice_items)
  loop
    item_index := item_index + 1;
    insert into public.invoice_items (
      invoice_id,
      description,
      quantity,
      unit_amount,
      sort_order
    )
    values (
      new_invoice,
      btrim(item_record->>'description'),
      round(coalesce((item_record->>'quantity')::numeric, 1), 2),
      round((item_record->>'unit_amount')::numeric, 2),
      item_index
    );
  end loop;

  return new_invoice;
end;
$$;

revoke all on function public.create_studio_invoice(uuid, uuid, uuid, text, date, jsonb) from public;
grant execute on function public.create_studio_invoice(uuid, uuid, uuid, text, date, jsonb) to authenticated;

notify pgrst, 'reload schema';

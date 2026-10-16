alter table public.invoices
  add column shared_with_client boolean not null default false;

update public.invoices i
set shared_with_client = true
where exists (
  select 1 from public.client_access a
  where a.workspace_id = i.workspace_id
    and a.client_id = i.client_id
);

drop policy if exists "clients read own invoices" on public.invoices;
create policy "clients read shared invoices"
  on public.invoices for select
  using (
    shared_with_client
    and exists (
      select 1 from public.client_access a
      where a.workspace_id = invoices.workspace_id
        and a.client_id = invoices.client_id
        and a.user_id = auth.uid()
    )
  );

drop policy if exists "invoice participants read line items" on public.invoice_items;
create policy "invoice participants read shared line items"
  on public.invoice_items for select
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id
      and (
        public.is_workspace_member(i.workspace_id)
        or (
          i.shared_with_client
          and exists (
            select 1 from public.client_access a
            where a.workspace_id = i.workspace_id
              and a.client_id = i.client_id
              and a.user_id = auth.uid()
          )
        )
      )
  ));

drop policy if exists "invoice participants read payments" on public.payments;
create policy "invoice participants read shared payments"
  on public.payments for select
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id
      and (
        public.is_workspace_member(i.workspace_id)
        or (
          i.shared_with_client
          and exists (
            select 1 from public.client_access a
            where a.workspace_id = i.workspace_id
              and a.client_id = i.client_id
              and a.user_id = auth.uid()
          )
        )
      )
  ));

drop policy if exists "invoice participants read receipts" on public.receipts;
create policy "invoice participants read shared receipts"
  on public.receipts for select
  using (exists (
    select 1
    from public.payments p
    join public.invoices i on i.id = p.invoice_id
    where p.id = payment_id
      and (
        public.is_workspace_member(i.workspace_id)
        or (
          i.shared_with_client
          and exists (
            select 1 from public.client_access a
            where a.workspace_id = i.workspace_id
              and a.client_id = i.client_id
              and a.user_id = auth.uid()
          )
        )
      )
  ));

create or replace function public.set_invoice_client_sharing(
  target_invoice uuid,
  should_share boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_workspace uuid;
  invoice_client uuid;
begin
  select i.workspace_id, i.client_id
    into invoice_workspace, invoice_client
  from public.invoices i
  where i.id = target_invoice;

  if not found then
    raise exception 'Invoice not found';
  end if;
  if not public.is_workspace_member(invoice_workspace) then
    raise exception 'Workspace access required';
  end if;
  if invoice_client is null then
    raise exception 'Link this invoice to a client before sharing it';
  end if;

  update public.invoices
  set shared_with_client = should_share
  where id = target_invoice;

  return true;
end;
$$;

revoke all on function public.set_invoice_client_sharing(uuid, boolean) from public;
grant execute on function public.set_invoice_client_sharing(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
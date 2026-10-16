drop policy if exists "workspace members delete draft invoices" on public.invoices;
create policy "workspace members delete invoices"
  on public.invoices for delete
  using (public.is_workspace_member(workspace_id));

create policy "workspace members delete receipts"
  on public.receipts for delete
  using (exists (
    select 1
    from public.payments p
    join public.invoices i on i.id = p.invoice_id
    where p.id = payment_id
      and public.is_workspace_member(i.workspace_id)
  ));

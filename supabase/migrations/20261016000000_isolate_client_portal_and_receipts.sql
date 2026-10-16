create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members m
    where m.workspace_id = target_workspace
      and m.user_id = auth.uid()
      and m.role in ('owner', 'collaborator')
      and coalesce(
        (select u.raw_user_meta_data->>'account_type'
         from auth.users u
         where u.id = auth.uid()),
        ''
      ) <> 'client'
  );
$$;

create or replace function public.has_client_record_access(
  target_workspace uuid,
  target_client uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.client_access a
    join public.clients c
      on c.workspace_id = a.workspace_id
     and c.id = a.client_id
    join auth.users u on u.id = a.user_id
    where a.workspace_id = target_workspace
      and a.client_id = target_client
      and a.user_id = auth.uid()
      and (
        lower(c.email) = lower(u.email)
        or exists (
          select 1
          from public.invitations i
          where i.workspace_id = a.workspace_id
            and i.client_id = a.client_id
            and i.accepted_at is not null
            and lower(i.email) = lower(u.email)
        )
      )
  );
$$;

create or replace function public.has_client_access(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project
      and p.share_with_client
      and public.has_client_record_access(p.workspace_id, p.client_id)
  );
$$;

revoke all on function public.has_client_record_access(uuid, uuid) from public;
grant execute on function public.has_client_record_access(uuid, uuid) to authenticated;

delete from public.client_access a
using public.clients c, auth.users u
where c.workspace_id = a.workspace_id
  and c.id = a.client_id
  and u.id = a.user_id
  and not (
    coalesce(lower(c.email) = lower(u.email), false)
    or exists (
      select 1
      from public.invitations i
      where i.workspace_id = a.workspace_id
        and i.client_id = a.client_id
        and i.accepted_at is not null
        and lower(i.email) = lower(u.email)
    )
  );

drop policy if exists "clients read shared invoices" on public.invoices;
create policy "clients read own shared invoices"
  on public.invoices for select
  using (
    shared_with_client
    and public.has_client_record_access(workspace_id, client_id)
  );

drop policy if exists "invoice participants read shared line items" on public.invoice_items;
create policy "invoice participants read scoped line items"
  on public.invoice_items for select
  using (exists (
    select 1
    from public.invoices i
    where i.id = invoice_id
      and (
        public.is_workspace_member(i.workspace_id)
        or (
          i.shared_with_client
          and public.has_client_record_access(i.workspace_id, i.client_id)
        )
      )
  ));

drop policy if exists "invoice participants read shared payments" on public.payments;
create policy "invoice participants read scoped payments"
  on public.payments for select
  using (exists (
    select 1
    from public.invoices i
    where i.id = invoice_id
      and (
        public.is_workspace_member(i.workspace_id)
        or (
          i.shared_with_client
          and public.has_client_record_access(i.workspace_id, i.client_id)
        )
      )
  ));

drop policy if exists "invoice participants read shared receipts" on public.receipts;
create policy "invoice participants read scoped receipts"
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
          and public.has_client_record_access(i.workspace_id, i.client_id)
        )
      )
  ));

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
  target_project uuid;
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
      and not public.has_client_record_access(i.workspace_id, i.client_id)
    order by i.created_at
    for update
  loop
    target_workspace := request_record.workspace_id;
    target_project := request_record.project_id;

    select c.id into target_client
    from public.clients c
    where c.workspace_id = target_workspace
      and lower(c.email) = target_user_email
    order by c.created_at
    limit 1;

    if target_client is null then
      insert into public.clients (workspace_id, name, email)
      values (target_workspace, request_record.name, target_user_email)
      returning id into target_client;
    end if;

    insert into public.client_access (workspace_id, client_id, user_id)
    values (target_workspace, target_client, auth.uid())
    on conflict do nothing;

    if target_project is null then
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
      returning id into target_project;
    else
      update public.projects
      set client_id = target_client,
          share_with_client = true
      where id = target_project
        and workspace_id = target_workspace;
    end if;

    update public.inquiries
    set client_id = target_client,
        project_id = target_project
    where id = request_record.id;

    claimed_count := claimed_count + 1;
  end loop;

  return claimed_count;
end;
$$;

revoke all on function public.claim_client_project_requests() from public;
grant execute on function public.claim_client_project_requests() to authenticated;

notify pgrst, 'reload schema';

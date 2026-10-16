-- Fresh clean-start baseline for GLYPH Studio.
create extension if not exists pgcrypto;

create type public.workspace_role as enum ('owner', 'collaborator', 'client');
create type public.project_status as enum ('inquiry', 'planning', 'active', 'review', 'complete', 'archived');
create type public.task_status as enum ('todo', 'in_progress', 'done');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade unique,
  studio_name text not null default 'GLYPH Creative Studio',
  slug text not null unique,
  contact_email text,
  brand_color text not null default '#2946d8',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'collaborator',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  company text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table public.client_access (
  workspace_id uuid not null,
  client_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (client_id, user_id),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null,
  email text not null,
  token uuid not null default gen_random_uuid() unique,
  invited_by uuid not null references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid,
  name text not null,
  service text not null default '',
  brief text not null default '',
  status public.project_status not null default 'planning',
  start_date date,
  due_date date,
  share_with_client boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete set null (client_id)
);

create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  title text not null,
  status public.task_status not null default 'todo',
  due_date date,
  visible_to_client boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade
);

create table public.project_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  title text not null default '',
  body text not null,
  kind text not null default 'note' check (kind in ('note', 'decision', 'meeting', 'brief')),
  source text not null default 'studio' check (source in ('studio', 'whatsapp', 'meeting', 'email')),
  visible_to_client boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade
);

create table public.project_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  label text not null,
  url text not null,
  kind text not null default 'drive' check (kind in ('drive', 'deliverable', 'reference', 'other')),
  visible_to_client boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade
);

create table public.project_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  sender_id uuid not null references auth.users(id),
  body text not null check (length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade
);

create table public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid,
  slug text not null unique,
  title text not null,
  service text not null default '',
  summary text not null default '',
  cover_path text,
  published boolean not null default false,
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete set null (project_id)
);

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  email text not null,
  service text not null default '',
  message text not null,
  created_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid,
  project_id uuid,
  number text not null,
  currency text not null default 'NGN',
  amount numeric(12,2) not null default 0 check (amount >= 0),
  status text not null default 'draft' check (status in ('draft', 'open', 'paid', 'void', 'overdue')),
  due_date date,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete set null (project_id),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete set null (client_id),
  unique (workspace_id, number)
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_amount numeric(12,2) not null default 0 check (unit_amount >= 0)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  provider text not null default 'korapay',
  provider_reference text not null unique,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'NGN',
  status text not null check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments(id) on delete cascade,
  receipt_number text not null unique,
  issued_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid,
  description text not null,
  category text not null default 'other',
  amount numeric(12,2) not null check (amount >= 0),
  incurred_on date not null default current_date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete set null (project_id)
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  summary text not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade
);

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.members
    where workspace_id = target_workspace and user_id = auth.uid()
  );
$$;

create or replace function public.has_client_access(target_project uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.projects p
    join public.client_access a on a.workspace_id = p.workspace_id and a.client_id = p.client_id
    where p.id = target_project and a.user_id = auth.uid() and p.share_with_client
  );
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare new_workspace uuid;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  insert into public.workspaces (owner_id, studio_name, slug, contact_email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'studio_name', ''), 'GLYPH Creative Studio'),
    'glyph-' || replace(new.id::text, '-', ''),
    new.email
  )
  on conflict (owner_id) do nothing
  returning id into new_workspace;
  if new_workspace is null then
    select id into new_workspace from public.workspaces where owner_id = new.id;
  end if;
  insert into public.members (workspace_id, user_id, role)
  values (new_workspace, new.id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.submit_inquiry(
  inquiry_name text,
  inquiry_email text,
  inquiry_service text,
  inquiry_message text
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare target_workspace uuid;
declare new_inquiry uuid;
begin
  if length(trim(coalesce(inquiry_name, ''))) not between 1 and 120
    or length(trim(coalesce(inquiry_email, ''))) not between 3 and 254
    or position('@' in trim(coalesce(inquiry_email, ''))) < 2
    or length(trim(coalesce(inquiry_message, ''))) not between 10 and 5000 then
    raise exception 'Please provide a name, valid email, and a message between 10 and 5000 characters';
  end if;
  select id into target_workspace from public.workspaces order by created_at limit 1;
  if target_workspace is null then
    raise exception 'Studio is not configured to receive inquiries';
  end if;
  insert into public.inquiries (workspace_id, name, email, service, message)
  values (target_workspace, trim(inquiry_name), lower(trim(inquiry_email)), trim(inquiry_service), trim(inquiry_message))
  returning id into new_inquiry;
  return new_inquiry;
end;
$$;

create or replace function public.accept_client_invitation(invitation_token uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare invitation public.invitations;
begin
  select * into invitation from public.invitations
  where token = invitation_token
    and lower(email) = lower((select email from auth.users where id = auth.uid()));
  if invitation.id is null then return false; end if;
  if invitation.accepted_at is not null then
    return exists (
      select 1 from public.client_access
      where workspace_id = invitation.workspace_id
        and client_id = invitation.client_id
        and user_id = auth.uid()
    );
  end if;
  insert into public.client_access (workspace_id, client_id, user_id)
  values (invitation.workspace_id, invitation.client_id, auth.uid())
  on conflict do nothing;
  update public.invitations set accepted_at = now() where id = invitation.id;
  return true;
end;
$$;

create or replace function public.create_studio_invoice(
  target_workspace uuid,
  target_client uuid,
  target_project uuid,
  invoice_number text,
  invoice_amount numeric,
  invoice_due_date date,
  item_description text
)
returns uuid language plpgsql security invoker set search_path = public
as $$
declare new_invoice uuid;
begin
  if not public.is_workspace_member(target_workspace) then
    raise exception 'Workspace access required';
  end if;
  if length(trim(invoice_number)) not between 1 and 80
    or length(trim(item_description)) not between 1 and 500
    or invoice_amount <= 0 then
    raise exception 'Enter an invoice number, a line item, and an amount greater than zero';
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
  insert into public.invoices (workspace_id, client_id, project_id, number, amount, currency, status, due_date)
  values (target_workspace, target_client, target_project, trim(invoice_number), invoice_amount, 'NGN', 'open', invoice_due_date)
  returning id into new_invoice;
  insert into public.invoice_items (invoice_id, description, quantity, unit_amount)
  values (new_invoice, trim(item_description), 1, invoice_amount);
  return new_invoice;
end;
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.members enable row level security;
alter table public.clients enable row level security;
alter table public.client_access enable row level security;
alter table public.invitations enable row level security;
alter table public.projects enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_notes enable row level security;
alter table public.project_links enable row level security;
alter table public.project_messages enable row level security;
alter table public.portfolio_items enable row level security;
alter table public.inquiries enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.receipts enable row level security;
alter table public.expenses enable row level security;
alter table public.activity_events enable row level security;

create policy "profiles owner access" on public.profiles for all
using (id = auth.uid()) with check (id = auth.uid());
create policy "workspace member read" on public.workspaces for select
using (public.is_workspace_member(id));
create policy "workspace owner update" on public.workspaces for update
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "members can read own membership" on public.members for select
using (user_id = auth.uid() or public.is_workspace_member(workspace_id));

create policy "workspace members manage clients" on public.clients for all
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "clients read own linked record" on public.clients for select
using (exists (select 1 from public.client_access a where a.client_id = id and a.user_id = auth.uid()));
create policy "workspace members manage invitations" on public.invitations for all
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id) and invited_by = auth.uid());
create policy "clients read own access" on public.client_access for select
using (user_id = auth.uid() or public.is_workspace_member(workspace_id));

create policy "projects workspace or assigned client" on public.projects for select
using (public.is_workspace_member(workspace_id) or public.has_client_access(id));
create policy "members create projects" on public.projects for insert
with check (
  public.is_workspace_member(workspace_id)
  and (client_id is null or exists (
    select 1 from public.clients c where c.id = client_id and c.workspace_id = projects.workspace_id
  ))
);
create policy "members update projects" on public.projects for update
using (public.is_workspace_member(workspace_id))
with check (
  public.is_workspace_member(workspace_id)
  and (client_id is null or exists (
    select 1 from public.clients c where c.id = client_id and c.workspace_id = projects.workspace_id
  ))
);
create policy "members delete projects" on public.projects for delete
using (public.is_workspace_member(workspace_id));

create policy "members manage tasks" on public.project_tasks for all
using (public.is_workspace_member(workspace_id))
with check (
  public.is_workspace_member(workspace_id)
  and created_by = auth.uid()
  and exists (select 1 from public.projects p where p.id = project_id and p.workspace_id = project_tasks.workspace_id)
);
create policy "clients read shared tasks" on public.project_tasks for select
using (visible_to_client and public.has_client_access(project_id));
create policy "members manage notes" on public.project_notes for all
using (public.is_workspace_member(workspace_id))
with check (
  public.is_workspace_member(workspace_id)
  and created_by = auth.uid()
  and exists (select 1 from public.projects p where p.id = project_id and p.workspace_id = project_notes.workspace_id)
);
create policy "clients read shared notes" on public.project_notes for select
using (visible_to_client and public.has_client_access(project_id));
create policy "members manage links" on public.project_links for all
using (public.is_workspace_member(workspace_id))
with check (
  public.is_workspace_member(workspace_id)
  and created_by = auth.uid()
  and exists (select 1 from public.projects p where p.id = project_id and p.workspace_id = project_links.workspace_id)
);
create policy "clients read shared links" on public.project_links for select
using (visible_to_client and public.has_client_access(project_id));
create policy "project message participants read" on public.project_messages for select
using (public.is_workspace_member(workspace_id) or public.has_client_access(project_id));
create policy "project participants send messages" on public.project_messages for insert
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.projects p where p.id = project_id and p.workspace_id = project_messages.workspace_id
    and (public.is_workspace_member(workspace_id) or public.has_client_access(project_id))
  )
);

create policy "public can view published portfolio" on public.portfolio_items for select
using (published);
create policy "workspace members manage portfolio" on public.portfolio_items for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));
create policy "workspace members read inquiries" on public.inquiries for select
using (public.is_workspace_member(workspace_id));

create policy "workspace members read invoices" on public.invoices for select
using (public.is_workspace_member(workspace_id));
create policy "workspace members create invoices" on public.invoices for insert
with check (
  public.is_workspace_member(workspace_id)
  and status in ('draft', 'open')
  and (client_id is null or exists (
    select 1 from public.clients c where c.id = client_id and c.workspace_id = invoices.workspace_id
  ))
  and (project_id is null or exists (
    select 1 from public.projects p where p.id = project_id and p.workspace_id = invoices.workspace_id
  ))
);
create policy "workspace members update unpaid invoices" on public.invoices for update
using (public.is_workspace_member(workspace_id) and status <> 'paid')
with check (
  public.is_workspace_member(workspace_id)
  and status in ('draft', 'open', 'void', 'overdue')
  and (client_id is null or exists (
    select 1 from public.clients c where c.id = client_id and c.workspace_id = invoices.workspace_id
  ))
  and (project_id is null or exists (
    select 1 from public.projects p where p.id = project_id and p.workspace_id = invoices.workspace_id
  ))
);
create policy "workspace members delete draft invoices" on public.invoices for delete
using (public.is_workspace_member(workspace_id) and status = 'draft');
create policy "clients read own invoices" on public.invoices for select
using (exists (select 1 from public.client_access a where a.client_id = client_id and a.user_id = auth.uid()));
create policy "invoice participants read line items" on public.invoice_items for select
using (exists (
  select 1 from public.invoices i where i.id = invoice_id
  and (public.is_workspace_member(i.workspace_id) or exists (
    select 1 from public.client_access a where a.client_id = i.client_id and a.user_id = auth.uid()
  ))
));
create policy "members manage invoice items" on public.invoice_items for all
using (exists (select 1 from public.invoices i where i.id = invoice_id and public.is_workspace_member(i.workspace_id)))
with check (exists (select 1 from public.invoices i where i.id = invoice_id and public.is_workspace_member(i.workspace_id)));
create policy "invoice participants read payments" on public.payments for select
using (exists (
  select 1 from public.invoices i where i.id = invoice_id
  and (public.is_workspace_member(i.workspace_id) or exists (
    select 1 from public.client_access a where a.client_id = i.client_id and a.user_id = auth.uid()
  ))
));
create policy "invoice participants read receipts" on public.receipts for select
using (exists (
  select 1 from public.payments p join public.invoices i on i.id = p.invoice_id
  where p.id = payment_id
  and (public.is_workspace_member(i.workspace_id) or exists (
    select 1 from public.client_access a where a.client_id = i.client_id and a.user_id = auth.uid()
  ))
));
create policy "members manage expenses" on public.expenses for all
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members read activity" on public.activity_events for select
using (public.is_workspace_member(workspace_id) or public.has_client_access(project_id));
create policy "members create activity" on public.activity_events for insert
with check (public.is_workspace_member(workspace_id) and actor_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('portfolio-media', 'portfolio-media', false)
on conflict (id) do update set public = false;

create policy "portfolio covers readable by owner or public when published"
on storage.objects for select
using (
  bucket_id = 'portfolio-media'
  and (
    (storage.foldername(name))[1] in (
      select m.workspace_id::text from public.members m where m.user_id = auth.uid()
    )
    or exists (
      select 1 from public.portfolio_items p
      where p.cover_path = storage.objects.name and p.published = true
    )
  )
);
create policy "workspace members upload portfolio covers"
on storage.objects for insert
with check (
  bucket_id = 'portfolio-media'
  and (storage.foldername(name))[1] in (
    select m.workspace_id::text from public.members m where m.user_id = auth.uid()
  )
);
create policy "workspace members remove portfolio covers"
on storage.objects for delete
using (
  bucket_id = 'portfolio-media'
  and (storage.foldername(name))[1] in (
    select m.workspace_id::text from public.members m where m.user_id = auth.uid()
  )
);

revoke all on function public.submit_inquiry(text, text, text, text) from public;
grant execute on function public.submit_inquiry(text, text, text, text) to anon, authenticated;
revoke all on function public.accept_client_invitation(uuid) from public;
grant execute on function public.accept_client_invitation(uuid) to authenticated;
revoke all on function public.create_studio_invoice(uuid, uuid, uuid, text, numeric, date, text) from public;
grant execute on function public.create_studio_invoice(uuid, uuid, uuid, text, numeric, date, text) to authenticated;

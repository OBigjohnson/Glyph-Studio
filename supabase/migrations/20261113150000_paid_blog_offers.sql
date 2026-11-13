alter table public.blog_posts
  add column document_storage_path text,
  add column document_title text,
  add column document_ngn_price numeric(12, 2),
  add column document_usd_price numeric(12, 2),
  add constraint blog_posts_document_path_workspace_check check (
    document_storage_path is null
    or document_storage_path like workspace_id::text || '/%'
  ),
  add constraint blog_posts_document_prices_check check (
    (document_storage_path is null
      and document_title is null
      and document_ngn_price is null
      and document_usd_price is null)
    or (document_storage_path is not null
      and document_title is not null
      and length(trim(document_title)) between 1 and 180
      and document_ngn_price is not null
      and document_ngn_price > 0
      and document_usd_price is not null
      and document_usd_price > 0)
  );

revoke select on public.blog_posts from anon;
grant select (
  id, workspace_id, title, slug, excerpt, body, cover_image_url, seo_title,
  meta_description, keywords, storybrand_angle, alternate_hooks,
  visual_direction, status, published_at, created_at, updated_at,
  document_title, document_ngn_price, document_usd_price
) on public.blog_posts to anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'paid-blog-documents',
  'paid-blog-documents',
  false,
  26214400,
  array['application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "workspace owners read paid blog documents"
on storage.objects for select
using (
  bucket_id = 'paid-blog-documents'
  and (storage.foldername(name))[1] in (
    select member.workspace_id::text
    from public.members member
    where member.user_id = auth.uid()
      and member.role = 'owner'
  )
);

create policy "workspace owners upload paid blog documents"
on storage.objects for insert
with check (
  bucket_id = 'paid-blog-documents'
  and (storage.foldername(name))[1] in (
    select member.workspace_id::text
    from public.members member
    where member.user_id = auth.uid()
      and member.role = 'owner'
  )
);

create policy "workspace owners remove paid blog documents"
on storage.objects for delete
using (
  bucket_id = 'paid-blog-documents'
  and (storage.foldername(name))[1] in (
    select member.workspace_id::text
    from public.members member
    where member.user_id = auth.uid()
      and member.role = 'owner'
  )
);

create table public.editorial_purchases (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  blog_post_id uuid references public.blog_posts(id) on delete set null,
  purchase_type text not null check (purchase_type in ('consultation', 'document')),
  product_title text not null check (length(trim(product_title)) between 1 and 180),
  customer_name text not null default '' check (length(customer_name) <= 160),
  customer_email text not null check (
    customer_email = lower(trim(customer_email))
    and length(customer_email) <= 320
  ),
  service_key text,
  duration_minutes smallint,
  requested_at timestamp without time zone,
  requested_timezone text,
  currency text not null check (currency in ('NGN', 'USD')),
  amount numeric(12, 2) not null check (amount > 0),
  document_storage_path text,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  receipt_number text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  notification_claimed_at timestamptz,
  notification_sent_at timestamptz,
  check (
    (purchase_type = 'consultation'
      and service_key is not null
      and duration_minutes is not null
      and duration_minutes > 0
      and requested_at is not null
      and requested_timezone = 'Africa/Lagos'
      and document_storage_path is null)
    or (purchase_type = 'document'
      and service_key is null
      and duration_minutes is null
      and requested_at is null
      and requested_timezone is null
      and document_storage_path is not null
      and document_storage_path like workspace_id::text || '/%')
  ),
  check (
    (status = 'pending' and receipt_number is null and paid_at is null)
    or (status = 'paid' and receipt_number is not null and paid_at is not null)
  )
);

create index editorial_purchases_workspace_created_idx
  on public.editorial_purchases(workspace_id, created_at desc);
create index editorial_purchases_post_created_idx
  on public.editorial_purchases(blog_post_id, created_at desc);

alter table public.editorial_purchases enable row level security;
revoke all on public.editorial_purchases from public, anon, authenticated;
grant select on public.editorial_purchases to authenticated;
grant all on public.editorial_purchases to service_role;

create policy "workspace owners read editorial purchases"
  on public.editorial_purchases for select
  using (
    exists (
      select 1 from public.members member
      where member.workspace_id = editorial_purchases.workspace_id
        and member.user_id = auth.uid()
        and member.role = 'owner'
    )
  );

create table public.bachs_editorial_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.editorial_purchases(id) on delete cascade,
  expected_amount numeric(12, 2) not null check (expected_amount > 0),
  currency text not null check (currency in ('NGN', 'USD')),
  bachs_checkout_id text unique,
  checkout_url text,
  checkout_environment text not null check (checkout_environment in ('sandbox', 'live')),
  checkout_organization_id text not null check (length(trim(checkout_organization_id)) > 0),
  status text not null default 'creating'
    check (status in ('creating', 'pending', 'succeeded', 'failed', 'expired')),
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index bachs_editorial_checkout_purchase_status_idx
  on public.bachs_editorial_checkout_sessions(purchase_id, status, created_at desc);

alter table public.bachs_editorial_checkout_sessions enable row level security;
revoke all on public.bachs_editorial_checkout_sessions from public, anon, authenticated;
grant all on public.bachs_editorial_checkout_sessions to service_role;

create or replace function public.claim_editorial_purchase_notification(target_purchase_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.editorial_purchases
  set notification_claimed_at = now()
  where id = target_purchase_id
    and status = 'paid'
    and notification_sent_at is null
    and (
      notification_claimed_at is null
      or notification_claimed_at < now() - interval '5 minutes'
    );
  return found;
end;
$$;

revoke all on function public.claim_editorial_purchase_notification(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_editorial_purchase_notification(uuid)
  to service_role;

create or replace function public.process_bachs_editorial_collection(
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
  checkout_record public.bachs_editorial_checkout_sessions;
  purchase_record public.editorial_purchases;
  payment_date timestamptz;
  receipt text;
begin
  if requested_environment not in ('sandbox', 'live')
    or requested_organization_id is null
    or btrim(requested_organization_id) = '' then
    raise exception 'Bachs account configuration is invalid';
  end if;

  select * into checkout_record
  from public.bachs_editorial_checkout_sessions
  where bachs_checkout_id = provider_checkout_id
    and checkout_environment = requested_environment
    and checkout_organization_id = requested_organization_id
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if exists (
    select 1 from public.bachs_webhook_events where event_id = provider_event_id
  ) then
    return jsonb_build_object('status', 'duplicate', 'purchase_id', checkout_record.purchase_id);
  end if;

  if checkout_record.status = 'succeeded' then
    insert into public.bachs_webhook_events (event_id, event_type, status)
    values (provider_event_id, 'collection.succeeded', 'duplicate')
    on conflict (event_id) do nothing;
    return jsonb_build_object('status', 'duplicate', 'purchase_id', checkout_record.purchase_id);
  end if;

  if checkout_record.status <> 'pending'
    or checkout_record.expected_amount <> received_amount
    or upper(checkout_record.currency) <> upper(received_currency) then
    insert into public.bachs_webhook_events (event_id, event_type, status, error)
    values (
      provider_event_id,
      'collection.succeeded',
      'rejected',
      'The paid amount or currency does not match the editorial checkout'
    )
    on conflict (event_id) do nothing;
    return jsonb_build_object('status', 'rejected');
  end if;

  select * into purchase_record
  from public.editorial_purchases
  where id = checkout_record.purchase_id
  for update;
  if not found or purchase_record.status <> 'pending' then
    raise exception 'The editorial purchase is no longer available';
  end if;

  payment_date := coalesce(provider_paid_at, now());
  receipt := 'GL-' || to_char(payment_date, 'YYYYMMDDHH24MISS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  update public.editorial_purchases
  set status = 'paid',
      receipt_number = receipt,
      paid_at = payment_date
  where id = purchase_record.id;

  update public.bachs_editorial_checkout_sessions
  set status = 'succeeded',
      paid_at = payment_date
  where id = checkout_record.id;

  insert into public.bachs_webhook_events (event_id, event_type, status)
  values (provider_event_id, 'collection.succeeded', 'processed')
  on conflict (event_id) do nothing;

  return jsonb_build_object(
    'status', 'processed',
    'purchase_id', purchase_record.id,
    'receipt_number', receipt,
    'paid_at', payment_date
  );
end;
$$;

revoke all on function public.process_bachs_editorial_collection(text, text, text, numeric, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.process_bachs_editorial_collection(text, text, text, numeric, text, timestamptz, text, text)
  to service_role;

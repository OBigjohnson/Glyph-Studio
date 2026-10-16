alter table public.workspaces
  add column tagline text not null default 'INDEPENDENT CREATIVE STUDIO',
  add column location text not null default 'Lagos & everywhere',
  add column hero_title text not null default 'Ideas into identity.',
  add column hero_subtitle text not null default 'We shape brands, images and moving stories for people building something that matters.',
  add column about_text text not null default 'GLYPH is an independent creative studio partnering with ambitious people to build thoughtful brands and vivid visual worlds.',
  add column services text[] not null default array[
    'Brand identity', 'Logo design', 'Graphic design',
    'Video editing', 'Videography', 'Photography'
  ],
  add constraint workspaces_brand_color_format
    check (brand_color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.portfolio_items
  add constraint portfolio_items_workspace_id_id_key unique (workspace_id, id);

create table public.portfolio_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  portfolio_item_id uuid not null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  sort_order integer not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, portfolio_item_id)
    references public.portfolio_items(workspace_id, id) on delete cascade
);

alter table public.portfolio_assets enable row level security;

create policy "workspace members manage portfolio assets"
on public.portfolio_assets for all
using (public.is_workspace_member(workspace_id))
with check (
  public.is_workspace_member(workspace_id)
  and created_by = auth.uid()
);

create policy "public can read published portfolio assets"
on public.portfolio_assets for select
using (exists (
  select 1 from public.portfolio_items p
  where p.id = portfolio_item_id
    and p.workspace_id = portfolio_assets.workspace_id
    and p.published
));

create policy "published portfolio files readable by visitors"
on storage.objects for select
using (
  bucket_id = 'portfolio-media'
  and exists (
    select 1 from public.portfolio_assets a
    join public.portfolio_items p
      on p.id = a.portfolio_item_id and p.workspace_id = a.workspace_id
    where a.storage_path = storage.objects.name
      and p.published
  )
);

update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
where id = 'portfolio-media';

create or replace function public.get_public_studio()
returns table (
  studio_name text,
  tagline text,
  location text,
  hero_title text,
  hero_subtitle text,
  about_text text,
  services text[],
  contact_email text,
  brand_color text
)
language sql
stable
security definer
set search_path = public
as $$
  select w.studio_name, w.tagline, w.location, w.hero_title,
    w.hero_subtitle, w.about_text, w.services, w.contact_email, w.brand_color
  from public.workspaces w
  order by w.created_at
  limit 1;
$$;

revoke all on function public.get_public_studio() from public;
grant execute on function public.get_public_studio() to anon, authenticated;

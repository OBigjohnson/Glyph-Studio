create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 180),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  excerpt text not null default '' check (length(excerpt) <= 400),
  body text not null check (length(trim(body)) between 1 and 30000),
  cover_image_url text not null default '',
  seo_title text not null default '' check (length(seo_title) <= 180),
  meta_description text not null default '' check (length(meta_description) <= 155),
  keywords text[] not null default '{}',
  storybrand_angle jsonb not null default '{}'::jsonb,
  alternate_hooks text[] not null default '{}',
  visual_direction text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug),
  unique (workspace_id, id)
);

create index blog_posts_publication_idx
  on public.blog_posts(status, published_at desc)
  where status = 'published';
create index blog_posts_workspace_updated_idx
  on public.blog_posts(workspace_id, updated_at desc);

create table public.blog_generation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_date date not null default current_date,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  blog_post_id uuid,
  error_message text not null default '' check (length(error_message) <= 1000),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, run_date),
  foreign key (workspace_id, blog_post_id)
    references public.blog_posts(workspace_id, id)
    on delete set null (blog_post_id)
);

create index blog_generation_runs_workspace_date_idx
  on public.blog_generation_runs(workspace_id, run_date desc);

alter table public.blog_generation_runs enable row level security;
revoke all on public.blog_generation_runs from anon, public;
grant select on public.blog_generation_runs to authenticated;

create policy "workspace owners read daily blog generation history"
  on public.blog_generation_runs for select
  using (
    exists (
      select 1 from public.members member
      where member.workspace_id = blog_generation_runs.workspace_id
        and member.user_id = auth.uid()
        and member.role = 'owner'
    )
  );

alter table public.social_content_posts
  add column storybrand_angle jsonb not null default '{}'::jsonb,
  add column alternate_hooks text[] not null default '{}',
  add column visual_direction text not null default ''
    check (length(visual_direction) <= 2000);

alter table public.blog_posts enable row level security;
revoke all on public.blog_posts from anon, public;
grant select on public.blog_posts to anon, authenticated;
grant insert, update, delete on public.blog_posts to authenticated;

create policy "public can read published blog posts"
  on public.blog_posts for select
  using (status = 'published');
create policy "workspace owners manage blog posts"
  on public.blog_posts for all
  using (
    exists (
      select 1 from public.members member
      where member.workspace_id = blog_posts.workspace_id
        and member.user_id = auth.uid()
        and member.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.members member
      where member.workspace_id = blog_posts.workspace_id
        and member.user_id = auth.uid()
        and member.role = 'owner'
    )
    and created_by = auth.uid()
  );

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email = lower(trim(email)) and length(email) <= 320),
  confirmation_token uuid not null default gen_random_uuid() unique,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, email),
  unique (workspace_id, id)
);

create index newsletter_subscribers_active_idx
  on public.newsletter_subscribers(workspace_id, created_at)
  where confirmed_at is not null and unsubscribed_at is null;

alter table public.newsletter_subscribers enable row level security;
revoke all on public.newsletter_subscribers from anon, public;
grant select on public.newsletter_subscribers to authenticated;

create policy "workspace owners read newsletter subscribers"
  on public.newsletter_subscribers for select
  using (
    exists (
      select 1 from public.members member
      where member.workspace_id = newsletter_subscribers.workspace_id
        and member.user_id = auth.uid()
        and member.role = 'owner'
    )
  );

create table public.newsletter_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sent_by uuid not null references auth.users(id) on delete cascade,
  subject text not null check (length(trim(subject)) between 1 and 150),
  preview_text text not null default '' check (length(preview_text) <= 200),
  alternate_subjects text[] not null default '{}',
  storybrand_angle jsonb not null default '{}'::jsonb,
  body text not null check (length(trim(body)) between 1 and 12000),
  recipient_count integer not null check (recipient_count > 0),
  sent_at timestamptz not null default now()
);

create index newsletter_campaigns_workspace_sent_idx
  on public.newsletter_campaigns(workspace_id, sent_at desc);

alter table public.newsletter_campaigns enable row level security;
revoke all on public.newsletter_campaigns from anon, public;
grant select on public.newsletter_campaigns to authenticated;

create policy "workspace owners read newsletter campaign history"
  on public.newsletter_campaigns for select
  using (
    exists (
      select 1 from public.members member
      where member.workspace_id = newsletter_campaigns.workspace_id
        and member.user_id = auth.uid()
        and member.role = 'owner'
    )
  );

drop function public.get_public_studio();
create function public.get_public_studio()
returns table (
  workspace_id uuid,
  studio_name text,
  slug text,
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
  select w.id, w.studio_name, w.slug, w.tagline, w.location, w.hero_title,
    w.hero_subtitle, w.about_text, w.services, w.contact_email, w.brand_color
  from public.workspaces w
  order by w.created_at
  limit 1;
$$;

revoke all on function public.get_public_studio() from public;
grant execute on function public.get_public_studio() to anon, authenticated;

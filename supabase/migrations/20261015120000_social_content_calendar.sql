create table public.social_content_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook', 'x')),
  caption text not null check (length(trim(caption)) between 1 and 5000),
  planned_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'planned', 'scheduled_externally', 'published')),
  portfolio_asset_id uuid references public.portfolio_assets(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index social_content_posts_workspace_schedule_idx
  on public.social_content_posts(workspace_id, planned_at);

create index social_content_posts_workspace_platform_idx
  on public.social_content_posts(workspace_id, platform);

alter table public.social_content_posts enable row level security;
revoke all on public.social_content_posts from anon, public;
grant select, insert, update, delete on public.social_content_posts to authenticated;

create policy "workspace members read social content plans"
  on public.social_content_posts for select
  using (public.is_workspace_member(workspace_id));

create policy "workspace members create social content plans"
  on public.social_content_posts for insert
  with check (
    public.is_workspace_member(workspace_id)
    and created_by = auth.uid()
    and (
      portfolio_asset_id is null
      or exists (
        select 1 from public.portfolio_assets asset
        where asset.id = social_content_posts.portfolio_asset_id
          and asset.workspace_id = social_content_posts.workspace_id
          and asset.mime_type in ('image/jpeg', 'image/png')
      )
    )
  );

create policy "workspace members update social content plans"
  on public.social_content_posts for update
  using (public.is_workspace_member(workspace_id))
  with check (
    public.is_workspace_member(workspace_id)
    and (
      portfolio_asset_id is null
      or exists (
        select 1 from public.portfolio_assets asset
        where asset.id = social_content_posts.portfolio_asset_id
          and asset.workspace_id = social_content_posts.workspace_id
          and asset.mime_type in ('image/jpeg', 'image/png')
      )
    )
  );

create policy "workspace members delete social content plans"
  on public.social_content_posts for delete
  using (public.is_workspace_member(workspace_id));
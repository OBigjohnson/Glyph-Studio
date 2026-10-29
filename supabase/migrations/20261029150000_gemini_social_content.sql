alter table public.workspaces
  add column enabled_social_platforms text[] not null default array[
    'instagram', 'tiktok', 'facebook', 'x', 'linkedin', 'youtube'
  ],
  add constraint workspaces_enabled_social_platforms_valid
    check (
      cardinality(enabled_social_platforms) > 0
      and enabled_social_platforms <@ array[
        'instagram', 'tiktok', 'facebook', 'x', 'linkedin', 'youtube'
      ]::text[]
    );

alter table public.social_content_posts
  drop constraint if exists social_content_posts_platform_check,
  add column portfolio_item_id uuid references public.portfolio_items(id) on delete set null,
  add column copied_at timestamptz,
  add column copy_count integer not null default 0 check (copy_count >= 0),
  add column used_at timestamptz,
  add column published_at timestamptz;

alter table public.social_content_posts
  drop constraint if exists social_content_posts_portfolio_item_id_fkey,
  add constraint social_content_posts_workspace_portfolio_fk
    foreign key (workspace_id, portfolio_item_id)
    references public.portfolio_items(workspace_id, id)
    on delete set null (portfolio_item_id);

alter table public.social_content_posts
  add constraint social_content_posts_platform_check
    check (platform in ('instagram', 'tiktok', 'facebook', 'x', 'linkedin', 'youtube'));

update public.social_content_posts post
set portfolio_item_id = asset.portfolio_item_id
from public.portfolio_assets asset
where post.portfolio_asset_id = asset.id
  and post.portfolio_item_id is null;

create index social_content_posts_workspace_portfolio_idx
  on public.social_content_posts(workspace_id, portfolio_item_id, created_at desc);

create or replace function public.track_social_content_post(
  target_post uuid,
  event_name text
)
returns table (
  copy_count integer,
  copied_at timestamptz,
  used_at timestamptz,
  published_at timestamptz,
  status text
)
language plpgsql
set search_path = public
as $$
begin
  if event_name = 'copied' then
    return query
      update public.social_content_posts post
      set copied_at = now(),
          copy_count = post.copy_count + 1,
          updated_at = now()
      where post.id = target_post
        and public.is_workspace_member(post.workspace_id)
      returning post.copy_count, post.copied_at, post.used_at, post.published_at, post.status;
  elsif event_name = 'used' then
    return query
      update public.social_content_posts post
      set used_at = now(),
          updated_at = now()
      where post.id = target_post
        and public.is_workspace_member(post.workspace_id)
      returning post.copy_count, post.copied_at, post.used_at, post.published_at, post.status;
  elsif event_name = 'published' then
    return query
      update public.social_content_posts post
      set status = 'published',
          published_at = coalesce(post.published_at, now()),
          used_at = coalesce(post.used_at, now()),
          updated_at = now()
      where post.id = target_post
        and public.is_workspace_member(post.workspace_id)
      returning post.copy_count, post.copied_at, post.used_at, post.published_at, post.status;
  else
    raise exception 'Unsupported social content event.';
  end if;

  if not found then
    raise exception 'Social content post not found or access denied.';
  end if;
end;
$$;

revoke all on function public.track_social_content_post(uuid, text) from public, anon;
grant execute on function public.track_social_content_post(uuid, text) to authenticated;

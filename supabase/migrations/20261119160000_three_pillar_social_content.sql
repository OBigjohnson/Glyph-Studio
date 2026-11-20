alter table public.social_content_posts
  drop constraint if exists social_content_posts_content_type_check;

alter table public.social_content_posts
  add constraint social_content_posts_content_type_check
    check (content_type in ('blog_story', 'portfolio_story', 'educational_solution'));

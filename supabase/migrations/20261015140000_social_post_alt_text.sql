alter table public.social_content_posts
  add column alt_text text not null default ''
  check (length(alt_text) <= 1000);
alter table public.social_content_posts
  add column content_type text not null default 'portfolio_story'
    check (content_type in ('portfolio_story', 'educational_solution')),
  add column video_generation_prompt text not null default ''
    check (length(video_generation_prompt) <= 3000);

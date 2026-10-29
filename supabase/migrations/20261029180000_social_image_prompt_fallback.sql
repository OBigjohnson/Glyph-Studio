alter table public.social_content_posts
  add column image_generation_prompt text not null default ''
    check (length(image_generation_prompt) <= 5000);

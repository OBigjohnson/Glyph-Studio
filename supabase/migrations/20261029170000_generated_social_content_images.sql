alter table public.social_content_posts
  add column generated_image_path text,
  add constraint social_content_posts_generated_image_path_valid
    check (
      generated_image_path is null
      or generated_image_path like workspace_id::text || '/social-content/%'
    );

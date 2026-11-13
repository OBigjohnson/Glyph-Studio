insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'blog-covers',
  'blog-covers',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "workspace owners upload blog cover images"
on storage.objects for insert
with check (
  bucket_id = 'blog-covers'
  and (storage.foldername(name))[1] in (
    select member.workspace_id::text
    from public.members member
    where member.user_id = auth.uid()
      and member.role = 'owner'
  )
);

create policy "workspace owners remove blog cover images"
on storage.objects for delete
using (
  bucket_id = 'blog-covers'
  and (storage.foldername(name))[1] in (
    select member.workspace_id::text
    from public.members member
    where member.user_id = auth.uid()
      and member.role = 'owner'
  )
);

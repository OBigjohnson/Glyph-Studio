alter table public.portfolio_assets
  drop constraint if exists portfolio_assets_mime_type_check;

alter table public.portfolio_assets
  add constraint portfolio_assets_mime_type_check
  check (mime_type in (
    'image/jpeg',
    'image/png',
    'application/pdf',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-msvideo',
    'video/mpeg',
    'video/3gpp',
    'video/x-m4v'
  ));

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'application/pdf',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/mpeg',
  'video/3gpp',
  'video/x-m4v'
]
where id = 'portfolio-media';

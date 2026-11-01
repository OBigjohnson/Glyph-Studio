alter table public.portfolio_assets
  drop constraint if exists portfolio_assets_file_size_check;

alter table public.portfolio_assets
  add constraint portfolio_assets_file_size_check
  check (file_size > 0 and file_size <= 1073741824);

update storage.buckets
set file_size_limit = 1073741824
where id = 'portfolio-media';

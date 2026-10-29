alter table public.portfolio_items
  add column segment text not null default 'Design'
    check (segment in (
      'Design', 'Branding', 'Graphic Design', 'UI/UX',
      'Mobile App Development', 'Web Development', 'Video Editing',
      'Videography', 'Photography'
    ));

update public.portfolio_items
set segment = case
  when lower(service) in ('brand identity', 'logo design') then 'Branding'
  when lower(service) = 'graphic design' then 'Graphic Design'
  when lower(service) = 'ui/ux' then 'UI/UX'
  when lower(service) = 'mobile app development' then 'Mobile App Development'
  when lower(service) = 'web development' then 'Web Development'
  when lower(service) = 'video editing' then 'Video Editing'
  when lower(service) = 'videography' then 'Videography'
  when lower(service) = 'photography' then 'Photography'
  else 'Design'
end;

alter table public.workspaces
  alter column services set default array[
    'Brand identity', 'Logo design', 'Graphic design', 'UI/UX',
    'Mobile App Development', 'Web Development', 'Video editing',
    'Videography', 'Photography'
  ];

update public.workspaces
set services = services
  || case when 'UI/UX' = any(services) then array[]::text[] else array['UI/UX'] end
  || case when 'Mobile App Development' = any(services) then array[]::text[] else array['Mobile App Development'] end
  || case when 'Web Development' = any(services) then array[]::text[] else array['Web Development'] end;

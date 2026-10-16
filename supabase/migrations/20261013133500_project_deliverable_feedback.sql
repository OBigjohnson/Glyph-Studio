alter table public.project_links
  add constraint project_links_workspace_project_id_key
  unique (workspace_id, project_id, id);

create table public.project_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  project_link_id uuid not null,
  author_id uuid not null references auth.users(id),
  kind text not null check (kind in ('comment', 'revision_request', 'approved', 'studio_response')),
  body text not null check (length(trim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id)
    references public.projects(workspace_id, id) on delete cascade,
  foreign key (workspace_id, project_id, project_link_id)
    references public.project_links(workspace_id, project_id, id) on delete cascade
);

alter table public.project_feedback enable row level security;

create policy "project participants read deliverable feedback"
on public.project_feedback for select
using (
  public.is_workspace_member(workspace_id)
  or (
    public.has_client_access(project_id)
    and exists (
      select 1
      from public.project_links l
      where l.id = project_link_id
        and l.workspace_id = project_feedback.workspace_id
        and l.project_id = project_feedback.project_id
        and l.visible_to_client
    )
  )
);

create policy "project participants add deliverable feedback"
on public.project_feedback for insert
with check (
  author_id = auth.uid()
  and exists (
    select 1
    from public.project_links l
    where l.id = project_link_id
      and l.workspace_id = project_feedback.workspace_id
      and l.project_id = project_feedback.project_id
      and (
        public.is_workspace_member(workspace_id)
        or (l.visible_to_client and public.has_client_access(project_id))
      )
  )
  and (
    public.is_workspace_member(workspace_id)
    or kind in ('comment', 'revision_request', 'approved')
  )
);

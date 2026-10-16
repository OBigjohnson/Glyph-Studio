create policy "workspace members delete project requests"
  on public.inquiries for delete
  using (public.is_workspace_member(workspace_id));

-- Allow the quote wizard to log generated/stored PDF preview artifacts.
-- Email/text delivery events remain service-role only because provider sends
-- must be validated and recorded by the edge function.

drop policy if exists "qde_client_preview_insert" on public.quote_delivery_events;

create policy "qde_client_preview_insert" on public.quote_delivery_events
  for insert with check (
    workspace_id = (select public.get_my_workspace())
    and public.quote_package_accessible_to_me(quote_package_id)
    and channel = 'preview'
    and status = 'draft'
    and coalesce(provider, '') in ('local_preview', 'stored_pdf_preview')
  );

-- Atomic commit for customer email send: insert delivery audit row + mark quote sent
-- in one transaction so we never persist a delivery event without the matching package
-- status (or vice versa) when the edge uses this RPC after Resend succeeds.

create or replace function public.quote_send_package_commit(
  p_workspace_id text,
  p_quote_package_id uuid,
  p_sent_at timestamptz,
  p_document_artifact_id uuid,
  p_recipient text,
  p_subject text,
  p_message_body text,
  p_provider text,
  p_follow_up_at timestamptz,
  p_created_by uuid,
  p_metadata jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.quote_delivery_events (
    workspace_id,
    quote_package_id,
    document_artifact_id,
    channel,
    status,
    recipient,
    subject,
    message_body,
    provider,
    provider_message_id,
    error_message,
    follow_up_at,
    created_by,
    metadata
  ) values (
    p_workspace_id,
    p_quote_package_id,
    p_document_artifact_id,
    'email',
    'sent',
    p_recipient,
    p_subject,
    p_message_body,
    p_provider,
    null,
    null,
    p_follow_up_at,
    p_created_by,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  update public.quote_packages
  set
    status = 'sent',
    sent_at = p_sent_at,
    sent_via = 'email',
    updated_at = now()
  where id = p_quote_package_id
    and workspace_id = p_workspace_id;

  if not found then
    raise exception 'quote_send_package_commit: quote package % not in workspace %',
      p_quote_package_id, p_workspace_id;
  end if;

  return v_id;
end;
$$;

comment on function public.quote_send_package_commit is
  'Service-role only: after external email succeeds, insert quote_delivery_events (email/sent) and set quote_packages to sent in one transaction.';

revoke execute on function public.quote_send_package_commit(
  text, uuid, timestamptz, uuid, text, text, text, text, timestamptz, uuid, jsonb
) from anon, authenticated;

grant execute on function public.quote_send_package_commit(
  text, uuid, timestamptz, uuid, text, text, text, text, timestamptz, uuid, jsonb
) to service_role;

-- ============================================================================
-- Migration 269: bulk_update_parts_embeddings RPC
--
-- The parts-embed-backfill edge function was doing one UPDATE per part through
-- the Supabase REST API, which meant ~50 round-trips per batch of 50 parts.
-- That pushed each batch to ~5s, and 87 batches × 5s = 435s — past the edge
-- function timeout, causing mid-run termination and (through a separate bug)
-- the user's auth session to appear expired.
--
-- This RPC takes a jsonb array of {part_id, embedding_literal, embedding_text}
-- tuples and applies them in a single SQL statement via unnest + update...from.
-- Drops per-batch write time from ~5s to <500ms.
-- ============================================================================

create or replace function public.bulk_update_parts_embeddings(p_updates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  -- Authorization: service_role OR admin/manager/owner
  if public.get_my_role() not in ('admin', 'manager', 'owner')
     and current_user <> 'service_role' then
    raise exception 'insufficient role for bulk embedding update';
  end if;

  -- Suppress the manual-override tracker for this bulk path — embeddings
  -- are computed state, not operator intent.
  perform set_config('parts_catalog.suppress_override_tracking', 'on', true);

  with incoming as (
    select
      (elem ->> 'part_id')::uuid                  as part_id,
      (elem ->> 'embedding_literal')::extensions.vector(1536) as embedding,
      elem ->> 'embedding_text'                   as embedding_text,
      coalesce(elem ->> 'embedding_model', 'text-embedding-3-small') as embedding_model
    from jsonb_array_elements(p_updates) as elem
  )
  update public.parts_catalog pc
  set embedding              = i.embedding,
      embedding_text         = i.embedding_text,
      embedding_model        = i.embedding_model,
      embedding_computed_at  = now(),
      updated_at             = now()
  from incoming i
  where pc.id = i.part_id
    and pc.deleted_at is null;

  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', true, 'rows_updated', v_updated);
end;
$$;

grant execute on function public.bulk_update_parts_embeddings(jsonb) to authenticated;

-- ============================================================================
-- Migration 269 complete.
-- ============================================================================

-- ============================================================================
-- Migration 320: Hub — soft-cascade comments when parent is soft-deleted
--
-- hub_comments.parent_id is polymorphic (no FK), so a soft-delete on
-- hub_feedback / hub_build_items / hub_decisions used to leave orphan
-- comments visible under the read policy. Post-build audit (P2).
--
-- Fix: trigger that cascades the parent's deleted_at onto matching comments
-- when the soft-delete transition fires (NULL → NOT NULL). Hard deletes
-- don't fire this because the audit pattern is soft-only for these tables.
-- ============================================================================

create or replace function public.hub_cascade_soft_delete_comments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_type text;
begin
  -- Only fire on soft-delete transition (NULL → NOT NULL). Skip re-deletes
  -- and undeletes.
  if OLD.deleted_at is not null or NEW.deleted_at is null then
    return NEW;
  end if;

  v_parent_type := case TG_TABLE_NAME
    when 'hub_feedback' then 'feedback'
    when 'hub_build_items' then 'build_item'
    when 'hub_decisions' then 'decision'
    else null
  end;

  if v_parent_type is null then
    return NEW;
  end if;

  update public.hub_comments
  set deleted_at = NEW.deleted_at
  where parent_type = v_parent_type
    and parent_id = NEW.id
    and deleted_at is null;

  return NEW;
end;
$$;

comment on function public.hub_cascade_soft_delete_comments() is
  'Cascades soft-delete from hub_feedback / hub_build_items / hub_decisions '
  'onto matching hub_comments rows. Fires only on NULL → NOT NULL transition.';

drop trigger if exists hub_feedback_soft_cascade on public.hub_feedback;
create trigger hub_feedback_soft_cascade
  after update on public.hub_feedback
  for each row execute function public.hub_cascade_soft_delete_comments();

drop trigger if exists hub_build_items_soft_cascade on public.hub_build_items;
create trigger hub_build_items_soft_cascade
  after update on public.hub_build_items
  for each row execute function public.hub_cascade_soft_delete_comments();

drop trigger if exists hub_decisions_soft_cascade on public.hub_decisions;
create trigger hub_decisions_soft_cascade
  after update on public.hub_decisions
  for each row execute function public.hub_cascade_soft_delete_comments();

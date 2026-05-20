-- ============================================================================
-- Migration 602: QB-11 owner margin exception report
--
-- Adds a read-only owner/workspace-gated report view over the existing
-- qb_margin_exceptions audit log enriched with the latest related
-- quote_approval_cases row. No new persistence store, no QB-12 draft-reason
-- logging changes, and no changes to existing admin margin discipline tables.
--
-- Rollback:
--   drop view if exists public.v_margin_exceptions;
-- ============================================================================

drop view if exists public.v_margin_exceptions;

create view public.v_margin_exceptions with (security_barrier = true) as
select
  qme.id as exception_id,
  qme.workspace_id,
  qme.created_at as exception_created_at,
  qme.quote_package_id,
  qme.brand_id,
  qb.code as brand_code,
  qb.name as brand_name,
  qme.rep_id,
  coalesce(nullif(rep.full_name, ''), nullif(rep.email, '')) as rep_name,
  qme.quoted_margin_pct,
  qme.threshold_margin_pct,
  qme.delta_pts,
  qme.estimated_gap_cents,
  qme.reason,
  qac.id as approval_case_id,
  qac.quote_number,
  qac.customer_name,
  qac.customer_company,
  qac.branch_name,
  qac.net_total,
  qac.margin_pct as approval_margin_pct,
  qac.status as approval_status,
  qac.assigned_to,
  qac.assigned_to_name,
  qac.assigned_role,
  qac.decided_by,
  qac.decided_by_name,
  qac.decided_at,
  qac.decision_note
from public.qb_margin_exceptions qme
left join lateral (
  select c.*
  from public.quote_approval_cases c
  where c.workspace_id = qme.workspace_id
    and c.quote_package_id = qme.quote_package_id
  order by c.created_at desc, c.version_number desc
  limit 1
) qac on true
left join public.profiles rep on rep.id = qme.rep_id
left join public.qb_brands qb on qb.id = qme.brand_id
where qme.workspace_id = public.get_my_workspace()
  and public.get_my_role() = 'owner';

alter view public.v_margin_exceptions set (security_invoker = true);

comment on view public.v_margin_exceptions is
  'QB-11 owner-only margin exception report. Base rows come from qb_margin_exceptions and are enriched with the latest quote_approval_cases context; view enforces workspace + owner gating.';

grant select on public.v_margin_exceptions to authenticated;

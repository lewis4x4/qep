-- ──────────────────────────────────────────────────────────────────────────
-- 552_quote_stage_drift_backfill.sql
--
-- Quote lifecycle automation now advances linked QRM deals when quotes are
-- saved/submitted/approved/sent/viewed/accepted. Backfill existing quote-linked
-- deals to the correct forward quote lifecycle stage based on latest quote
-- status while preserving forward-only behavior.
-- ──────────────────────────────────────────────────────────────────────────

do $$
begin
  if exists (
    with latest_quote as (
      select distinct on (qp.deal_id)
        qp.id,
        qp.deal_id,
        qp.status
      from public.quote_packages qp
      where qp.deal_id is not null
        and qp.status in (
          'draft','ready','pending_approval','approved','approved_with_conditions',
          'changes_requested','rejected','sent','viewed','accepted','converted_to_deal'
        )
      order by qp.deal_id, qp.updated_at desc nulls last, qp.created_at desc nulls last, qp.id desc
    ), quote_targets as (
      select
        lq.deal_id,
        case
          when lq.status in ('draft','ready','pending_approval','approved','approved_with_conditions','changes_requested','rejected') then 'Quote Created'
          when lq.status = 'sent' then 'Quote Sent'
          when lq.status = 'viewed' then 'Quote Presented'
          when lq.status in ('accepted','converted_to_deal') then 'Sales Order Signed'
          else null
        end as target_stage_name,
        case
          when lq.status in ('draft','ready','pending_approval','approved','approved_with_conditions','changes_requested','rejected') then 6
          when lq.status = 'sent' then 7
          when lq.status = 'viewed' then 8
          when lq.status in ('accepted','converted_to_deal') then 13
          else null
        end as target_sort_order
      from latest_quote lq
    ), eligible_deals as (
      select d.id as deal_id, d.workspace_id, qt.target_stage_name, qt.target_sort_order
      from quote_targets qt
      join public.crm_deals d on d.id = qt.deal_id
      join public.crm_deal_stages current_stage on current_stage.id = d.stage_id
      where d.deleted_at is null
        and current_stage.is_closed_won is not true
        and current_stage.is_closed_lost is not true
        and qt.target_stage_name is not null
        and qt.target_sort_order is not null
        and current_stage.sort_order < qt.target_sort_order
    )
    select 1
    from eligible_deals ed
    where not exists (
      select 1
      from public.crm_deal_stages target_stage
      where target_stage.workspace_id in (ed.workspace_id, 'default')
        and target_stage.is_closed_won is not true
        and target_stage.is_closed_lost is not true
        and (target_stage.name = ed.target_stage_name or target_stage.sort_order = ed.target_sort_order)
    )
    limit 1
  ) then
    raise exception 'Cannot backfill quote stage drift: missing open target stage by exact name or fallback sort_order for at least one eligible quote-linked deal';
  end if;

  with latest_quote as (
    select distinct on (qp.deal_id)
      qp.id,
      qp.deal_id,
      qp.status
    from public.quote_packages qp
    where qp.deal_id is not null
      and qp.status in (
        'draft','ready','pending_approval','approved','approved_with_conditions',
        'changes_requested','rejected','sent','viewed','accepted','converted_to_deal'
      )
    order by qp.deal_id, qp.updated_at desc nulls last, qp.created_at desc nulls last, qp.id desc
  ), quote_targets as (
    select
      lq.deal_id,
      case
        when lq.status in ('draft','ready','pending_approval','approved','approved_with_conditions','changes_requested','rejected') then 'Quote Created'
        when lq.status = 'sent' then 'Quote Sent'
        when lq.status = 'viewed' then 'Quote Presented'
        when lq.status in ('accepted','converted_to_deal') then 'Sales Order Signed'
        else null
      end as target_stage_name,
      case
        when lq.status in ('draft','ready','pending_approval','approved','approved_with_conditions','changes_requested','rejected') then 6
        when lq.status = 'sent' then 7
        when lq.status = 'viewed' then 8
        when lq.status in ('accepted','converted_to_deal') then 13
        else null
      end as target_sort_order
    from latest_quote lq
  ), eligible_deals as (
    select d.id as deal_id, target_stage.id as target_stage_id
    from quote_targets qt
    join public.crm_deals d on d.id = qt.deal_id
    join public.crm_deal_stages current_stage on current_stage.id = d.stage_id
    cross join lateral (
      select candidate.id
      from public.crm_deal_stages candidate
      where candidate.workspace_id in (d.workspace_id, 'default')
        and candidate.is_closed_won is not true
        and candidate.is_closed_lost is not true
        and (candidate.name = qt.target_stage_name or candidate.sort_order = qt.target_sort_order)
      order by
        case
          when candidate.workspace_id = d.workspace_id and candidate.name = qt.target_stage_name then 1
          when candidate.workspace_id = d.workspace_id and candidate.sort_order = qt.target_sort_order then 2
          when candidate.workspace_id = 'default' and candidate.name = qt.target_stage_name then 3
          when candidate.workspace_id = 'default' and candidate.sort_order = qt.target_sort_order then 4
          else 5
        end,
        candidate.sort_order,
        candidate.id
      limit 1
    ) target_stage
    where d.deleted_at is null
      and current_stage.is_closed_won is not true
      and current_stage.is_closed_lost is not true
      and qt.target_stage_name is not null
      and qt.target_sort_order is not null
      and current_stage.sort_order < qt.target_sort_order
  )
  update public.crm_deals d
  set stage_id = eligible_deals.target_stage_id,
      updated_at = now()
  from eligible_deals
  where d.id = eligible_deals.deal_id;
end $$;

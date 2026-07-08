-- ============================================================================
-- Migration 777: Stream L / L6 — rental_resolve_context
--
-- Blueprint §6: one deterministic RPC returns everything QEP knows about a
-- rental contract (the flow_resolve_context / get_account_360 pattern):
-- contract + lines + both customer anchors + open invoices/balance + AR
-- posture + haul tickets + returns/inspections + RPO + recent rental events.
-- Powers the chat drill-to-chat preload branch (rentalContractId) and any
-- future flow freeze — composite reads, no N+1.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.rental_resolve_context(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'contract', to_jsonb(c) - 'delivery_address' - 'pickup_address',
    'company', (SELECT jsonb_build_object('id', co.id, 'name', co.name)
                FROM public.qrm_companies co WHERE co.id = c.qrm_company_id),
    'portal_customer', (SELECT jsonb_build_object('id', pc.id, 'name', pc.first_name || ' ' || pc.last_name, 'crm_company_id', pc.crm_company_id)
                        FROM public.portal_customers pc WHERE pc.id = c.portal_customer_id),
    'equipment', (SELECT jsonb_build_object('id', e.id, 'label', concat_ws(' ', e.year::text, e.make, e.model),
                          'availability', e.availability, 'readiness_status', e.readiness_status,
                          'next_available_at', e.next_available_at)
                  FROM public.qrm_equipment e WHERE e.id = c.equipment_id),
    'lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'line_number', l.line_number, 'status', l.status, 'return_code', l.return_code,
                'equipment_id', l.equipment_id,
                'outbound_meter_hours', l.outbound_meter_hours, 'return_meter_hours', l.return_meter_hours,
                'exchange_parent_line_id', l.exchange_parent_line_id,
                'exchange_rate_continuous', l.exchange_rate_continuous,
                'is_sub_rental', l.is_sub_rental) ORDER BY l.line_number), '[]'::jsonb)
              FROM public.rental_contract_lines l
              WHERE l.rental_contract_id = c.id AND l.deleted_at IS NULL),
    'invoices', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'invoice_number', i.invoice_number, 'period_start', i.period_start,
                  'period_end', i.period_end, 'status', i.status,
                  'total_cents', i.total_cents, 'balance_cents', i.balance_cents) ORDER BY i.period_start), '[]'::jsonb)
                 FROM public.rental_invoices i
                 WHERE i.rental_contract_id = c.id AND i.deleted_at IS NULL),
    'open_balance_cents', (SELECT COALESCE(sum(i.balance_cents), 0)
                           FROM public.rental_invoices i
                           WHERE i.rental_contract_id = c.id AND i.deleted_at IS NULL
                             AND i.status::text IN ('posted', 'sent', 'partial', 'overdue')),
    'ar_blocked', (SELECT EXISTS (
                    SELECT 1 FROM public.ar_credit_blocks b
                    WHERE b.company_id = c.qrm_company_id AND b.status = 'active'
                      AND b.cleared_at IS NULL
                      AND (b.override_until IS NULL OR b.override_until < now()))),
    'haul_tickets', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'id', t.id, 'status', t.status, 'to_location', t.to_location,
                      'promised_delivery_at', t.promised_delivery_at) ORDER BY t.created_at DESC), '[]'::jsonb)
                     FROM public.traffic_tickets t
                     WHERE t.equipment_id = c.equipment_id AND t.department = 'rental'
                       AND t.status <> 'completed'),
    'returns', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'id', r.id, 'status', r.status, 'damage_disposition', r.damage_disposition,
                 'charge_amount', r.charge_amount, 'work_order_number', r.work_order_number)), '[]'::jsonb)
                FROM public.rental_returns r WHERE r.rental_contract_id = c.id),
    'inspections', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'inspection_number', ir.inspection_number, 'completed_at', ir.completed_at,
                     'machine_hours', ir.machine_hours, 'damage_found', ir.damage_found)), '[]'::jsonb)
                    FROM public.inspection_runs ir WHERE ir.rental_contract_id = c.id),
    'rpo', CASE WHEN c.contract_type = 'rpo' THEN jsonb_build_object(
             'purchase_price_cents', c.rpo_purchase_price_cents,
             'credit_pct', c.rpo_rental_credit_pct,
             'accrued_cents', c.rpo_credit_accrued_cents,
             'exercise_deadline', c.rpo_exercise_deadline) END,
    'recent_events', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'type', ae.flow_event_type, 'at', ae.occurred_at) ORDER BY ae.occurred_at DESC), '[]'::jsonb)
                      FROM (SELECT flow_event_type, occurred_at FROM public.analytics_events
                            WHERE entity_id = c.id::text AND source_module = 'rental'
                            ORDER BY occurred_at DESC LIMIT 10) ae)
  )
  INTO v
  FROM public.rental_contracts c
  WHERE c.id = p_contract_id AND c.deleted_at IS NULL;

  RETURN v;  -- null when the contract does not exist
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rental_resolve_context(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rental_resolve_context(uuid) TO authenticated, service_role;

COMMIT;

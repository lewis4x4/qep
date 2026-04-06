-- Repair rows that violate crm_activities_check (exactly one of contact_id, deal_id, company_id).
-- Typical causes: legacy imports, or edge functions that set multiple FKs (fixed in voice-to-qrm).

-- Prefer deal as the single subject when a deal is linked.
update public.crm_activities
set
  contact_id = null,
  company_id = null,
  updated_at = now()
where deleted_at is null
  and deal_id is not null
  and (contact_id is not null or company_id is not null);

-- If only contact + company (no deal), keep contact only.
update public.crm_activities
set
  company_id = null,
  updated_at = now()
where deleted_at is null
  and deal_id is null
  and contact_id is not null
  and company_id is not null;

-- Remove rows with no CRM subject (cannot satisfy constraint or product rules).
delete from public.crm_activities
where deleted_at is null
  and contact_id is null
  and deal_id is null
  and company_id is null;

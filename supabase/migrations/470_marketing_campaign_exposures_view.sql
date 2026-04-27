-- 470_marketing_campaign_exposures_view.sql
--
-- Wave 1 held-conflict resolution for
-- docs/intellidealer-gap-audit/phase-9-advanced-intelligence.yaml#customer_portal_view.marketing_campaigns.
--
-- Decision: public.marketing_campaigns and public.campaign_recipients already
-- model campaign delivery/exposure. Do not duplicate marketing_campaigns. Add
-- a compatibility view named marketing_campaign_exposures over recipients so
-- account/customer surfaces can query the audit shape without split-brain
-- campaign storage.
--
-- Rollback notes:
--   drop view if exists public.marketing_campaign_exposures;

create or replace view public.marketing_campaign_exposures
  with (security_invoker = true) as
select
  cr.id,
  mc.workspace_id,
  cr.campaign_id,
  coalesce(pc.crm_company_id, c.primary_company_id) as company_id,
  cr.contact_id,
  cr.portal_customer_id,
  coalesce(cr.delivered_at, cr.opened_at, cr.clicked_at, cr.converted_at, cr.created_at) as exposed_at,
  case
    when cr.converted_at is not null then 100::numeric
    when cr.clicked_at is not null then 75::numeric
    when cr.opened_at is not null then 50::numeric
    when cr.delivered_at is not null then 25::numeric
    else 0::numeric
  end as engagement_score,
  cr.channel,
  cr.delivery_status,
  cr.opened_at,
  cr.clicked_at,
  cr.converted_at,
  cr.created_at
from public.campaign_recipients cr
join public.marketing_campaigns mc on mc.id = cr.campaign_id
left join public.portal_customers pc on pc.id = cr.portal_customer_id
left join public.crm_contacts c on c.id = cr.contact_id;

comment on view public.marketing_campaign_exposures is
  'Compatibility view for IntelliDealer marketing campaign exposures. Source of truth remains marketing_campaigns + campaign_recipients.';
comment on column public.marketing_campaign_exposures.company_id is
  'Best-effort company from portal customer or CRM contact; no new exposure storage is created.';
comment on column public.marketing_campaign_exposures.exposed_at is
  'Exposure timestamp derived from delivery/engagement timestamps, falling back to recipient creation time.';
comment on column public.marketing_campaign_exposures.engagement_score is
  'Derived 0-100 engagement score from existing recipient lifecycle timestamps.';

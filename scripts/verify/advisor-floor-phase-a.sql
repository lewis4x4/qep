-- Epic #45 Phase A — data audit for iron_advisor /floor
-- Replace <ADVISOR_UUID> with profiles.id for the Sales Team / advisor test user (see profiles.iron_role = 'iron_advisor').

-- 1) Profile + role
select id, email, role, iron_role, active_workspace_id
from public.profiles
where id = '<ADVISOR_UUID>'::uuid;

-- 2) Quote packages for this rep (status buckets for My Quotes widget)
select status, count(*) as n
from public.quote_packages
where created_by = '<ADVISOR_UUID>'::uuid
  and coalesce(status::text, '') not in ('archived', 'converted_to_deal')
group by status
order by n desc;

-- 3) Follow-ups (action items surface)
select count(*) as pending_follow_ups
from public.follow_up_touchpoints t
join public.follow_up_cadences c on c.id = t.cadence_id
where t.status in ('pending', 'scheduled')
  and c.assigned_to = '<ADVISOR_UUID>'::uuid;

-- 4) Active deals
select count(*) as open_deals
from public.qrm_deals
where assigned_rep_id = '<ADVISOR_UUID>'::uuid
  and deleted_at is null
  and closed_at is null;

-- 5) Recent rep-logged activities (Recent Activity widget)
select count(*) as activities_last_30d
from public.qrm_activities
where created_by = '<ADVISOR_UUID>'::uuid
  and deleted_at is null
  and occurred_at > now() - interval '30 days';

-- 6) Quotes viewed in last 7 days (buying-signal stream in Recent Activity)
select count(*) as quotes_viewed_7d
from public.quote_packages
where created_by = '<ADVISOR_UUID>'::uuid
  and viewed_at is not null
  and viewed_at > now() - interval '7 days';

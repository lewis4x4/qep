-- 544 — Canonical QEP selling branches
--
-- The quote branch picker reads public.branches where is_active = true and
-- deleted_at is null. Demo/inventory backfills created operational rows like
-- Branch 02, Gulf Depot, Main, and Main Yard, which are not customer-facing
-- QEP selling branches. Keep those historical rows for foreign keys and old
-- quotes, but mark them inactive so active branch dropdowns show only Lake City
-- and Ocala. The app's QEP tenant uses workspace_id = 'default', so this is
-- intentionally scoped there instead of guessing from generic branch names.

create temporary table _qep_branch_workspaces on commit drop as
with normalized_branches as (
  select
    workspace_id,
    regexp_replace(lower(coalesce(display_name, slug)), '[^a-z0-9]+', '', 'g') as normalized_display,
    regexp_replace(lower(coalesce(slug, display_name)), '[^a-z0-9]+', '', 'g') as normalized_slug
  from public.branches
  where deleted_at is null
    and workspace_id = 'default'
)
select distinct workspace_id
from normalized_branches
where normalized_display in (
  'branch02',
  'branch2',
  'gulfdepot',
  'gulfcoastdepot',
  'lakecity',
  'lakecitybranch',
  'ocala'
)
or normalized_slug in (
  'branch02',
  'branch2',
  'gulfdepot',
  'gulfcoastdepot',
  'lakecity',
  'lakecitybranch',
  'ocala'
);

insert into public.branches (
  workspace_id,
  slug,
  display_name,
  is_active,
  city,
  state_province,
  country,
  timezone,
  notes,
  metadata
)
select
  workspace_id,
  'lake-city',
  'Lake City',
  true,
  'Lake City',
  'FL',
  'US',
  'America/New_York',
  'Canonical QEP selling branch for quote routing.',
  jsonb_build_object('canonical_selling_branch', true)
from _qep_branch_workspaces w
where not exists (
  select 1
  from public.branches b
  where b.workspace_id = w.workspace_id
    and b.deleted_at is null
    and (
      regexp_replace(lower(coalesce(b.display_name, b.slug)), '[^a-z0-9]+', '', 'g') in ('lakecity', 'lakecitybranch')
      or regexp_replace(lower(coalesce(b.slug, b.display_name)), '[^a-z0-9]+', '', 'g') in ('lakecity', 'lakecitybranch')
    )
)
on conflict (workspace_id, slug) do update
set
  display_name = 'Lake City',
  is_active = true,
  deleted_at = null,
  city = coalesce(public.branches.city, excluded.city),
  state_province = coalesce(public.branches.state_province, excluded.state_province),
  country = coalesce(public.branches.country, excluded.country),
  timezone = coalesce(public.branches.timezone, excluded.timezone),
  notes = case
    when public.branches.notes is null or public.branches.notes = '' then excluded.notes
    when public.branches.notes like '%Canonical QEP selling branch%' then public.branches.notes
    else public.branches.notes || ' Canonical QEP selling branch for quote routing.'
  end,
  metadata = coalesce(public.branches.metadata, '{}'::jsonb) || jsonb_build_object('canonical_selling_branch', true),
  updated_at = now();

insert into public.branches (
  workspace_id,
  slug,
  display_name,
  is_active,
  city,
  state_province,
  country,
  timezone,
  notes,
  metadata
)
select
  workspace_id,
  'ocala',
  'Ocala',
  true,
  'Ocala',
  'FL',
  'US',
  'America/New_York',
  'Canonical QEP selling branch for quote routing.',
  jsonb_build_object('canonical_selling_branch', true)
from _qep_branch_workspaces
on conflict (workspace_id, slug) do update
set
  display_name = 'Ocala',
  is_active = true,
  deleted_at = null,
  city = coalesce(public.branches.city, excluded.city),
  state_province = coalesce(public.branches.state_province, excluded.state_province),
  country = coalesce(public.branches.country, excluded.country),
  timezone = coalesce(public.branches.timezone, excluded.timezone),
  notes = case
    when public.branches.notes is null or public.branches.notes = '' then excluded.notes
    when public.branches.notes like '%Canonical QEP selling branch%' then public.branches.notes
    else public.branches.notes || ' Canonical QEP selling branch for quote routing.'
  end,
  metadata = coalesce(public.branches.metadata, '{}'::jsonb) || jsonb_build_object('canonical_selling_branch', true),
  updated_at = now();

create temporary table _qep_branch_keep on commit drop as
with candidates as (
  select
    b.id,
    b.workspace_id,
    case
      when regexp_replace(lower(coalesce(b.display_name, b.slug)), '[^a-z0-9]+', '', 'g') in ('lakecity', 'lakecitybranch')
        or regexp_replace(lower(coalesce(b.slug, b.display_name)), '[^a-z0-9]+', '', 'g') in ('lakecity', 'lakecitybranch')
        then 'lake_city'
      when regexp_replace(lower(coalesce(b.display_name, b.slug)), '[^a-z0-9]+', '', 'g') = 'ocala'
        or regexp_replace(lower(coalesce(b.slug, b.display_name)), '[^a-z0-9]+', '', 'g') = 'ocala'
        then 'ocala'
      else null
    end as canonical_key,
    row_number() over (
      partition by
        b.workspace_id,
        case
          when regexp_replace(lower(coalesce(b.display_name, b.slug)), '[^a-z0-9]+', '', 'g') in ('lakecity', 'lakecitybranch')
            or regexp_replace(lower(coalesce(b.slug, b.display_name)), '[^a-z0-9]+', '', 'g') in ('lakecity', 'lakecitybranch')
            then 'lake_city'
          when regexp_replace(lower(coalesce(b.display_name, b.slug)), '[^a-z0-9]+', '', 'g') = 'ocala'
            or regexp_replace(lower(coalesce(b.slug, b.display_name)), '[^a-z0-9]+', '', 'g') = 'ocala'
            then 'ocala'
          else null
        end
      order by
        case
          when regexp_replace(lower(coalesce(b.slug, b.display_name)), '[^a-z0-9]+', '', 'g') in ('ocala', 'lakecity', 'lakecitybranch') then 0
          else 1
        end,
        case when b.is_active and b.deleted_at is null then 0 else 1 end,
        (
          case when b.address_line1 is not null then 1 else 0 end +
          case when b.phone_main is not null then 1 else 0 end +
          case when b.email_main is not null then 1 else 0 end +
          case when b.sales_manager_id is not null then 1 else 0 end +
          case when b.general_manager_id is not null then 1 else 0 end
        ) desc,
        b.updated_at desc,
        b.created_at desc,
        b.id
    ) as rn
  from public.branches b
  join _qep_branch_workspaces w on w.workspace_id = b.workspace_id
)
select id, workspace_id, canonical_key
from candidates
where canonical_key is not null
  and rn = 1;

update public.branches b
set
  display_name = case k.canonical_key
    when 'lake_city' then 'Lake City'
    when 'ocala' then 'Ocala'
    else b.display_name
  end,
  is_active = true,
  deleted_at = null,
  city = case k.canonical_key
    when 'lake_city' then coalesce(b.city, 'Lake City')
    when 'ocala' then coalesce(b.city, 'Ocala')
    else b.city
  end,
  state_province = coalesce(b.state_province, 'FL'),
  country = coalesce(b.country, 'US'),
  timezone = coalesce(b.timezone, 'America/New_York'),
  metadata = coalesce(b.metadata, '{}'::jsonb) || jsonb_build_object('canonical_selling_branch', true),
  updated_at = now()
from _qep_branch_keep k
where k.id = b.id;

update public.branches b
set
  is_active = false,
  notes = case
    when b.notes is null or b.notes = '' then 'Inactive: operational/demo branch hidden from QEP selling branch pickers.'
    when b.notes like '%hidden from QEP selling branch pickers%' then b.notes
    else b.notes || ' Inactive: operational/demo branch hidden from QEP selling branch pickers.'
  end,
  metadata = coalesce(b.metadata, '{}'::jsonb) || jsonb_build_object('archived_from_selling_branch_picker', true),
  updated_at = now()
from _qep_branch_workspaces w
where b.workspace_id = w.workspace_id
  and b.deleted_at is null
  and not exists (
    select 1
    from _qep_branch_keep k
    where k.id = b.id
  );

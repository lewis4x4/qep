-- 521_floor_customer_legacy_search_layouts.sql
--
-- Makes the customer-search Floor widget visible in role-default layouts that
-- still have room under the six-widget cap. This supports the IntelliDealer
-- customer handoff by letting users search imported customers by their legacy
-- customer number directly from the Floor.
--
-- Per-user layout overrides are intentionally untouched.

update public.floor_layouts
set
  layout_json = jsonb_set(
    layout_json,
    '{widgets}',
    (layout_json->'widgets') || jsonb_build_array(jsonb_build_object('id', 'crm.customer-search', 'order', 4))
  ),
  updated_at = now()
where workspace_id = 'default'
  and user_id is null
  and iron_role = 'iron_owner'
  and jsonb_array_length(layout_json->'widgets') < 6
  and not exists (
    select 1
    from jsonb_array_elements(layout_json->'widgets') as widget
    where widget->>'id' = 'crm.customer-search'
  );

update public.floor_layouts
set
  layout_json = jsonb_set(
    layout_json,
    '{widgets}',
    (layout_json->'widgets') || jsonb_build_array(jsonb_build_object('id', 'crm.customer-search', 'order', 5))
  ),
  updated_at = now()
where workspace_id = 'default'
  and user_id is null
  and iron_role in ('iron_advisor', 'iron_woman', 'iron_man', 'iron_parts_counter')
  and jsonb_array_length(layout_json->'widgets') < 6
  and not exists (
    select 1
    from jsonb_array_elements(layout_json->'widgets') as widget
    where widget->>'id' = 'crm.customer-search'
  );

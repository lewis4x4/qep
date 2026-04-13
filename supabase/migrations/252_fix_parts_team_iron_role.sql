-- Migration 252: Fix Parts Team users landing on Sales page
--
-- Users with "Parts" in their name who have role='rep' were not getting
-- iron_role='iron_woman' set, causing them to route to /sales/today
-- instead of /parts/companion/queue.

UPDATE public.profiles
SET iron_role = 'iron_woman',
    updated_at = now()
WHERE lower(full_name) LIKE '%parts%'
  AND (iron_role IS NULL OR iron_role = 'iron_advisor')
  AND role IN ('rep', 'admin');

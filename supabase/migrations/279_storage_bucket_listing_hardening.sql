-- ============================================================================
-- Migration 279: Drop broad listing policies on public storage buckets
--
-- Closes advisor warning "Public Bucket Allows Listing" for branch-assets
-- and equipment-photos. These buckets serve public object URLs via the
-- Supabase CDN; they don't need a SELECT policy on storage.objects for
-- that to work. Dropping the policies removes the ability for anonymous
-- clients to enumerate every file in the bucket.
--
-- Verified impact:
--   - Public URL access (e.g. /storage/v1/object/public/<bucket>/<path>)
--     still works — unchanged, CDN layer doesn't require storage.objects SELECT.
--   - storage.from('branch-assets').list() calls by anon/authenticated
--     will now return empty/denied. Upload/signed-URL flows unaffected.
-- ============================================================================

drop policy if exists branch_assets_select on storage.objects;
drop policy if exists equipment_photos_select on storage.objects;

-- ============================================================================
-- Migration 279 complete.
-- ============================================================================

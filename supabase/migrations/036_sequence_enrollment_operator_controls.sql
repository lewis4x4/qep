-- Allow elevated CRM operators to govern enrollment status from the app.

drop policy if exists "enrollments_update_elevated" on public.sequence_enrollments;

create policy "enrollments_update_elevated" on public.sequence_enrollments
  for update
  using (public.get_my_role() in ('admin', 'manager', 'owner'))
  with check (public.get_my_role() in ('admin', 'manager', 'owner'));

-- Rollback (do not execute -- reference only)
-- drop policy if exists "enrollments_update_elevated" on public.sequence_enrollments;

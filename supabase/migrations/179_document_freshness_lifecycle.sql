-- Knowledge base freshness lifecycle:
-- - review cadence per document
-- - automatic review_due scheduling
-- - weekly cron to move stale published docs into pending_review

alter type public.document_audit_event_type add value if not exists 'review_due';

alter table public.documents
  add column if not exists review_interval_days integer not null default 180;

alter table public.documents
  drop constraint if exists documents_review_interval_days_check;

alter table public.documents
  add constraint documents_review_interval_days_check
  check (review_interval_days > 0 and review_interval_days <= 3650);

create index if not exists idx_documents_published_review_due
  on public.documents (review_due_at)
  where status = 'published';

create or replace function public.sync_document_review_schedule()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' then
    if tg_op = 'INSERT'
      or old.status is distinct from new.status
      or old.review_interval_days is distinct from new.review_interval_days
      or new.review_due_at is null
    then
      new.review_due_at := now() + make_interval(days => coalesce(new.review_interval_days, 180));
    end if;
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status and new.status <> 'published' then
    new.review_due_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_document_review_schedule on public.documents;
create trigger sync_document_review_schedule
  before insert or update of status, review_interval_days, review_due_at
  on public.documents
  for each row execute function public.sync_document_review_schedule();

update public.documents
set review_due_at = now() + make_interval(days => coalesce(review_interval_days, 180))
where status = 'published'
  and review_due_at is null;

do $cron$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping document freshness cron: pg_cron not available.';
    return;
  end if;

  perform cron.unschedule('document-review-due-weekly')
    where exists (select 1 from cron.job where jobname = 'document-review-due-weekly');

  perform cron.schedule(
    'document-review-due-weekly',
    '0 14 * * 1',
    $sql$
      with due_docs as (
        select id, title
        from public.documents
        where status = 'published'
          and review_due_at is not null
          and review_due_at <= now()
      ),
      updated as (
        update public.documents doc
        set status = 'pending_review'
        from due_docs due
        where doc.id = due.id
        returning doc.id, due.title
      )
      insert into public.document_audit_events (
        document_id,
        document_title_snapshot,
        event_type,
        metadata
      )
      select
        updated.id,
        updated.title,
        'review_due'::public.document_audit_event_type,
        jsonb_build_object('trigger', 'weekly_cron')
      from updated;
    $sql$
  );
exception
  when undefined_object then
    raise notice 'Skipping document freshness cron: %', sqlerrm;
  when others then
    raise notice 'Skipping document freshness cron: %', sqlerrm;
end;
$cron$;

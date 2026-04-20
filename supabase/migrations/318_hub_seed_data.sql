-- ============================================================================
-- Migration 318: Hub — seed baseline build items + decisions + changelog.
--
-- Day 13-14 work (per the 14-day plan): the tiles and activity feed need
-- real current-state data before the Rylee walkthrough. This seed reflects
-- the world as of the hub launch — QRM Phase 1, DGE Sprint 2, Parts Phases
-- 1-3, Service & Rental command centers, plus the Stakeholder Build Hub
-- itself (the thing you're reading about in the thing).
--
-- Decisions seed: the six locked choices from the original planning pass
-- (/brief not /hub, Supabase mirror not M365 Graph, browser mic not Twilio,
-- Resend not M365 email, Sonnet triage not Opus, single-tenant workspace).
-- These are the provenance receipts the /brief/decisions surface reads.
--
-- Idempotency: every insert is wrapped in `on conflict do nothing` on a
-- stable natural key (title for decisions, title+module for build items).
-- Safe to re-run.
--
-- Safety: this seed only INSERTS rows. It never updates or deletes. If
-- Brian later refines a title or body, the seed will no-op and the edit
-- sticks.
-- ============================================================================

-- ── 1. Build items ──────────────────────────────────────────────────────────

insert into public.hub_build_items (workspace_id, module, title, description, status, sprint_number)
values
  ('default', 'crm', 'QRM HubSpot replacement — Phase 1',
    'Swap HubSpot for the in-house QEP Relationship Manager. Deals, companies, activities, duplicate detection, voice-capture, follow-up sequences.',
    'in_progress', 1),
  ('default', 'crm', 'QRM voice-capture → deal hydration',
    'Browser mic → iron-transcribe → auto-hydrated CRM deal with extracted fields.',
    'shipped', 1),
  ('default', 'sales', 'DGE Sprint 2 — deal economics',
    'Deep deal-economics surface with margin health, pricing rules, and cross-dealer mirror. Sprint 2 stabilization.',
    'in_progress', 2),
  ('default', 'parts', 'Parts Intelligence Engine — Phases 1-3',
    'Bulk import, predictive failure, pricing autocorrect, predictive AI, auto-replenish, demand forecast. Shipped across 3 phases.',
    'shipped', 3),
  ('default', 'parts', 'AI parts lookup — voice-first',
    'Speak the part, get the SKU. Embeddings + Anthropic for clarification.',
    'shipped', 2),
  ('default', 'service', 'Service command center',
    'Unified intake, asset detail, and work-order view for the service line.',
    'in_progress', 2),
  ('default', 'rental', 'Rental command center',
    'Fleet utilization, rental pipeline, and quote-to-contract flow.',
    'in_progress', 2),
  ('default', 'financial', 'Owner morning brief',
    'Claude Sonnet 4.6 reads overnight events + KPIs and writes the owner a 3-5 sentence briefing.',
    'shipped', 1),
  ('default', 'hub', 'Stakeholder Build Hub — /brief',
    'Personalized dashboard, closed feedback→PR→ship loop, decisions log with NotebookLM provenance, Ask-the-Project-Brain retrieval. The thing you are reading.',
    'in_progress', 1),
  ('default', 'dge', 'DGE refresh worker + economic sync',
    'Daily market valuation refresh + economic data pull into the deal economics surface.',
    'shipped', 2)
on conflict do nothing;

-- Mark shipped items with a shipped_at timestamp so the "Shipped this week"
-- tile has something to show. We set them a few days ago so the week window
-- catches them.
update public.hub_build_items
set shipped_at = now() - interval '2 days'
where status = 'shipped' and shipped_at is null;

-- ── 2. Decisions ────────────────────────────────────────────────────────────
-- The locked choices from the planning Q&A. Each one is the receipt for a
-- visible architectural trade-off the stakeholders will ask about.

insert into public.hub_decisions (workspace_id, title, context, decision, decided_by, affects_modules)
select * from (values
  (
    'default',
    'Stakeholder hub lives at /brief, not /hub',
    '/hub is already taken by OperatingSystemHubPage (the internal dashboard). Rerouting it would break existing deep-links.',
    'New route is /brief. Audience-gated: stakeholders land there by default, internal users navigate in via sidebar.',
    array['Brian', 'Rylee']::text[],
    array['hub']::text[]
  ),
  (
    'default',
    'NotebookLM integration: Supabase pgvector mirror, not the NotebookLM API',
    'NotebookLM has no public API. Live-querying was not on the table. The Drive folder NotebookLM watches IS public-API-shaped.',
    'We push markdown to Drive from hub_changelog + hub_decisions. NotebookLM ingests on its cadence. Supabase pgvector mirror is the load-bearing path for Ask-the-Brain.',
    array['Brian', 'Ryan']::text[],
    array['hub']::text[]
  ),
  (
    'default',
    'Voice-in: browser mic only, skip Twilio/8x8 for v1',
    'A dedicated phone line adds cost + a failure mode. The browser mic + iron-transcribe already work in QRM.',
    'Feedback modal reuses the existing iron-transcribe flow. Phone line is Phase 2 when a real need shows up.',
    array['Brian', 'Rylee']::text[],
    array['hub']::text[]
  ),
  (
    'default',
    'Transactional email: Resend, not M365 Graph',
    'M365 Graph requires a tenant-scoped app registration. Resend is already wired + working.',
    '_shared/resend-email.ts is the only email path. RESEND_FROM defaults to the shared onboarding address.',
    array['Brian']::text[],
    array['hub', 'crm']::text[]
  ),
  (
    'default',
    'Triage model: Claude Sonnet 4.6; escalate only when needed',
    'Sonnet is fast and cheap. Opus 4.7 costs more and is slower — reserved for genuinely hard classification.',
    'hub-feedback-intake uses Sonnet. If confidence drops, future work can add an Opus fallback.',
    array['Brian']::text[],
    array['hub']::text[]
  ),
  (
    'default',
    'Single-tenant workspace_id = default for v1',
    'A second BlackRock AI client is not imminent. workspace_members table adds complexity for no current gain.',
    'Stay with workspace_id text default ''default''. Revisit when the second tenant lands.',
    array['Brian', 'Ryan']::text[],
    array['crm', 'parts', 'hub']::text[]
  )
) as d(workspace_id, title, context, decision, decided_by, affects_modules)
where not exists (
  select 1 from public.hub_decisions existing
  where existing.workspace_id = d.workspace_id and existing.title = d.title
);

-- ── 3. Changelog seed ───────────────────────────────────────────────────────
-- Bootstrap the activity feed so it isn't empty before the first cron tick.
-- hub-changelog-from-commit will append real entries as commits land.

insert into public.hub_changelog (workspace_id, summary, details, change_type, created_at)
select * from (values
  ('default',
   'Stakeholder Build Hub is live at /brief — you are reading it.',
   'Migrations 310-318 + 7 edge functions + /brief routes landed this week.',
   'shipped',
   now() - interval '1 hour'),
  ('default',
   'Feedback loop closed: submit → Claude triages → draft PR → merge → "your fix shipped".',
   'hub-feedback-intake + hub-feedback-draft-fix + hub-merge-pr + hub-changelog-from-commit wire end-to-end.',
   'shipped',
   now() - interval '6 hours'),
  ('default',
   'Ask the Project Brain now answers with citations from pgvector-mirrored NotebookLM sources.',
   'hub-knowledge-sync chunks + embeds changelog/decisions/specs every 4h. hub-ask-brain wraps match_hub_knowledge.',
   'shipped',
   now() - interval '1 day'),
  ('default',
   'Parts Intelligence Engine Phase 3: demand forecast + auto-replenish land.',
   'Two new edge functions + pgvector-backed predictions. Rolled out for Parts team.',
   'shipped',
   now() - interval '3 days'),
  ('default',
   'QRM voice capture hydrates a full deal from a 30-second memo.',
   'iron-transcribe + Claude extraction → company/contact/amount/next-step all autofilled.',
   'shipped',
   now() - interval '5 days')
) as c(workspace_id, summary, details, change_type, created_at)
where not exists (
  select 1 from public.hub_changelog existing
  where existing.workspace_id = c.workspace_id and existing.summary = c.summary
);

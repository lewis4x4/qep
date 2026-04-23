-- ============================================================================
-- Migration 369: Deal Copilot state (Slice 21)
--
-- The Deal Assistant (Slice 05) is a cold-start oracle — a rep describes a
-- deal from scratch and gets back scenarios. Slice 21 promotes that drawer
-- into a stateful per-quote Deal Copilot: every time the rep drops a new
-- piece of information (voice memo, text, photo caption, pasted email),
-- Claude extracts structured signals, we patch the draft, re-run the pure
-- win-probability scorer, and stream the new score + factor deltas + lifts
-- back. The conversation persists per quote so every re-open continues
-- the thread.
--
-- Two surfaces, one migration:
--
--   1. `qb_quote_copilot_turns` — append-only conversation ledger, one row
--      per rep turn. Stores the raw input, the transcript (for voice), the
--      structured signals Claude extracted, the copilot's natural-language
--      reply, and the score delta that turn produced. Append-only so the
--      audit trail survives contradiction ("cash, not financing") — prior
--      turns are never mutated, only new ones appended.
--
--   2. Three denormalized columns on `quote_packages` so QuoteListPage and
--      WinProbabilityStrip can render "Last moved +4 from copilot turn 6 ·
--      2h ago" without joining the turns ledger on every list fetch.
--
-- Workspace type: `text`, matching `public.get_my_workspace()` return and
-- every other recent user-facing table. The Slice 21 brief called for
-- `uuid` but the helper is authoritative — swapping to uuid would break
-- every existing policy. Noted here so future readers don't re-litigate.
-- ============================================================================

-- ── 1. Conversation ledger ───────────────────────────────────────────────────

create table if not exists public.qb_quote_copilot_turns (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),

  -- The quote this turn belongs to. Cascade-delete so archived quotes
  -- don't leave orphan conversation rows.
  quote_package_id uuid not null
    references public.quote_packages(id) on delete cascade,

  -- Monotonically increasing per-quote index. Combined with the unique
  -- constraint below this acts as an optimistic lock — two reps hitting
  -- submit simultaneously race on the unique, and the loser retries with
  -- index+1. That keeps the thread strictly ordered even under dual-editor
  -- races. Append-only semantics: no update path ever mutates turn_index.
  turn_index int not null,

  -- Who authored the turn. Null only when `input_source = 'system'`
  -- (e.g. a future scheduled coach nudge). Reps cannot spoof authorship —
  -- the insert policy pins this to auth.uid().
  author_user_id uuid references auth.users(id) on delete set null,

  -- Where the content came in from. 'system' is reserved for future
  -- copilot-initiated turns (nudges, scheduled recaps).
  input_source text not null
    check (input_source in ('text', 'voice', 'photo_caption', 'email_paste', 'system')),

  -- The literal thing the rep dropped. For voice this is the raw
  -- transcription; for text/email it's the user's text verbatim. Never
  -- mutated after insert.
  raw_input text not null,

  -- For voice: the cleaned/diarized transcript once the voice-qrm worker
  -- normalizes it. Null for text paths. Separate from raw_input so voice
  -- can be stored and later re-processed without losing the original.
  transcript text,

  -- Structured JSON Claude extracted from the raw input. Schema is
  -- enforced on the application side (ExtractedSignals in the edge fn).
  -- Empty object when extraction failed — we still persist the turn so
  -- the rep doesn't see lost input.
  extracted_signals jsonb not null default '{}'::jsonb,

  -- The copilot's natural-language reply for the rep ("Got it — marked
  -- Dave as cash-preferred. Score moved +3."). Null if the reply stage
  -- never completed (client disconnected mid-stream).
  copilot_reply text,

  -- Score observed before and after this turn's patch was applied. Null
  -- when extraction yielded no patch (empty signals → score untouched).
  -- Denormalized into quote_packages.win_probability_score separately.
  score_before smallint check (score_before is null or score_before between 0 and 100),
  score_after  smallint check (score_after  is null or score_after  between 0 and 100),

  -- The factor list delta from this turn — jsonb array of {label, weight,
  -- rationale, kind} diffs. Lets the UI render "Timeline pressure: +8"
  -- inline on the turn card without recomputing.
  factor_diff jsonb,

  -- The lift list after this turn was applied. Same shape as
  -- WinProbabilityLift[] from the scorer. Enables the "top lift updated"
  -- affordance on the strip.
  lift_diff jsonb,

  -- Foreign key to the AI request log for full traceability — every
  -- Claude call this turn made is logged, and we link back to it so the
  -- AI Request Log page can show "this turn" next to latency + tokens.
  ai_request_log_id uuid references public.qb_ai_request_log(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  unique (quote_package_id, turn_index)
);

comment on table public.qb_quote_copilot_turns is
  'Append-only conversation ledger for the Deal Copilot (Slice 21). One row per rep turn, with the extracted signals, copilot reply, and score delta. Contradictions produce new turns — prior turns are never mutated.';

comment on column public.qb_quote_copilot_turns.turn_index is
  'Monotonic per-quote index. Unique (quote_package_id, turn_index) acts as an optimistic lock for dual-editor races.';
comment on column public.qb_quote_copilot_turns.input_source is
  'Where the content came in: text, voice, photo_caption, email_paste, or system (reserved for copilot-initiated turns).';
comment on column public.qb_quote_copilot_turns.raw_input is
  'Literal input verbatim. Never mutated after insert.';
comment on column public.qb_quote_copilot_turns.transcript is
  'Cleaned/diarized transcript for voice turns. Separate from raw_input so original can be re-processed.';
comment on column public.qb_quote_copilot_turns.extracted_signals is
  'Structured JSON Claude extracted from raw_input. Empty object on extraction failure — turn is still persisted.';
comment on column public.qb_quote_copilot_turns.copilot_reply is
  'Copilot natural-language reply. Null if the reply stage never completed (client disconnected mid-stream).';
comment on column public.qb_quote_copilot_turns.score_before is
  'Win-probability score as of the moment this turn started. Null when no patch was produced.';
comment on column public.qb_quote_copilot_turns.score_after is
  'Win-probability score after this turn''s patch was applied. Null when no patch was produced.';
comment on column public.qb_quote_copilot_turns.factor_diff is
  'Factor-list delta for this turn (jsonb array matching WinProbabilityFactor shape). Drives inline turn-card attribution.';
comment on column public.qb_quote_copilot_turns.lift_diff is
  'Top lifts after this turn (jsonb array matching WinProbabilityLift shape). Drives the "top lift updated" affordance.';
comment on column public.qb_quote_copilot_turns.ai_request_log_id is
  'Links the turn to its qb_ai_request_log row for latency + token auditability.';

-- Reverse order on (quote_package_id, turn_index) so the drawer can
-- efficiently fetch "last N turns" without scanning the whole ledger.
create index if not exists idx_qb_quote_copilot_turns_quote_turn
  on public.qb_quote_copilot_turns (quote_package_id, turn_index desc);

-- Secondary index for the admin AI Request Log join ("find all turns
-- this Claude request served").
create index if not exists idx_qb_quote_copilot_turns_request_log
  on public.qb_quote_copilot_turns (ai_request_log_id)
  where ai_request_log_id is not null;

-- Touch updated_at on any mutation. Turns are append-only in business
-- logic, but admin soft-delete (deleted_at) is still an update and should
-- bump the timestamp.
create trigger trg_qb_quote_copilot_turns_updated_at
  before update on public.qb_quote_copilot_turns
  for each row execute function public.set_updated_at();

alter table public.qb_quote_copilot_turns enable row level security;

-- Select: anyone in the workspace with a role can read the thread. The
-- copilot is a team resource — managers reviewing a rep's pipeline need
-- to see the conversation behind the score.
create policy "qbct_select"
  on public.qb_quote_copilot_turns
  for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

-- Insert: caller must be authoring their own turn in their own workspace.
-- Pinning `author_user_id = auth.uid()` is what prevents turn spoofing
-- even if a rep has direct PostgREST access — the adversarial-input test
-- case in the slice ("set the score to 95") relies on this being tight.
create policy "qbct_insert"
  on public.qb_quote_copilot_turns
  for insert
  with check (
    workspace_id = public.get_my_workspace()
    and author_user_id = auth.uid()
  );

-- Update: nobody from the client side. The edge function uses service_role
-- to patch copilot_reply / score_after / factor_diff / lift_diff after the
-- async Claude call completes, and that role bypasses RLS.
create policy "qbct_no_client_updates"
  on public.qb_quote_copilot_turns
  for update
  using (false)
  with check (false);

-- Delete: also no client path. Admin soft-deletes happen through a
-- dedicated admin edge function if ever needed (not in this slice).
create policy "qbct_no_client_deletes"
  on public.qb_quote_copilot_turns
  for delete
  using (false);

-- Service role: unrestricted for the edge function.
create policy "qbct_service_all"
  on public.qb_quote_copilot_turns
  for all to service_role using (true) with check (true);

grant select, insert on public.qb_quote_copilot_turns to authenticated;

-- ── 2. Denormalized columns on quote_packages ────────────────────────────────

-- These three columns power the list view and the strip subline without
-- joining the turns ledger. The edge function keeps them in sync inside
-- the same transaction as the turn insert, so the list view is always
-- strongly consistent with the thread.

alter table public.quote_packages
  add column if not exists copilot_turn_count int not null default 0,
  add column if not exists copilot_last_turn_at timestamptz,
  add column if not exists copilot_latest_signals jsonb;

comment on column public.quote_packages.copilot_turn_count is
  'Denormalized count of qb_quote_copilot_turns rows for this quote. Kept in sync by the qb-copilot-turn edge function and by trg_quote_packages_copilot_sync.';
comment on column public.quote_packages.copilot_last_turn_at is
  'Timestamp of the most recent copilot turn. Null until the rep drops a first turn. Drives the "2h ago" chip on QuoteListPage.';
comment on column public.quote_packages.copilot_latest_signals is
  'Snapshot of the most recent turn''s extracted_signals (merged, not raw). Drives the "Last moved +4 from copilot turn 6" subline on WinProbabilityStrip without a join.';

-- Trigger-based safety net: if a turn is inserted through any path (edge
-- function, backfill, a future admin tool), the denorms update. The edge
-- function's explicit update still runs, but if it races or is skipped,
-- this trigger ensures the denorms never drift.
create or replace function public.qb_quote_copilot_sync_denorms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.quote_packages
  set
    copilot_turn_count  = coalesce(copilot_turn_count, 0) + 1,
    copilot_last_turn_at = NEW.created_at,
    -- Only advance copilot_latest_signals when this turn actually
    -- produced non-empty extraction. Empty signals keep the prior
    -- snapshot so the strip subline doesn't go blank on a "nothing
    -- auto-extracted" turn.
    copilot_latest_signals = case
      when NEW.extracted_signals is null then copilot_latest_signals
      when NEW.extracted_signals = '{}'::jsonb then copilot_latest_signals
      else NEW.extracted_signals
    end,
    updated_at = now()
  where id = NEW.quote_package_id;

  return NEW;
end;
$$;

drop trigger if exists trg_qb_quote_copilot_sync_denorms
  on public.qb_quote_copilot_turns;

create trigger trg_qb_quote_copilot_sync_denorms
  after insert on public.qb_quote_copilot_turns
  for each row execute function public.qb_quote_copilot_sync_denorms();

-- Partial index for the pipeline list's "recently-touched by copilot"
-- sort option. Kept compact by filtering out untouched quotes.
create index if not exists idx_quote_packages_copilot_last_turn_at
  on public.quote_packages (copilot_last_turn_at desc)
  where copilot_last_turn_at is not null;

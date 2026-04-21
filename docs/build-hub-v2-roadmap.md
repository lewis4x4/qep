# Build Hub v2 — Feedback Becomes a Loop

**Date:** 2026-04-20
**Owner:** Brian
**Audience:** Engineering + stakeholder previewers (Angela, Ryan, Rylee, Juan)
**Status:** Proposed — scoped from v1 usage review
**Parent:** `QEP-OS-Master-Roadmap.md`, Track 7A

---

## Why

Build Hub v1 ships feedback to a database and fires a high-priority email to
`HUB_OPS_EMAIL`. That is a submission pipe, not a loop. A stakeholder who
submits feedback today has no way to know it was seen, understood, drafted,
or shipped unless they remember to check `/brief/feedback` by hand. In the
field — with gloves, noise, and no keyboard — they will not. Adoption dies
in week 2.

v2 is about four things that turn feedback from a form into a conversation:

1. **Close the loop back to the submitter** — they hear when their thing ships.
2. **Voice-first capture, context auto-attached** — the field can actually use it.
3. **Make feedback part of the knowledge layer** — resolved feedback joins the
   project brain so "did we fix X?" has a real answer.
4. **Dedupe with embeddings** — three people reporting the same thing stack
   visibly, instead of becoming three separate triage rows.

The connecting thread: the Build Hub should feel like talking to a team that
hears you, not dropping a form into a box.

---

## Headline Status

| Slice | Ship order | Depends on | Estimate |
|---|:---:|---|:---:|
| **V2.1** Submitter loop-back | 1 | v1 `hub_feedback` schema | S (1–2 days) |
| **V2.2** Voice-first capture + page context | 2 | `iron-transcribe` edge fn | M (3–4 days) |
| **V2.3** Feedback → NotebookLM on resolve | 3 | `hub-knowledge-sync` | S (1–2 days) |
| **V2.4** pgvector dedup on insert | 4 | `vector` extension already on project | M (2–3 days) |

Total: ~2 weeks of sequential work, or ~1 week parallelized. All four land
behind the same `/brief/feedback` URL — stakeholders get progressively more
value per feedback item they submit, with no UI relocation.

---

## Slice V2.1 — Submitter loop-back

**What the stakeholder sees:** A notification bell on `/brief` shows a dot
when any of their submitted items transitions state. The card in their
inbox shows an inline timeline: `submitted → triaged → drafting → shipped`,
with the PR URL and a human-friendly `"here's what we shipped"` note. When
something ships, they get an email with the same summary.

**What to build:**

- New table `hub_feedback_events` (id, feedback_id, event_type, payload jsonb,
  actor, created_at). RLS mirrors `hub_feedback` (submitter + admin read).
- Trigger on `hub_feedback` `AFTER UPDATE`: when `status` changes, insert a
  row into `hub_feedback_events` with the before/after.
- Trigger on `status = 'shipped'`: queue a Resend email to the submitter
  (not just `HUB_OPS_EMAIL`) with the PR URL, merge SHA, and a Claude-written
  1-sentence "what this means for you" note. Pull the note from the existing
  triage record if present; regenerate if it's stale.
- Frontend: `/brief/feedback` card gets an inline `<FeedbackTimeline />` that
  reads the events. Notification bell in `BriefNav` lights when the caller
  has an unseen event; click dismisses.
- `hub_feedback` gets `last_seen_by_submitter_at timestamptz` so the bell
  knows what "unseen" means.

**Acceptance:**
- Stakeholder submits feedback → 1 minute later they see the `triaged` event
  in their card without refreshing (via a 30s poll — realtime is v3).
- Feedback transitions to `shipped` in prod → submitter receives the
  "your fix shipped" email within 5 minutes.
- Admin marking something `wont_fix` sends a different, respectful email
  explaining why (Claude-drafted from the suggested action + an admin note).

**Files:**
- `supabase/migrations/320_hub_feedback_events.sql` (new)
- `supabase/functions/hub-feedback-notify/index.ts` (new, listens to events via a trigger-fired HTTP call or a small cron)
- `apps/web/src/features/brief/components/FeedbackTimeline.tsx` (new)
- `apps/web/src/features/brief/BriefRoutes.tsx` (add bell)

---

## Slice V2.2 — Voice-first capture + page context

**What the stakeholder sees:** The feedback modal opens with a big circular
mic button. Press-and-hold → release to transcribe. Transcript drops into
the body field; they can edit or submit as-is. Submit also captures the URL
they were on, the current `build_item_id` (if any), and a minimal DOM
snapshot — Claude triages with real context, not just the typed body.

**What to build:**

- Voice: reuse `iron-transcribe` edge function (already deployed, per commit
  history). Frontend records via `MediaRecorder`, uploads to a signed
  Supabase Storage URL in a new `hub_feedback_audio` bucket, calls
  `iron-transcribe` with the path, gets the transcript back.
- Context: `FeedbackButton` captures `window.location.pathname`,
  `document.title`, and any `data-build-item-id` on the ancestor chain into
  a new `submission_context jsonb` column on `hub_feedback`.
- Permissions: on first mic click, the modal shows an inline "we need
  microphone access to transcribe your feedback" row with a Grant button.
  On denial, fall back silently to the typed path.
- Triage upgrade: pass `submission_context` into the Claude triage prompt so
  priority/type/summary reflect where the user was.

**Acceptance:**
- A 30-second voice clip from Rylee on the `/qrm/quotes/new` page produces a
  feedback row with:
  - `body` = the transcript
  - `voice_transcript` = the transcript (duplicate for now; body is editable)
  - `voice_audio_url` = the Storage URL
  - `submission_context.path = "/qrm/quotes/new"`
  - `ai_summary` references the page + the spoken content
- Mobile Safari and Chrome both grant mic on HTTPS without errors.
- Typed fallback keeps working unchanged for anyone who doesn't use voice.

**Files:**
- `supabase/migrations/321_hub_feedback_voice_context.sql` (adds `submission_context`, creates storage bucket policies)
- `apps/web/src/features/brief/components/FeedbackButton.tsx` (add VoiceCapture)
- `apps/web/src/features/brief/components/VoiceCapture.tsx` (new)
- `supabase/functions/hub-feedback-intake/index.ts` (accept context, pass to triage prompt)

---

## Slice V2.3 — Feedback → NotebookLM on resolve

**What the stakeholder sees:** After a feedback item ships, "Ask the Brain"
can answer `"Did we ever fix the customer-picker add-new bug?"` with the
actual PR link and the 1-sentence "what shipped" note. Today it can't —
feedback is not in the knowledge layer.

**What to build:**

- Add `notebooklm_source_id text`, `notebooklm_synced_at timestamptz`, and
  `notebooklm_markdown text` to `hub_feedback`.
- Extend `hub-knowledge-sync` (the 4h cron) to include resolved feedback:
  only rows where `status IN ('shipped', 'wont_fix')` AND
  `notebooklm_synced_at IS NULL OR resolved_at > notebooklm_synced_at`.
- Render each resolved item as a markdown page:
  ```
  # Feedback: {ai_summary}

  **Submitted by:** {submitter name}  **Resolved:** {date}
  **Status:** {status}  **Type:** {feedback_type}

  ## What they reported
  {body}

  ## What we did
  {ai_suggested_action → actual PR → merge SHA}

  ## Provenance
  - PR: {claude_pr_url}
  - Feedback ID: {id}
  ```
- Push to the same Google Drive folder as decisions/changelog. Write back
  `notebooklm_source_id` = Drive file ID.
- Unresolved feedback stays OUT of Drive — it's noisy and may contain
  half-formed complaints that shouldn't become institutional memory.

**Acceptance:**
- A feedback item transitions `awaiting_merge → shipped`. Within one cron
  cycle (max 4h, manually triggerable) it shows up in the NotebookLM-mirrored
  pgvector index.
- "Ask the Brain" with the query above returns the fixed item as a citation
  with a working PR link.
- A `wont_fix` item is also synced so the record of "we decided not to do
  this because X" lives in the brain.

**Files:**
- `supabase/migrations/322_hub_feedback_notebooklm.sql`
- `supabase/functions/hub-knowledge-sync/index.ts` (extend source list)
- `supabase/functions/hub-knowledge-sync/renderFeedback.ts` (new helper)

---

## Slice V2.4 — pgvector dedup on insert

**What the stakeholder sees:** They submit "the customer picker won't let me
add a new one." The triage response now says
`"This matches 2 earlier reports (Angela, Juan). Stacking with those."` Their
card in `/brief/feedback` shows a `Related (3)` chip that expands to the
stack.

**What to build:**

- Add `body_embedding vector(1536)` to `hub_feedback` (OpenAI `text-embedding-3-small`
  or the existing embedding provider used by `hub-knowledge-sync`).
- In `hub-feedback-intake`, after the body is accepted and before triage:
  1. Embed the body.
  2. `SELECT id FROM hub_feedback WHERE body_embedding <=> $1 < 0.25 AND
     workspace_id = $wsId AND status NOT IN ('shipped','wont_fix') ORDER BY
     body_embedding <=> $1 LIMIT 5;`
  3. If matches, add `parent_feedback_id uuid` (new column) pointing at the
     oldest open match, and include the match list in the triage context so
     Claude can write a smarter summary.
- Frontend: card shows `[+ 2 related]` chip when `hub_feedback` has other
  rows with the same `parent_feedback_id`. Click expands.
- The original row (the one others stack under) gets a `stacked_count` virtual
  field via a view, so the inbox can sort by "hottest" (most stacked, newest).

**Acceptance:**
- Angela submits "can't add new customer in quote builder."
- Juan submits similar text 5 minutes later. His card shows
  "matches Angela's item from 5m ago" at triage time. Admin inbox shows 1 row
  with `stacked_count = 2`, not 2 rows.
- The `stacked_count = 2` row is what Brian sees, acts on, and ships. When it
  ships, v2.1's loop-back emails fire to **both** submitters.

**Files:**
- `supabase/migrations/323_hub_feedback_embeddings.sql` (add column, index,
  `hub_feedback_with_stacks` view)
- `supabase/functions/hub-feedback-intake/index.ts` (embed → find matches → link parent)
- `apps/web/src/features/brief/pages/BriefFeedbackPage.tsx` (render stack)

---

## Non-goals for v2

- Slack / Teams integration. The email + inbox loop is enough for now.
  Revisit once adoption hits ≥50 submissions/week.
- Real-time via Supabase Realtime. 30s polling is fine for this volume.
- Multi-tenant. `workspace_id = 'default'` is locked per decision in the
  Decisions log (`Single-tenant workspace_id = default for v1`).
- Public feedback intake (from customers, not stakeholders). This roadmap
  is stakeholder-only. Customer-facing feedback is a separate product surface.

---

## Rollout

Ship in order. Each slice is behind a feature flag in
`public.feature_flags` (table already exists per the platform spine):

- `hub_feedback_loopback` → enables v2.1
- `hub_feedback_voice` → enables v2.2 mic UI
- `hub_feedback_kb_sync` → enables v2.3 knowledge sync
- `hub_feedback_dedup` → enables v2.4 embeddings + stacking

Flags default `false` in prod; flip after smoke-testing with Ryan + Rylee
on the Netlify deploy. No rollback required — schema changes are additive.

---

## Definition of done

The Build Hub ships v2 when:

- A stakeholder can submit feedback by voice on mobile while walking the yard.
- The submitter gets a real email saying "your fix shipped — here's what
  changed" without Brian having to write it.
- "Ask the Brain" can answer questions about resolved feedback with PR
  citations.
- Three stakeholders reporting the same bug produce one triage row, not three.

Until all four are true, feedback is still a form. After, it's a loop.

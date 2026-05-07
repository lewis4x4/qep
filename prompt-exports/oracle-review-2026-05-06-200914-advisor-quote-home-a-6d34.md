# Oracle Review

## Summary

The scoped diff makes the advisor home quote-first, adds QRM-backed advisor stats, hardens briefing empty/degraded states, aligns admin access for quote routes, adds voice-quote chrome support, implements matched `voice_session_id` handoff hydration into Quote Builder, and schedules `generate-daily-briefing`. The main blocking risks I see are in the shared Quote Builder scenario handler and the cron migration’s environment assumptions.

## P1 — Blocking Findings

1. **`apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx` — Non-voice scenario selections are now mislabeled as voice handoffs**

   `handleScenarioSelection` is used both for `/voice-quote` handoff hydration and for the in-page `ConversationalDealEngine`. The diff now always sets:

   ```ts
   entryMode: "voice"
   ```

   and builds a recommendation with:

   ```ts
   triggerType: "voice_transcript"
   sourceField: "voice_quote_handoff"
   ```

   That means normal in-builder scenario selections can be persisted/rendered as voice-originated even when they came from the quote copilot or another non-voice scenario flow.

   **Suggestion:** Split the handler path. For example:

   - Keep a generic `applyScenarioSelection(selection, source)` helper.
   - Call it with `source: "voice_handoff"` from the URL handoff effect.
   - Call it with `source: "deal_assistant"` from `ConversationalDealEngine`.
   - Only set `entryMode: "voice"` and voice-specific recommendation trigger metadata for the voice handoff path.

2. **`supabase/migrations/545_generate_daily_briefing_cron_modern.sql` — Cron targets a hard-coded Supabase project URL**

   The migration schedules:

   ```sql
   v_url_base constant text := 'https://iciddijgonywtxoelous.supabase.co';
   ```

   This is unsafe for local/staging/preview environments because applying the migration outside that project can schedule jobs that call the wrong Supabase project.

   **Suggestion:** Derive the function base URL from existing environment-specific configuration, Vault/settings, or an existing cron command in the same environment. If the URL cannot be resolved safely, skip with a notice rather than scheduling a cross-environment job.

3. **`supabase/migrations/545_generate_daily_briefing_cron_modern.sql` — Migration can hard-fail if `flow-runner` cron is absent**

   The migration extracts the internal secret only from:

   ```sql
   select command from cron.job where jobname = 'flow-runner'
   ```

   and raises an exception if it cannot parse the secret. That makes this additive cron migration brittle in fresh/ephemeral DBs or environments where `flow-runner` is renamed/disabled.

   **Suggestion:** Use the canonical secret source used by existing cron migrations, or gracefully skip with a clear notice when the secret cannot be resolved. If reusing cron commands, consider searching for any trusted existing job containing `x-internal-service-secret`, not only `flow-runner`.

## P2 — Non-blocking Suggestions

1. **`supabase/migrations/545_generate_daily_briefing_cron_modern.sql` — Schedule comment is DST-sensitive**

   The migration says:

   ```sql
   '0 10 * * *' -- 05:00 CT
   ```

   `10:00 UTC` is 5am during daylight time but 4am during standard time.

   **Suggestion:** Clarify that the cron is UTC-based, or use timezone-aware scheduling if Supabase/project conventions support it.
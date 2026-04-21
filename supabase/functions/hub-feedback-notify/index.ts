/**
 * hub-feedback-notify — Build Hub v2.1 submitter loop-back.
 *
 * Drains hub_feedback_events rows with notified_submitter_at IS NULL and
 * emails the submitter via Resend for the events that warrant it:
 *
 *   - shipped          → "your fix shipped" + PR link + merge-meaning line
 *   - wont_fix         → respectful explainer + rationale + reply-to-reopen
 *   - pr_opened        → reassuring "draft PR ready for review" mid-flight
 *
 * triaged / drafting_started / submitted / awaiting_merge / reopened /
 * merged / admin_note are STAMPED as notified (so the cron doesn't retry
 * forever) but do NOT email — the in-app bell + timeline carries them.
 *
 * Scheduled every minute (see migration 321_hub_feedback_events_cron when
 * pg_cron/pg_net are available; invoke manually otherwise).
 *
 * Zero-blocking:
 *   - Missing RESEND_API_KEY → row is stamped (to avoid infinite loop) and
 *     a `skipped_no_email` counter is returned. UI still gets the event.
 *   - Missing ANTHROPIC_API_KEY → meaning-line falls back to
 *     ai_suggested_action verbatim instead of a Claude-rewritten version.
 *
 * Auth: service-role-only (x-internal-service-secret or Bearer
 *   service_role key). verify_jwt=false on deploy. See cron-auth.ts.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { sendResendEmail } from "../_shared/resend-email.ts";

const MAX_EVENTS_PER_RUN = 50;
const ANTHROPIC_MEANING_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_TIMEOUT_MS = 12_000;

type EventType =
  | "submitted"
  | "triaged"
  | "drafting_started"
  | "pr_opened"
  | "awaiting_merge"
  | "merged"
  | "shipped"
  | "wont_fix"
  | "reopened"
  | "admin_note"
  | "duplicate_linked"
  | "preview_ready";

/** Event types that trigger a Resend email. */
const EMAIL_WORTHY: Readonly<Set<EventType>> = new Set([
  "shipped",
  "wont_fix",
  "pr_opened",
  "preview_ready",
]);

interface EventRow {
  id: string;
  feedback_id: string;
  workspace_id: string;
  event_type: EventType;
  from_status: string | null;
  to_status: string | null;
  actor_role: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface FeedbackRow {
  id: string;
  submitted_by: string | null;
  feedback_type: string;
  body: string;
  ai_summary: string | null;
  ai_suggested_action: string | null;
  claude_pr_url: string | null;
  claude_branch_name: string | null;
  claude_preview_url: string | null;
}

interface SubmitterProfile {
  id: string;
  email: string | null;
  full_name: string | null;
}

interface NotifyOutcome {
  event_id: string;
  event_type: EventType;
  feedback_id: string;
  action: "emailed" | "skipped_no_email" | "skipped_non_emailable" | "skipped_no_submitter" | "error";
  error?: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST" && req.method !== "GET") {
    return safeJsonError("Method not allowed", 405, origin);
  }
  if (!isServiceRoleCaller(req)) {
    return safeJsonError("service-role or internal-service-secret required", 401, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return safeJsonError("Server misconfiguration (SUPABASE env missing)", 500, origin);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const startMs = Date.now();

  try {
    const { data: events, error } = await supabase
      .from("hub_feedback_events")
      .select(
        "id, feedback_id, workspace_id, event_type, from_status, to_status, actor_role, payload, created_at",
      )
      .is("notified_submitter_at", null)
      .order("created_at", { ascending: true })
      .limit(MAX_EVENTS_PER_RUN);

    if (error) throw new Error(`events scan: ${error.message}`);

    const rows: EventRow[] = (events ?? []) as EventRow[];
    if (rows.length === 0) {
      return safeJsonOk(
        { drained: 0, outcomes: [], elapsed_ms: Date.now() - startMs },
        origin,
      );
    }

    const outcomes: NotifyOutcome[] = [];

    for (const event of rows) {
      try {
        const outcome = await processEvent(supabase, event);
        outcomes.push(outcome);
      } catch (err) {
        outcomes.push({
          event_id: event.id,
          event_type: event.event_type,
          feedback_id: event.feedback_id,
          action: "error",
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    return safeJsonOk(
      {
        drained: outcomes.length,
        outcomes,
        elapsed_ms: Date.now() - startMs,
      },
      origin,
    );
  } catch (err) {
    captureEdgeException(err, { fn: "hub-feedback-notify" });
    return safeJsonError((err as Error).message, 500, origin);
  }
});

/**
 * Mark a single event as drained. For non-emailable events (e.g., triaged,
 * admin_note) we stamp notified_submitter_at so the cron doesn't retry.
 * For emailable events we resolve submitter → render → send → stamp.
 */
async function processEvent(
  supabase: SupabaseClient,
  event: EventRow,
): Promise<NotifyOutcome> {
  if (!EMAIL_WORTHY.has(event.event_type)) {
    await stamp(supabase, event.id);
    return {
      event_id: event.id,
      event_type: event.event_type,
      feedback_id: event.feedback_id,
      action: "skipped_non_emailable",
    };
  }

  const feedback = await loadFeedback(supabase, event.feedback_id);
  if (!feedback || !feedback.submitted_by) {
    await stamp(supabase, event.id);
    return {
      event_id: event.id,
      event_type: event.event_type,
      feedback_id: event.feedback_id,
      action: "skipped_no_submitter",
    };
  }

  const submitter = await loadSubmitter(supabase, feedback.submitted_by);
  if (!submitter?.email) {
    // No email on file. Stamp so we don't loop; the in-app bell still works.
    await stamp(supabase, event.id);
    return {
      event_id: event.id,
      event_type: event.event_type,
      feedback_id: event.feedback_id,
      action: "skipped_no_submitter",
    };
  }

  const { subject, text } = await renderEmail(event, feedback, submitter);

  const result = await sendResendEmail({
    to: submitter.email,
    subject,
    text,
  }).catch(() => ({ ok: false, skipped: true as const }));

  // Zero-blocking: skipped (no API key) still stamps to prevent loops.
  await stamp(supabase, event.id);

  if (result.skipped) {
    return {
      event_id: event.id,
      event_type: event.event_type,
      feedback_id: event.feedback_id,
      action: "skipped_no_email",
    };
  }

  return {
    event_id: event.id,
    event_type: event.event_type,
    feedback_id: event.feedback_id,
    action: result.ok ? "emailed" : "error",
    error: result.ok ? undefined : "resend send returned non-ok",
  };
}

async function stamp(supabase: SupabaseClient, eventId: string): Promise<void> {
  const { error } = await supabase
    .from("hub_feedback_events")
    .update({ notified_submitter_at: new Date().toISOString() })
    .eq("id", eventId);
  if (error) {
    // Don't throw — the caller will retry on the next tick anyway, and a
    // stamp failure is recoverable noise, not a hard fault.
    console.warn(`notify stamp failed for ${eventId}: ${error.message}`);
  }
}

async function loadFeedback(
  supabase: SupabaseClient,
  id: string,
): Promise<FeedbackRow | null> {
  const { data, error } = await supabase
    .from("hub_feedback")
    .select(
      "id, submitted_by, feedback_type, body, ai_summary, ai_suggested_action, claude_pr_url, claude_branch_name, claude_preview_url",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`feedback load: ${error.message}`);
  return (data as FeedbackRow | null) ?? null;
}

async function loadSubmitter(
  supabase: SupabaseClient,
  id: string,
): Promise<SubmitterProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`submitter load: ${error.message}`);
  return (data as SubmitterProfile | null) ?? null;
}

/**
 * Render a subject + plain-text body for a single event. We keep this in
 * plain text (not HTML) so Resend never has to round-trip template renders
 * and so the message reads fine in SMS preview / Apple Watch / terminal.
 */
async function renderEmail(
  event: EventRow,
  feedback: FeedbackRow,
  submitter: SubmitterProfile,
): Promise<{ subject: string; text: string }> {
  const firstName = submitter.full_name?.split(/\s+/)[0] ?? "friend";
  const summary = feedback.ai_summary ?? truncate(feedback.body, 120);

  switch (event.event_type) {
    case "shipped": {
      const meaning = await composeMeaningLine({
        summary,
        body: feedback.body,
        suggestedAction: feedback.ai_suggested_action,
      });
      return {
        subject: `[QEP OS] Your fix shipped — ${truncate(summary, 60)}`,
        text: [
          `Hi ${firstName} —`,
          ``,
          `The feedback you submitted just shipped:`,
          `  "${summary}"`,
          ``,
          `What shipped: ${meaning}`,
          ``,
          feedback.claude_pr_url ? `PR: ${feedback.claude_pr_url}` : null,
          ``,
          `Thank you for the signal. Keep them coming — the build gets sharper every time one of you hits "Send."`,
          ``,
          `— QEP OS Build Hub`,
        ]
          .filter((line) => line !== null)
          .join("\n"),
      };
    }

    case "wont_fix": {
      const rationale = feedback.ai_suggested_action
        ?? "We're not moving on this one right now.";
      return {
        subject: `[QEP OS] Update on your feedback — ${truncate(summary, 60)}`,
        text: [
          `Hi ${firstName} —`,
          ``,
          `Quick update on the feedback you submitted:`,
          `  "${summary}"`,
          ``,
          `We've decided not to ship a change for this right now.`,
          `Context: ${rationale}`,
          ``,
          `This isn't a dead end. If something changes — a new case, a new constraint, or you just want to push back — reply to this email and we'll re-open it.`,
          ``,
          `— QEP OS Build Hub`,
        ].join("\n"),
      };
    }

    case "preview_ready": {
      // v3.1 Build Hub: Angela doesn't have to wait for merge to see her
      // feedback become a shipped thing. We hand her a live preview URL
      // the moment Netlify finishes the build, with an explicit invitation
      // to push back if it's wrong — the single most powerful moment in
      // the loop, because it's the first time the fix exists in *her*
      // hands instead of ours.
      const previewUrl =
        feedback.claude_preview_url
        ?? (event.payload.claude_preview_url as string | undefined)
        ?? "";
      return {
        subject: `[QEP OS] Your fix is live to test — ${truncate(summary, 50)}`,
        text: [
          `Hi ${firstName} —`,
          ``,
          `The proposed fix for your feedback is deployed to a live preview:`,
          `  "${summary}"`,
          ``,
          previewUrl ? `Try it: ${previewUrl}` : `(Preview URL pending — the Build Hub will surface it on your card momentarily.)`,
          ``,
          `This is a PR preview — nothing has merged yet. Poke at it.`,
          `If it misses the mark, reply to this email and we'll spin another take before the merge goes in.`,
          feedback.claude_pr_url ? `` : null,
          feedback.claude_pr_url ? `Underlying PR: ${feedback.claude_pr_url}` : null,
          ``,
          `— QEP OS Build Hub`,
        ]
          .filter((line) => line !== null)
          .join("\n"),
      };
    }

    case "pr_opened": {
      const prUrl = feedback.claude_pr_url
        ?? (event.payload.claude_pr_url as string | undefined)
        ?? "";
      return {
        subject: `[QEP OS] Draft fix ready for your feedback — ${truncate(summary, 50)}`,
        text: [
          `Hi ${firstName} —`,
          ``,
          `A draft PR is open for your feedback:`,
          `  "${summary}"`,
          ``,
          prUrl ? `Review it here: ${prUrl}` : `The Build Hub will link the PR on your card once it propagates.`,
          ``,
          `No action required — we'll email again the moment it ships. This note is just so you know it's moving.`,
          ``,
          `— QEP OS Build Hub`,
        ].join("\n"),
      };
    }

    default:
      // Defensive: EMAIL_WORTHY guard should prevent this.
      return {
        subject: `[QEP OS] Update on your feedback`,
        text: `Hi ${firstName} — update on "${summary}". See the Build Hub for details.`,
      };
  }
}

/**
 * "What this means for you" — a 1-sentence Claude rewrite of the suggested
 * action in stakeholder voice. Falls back to the raw suggested_action when
 * Anthropic isn't available.
 */
async function composeMeaningLine(params: {
  summary: string;
  body: string;
  suggestedAction: string | null;
}): Promise<string> {
  const fallback = params.suggestedAction?.trim()
    ? params.suggestedAction.trim()
    : params.summary;

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return fallback;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MEANING_MODEL,
        max_tokens: 160,
        temperature: 0.2,
        system:
          "You write one sentence, plain English, max 22 words, describing " +
          "what a ship means for the stakeholder in their voice. No preamble, " +
          "no 'we'. Start with the concrete user-visible change.",
        messages: [
          {
            role: "user",
            content: [
              `Feedback summary: ${params.summary}`,
              `Feedback body: ${params.body.slice(0, 600)}`,
              params.suggestedAction ? `Suggested action: ${params.suggestedAction}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const text = ((data?.content ?? []) as Array<{ type: string; text?: string }>)
      .find((c) => c.type === "text")?.text?.trim();
    if (!text) return fallback;
    return text.split(/\n+/)[0].slice(0, 240);
  } catch {
    return fallback;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/**
 * Wave 6.11 Flare — submit edge function.
 *
 * Single entry point, 5-lane fan-out:
 *   Lane 1: Supabase DB row (REQUIRED — system of record)
 *   Lane 2: Linear issue create (fail-open)
 *   Lane 3: Paperclip issue create (fail-open)
 *   Lane 4: Slack notification (fail-open)
 *   Lane 5: Email blocker escalation (fail-open, severity='blocker' only)
 *
 * Plus Phase F intelligence layer:
 *   - Auto-generated reproducer steps from click_trail + route_trail
 *   - GPT severity validator + reasoning
 *   - Voice capture auto-link (flare_recent_voice_capture RPC)
 *   - Console-error pattern hypothesis
 *   - Wave 6.9 Exception Inbox wire (enqueue_exception for blockers)
 *   - Most-recent-activity autofill lookup
 *
 * Auth: JWT required. Rate-limited to 20 / user / hour.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { resolveProfileActiveWorkspaceId } from "../_shared/workspace.ts";
import { generateReproducerSteps, detectHypothesisPattern } from "./intelligence.ts";
import { dispatchToLinear } from "./linear.ts";
import { dispatchToPaperclip } from "./paperclip.ts";
import { dispatchToSlack } from "./slack.ts";
import { dispatchBlockerEmail } from "./email.ts";

const RATE_LIMIT_PER_HOUR = 20;
const BUCKET_NAME = "flare-artifacts";

interface SubmitBody {
  severity: "blocker" | "bug" | "annoyance" | "idea";
  user_description: string;
  screenshot_base64: string;
  dom_snapshot_gzipped: string;
  annotations: Array<{ type: string; points: number[] }>;
  context: {
    user_id: string;
    workspace_id: string;
    reporter_email: string;
    reporter_role: string;
    reporter_iron_role: string | null;
    url: string;
    route: string;
    page_title: string;
    visible_entities: Array<{ type: string; id: string }>;
    click_trail: Array<Record<string, unknown>>;
    network_trail: Array<Record<string, unknown>>;
    console_errors: Array<{ ts: number; level: string; message: string; stack: string | null }>;
    route_trail: Array<Record<string, unknown>>;
    store_snapshot: Record<string, unknown> | null;
    react_query_cache_keys: string[];
    feature_flags: Record<string, boolean>;
    browser: string;
    os: string;
    viewport: { width: number; height: number; dpr: number };
    network_type: string | null;
    app_version: string;
    git_sha: string;
    build_timestamp: string;
    session_id: string;
    tab_id: string;
    time_on_page_ms: number;
    performance_metrics: Record<string, unknown>;
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    // ── Auth ────────────────────────────────────────────────────────
    // Canonical JWT auth — ES256-safe. Gates rep/admin/manager/owner which
    // matches the app shell audience; flare UI isn't exposed to customer
    // portal users, so the narrower role gate is a deliberate tighten.
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    const user = { id: auth.userId, email: undefined as string | undefined };

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Parse ─────────────────────────────────────────────────────
    let body: SubmitBody;
    try {
      body = await req.json();
    } catch {
      return safeJsonError("invalid_payload", 400, origin);
    }

    // Basic validation
    if (!["blocker", "bug", "annoyance", "idea"].includes(body.severity)) {
      return safeJsonError("invalid_severity", 400, origin);
    }
    if (typeof body.user_description !== "string"
        || body.user_description.trim().length === 0
        || body.user_description.length > 2000) {
      return safeJsonError("invalid_description", 400, origin);
    }
    if (!body.context || typeof body.context.workspace_id !== "string") {
      return safeJsonError("invalid_context", 400, origin);
    }

    // Resolve workspace from profile — never trust the body's workspace_id
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role, iron_role, email, full_name")
      .eq("id", user.id)
      .maybeSingle();
    const workspace = await resolveProfileActiveWorkspaceId(supabaseAdmin, user.id);

    // ── Rate limit ───────────────────────────────────────────────
    const windowStart = new Date();
    windowStart.setMinutes(0, 0, 0);
    const windowIso = windowStart.toISOString();

    const { data: rateRow } = await supabaseAdmin
      .from("flare_rate_limits")
      .select("count")
      .eq("reporter_id", user.id)
      .eq("window_start", windowIso)
      .maybeSingle();

    const currentCount = Number((rateRow as { count?: number } | null)?.count ?? 0);
    if (currentCount >= RATE_LIMIT_PER_HOUR) {
      const nextHour = new Date(windowStart.getTime() + 60 * 60 * 1000);
      const retrySecs = Math.ceil((nextHour.getTime() - Date.now()) / 1000);
      return safeJsonOk(
        { error: "rate_limited", retry_after_seconds: retrySecs },
        origin,
        429,
      );
    }

    await supabaseAdmin.from("flare_rate_limits").upsert({
      reporter_id: user.id,
      window_start: windowIso,
      count: currentCount + 1,
    }, { onConflict: "reporter_id,window_start" });

    // ── Phase F intelligence (pre-insert) ────────────────────────
    const reproducerSteps = generateReproducerSteps(
      body.context.click_trail,
      body.context.route_trail,
      body.context.route,
    );

    const hypothesisPattern = detectHypothesisPattern(body.context.console_errors);

    // Voice capture auto-link
    let linkedVoiceCaptureId: string | null = null;
    try {
      const { data: vcId } = await supabaseAdmin
        .rpc("flare_recent_voice_capture", { p_user_id: user.id });
      linkedVoiceCaptureId = (vcId as string | null) ?? null;
    } catch { /* ignore */ }

    // Recent activity autofill lookup
    let recentActivity: { id: string; type: string; subject: string | null; occurred_at: string } | null = null;
    try {
      const { data: act } = await supabaseAdmin
        .rpc("flare_recent_user_activity", { p_user_id: user.id });
      if (act && typeof act === "object") {
        recentActivity = act as typeof recentActivity;
      }
    } catch { /* ignore */ }

    // GPT severity validator (only when it matters — skip for ideas)
    let aiSeverityRec: string | null = null;
    let aiSeverityReasoning: string | null = null;
    let aiConfidence: number | null = null;
    const openAiKey = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPENAI_KEY");
    if (openAiKey && body.severity !== "idea") {
      try {
        const consoleErrText = body.context.console_errors
          .slice(0, 3)
          .map((e) => `[${e.level}] ${e.message}`)
          .join("\n");
        const classifyRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: `You classify dealership-app bug reports. Decide the best severity from:
- blocker: production-blocking, customer-facing outage, data loss, security hole
- bug: broken feature, wrong behavior, does NOT block core flows
- annoyance: friction, cosmetic, slow but functional
- idea: feature request, process improvement

Reporter-selected severity is provided but you may override if the description + console errors contradict it.

Output JSON: {
  "recommended_severity": "blocker" | "bug" | "annoyance" | "idea",
  "reasoning": "one sentence ≤140 chars",
  "confidence": 0.0-1.0
}`,
              },
              {
                role: "user",
                content: `Reporter severity: ${body.severity}
Description: ${body.user_description}
Route: ${body.context.route}
Recent console errors:
${consoleErrText || "(none)"}`,
              },
            ],
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (classifyRes.ok) {
          const data = await classifyRes.json();
          const content = data.choices?.[0]?.message?.content ?? "{}";
          const parsed = JSON.parse(content);
          if (["blocker", "bug", "annoyance", "idea"].includes(parsed.recommended_severity)) {
            aiSeverityRec = parsed.recommended_severity;
            aiSeverityReasoning = typeof parsed.reasoning === "string"
              ? parsed.reasoning.slice(0, 140)
              : null;
            aiConfidence = typeof parsed.confidence === "number"
              ? Math.max(0, Math.min(1, parsed.confidence))
              : null;
          }
        }
      } catch (err) {
        console.warn("[flare-submit] severity classifier failed:", err);
      }
    }

    // ── Lane 1: Supabase DB row (REQUIRED) ────────────────────────
    const insertRow: Record<string, unknown> = {
      workspace_id: workspace,
      reporter_id: user.id,
      reporter_email: (profile?.email as string | undefined) ?? user.email ?? null,
      reporter_role: (profile?.role as string | undefined) ?? "unknown",
      reporter_iron_role: (profile?.iron_role as string | undefined) ?? null,

      severity: body.severity,
      user_description: body.user_description.trim(),

      url: body.context.url,
      route: body.context.route,
      page_title: body.context.page_title,

      visible_entities: body.context.visible_entities,
      click_trail: body.context.click_trail,
      network_trail: body.context.network_trail,
      console_errors: body.context.console_errors,
      route_trail: body.context.route_trail,
      store_snapshot: body.context.store_snapshot,
      react_query_cache_keys: body.context.react_query_cache_keys,
      feature_flags: body.context.feature_flags,

      browser: body.context.browser,
      os: body.context.os,
      viewport: body.context.viewport,
      network_type: body.context.network_type,
      app_version: body.context.app_version,
      git_sha: body.context.git_sha,
      build_timestamp: body.context.build_timestamp,

      session_id: body.context.session_id,
      tab_id: body.context.tab_id,
      time_on_page_ms: body.context.time_on_page_ms,
      performance_metrics: body.context.performance_metrics,

      annotations: body.annotations,

      // Phase F intelligence
      reproducer_steps: reproducerSteps,
      ai_severity_recommendation: aiSeverityRec,
      ai_severity_reasoning: aiSeverityReasoning,
      ai_confidence: aiConfidence,
      hypothesis_pattern: hypothesisPattern,
      linked_voice_capture_id: linkedVoiceCaptureId,
      recent_activity_id: recentActivity?.id ?? null,
    };

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("flare_reports")
      .insert(insertRow)
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("[flare-submit] lane 1 failed:", insertErr);
      return safeJsonOk(
        { error: "internal", report_id: null, detail: insertErr?.message ?? "insert failed" },
        origin,
        500,
      );
    }

    const reportId = (inserted as { id: string }).id;

    // ── Upload screenshot + DOM snapshot (fail-open) ──────────────
    const dispatchErrors: Record<string, string> = {};
    let screenshotPath: string | null = null;
    let domSnapshotPath: string | null = null;

    if (body.screenshot_base64) {
      try {
        // Ensure bucket exists (create on first run)
        await supabaseAdmin.storage.createBucket(BUCKET_NAME, { public: false }).catch(() => null);

        // Strip data URL prefix
        const b64 = body.screenshot_base64.replace(/^data:image\/\w+;base64,/, "");
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const path = `${workspace}/${reportId}/screenshot.png`;
        const { error: upErr } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .upload(path, bytes, { contentType: "image/png", upsert: true });
        if (upErr) throw upErr;
        screenshotPath = path;
      } catch (err) {
        dispatchErrors.screenshot = err instanceof Error ? err.message : "upload failed";
      }
    }

    if (body.dom_snapshot_gzipped) {
      try {
        const bytes = Uint8Array.from(atob(body.dom_snapshot_gzipped), (c) => c.charCodeAt(0));
        const path = `${workspace}/${reportId}/dom.html.gz`;
        const { error: upErr } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .upload(path, bytes, { contentType: "application/gzip", upsert: true });
        if (upErr) throw upErr;
        domSnapshotPath = path;
      } catch (err) {
        dispatchErrors.dom_snapshot = err instanceof Error ? err.message : "upload failed";
      }
    }

    if (screenshotPath || domSnapshotPath) {
      await supabaseAdmin
        .from("flare_reports")
        .update({ screenshot_path: screenshotPath, dom_snapshot_path: domSnapshotPath })
        .eq("id", reportId);
    }

    // ── Dedupe peek for response + slack ──────────────────────────
    // Phase J upgrade: pass first console_error message so the dedupe RPC
    // can correlate "we all hit the same TypeError on this page" cases
    // that route + description alone miss.
    let similarCount = 0;
    try {
      const firstErrorMsg = body.context.console_errors?.[0]?.message ?? null;
      const { data: dedupe } = await supabase
        .rpc("flare_dedupe_count", {
          p_route: body.context.route,
          p_description: body.user_description,
          p_threshold: 0.4,
          p_first_error: firstErrorMsg,
        });
      similarCount = Number(dedupe ?? 0);
    } catch { /* ignore */ }

    // ── Signed screenshot URLs for dispatch helpers ───────────────
    // Spec §8: Slack/Linear/Paperclip use 7-day expiry; email uses 1-hour.
    let signedScreenshotUrl: string | null = null;
    let signedScreenshotUrlEmail: string | null = null;
    if (screenshotPath) {
      try {
        const { data: signed } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .createSignedUrl(screenshotPath, 60 * 60 * 24 * 7); // 7 days
        signedScreenshotUrl = signed?.signedUrl ?? null;
      } catch { /* ignore */ }
      try {
        const { data: signedEmail } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .createSignedUrl(screenshotPath, 60 * 60); // 1 hour for email per spec §3 Lane 5
        signedScreenshotUrlEmail = signedEmail?.signedUrl ?? null;
      } catch { /* ignore */ }
    }

    const reporterDisplayName = (profile?.full_name as string | undefined)
      ?? (profile?.email as string | undefined)
      ?? user.email
      ?? "a user";

    // ── Lanes 2-5: fan-out dispatch (fail-open) ──────────────────
    // Phase 1: Linear + Paperclip in parallel (need their URLs for Slack/email buttons).
    // Phase 2: Slack + Email in parallel, with Linear/Paperclip URLs threaded through.
    const ticketDispatches = await Promise.allSettled([
      dispatchToLinear({
        reportId,
        severity: body.severity,
        description: body.user_description,
        route: body.context.route,
        url: body.context.url,
        reproducerSteps,
        hypothesisPattern,
        signedScreenshotUrl,
        reporterDisplayName,
      }),
      dispatchToPaperclip({
        reportId,
        severity: body.severity,
        description: body.user_description,
        route: body.context.route,
        url: body.context.url,
        reproducerSteps,
        hypothesisPattern,
        signedScreenshotUrl,
        reporterDisplayName,
      }),
    ]);

    const linearResult = ticketDispatches[0];
    const paperclipResult = ticketDispatches[1];
    const linearOk = linearResult.status === "fulfilled" ? linearResult.value : null;
    const paperclipOk = paperclipResult.status === "fulfilled" ? paperclipResult.value : null;

    const notifyDispatches = await Promise.allSettled([
      dispatchToSlack({
        reportId,
        severity: body.severity,
        description: body.user_description,
        route: body.context.route,
        url: body.context.url,
        reporterDisplayName,
        reporterRole: (profile?.role as string | undefined) ?? "unknown",
        similarCount,
        signedScreenshotUrl,
        linearIssueUrl: linearOk?.issue_url ?? null,
        paperclipIssueUrl: paperclipOk?.issue_url ?? null,
      }),
      body.severity === "blocker"
        ? dispatchBlockerEmail({
            reportId,
            description: body.user_description,
            route: body.context.route,
            url: body.context.url,
            reporterDisplayName,
            reporterRole: (profile?.role as string | undefined) ?? "unknown",
            signedScreenshotUrl: signedScreenshotUrlEmail,
          })
        : Promise.resolve(null),
    ]);
    const slackResult = notifyDispatches[0];
    const emailResult = notifyDispatches[1];
    const slackOk = slackResult.status === "fulfilled" ? slackResult.value : null;

    if (linearResult.status === "rejected")
      dispatchErrors.linear = linearResult.reason instanceof Error ? linearResult.reason.message : "dispatch failed";
    if (paperclipResult.status === "rejected")
      dispatchErrors.paperclip = paperclipResult.reason instanceof Error ? paperclipResult.reason.message : "dispatch failed";
    if (slackResult.status === "rejected")
      dispatchErrors.slack = slackResult.reason instanceof Error ? slackResult.reason.message : "dispatch failed";
    if (emailResult.status === "rejected")
      dispatchErrors.email = emailResult.reason instanceof Error ? emailResult.reason.message : "dispatch failed";

    // ── Lane 7 (Phase J upgrade): cross-write idea-mode flares into
    //    qrm_idea_backlog so they land in /qrm/ideas alongside voice-
    //    captured ideas. Idempotent enough — best-effort, fail-open.
    if (body.severity === "idea") {
      try {
        await supabaseAdmin.from("qrm_idea_backlog").insert({
          workspace_id: workspace,
          title: body.user_description.slice(0, 200),
          body: body.user_description,
          source: "flare",
          status: "new",
          priority: "medium",
          tags: ["from:flare", `route:${body.context.route ?? "unknown"}`],
          captured_by: user.id,
          ai_confidence: aiConfidence ?? 0.6,
        });
      } catch (err) {
        dispatchErrors.idea_backlog = err instanceof Error ? err.message : "insert failed";
      }
    }

    // ── Lane 6 (bonus): Wave 6.9 Exception Inbox for blockers ─────
    let exceptionQueueId: string | null = null;
    if (body.severity === "blocker") {
      try {
        const { data: excId } = await supabaseAdmin.rpc("enqueue_exception", {
          p_source: "data_quality", // closest existing source enum; flare-specific enum is a future migration
          p_title: `Flare blocker: ${body.user_description.slice(0, 120)}`,
          p_severity: "critical",
          p_detail: body.user_description,
          p_payload: {
            flare_report_id: reportId,
            route: body.context.route,
            url: body.context.url,
            reporter: reporterDisplayName,
            linear_url: linearOk?.issue_url ?? null,
          },
          p_entity_table: "flare_reports",
          p_entity_id: reportId,
        });
        exceptionQueueId = (excId as string | null) ?? null;
      } catch (err) {
        dispatchErrors.exception_queue = err instanceof Error ? err.message : "enqueue failed";
      }
    }

    // ── Update row with dispatch outcomes ────────────────────────
    await supabaseAdmin
      .from("flare_reports")
      .update({
        linear_issue_id: linearOk?.issue_id ?? null,
        linear_issue_url: linearOk?.issue_url ?? null,
        paperclip_issue_id: paperclipOk?.issue_id ?? null,
        paperclip_issue_url: paperclipOk?.issue_url ?? null,
        slack_ts: slackOk?.ts ?? null,
        exception_queue_id: exceptionQueueId,
        dispatch_errors: dispatchErrors,
      })
      .eq("id", reportId);

    return safeJsonOk({
      report_id: reportId,
      linear_issue_url: linearOk?.issue_url ?? null,
      paperclip_issue_url: paperclipOk?.issue_url ?? null,
      slack_ts: slackOk?.ts ?? null,
      similar_count_last_7d: similarCount,
      ai_severity_recommendation: aiSeverityRec,
      ai_severity_reasoning: aiSeverityReasoning,
      hypothesis_pattern: hypothesisPattern,
      reproducer_steps: reproducerSteps,
      recent_activity: recentActivity,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "flare-submit", req });
    console.error("[flare-submit] error:", err);
    return safeJsonError("internal", 500, req.headers.get("origin"));
  }
});

/**
 * Follow-Up Engine Edge Function (Cron: every hour)
 *
 * Processes due follow-up touchpoints and generates AI value-add content.
 * Core rule from owner's SOP: EVERY follow-up must include VALUE.
 * Zero tolerance for "just checking in."
 *
 * Pipeline:
 *   1. Query due touchpoints (join active cadences)
 *   2. Batch-load deals, needs assessments, contacts (no N+1 on reads)
 *   3. Per touchpoint: generate AI content (OpenAI)
 *   4. Batch UPDATE touchpoints via batch_apply_follow_up_touchpoint_ai RPC
 *   5. Bulk INSERT crm_in_app_notifications (one request)
 *   6. ── Day 7 dual-write ── per touchpoint, also publish a
 *      `follow_up.touchpoint_due` event to the flow bus. Best-effort.
 *
 * DB round-trips per run: 4 reads + 1 RPC + 1 bulk insert + N bus publishes
 * (where N = touchpoints with assigned reps; typically ≤ 50 per run).
 *
 * Auth: service_role (cron invocation)
 *
 * ── Phase 0 P0.4 Day 7 — DUAL-WRITE TO FLOW BUS ────────────────────────────
 *
 * The bus publish is best-effort: a failure logs to sentry but never breaks
 * the primary follow-up flow. The direct-insert path
 * (crm_in_app_notifications + batch_apply_follow_up_touchpoint_ai RPC) is
 * retired at the end of Phase 2 Slice 2.2 per main roadmap §15 Q3.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { publishFlowEvent } from "../_shared/flow-bus/publish.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

interface TouchpointWithContext {
  id: string;
  cadence_id: string;
  touchpoint_type: string;
  scheduled_date: string;
  purpose: string;
  value_type: string | null;
  status: string;
  follow_up_cadences: {
    deal_id: string;
    contact_id: string | null;
    assigned_to: string | null;
    cadence_type: string;
    workspace_id: string;
  };
}

async function generateValueContent(
  touchpoint: TouchpointWithContext,
  dealContext: Record<string, unknown>,
): Promise<string> {
  if (!OPENAI_API_KEY) {
    // Fallback content when no API key
    return `Follow-up for ${touchpoint.purpose}. Review the deal details and prepare value-add content before reaching out.`;
  }

  const prompt = `You are an AI assistant for QEP, a heavy equipment dealership. Generate a brief, value-driven follow-up message for a sales rep to use when contacting a customer.

CRITICAL RULE: The message must contain SPECIFIC VALUE for the customer. NEVER use generic phrases like "just checking in" or "touching base." Every follow-up must give the customer a reason to engage.

Context:
- Follow-up type: ${touchpoint.value_type || touchpoint.touchpoint_type}
- Purpose: ${touchpoint.purpose}
- Cadence type: ${touchpoint.follow_up_cadences.cadence_type}
- Deal info: ${JSON.stringify(dealContext)}

Generate a 2-3 sentence suggested talking point or message the rep can use. Be specific to the customer's needs if available. Include a clear call to action.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      console.error("OpenAI error:", await res.text());
      return `Follow-up for: ${touchpoint.purpose}`;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || touchpoint.purpose;
  } catch (err) {
    console.error("AI content generation failed:", err);
    return `Follow-up for: ${touchpoint.purpose}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }

  try {
    // Phase 0 Wave 4a — service-role gate accepts BOTH legacy Bearer
    // service_role_key AND modern x-internal-service-secret. See
    // _shared/cron-auth.ts and migration 212 for the modern cron pattern.
    if (!isServiceRoleCaller(req)) {
      return safeJsonError("Unauthorized — service role required", 401, null);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey!,
    );

    let body: { batch_size?: number } = {};
    try {
      body = await req.json();
    } catch {
      // No body is fine for cron invocations
    }
    const batchSize = body.batch_size || 50;

    const today = new Date().toISOString().split("T")[0];

    const results = {
      touchpoints_processed: 0,
      content_generated: 0,
      notifications_created: 0,
      overdue_marked: 0,
      errors: 0,
    };

    // ── 1. Find due touchpoints ───────────────────────────────────────────
    const { data: dueTouchpoints, error: queryError } = await supabaseAdmin
      .from("follow_up_touchpoints")
      .select(`
        id, cadence_id, touchpoint_type, scheduled_date, purpose, value_type, status,
        follow_up_cadences!inner(deal_id, contact_id, assigned_to, cadence_type, workspace_id, status)
      `)
      .eq("status", "pending")
      .lte("scheduled_date", today)
      .eq("follow_up_cadences.status", "active")
      .order("scheduled_date", { ascending: true })
      .limit(batchSize);

    if (queryError) {
      console.error("follow-up-engine query error:", queryError);
      return safeJsonError("Failed to query touchpoints", 500, null);
    }

    if (!dueTouchpoints || dueTouchpoints.length === 0) {
      return safeJsonOk({ ok: true, message: "No due touchpoints", results }, null);
    }

    // ── 2. Batch-fetch context data (eliminates N+1) ───────────────────────
    const touchpoints = dueTouchpoints as unknown as TouchpointWithContext[];

    // Collect unique IDs for batch loading
    const dealIds = [...new Set(touchpoints.map((tp) => tp.follow_up_cadences.deal_id))];
    const contactIds = [...new Set(
      touchpoints
        .map((tp) => tp.follow_up_cadences.contact_id)
        .filter((id): id is string => id !== null),
    )];

    // Batch-fetch deals
    const dealMap = new Map<string, { name: string; amount: number | null; margin_pct: number | null }>();
    if (dealIds.length > 0) {
      const { data: deals } = await supabaseAdmin
        .from("crm_deals")
        .select("id, name, amount, margin_pct")
        .in("id", dealIds);
      for (const d of deals ?? []) dealMap.set(d.id, d);
    }

    // Batch-fetch assessments (latest per deal)
    const assessmentMap = new Map<string, Record<string, unknown>>();
    if (dealIds.length > 0) {
      const { data: assessments } = await supabaseAdmin
        .from("needs_assessments")
        .select("deal_id, application, machine_interest, budget_type, monthly_payment_target, current_equipment_issues")
        .in("deal_id", dealIds)
        .order("created_at", { ascending: false });
      for (const a of assessments ?? []) {
        if (!assessmentMap.has(a.deal_id)) assessmentMap.set(a.deal_id, a);
      }
    }

    // Batch-fetch contacts
    const contactMap = new Map<string, string>();
    if (contactIds.length > 0) {
      const { data: contacts } = await supabaseAdmin
        .from("crm_contacts")
        .select("id, first_name, last_name")
        .in("id", contactIds);
      for (const c of contacts ?? []) {
        contactMap.set(c.id, `${c.first_name || ""} ${c.last_name || ""}`.trim());
      }
    }

    // ── 3. Build per-touchpoint context (no AI yet — pure CPU) ──────────
    //
    // P2 W2-4 fix: the original loop was sequential `await
    // generateValueContent(...)` per touchpoint, costing 50 × 500ms = 25s
    // of cron latency at the upper end. The fix splits this into two
    // phases: (a) build all the deal contexts up front in a tight CPU
    // loop, (b) call OpenAI in chunks of 10 via Promise.allSettled.
    //
    // This is the same pattern Day 7 used for the bus publish loop in
    // anomaly-scan but with a smaller chunk size because OpenAI's
    // per-minute rate limits are tighter than Postgres connections.

    type TouchpointAiRow = {
      id: string;
      suggested_message: string;
      content_generated_at: string;
      content_context: Record<string, unknown>;
      set_overdue: boolean;
    };

    type TouchpointContext = {
      tp: TouchpointWithContext;
      dealContext: Record<string, unknown>;
      contactName: string;
      isOverdue: boolean;
    };

    const todayDate = new Date(today);

    // Phase A: build contexts in a tight loop (no awaits, no errors)
    const touchpointContexts: TouchpointContext[] = touchpoints.map((tp) => {
      const cadence = tp.follow_up_cadences;
      const deal = dealMap.get(cadence.deal_id);
      const assessment = assessmentMap.get(cadence.deal_id);
      const contactName = (cadence.contact_id && contactMap.get(cadence.contact_id)) || "Customer";

      const dealContext = {
        deal_name: deal?.name,
        deal_amount: deal?.amount,
        contact_name: contactName,
        application: assessment?.application,
        machine_interest: assessment?.machine_interest,
        budget_type: assessment?.budget_type,
        current_issues: assessment?.current_equipment_issues,
      };

      const scheduledDate = new Date(tp.scheduled_date);
      const isOverdue = scheduledDate < todayDate;

      return { tp, dealContext, contactName, isOverdue };
    });

    // Phase B: chunked parallel OpenAI calls.
    // Chunk size 10 keeps concurrent OpenAI requests within a comfortable
    // gpt-4o-mini rate-limit envelope. 50 touchpoints → 5 chunks → 10
    // concurrent requests max. If touchpoints > 50 (only possible if
    // batch_size override is supplied), the chunking still bounds the
    // load.
    const AI_CHUNK_SIZE = 10;
    const aiResults = new Map<string, string>(); // touchpoint id → message

    for (let chunkStart = 0; chunkStart < touchpointContexts.length; chunkStart += AI_CHUNK_SIZE) {
      const chunk = touchpointContexts.slice(chunkStart, chunkStart + AI_CHUNK_SIZE);
      const settled = await Promise.allSettled(
        chunk.map((ctx) => generateValueContent(ctx.tp, ctx.dealContext)),
      );
      for (let i = 0; i < settled.length; i += 1) {
        const result = settled[i];
        const ctx = chunk[i];
        if (result.status === "fulfilled") {
          aiResults.set(ctx.tp.id, result.value);
        } else {
          // AI call failed → use the same fallback message as
          // generateValueContent's internal catch path so the touchpoint
          // still gets persisted with SOMETHING. The error is still
          // counted in results.errors.
          console.error(`AI call failed for touchpoint ${ctx.tp.id}:`, result.reason);
          results.errors++;
          aiResults.set(ctx.tp.id, `Follow-up for: ${ctx.tp.purpose}`);
        }
      }
    }

    // Phase C: build the touchpoint AI rows + notification rows from the
    // context array + the AI results map. No awaits in this phase.
    const touchpointAiRows: TouchpointAiRow[] = [];
    const notificationRows: Array<{
      workspace_id: string;
      user_id: string;
      kind: string;
      title: string;
      body: string | null;
      deal_id: string;
      metadata: Record<string, unknown>;
    }> = [];

    for (const ctx of touchpointContexts) {
      try {
        results.touchpoints_processed++;
        const { tp, dealContext, contactName, isOverdue } = ctx;
        const cadence = tp.follow_up_cadences;
        const suggestedMessage = aiResults.get(tp.id) ?? `Follow-up for: ${tp.purpose}`;
        results.content_generated++;

        touchpointAiRows.push({
          id: tp.id,
          suggested_message: suggestedMessage,
          content_generated_at: new Date().toISOString(),
          content_context: dealContext,
          set_overdue: isOverdue,
        });

        if (isOverdue) results.overdue_marked++;

        if (cadence.assigned_to) {
          notificationRows.push({
            workspace_id: cadence.workspace_id,
            user_id: cadence.assigned_to,
            kind: "follow_up_due",
            title: `Follow-Up Due: ${contactName}`,
            body: suggestedMessage,
            deal_id: cadence.deal_id,
            metadata: {
              touchpoint_id: tp.id,
              touchpoint_type: tp.touchpoint_type,
              value_type: tp.value_type,
              cadence_type: cadence.cadence_type,
            },
          });
        }
      } catch (tpError) {
        console.error(`Error processing touchpoint ${ctx.tp.id}:`, tpError);
        results.errors++;
      }
    }

    if (touchpointAiRows.length > 0) {
      const { error: batchUpdateError } = await supabaseAdmin.rpc("batch_apply_follow_up_touchpoint_ai", {
        p_rows: touchpointAiRows,
      });
      if (batchUpdateError) {
        console.error("batch_apply_follow_up_touchpoint_ai error:", batchUpdateError);
        return safeJsonError("Failed to persist touchpoint updates", 500, null);
      }
    }

    if (notificationRows.length > 0) {
      const { error: notifError } = await supabaseAdmin.from("crm_in_app_notifications").insert(notificationRows);
      if (notifError) {
        console.error("crm_in_app_notifications bulk insert error:", notifError);
        return safeJsonError("Failed to create notifications", 500, null);
      }
      results.notifications_created = notificationRows.length;

      // ── Day 7 dual-write to flow bus (PARALLEL) ──
      // P1 fix (post-Day-7 audit): Promise.allSettled instead of sequential
      // await — each publish is independent and the bus dedupe via the
      // partial unique index handles concurrent same-key races. The cron
      // can process ~50 touchpoints per run; sequential would add 1-2s of
      // round-trip latency that this parallelization eliminates.
      const publishResults = await Promise.allSettled(
        notificationRows.map((notif) => {
          const meta = notif.metadata as Record<string, unknown>;
          return publishFlowEvent(supabaseAdmin, {
            workspaceId: notif.workspace_id,
            eventType: "follow_up.touchpoint_due",
            sourceModule: "follow-up-engine",
            dealId: notif.deal_id,
            suggestedOwner: notif.user_id,
            severity: "medium",
            commercialRelevance: "high",
            requiredAction: notif.title,
            draftMessage: notif.body ?? undefined,
            payload: {
              touchpoint_id: meta.touchpoint_id,
              touchpoint_type: meta.touchpoint_type,
              value_type: meta.value_type,
              cadence_type: meta.cadence_type,
            },
            idempotencyKey: `follow_up.touchpoint_due:${meta.touchpoint_id}`,
          });
        }),
      );

      let busPublished = 0;
      let busFailed = 0;
      for (let i = 0; i < publishResults.length; i += 1) {
        const result = publishResults[i];
        if (result.status === "fulfilled") {
          busPublished++;
        } else {
          busFailed++;
          const meta = notificationRows[i].metadata as Record<string, unknown>;
          console.error(
            "[follow-up-engine] flow bus publish failed:",
            result.reason instanceof Error ? result.reason.message : result.reason,
          );
          captureEdgeException(result.reason, {
            fn: "follow-up-engine",
            req,
            extra: {
              phase: "bus_publish",
              touchpoint_id: meta.touchpoint_id,
            },
          });
        }
      }
      console.log(
        `[follow-up-engine] bus published=${busPublished} failed=${busFailed} of ${notificationRows.length}`,
      );
    }

    return safeJsonOk({ ok: true, results }, null);
  } catch (err) {
    captureEdgeException(err, { fn: "follow-up-engine", req });
    console.error("follow-up-engine error:", err);
    return safeJsonError("Internal server error", 500, null);
  }
});

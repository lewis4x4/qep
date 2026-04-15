/**
 * Escalation Router Edge Function
 *
 * Creates escalation tickets from voice commands during post-sale follow-ups.
 * Single voice command → email draft + follow-up task + escalation ticket.
 *
 * Slice 2.5 additions:
 *   - Accepts service-role / internal-service-secret auth so voice-to-qrm
 *     can dispatch escalations without a user JWT
 *   - Auto-resolves the department manager via escalation-intelligence when
 *     the caller didn't supply name/email
 *   - Scores severity from deal amount + issue language + sentiment
 *   - Attaches a resolution suggestion to the ticket metadata
 *
 * POST: Create escalation with auto-generated email and task
 *
 * Auth: rep/admin/manager/owner OR service-role OR internal-service-secret
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
import {
  resolveEscalationManager,
  scoreEscalationSeverity,
  suggestResolution,
  type ManagerCandidate,
} from "../_shared/escalation-intelligence.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

interface EscalationInput {
  deal_id: string;
  contact_id?: string;
  touchpoint_id?: string;
  issue_description: string;
  department?: string;
  branch?: string;
  severity?: string;
  department_manager_name?: string;
  department_manager_email?: string;
  // Slice 2.5 — metadata the voice-to-qrm caller can attach.
  source?: string;
  detection_reason?: string;
  voice_capture_id?: string | null;
  sentiment?: string | null;
}

async function generateEscalationEmail(
  input: EscalationInput & { resolved_manager_name?: string | null },
  contactName: string,
): Promise<string> {
  const managerName = input.resolved_manager_name || input.department_manager_name || "Manager";
  if (!OPENAI_API_KEY) {
    return `Dear ${managerName},\n\nI am writing to bring to your attention an issue reported by ${contactName} during a follow-up call.\n\n${input.issue_description}\n\nPlease reach out to the customer at your earliest convenience.\n\nThank you.`;
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: `Write a professional internal email from a QEP sales rep to ${managerName} at QEP ${input.branch || ""} branch about a customer issue.

Customer: ${contactName}
Department: ${input.department || "Service"}
Issue: ${input.issue_description}

The email should:
1. Be professional and concise
2. Clearly state the issue
3. Request a courtesy call to the customer
4. Include urgency if appropriate

Write just the email body, no subject line.`,
        }],
        max_tokens: 300,
        temperature: 0.5,
      }),
    });

    if (!res.ok) return input.issue_description;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || input.issue_description;
  } catch {
    return input.issue_description;
  }
}

// Auth helpers ──────────────────────────────────────────────────────────────

function isServiceRoleRequest(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalSecretHeader = req.headers.get("x-internal-service-secret") ?? "";
  const internalServiceSecret =
    Deno.env.get("INTERNAL_SERVICE_SECRET") ??
    Deno.env.get("DGE_INTERNAL_SERVICE_SECRET") ??
    "";

  return (
    (serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`)
    || (internalServiceSecret.length > 0 && internalSecretHeader === internalServiceSecret)
  );
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const serviceRole = isServiceRoleRequest(req);

    // Per-user path: verify JWT and derive the caller's id for attribution.
    let callerUserId: string | null = null;
    let callerWorkspaceId: string | null = null;
    if (!serviceRole) {
      const authHeader = req.headers.get("Authorization")?.trim();
      if (!authHeader) return safeJsonError("Unauthorized", 401, origin);

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );

      const token = authHeader.replace(/^Bearer\s+/i, "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) return safeJsonError("Unauthorized", 401, origin);

      callerUserId = user.id;

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("workspace_id")
        .eq("id", user.id)
        .maybeSingle();
      callerWorkspaceId = (profile as { workspace_id?: string } | null)?.workspace_id ?? null;
    }

    const body: EscalationInput = await req.json();

    if (!body.deal_id || !body.issue_description) {
      return safeJsonError("deal_id and issue_description are required", 400, origin);
    }

    // Look up the deal: amount for severity scoring + workspace for manager scope.
    const { data: deal } = await supabaseAdmin
      .from("crm_deals")
      .select("amount, workspace_id, assigned_rep_id")
      .eq("id", body.deal_id)
      .maybeSingle();

    const dealRow = deal as { amount: number | null; workspace_id: string; assigned_rep_id: string | null } | null;
    const dealAmount = dealRow?.amount ?? null;
    const dealWorkspace = dealRow?.workspace_id ?? callerWorkspaceId;

    if (!dealWorkspace) {
      return safeJsonError("Could not resolve workspace for deal", 400, origin);
    }

    // For service-role callers, attribute the ticket to the deal's assigned
    // rep so rows carry a non-null `escalated_by` (matches existing semantics).
    const escalatedBy = callerUserId ?? dealRow?.assigned_rep_id ?? null;

    // Contact name
    let contactName = "Customer";
    if (body.contact_id) {
      const { data: contact } = await supabaseAdmin
        .from("crm_contacts")
        .select("first_name, last_name")
        .eq("id", body.contact_id)
        .maybeSingle();
      if (contact) {
        const c = contact as { first_name: string | null; last_name: string | null };
        contactName = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Customer";
      }
    }

    // Score severity (Slice 2.5).
    const severity = scoreEscalationSeverity({
      deal_amount: dealAmount,
      issue_description: body.issue_description,
      sentiment: body.sentiment,
      explicit: body.severity,
    });

    // Resolve the target manager when the caller didn't supply one.
    let resolvedManagerName = body.department_manager_name ?? null;
    let resolvedManagerEmail = body.department_manager_email ?? null;
    let resolvedManagerUserId: string | null = null;
    let managerResolutionReason = "explicit";

    if (!resolvedManagerName && !resolvedManagerEmail) {
      // Pull workspace managers to offer the resolver as candidates.
      const { data: candidates } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, role, iron_role")
        .eq("workspace_id", dealWorkspace)
        .in("role", ["admin", "manager", "owner"]);

      const pool: ManagerCandidate[] = ((candidates ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        full_name: (row.full_name as string | null) ?? null,
        email: (row.email as string | null) ?? null,
        role: String(row.role),
        iron_role: (row.iron_role as string | null) ?? null,
        // We don't have a department→profile mapping table yet, so no
        // candidate is marked department_match; the resolver will fall
        // through to iron_manager / workspace admin.
        department_match: false,
      }));

      const resolved = resolveEscalationManager({
        department: body.department,
        candidates: pool,
      });
      resolvedManagerName = resolved.name;
      resolvedManagerEmail = resolved.email;
      resolvedManagerUserId = resolved.user_id;
      managerResolutionReason = resolved.reason;
    }

    // Resolution suggestion (advisory — the email stays the primary action).
    const suggestedResolution = suggestResolution({
      issue_description: body.issue_description,
      severity,
    });

    // 1. Generate email draft
    const emailContent = await generateEscalationEmail(
      { ...body, resolved_manager_name: resolvedManagerName },
      contactName,
    );

    // 2. Create follow-up task (QRM activity)
    const { data: task } = await supabaseAdmin
      .from("crm_activities")
      .insert({
        workspace_id: dealWorkspace,
        activity_type: "task",
        body: `Follow up with ${resolvedManagerName || body.department || "department"} about ${contactName}'s issue: ${body.issue_description}`,
        deal_id: body.deal_id,
        contact_id: body.contact_id,
        created_by: escalatedBy,
        metadata: {
          source: "escalation_router",
          task_status: "pending",
          severity,
          resolution_hint: suggestedResolution,
          voice_capture_id: body.voice_capture_id ?? null,
          detection_reason: body.detection_reason ?? null,
        },
      })
      .select("id")
      .single();

    // 3. Create escalation ticket
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("escalation_tickets")
      .insert({
        deal_id: body.deal_id,
        contact_id: body.contact_id,
        touchpoint_id: body.touchpoint_id,
        issue_description: body.issue_description,
        department: body.department,
        branch: body.branch,
        severity,
        escalated_by: escalatedBy,
        email_drafted: true,
        email_draft_content: emailContent,
        email_recipient: resolvedManagerEmail,
        follow_up_task_created: !!task,
        follow_up_task_id: (task as { id?: string } | null)?.id,
      })
      .select()
      .single();

    if (ticketError) {
      console.error("escalation-router error:", ticketError);
      return safeJsonError("Failed to create escalation ticket", 500, origin);
    }

    return safeJsonOk({
      ticket,
      email_draft: emailContent,
      follow_up_task: task,
      contact_name: contactName,
      severity,
      resolution_hint: suggestedResolution,
      manager: {
        name: resolvedManagerName,
        email: resolvedManagerEmail,
        user_id: resolvedManagerUserId,
        reason: managerResolutionReason,
      },
      source: body.source ?? "manual",
      detection_reason: body.detection_reason ?? null,
    }, origin, 201);
  } catch (err) {
    captureEdgeException(err, { fn: "escalation-router", req });
    console.error("escalation-router error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});

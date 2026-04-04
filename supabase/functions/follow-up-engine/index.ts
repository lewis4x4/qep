/**
 * Follow-Up Engine Edge Function (Cron: every hour)
 *
 * Processes due follow-up touchpoints and generates AI value-add content.
 * Core rule from owner's SOP: EVERY follow-up must include VALUE.
 * Zero tolerance for "just checking in."
 *
 * Pipeline:
 *   1. Query touchpoints where scheduled_date <= today AND status = 'pending'
 *   2. For each: load deal context (needs assessment, competitor mentions, equipment)
 *   3. Generate AI value-add content via OpenAI
 *   4. Create crm_in_app_notifications
 *   5. Mark overdue if past deadline
 *
 * Auth: service_role (cron invocation)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

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
    // Validate service role auth — cron-only function
    const authHeader = req.headers.get("Authorization")?.trim();
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
      return safeJsonError("Unauthorized — service role required", 401, null);
    }

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

    // ── 2. Process each touchpoint ────────────────────────────────────────
    for (const tp of dueTouchpoints as unknown as TouchpointWithContext[]) {
      try {
        results.touchpoints_processed++;
        const cadence = tp.follow_up_cadences;

        // Load deal context for AI content generation
        const { data: deal } = await supabaseAdmin
          .from("crm_deals")
          .select("name, amount, margin_pct, metadata")
          .eq("id", cadence.deal_id)
          .single();

        // Load needs assessment if available
        const { data: assessment } = await supabaseAdmin
          .from("needs_assessments")
          .select("application, machine_interest, budget_type, monthly_payment_target, current_equipment_issues, qrm_narrative")
          .eq("deal_id", cadence.deal_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // Load contact name
        let contactName = "Customer";
        if (cadence.contact_id) {
          const { data: contact } = await supabaseAdmin
            .from("crm_contacts")
            .select("first_name, last_name")
            .eq("id", cadence.contact_id)
            .maybeSingle();
          if (contact) {
            contactName = `${contact.first_name || ""} ${contact.last_name || ""}`.trim();
          }
        }

        const dealContext = {
          deal_name: deal?.name,
          deal_amount: deal?.amount,
          contact_name: contactName,
          application: assessment?.application,
          machine_interest: assessment?.machine_interest,
          budget_type: assessment?.budget_type,
          current_issues: assessment?.current_equipment_issues,
        };

        // Generate AI value-add content
        const suggestedMessage = await generateValueContent(tp, dealContext);
        results.content_generated++;

        // Update touchpoint with generated content
        await supabaseAdmin
          .from("follow_up_touchpoints")
          .update({
            suggested_message: suggestedMessage,
            content_generated_at: new Date().toISOString(),
            content_context: dealContext,
          })
          .eq("id", tp.id);

        // Mark overdue if past scheduled date
        const scheduledDate = new Date(tp.scheduled_date);
        const todayDate = new Date(today);
        if (scheduledDate < todayDate) {
          await supabaseAdmin
            .from("follow_up_touchpoints")
            .update({ status: "overdue" })
            .eq("id", tp.id);
          results.overdue_marked++;
        }

        // Create notification for assigned rep
        if (cadence.assigned_to) {
          await supabaseAdmin.from("crm_in_app_notifications").insert({
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
          results.notifications_created++;
        }
      } catch (tpError) {
        console.error(`Error processing touchpoint ${tp.id}:`, tpError);
        results.errors++;
      }
    }

    return safeJsonOk({ ok: true, results }, null);
  } catch (err) {
    console.error("follow-up-engine error:", err);
    return safeJsonError("Internal server error", 500, null);
  }
});

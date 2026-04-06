/**
 * Escalation Router Edge Function
 *
 * Creates escalation tickets from voice commands during post-sale follow-ups.
 * Single voice command → email draft + follow-up task + escalation ticket.
 *
 * POST: Create escalation with auto-generated email and task
 *
 * Auth: rep/admin/manager/owner
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

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
}

async function generateEscalationEmail(input: EscalationInput, contactName: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    return `Dear ${input.department_manager_name || "Manager"},\n\nI am writing to bring to your attention an issue reported by ${contactName} during a follow-up call.\n\n${input.issue_description}\n\nPlease reach out to the customer at your earliest convenience.\n\nThank you.`;
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
          content: `Write a professional internal email from a QEP sales rep to ${input.department_manager_name || "the department manager"} at QEP ${input.branch || ""} branch about a customer issue.

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

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const body: EscalationInput = await req.json();

    if (!body.deal_id || !body.issue_description) {
      return safeJsonError("deal_id and issue_description are required", 400, origin);
    }

    // Get contact name
    let contactName = "Customer";
    if (body.contact_id) {
      const { data: contact } = await supabase
        .from("crm_contacts")
        .select("first_name, last_name")
        .eq("id", body.contact_id)
        .maybeSingle();
      if (contact) {
        contactName = `${contact.first_name || ""} ${contact.last_name || ""}`.trim();
      }
    }

    // 1. Generate email draft
    const emailContent = await generateEscalationEmail(body, contactName);

    // 2. Create follow-up task (QRM activity)
    const { data: task } = await supabase
      .from("crm_activities")
      .insert({
        activity_type: "task",
        body: `Follow up with ${body.department_manager_name || body.department || "department"} about ${contactName}'s issue: ${body.issue_description}`,
        deal_id: body.deal_id,
        contact_id: body.contact_id,
        created_by: user.id,
        metadata: {
          source: "escalation_router",
          task_status: "pending",
        },
      })
      .select("id")
      .single();

    // 3. Create escalation ticket
    const { data: ticket, error: ticketError } = await supabase
      .from("escalation_tickets")
      .insert({
        deal_id: body.deal_id,
        contact_id: body.contact_id,
        touchpoint_id: body.touchpoint_id,
        issue_description: body.issue_description,
        department: body.department,
        branch: body.branch,
        severity: body.severity || "normal",
        escalated_by: user.id,
        email_drafted: true,
        email_draft_content: emailContent,
        email_recipient: body.department_manager_email,
        follow_up_task_created: !!task,
        follow_up_task_id: task?.id,
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
    }, origin, 201);
  } catch (err) {
    console.error("escalation-router error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});

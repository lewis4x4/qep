/**
 * Draft Email Edge Function (Wave 5A.2)
 *
 * Shared GPT-backed email draft generator. Used by:
 *   - Deal Timing Engine     → urgency emails for budget cycles + price increases
 *   - Tariff Tracking        → "Call your Develon customers — 7% surcharge June 1"
 *   - Price File Intelligence → "Heads up — [Manufacturer] adjusted pricing"
 *   - Replacement Cost Curve → trade-up nudge emails
 *
 * Always returns JSON. Drafts are NEVER auto-sent — they are stored in
 * `email_drafts` and surfaced in the rep's UI for review/edit/send.
 *
 * POST /draft
 *   {
 *     scenario: 'budget_cycle' | 'price_increase' | 'tariff' | 'requote' | 'trade_up' | 'custom',
 *     deal_id?: uuid,
 *     contact_id?: uuid,
 *     company_id?: uuid,
 *     equipment_id?: uuid,
 *     context: { ... scenario-specific facts ... },
 *     tone?: 'urgent' | 'consultative' | 'friendly',  // default: consultative
 *     persist?: boolean  // default: true — store row in email_drafts
 *   }
 *
 * POST /batch — generate drafts for many recipients in one shot
 *   {
 *     scenario: ...,
 *     recipients: [{ deal_id, contact_id, context }, ...],
 *     tone?: ...
 *   }
 *
 * GET /list?status=pending&assigned_to=<uuid>
 * POST /mark-sent  { draft_id, sent_via, sent_at }
 *
 * Auth: rep/manager/owner (manual) OR service_role (cron)
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPENAI_KEY");

type Scenario =
  | "budget_cycle"
  | "price_increase"
  | "tariff"
  | "requote"
  | "trade_up"
  | "custom";

interface DraftRequest {
  scenario: Scenario;
  deal_id?: string;
  contact_id?: string;
  company_id?: string;
  equipment_id?: string;
  context?: Record<string, unknown>;
  tone?: "urgent" | "consultative" | "friendly";
  persist?: boolean;
  rep_signature?: string;
}

interface BatchDraftRequest {
  scenario: Scenario;
  recipients: Array<{
    deal_id?: string;
    contact_id?: string;
    company_id?: string;
    equipment_id?: string;
    context?: Record<string, unknown>;
  }>;
  tone?: "urgent" | "consultative" | "friendly";
  rep_signature?: string;
}

/* ────────────── Prompt library (per scenario) ────────────── */

const SCENARIO_SYSTEM_PROMPTS: Record<Scenario, string> = {
  budget_cycle: `You are an email-drafting assistant for a heavy-equipment dealership. Write a concise (≤180 words), professional email reaching out to a customer whose budget cycle is opening soon. Lead with the timing observation, reference the specific machine they previously expressed interest in, offer to lock in current pricing or schedule a demo. End with one clear ask. Never invent numbers — use only the facts provided in the context.`,
  price_increase: `You are an email-drafting assistant for a heavy-equipment dealership. Write a concise (≤200 words), professional but urgent email warning a customer that the manufacturer has announced a price increase taking effect on a specific date. Mention the manufacturer, the percentage, the effective date, and offer to lock in current pricing on any open quote. Tone is helpful, not pushy. Never invent numbers.`,
  tariff: `You are an email-drafting assistant for a heavy-equipment dealership. Write a short (≤150 words) urgency email letting a customer know about an incoming tariff/surcharge on a specific manufacturer's equipment. State the manufacturer, the surcharge %, the effective date, and offer a path to act before the deadline (lock in price, place order, etc.). Direct and action-oriented.`,
  requote: `You are an email-drafting assistant for a heavy-equipment dealership. Write a brief (≤140 words), professional email letting the customer know that the manufacturer has adjusted pricing on equipment in their open quote, and you'd like to send them an updated quote. Lead with "Heads up — [Manufacturer] adjusted pricing", state the impact in a single sentence if the dollar delta is provided, and end with a clear next step.`,
  trade_up: `You are an email-drafting assistant for a heavy-equipment dealership. Write a consultative (≤180 words) email suggesting that the customer consider trading up their current machine. Reference the machine (year/make/model/hours if provided), the cumulative parts/maintenance spend if available, and frame the trade-up as a way to reduce downtime and total cost of ownership. Offer a no-pressure conversation.`,
  custom: `You are an email-drafting assistant for a heavy-equipment dealership. Write a concise, professional email based on the supplied context. Honor the requested tone. Never fabricate numbers.`,
};

function buildUserPrompt(
  scenario: Scenario,
  context: Record<string, unknown>,
  tone: string,
  signature: string,
): string {
  return `Scenario: ${scenario}
Tone: ${tone}
Rep signature: ${signature}

Context (use only these facts — do not invent):
${JSON.stringify(context, null, 2)}

Return ONLY a JSON object:
{
  "subject": "string — email subject line",
  "body": "string — full email body, plain text, with greeting and signature",
  "preview": "string — 1-sentence summary used in list views",
  "urgency_score": "number 0-1 — how time-sensitive this is"
}`;
}

async function callOpenAi(
  scenario: Scenario,
  context: Record<string, unknown>,
  tone: string,
  signature: string,
): Promise<{ subject: string; body: string; preview: string; urgency_score: number }> {
  if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SCENARIO_SYSTEM_PROMPTS[scenario] },
        { role: "user", content: buildUserPrompt(scenario, context, tone, signature) },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error: ${errText}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("OpenAI returned no content");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("OpenAI returned malformed JSON");
  }
}

async function persistDraft(
  supabase: SupabaseClient,
  workspace: string,
  createdBy: string | null,
  payload: DraftRequest,
  generated: { subject: string; body: string; preview: string; urgency_score: number },
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("email_drafts")
    .insert({
      workspace_id: workspace,
      scenario: payload.scenario,
      deal_id: payload.deal_id || null,
      contact_id: payload.contact_id || null,
      company_id: payload.company_id || null,
      equipment_id: payload.equipment_id || null,
      subject: generated.subject,
      body: generated.body,
      preview: generated.preview,
      urgency_score: generated.urgency_score,
      tone: payload.tone || "consultative",
      context: payload.context || {},
      status: "pending",
      created_by: createdBy,
    })
    .select("id")
    .single();

  if (error) {
    console.error("draft-email persist error:", error);
    return null;
  }
  return data;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) return safeJsonError("Unauthorized", 401, origin);

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

    let supabaseAdmin: SupabaseClient | null = null;
    let userId: string | null = null;
    let workspace = "default";

    if (isServiceRole) {
      supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey!);
    } else {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return safeJsonError("Unauthorized", 401, origin);

      supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey!);

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role, workspace_id")
        .eq("id", user.id)
        .single();

      if (!profile || !["rep", "manager", "owner", "admin"].includes(profile.role)) {
        return safeJsonError("draft-email requires rep/manager/owner/admin role", 403, origin);
      }

      userId = user.id;
      workspace = profile.workspace_id || "default";
    }

    if (!supabaseAdmin) return safeJsonError("Server misconfiguration", 500, origin);

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop() || "";

    /* ─────────── GET /list ─────────── */
    if (req.method === "GET" && action === "list") {
      const status = url.searchParams.get("status") || "pending";
      const assignedTo = url.searchParams.get("assigned_to");

      let query = supabaseAdmin
        .from("email_drafts")
        .select("id, scenario, subject, preview, urgency_score, status, created_at, deal_id, contact_id, company_id")
        .eq("workspace_id", workspace)
        .eq("status", status)
        .order("urgency_score", { ascending: false })
        .limit(100);

      if (assignedTo) query = query.eq("created_by", assignedTo);

      const { data, error } = await query;
      if (error) return safeJsonError("Failed to list drafts", 500, origin);
      return safeJsonOk({ drafts: data }, origin);
    }

    if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

    const body = await req.json();

    /* ─────────── POST /draft ─────────── */
    if (action === "draft") {
      const payload = body as DraftRequest;
      if (!payload.scenario) {
        return safeJsonError("scenario is required", 400, origin);
      }
      if (!SCENARIO_SYSTEM_PROMPTS[payload.scenario]) {
        return safeJsonError(`Unknown scenario: ${payload.scenario}`, 400, origin);
      }

      const tone = payload.tone || "consultative";
      const signature = payload.rep_signature || "Your QEP team";
      const context = payload.context || {};

      let generated;
      try {
        generated = await callOpenAi(payload.scenario, context, tone, signature);
      } catch (err) {
        console.error("draft-email generation error:", err);
        return safeJsonError("Email draft generation failed", 502, origin);
      }

      let draftId: string | null = null;
      if (payload.persist !== false) {
        const persisted = await persistDraft(
          supabaseAdmin,
          workspace,
          userId,
          payload,
          generated,
        );
        draftId = persisted?.id || null;
      }

      return safeJsonOk(
        {
          draft_id: draftId,
          scenario: payload.scenario,
          subject: generated.subject,
          body: generated.body,
          preview: generated.preview,
          urgency_score: generated.urgency_score,
        },
        origin,
        201,
      );
    }

    /* ─────────── POST /batch ─────────── */
    if (action === "batch") {
      const payload = body as BatchDraftRequest;
      if (!payload.scenario || !Array.isArray(payload.recipients)) {
        return safeJsonError("scenario and recipients[] required", 400, origin);
      }
      if (payload.recipients.length > 50) {
        return safeJsonError("Max 50 recipients per batch", 400, origin);
      }

      const tone = payload.tone || "consultative";
      const signature = payload.rep_signature || "Your QEP team";

      const results: Array<{ deal_id?: string; draft_id: string | null; error?: string }> = [];

      for (const recipient of payload.recipients) {
        try {
          const generated = await callOpenAi(
            payload.scenario,
            recipient.context || {},
            tone,
            signature,
          );

          const persisted = await persistDraft(
            supabaseAdmin,
            workspace,
            userId,
            { scenario: payload.scenario, ...recipient, tone },
            generated,
          );

          results.push({ deal_id: recipient.deal_id, draft_id: persisted?.id || null });
        } catch (err) {
          results.push({
            deal_id: recipient.deal_id,
            draft_id: null,
            error: err instanceof Error ? err.message : "unknown error",
          });
        }
      }

      return safeJsonOk(
        {
          scenario: payload.scenario,
          generated: results.filter((r) => r.draft_id).length,
          failed: results.filter((r) => !r.draft_id).length,
          results,
        },
        origin,
        201,
      );
    }

    /* ─────────── POST /mark-sent ─────────── */
    if (action === "mark-sent") {
      if (!body.draft_id) return safeJsonError("draft_id required", 400, origin);

      const { error } = await supabaseAdmin
        .from("email_drafts")
        .update({
          status: "sent",
          sent_at: body.sent_at || new Date().toISOString(),
          sent_via: body.sent_via || "manual",
        })
        .eq("id", body.draft_id)
        .eq("workspace_id", workspace);

      if (error) return safeJsonError("Failed to mark sent", 500, origin);
      return safeJsonOk({ ok: true }, origin);
    }

    return safeJsonError("Unknown action", 400, origin);
  } catch (err) {
    console.error("draft-email error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});

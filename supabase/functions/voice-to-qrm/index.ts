/**
 * Voice-to-QRM Pipeline Edge Function
 *
 * The crown jewel of Phase 1. Transforms a single voice note into a fully
 * populated QRM entry: contact + company + deal + needs assessment + follow-up
 * cadence — all in <10 seconds.
 *
 * Pipeline:
 *   1. Accept audio → upload to storage → transcribe via Whisper
 *   2. Extract ALL fields via enhanced GPT prompt (VoiceQrmExtraction schema)
 *   3. Fuzzy match or auto-create contact + company
 *   4. Auto-create or update deal in correct pipeline stage
 *   5. Auto-populate needs assessment
 *   6. Auto-set follow-up cadence
 *   7. Generate QRM narrative in owner's format
 *   8. Return complete result with all entity IDs
 *
 * Auth: rep/manager/owner
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
import { resolveProfileActiveWorkspaceId } from "../_shared/workspace.ts";
import { detectEscalationFromVoice } from "../_shared/voice-escalation-detect.ts";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

/** Parsed GPT JSON; fields are optional at runtime. */
interface VoiceQrmContact {
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface VoiceQrmCompany {
  name?: string | null;
  location?: string | null;
}

interface VoiceQrmNeedsAssessment {
  application?: string | null;
  terrain_material?: string | null;
  machine_interest?: string | null;
  attachments_needed?: string[] | null;
  brand_preference?: string | null;
  current_equipment?: string | null;
  current_equipment_issues?: string | null;
  timeline?: string | null;
  timeline_urgency?: string | null;
  budget_amount?: number | null;
  budget_type?: string | null;
  monthly_payment_target?: number | null;
  financing_preference?: string | null;
  trade_in?: boolean | null;
  trade_in_details?: string | null;
  decision_maker?: boolean | null;
  decision_maker_name?: string | null;
  next_step?: string | null;
}

interface VoiceQrmDeal {
  description?: string | null;
  next_step?: string | null;
  stage_suggestion?: number | null;
  estimated_value?: number | null;
  machine_interest?: string | null;
  quantity?: number | null;
}

interface VoiceQrmEquipmentMention {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  hours?: number | null;
  mentioned_as?: "current_fleet" | "trade_in" | "competitor" | "interest" | null;
  raw_mention?: string | null;
}

interface VoiceQrmBudgetTimeline {
  cycle_month?: number | null; // 1-12 (e.g. "October" → 10)
  fiscal_year_end_month?: number | null;
  notes?: string | null;
}

interface VoiceQrmFutureTask {
  title?: string | null;
  description?: string | null;
  scheduled_for?: string | null; // YYYY-MM-DD
}

interface VoiceQrmIntelligence {
  competitor_mentions?: Array<{ brand?: string; context?: string }>;
  sentiment?: string | null;
  buying_intent?: string | null;
  /** Slice 2.5 — structured escalation signal extracted from the transcript. */
  escalation?: {
    issue?: string | null;
    department?: string | null;
    severity?: string | null;
  } | null;
}

interface VoiceQrmExtraction {
  contact?: VoiceQrmContact;
  company?: VoiceQrmCompany;
  needs_assessment?: VoiceQrmNeedsAssessment;
  deal?: VoiceQrmDeal;
  /** Additional deals beyond the primary (multi-deal extraction) */
  additional_deals?: VoiceQrmDeal[];
  /** Equipment mentioned in voice (current fleet, trade-in, interest) */
  equipment_mentions?: VoiceQrmEquipmentMention[];
  /** Budget/fiscal timeline captured from conversation */
  budget_timeline?: VoiceQrmBudgetTimeline;
  /** Future-dated tasks extracted from voice (e.g., "call in August") */
  future_tasks?: VoiceQrmFutureTask[];
  intelligence?: VoiceQrmIntelligence;
  qrm_narrative?: string;
  content_type?: string;
  follow_up_suggestions?: string[];
}

// Enhanced extraction schema per QEP-OS-Build-Roadmap-LLM.md lines 177-219
const EXTRACTION_PROMPT_TEMPLATE = (transcript: string) => `You are a QRM (Quality Relationship Manager) data extraction assistant for QEP, a heavy equipment dealership.
A sales rep (Iron Advisor) just recorded a field note about a customer interaction. Extract ALL available information.

Transcript:
"""
${transcript}
"""

Rules:
- Return ONLY valid JSON matching the schema below.
- If something is not clearly stated, use null.
- Do NOT fabricate data. Only extract what is explicitly mentioned or strongly implied.
- For the qrm_narrative: write a professional first-person summary in this exact style:
  "I spoke to [Name] with [Company] of [Location]. He/she is interested in [Equipment] for [Application]..."
  Include all relevant details: equipment interest, current equipment issues, timeline, budget, financing preference, trade-in, decision maker status, and next steps.

Return ONLY valid JSON:
{
  "contact": {
    "first_name": "string or null",
    "last_name": "string or null",
    "role": "string or null (owner, operator, manager, etc.)",
    "phone": "string or null",
    "email": "string or null"
  },
  "company": {
    "name": "string or null",
    "location": "string or null"
  },
  "needs_assessment": {
    "application": "string or null (land clearing, tree service, excavation, etc.)",
    "terrain_material": "string or null",
    "machine_interest": "string or null (Yanmar ViO 55, etc.)",
    "attachments_needed": ["strings"],
    "brand_preference": "string or null",
    "current_equipment": "string or null",
    "current_equipment_issues": "string or null",
    "timeline": "string or null (end of month, ASAP, Q3)",
    "timeline_urgency": "urgent | normal | flexible | null",
    "budget_amount": "number or null",
    "budget_type": "cash | financing | lease | null",
    "monthly_payment_target": "number or null",
    "financing_preference": "string or null (0% financing, etc.)",
    "trade_in": "boolean or null",
    "trade_in_details": "string or null",
    "decision_maker": "boolean or null",
    "decision_maker_name": "string or null"
  },
  "deal": {
    "next_step": "quote | demo | credit_application | site_visit | follow_up | null",
    "stage_suggestion": "number 1-21 or null",
    "estimated_value": "number or null"
  },
  "intelligence": {
    "competitor_mentions": [{"brand": "string", "context": "string"}],
    "sentiment": "positive | neutral | negative",
    "buying_intent": "high | medium | low",
    "escalation": {
      "issue": "string — concise description of the customer complaint or failure, or null",
      "department": "Service | Parts | Warranty | Sales | Credit | null",
      "severity": "high | medium | low — based on business impact and tone, or null"
    }
  },
  "qrm_narrative": "string — professional first-person summary in the owner's format",
  "content_type": "sales | parts | service | process_improvement | general — classify the PRIMARY purpose of this voice note",
  "follow_up_suggestions": ["string — 1-3 specific actionable follow-up steps based on the conversation"],
  "additional_deals": [
    {
      "description": "string — e.g. 'Second unit for crew 2'",
      "machine_interest": "string — machine model",
      "quantity": "number",
      "estimated_value": "number or null",
      "next_step": "quote | demo | credit_application | site_visit | follow_up | null",
      "stage_suggestion": "number 1-21 or null"
    }
  ],
  "equipment_mentions": [
    {
      "make": "string — manufacturer (e.g. 'Tigercat')",
      "model": "string — model number (e.g. '620E')",
      "year": "number or null",
      "hours": "number or null",
      "mentioned_as": "current_fleet | trade_in | competitor | interest",
      "raw_mention": "string — short quote from transcript"
    }
  ],
  "budget_timeline": {
    "cycle_month": "number 1-12 — month when budget opens (e.g. 'budget opens October' → 10), null if not mentioned",
    "fiscal_year_end_month": "number 1-12 — fiscal year end month, null if not mentioned",
    "notes": "string — original language about budget timing"
  },
  "future_tasks": [
    {
      "title": "string — e.g. 'Call about Q4 budget'",
      "description": "string",
      "scheduled_for": "YYYY-MM-DD — specific date extracted from phrases like 'call in August' → pick a reasonable date"
    }
  ]
}

IMPORTANT:
- If the rep mentions MULTIPLE equipment needs ("they need two units", "also want a second machine"), create ONE primary deal AND populate additional_deals.
- Extract ALL equipment the rep mentions (current fleet, trade-ins, what they're interested in) into equipment_mentions.
- If the rep says "budget opens October" or similar, extract cycle_month as 10.
- If the rep says "call me in August" or "follow up in 3 months", compute an actual date for scheduled_for.`;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  const pipelineStart = Date.now();

  try {
    // Canonical ES256-safe JWT auth; tighten to rep/manager/owner (no admin).
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    if (!["rep", "manager", "owner"].includes(auth.role)) {
      return safeJsonError("Your role does not have access to voice-to-QRM.", 403, origin);
    }
    const supabase = auth.supabase;
    const user = { id: auth.userId };

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const workspace = await resolveProfileActiveWorkspaceId(supabaseAdmin, user.id);

    // ── 1. Parse multipart form data ───���──────────────────────────────────
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return safeJsonError("Expected multipart/form-data", 400, origin);
    }

    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;
    const dealIdParam = formData.get("deal_id") as string | null;

    if (!audioFile) {
      return safeJsonError("audio field is required", 400, origin);
    }

    if (audioFile.size > 50 * 1024 * 1024) {
      return safeJsonError("Audio file exceeds 50MB limit", 400, origin);
    }

    // ── 2. Upload audio to storage ────────��───────────────────────────────
    const audioBuffer = await audioFile.arrayBuffer();
    const ext = audioFile.name?.split(".").pop() || "webm";
    const storagePath = `voice-qrm/${user.id}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("voice-captures")
      .upload(storagePath, audioBuffer, {
        contentType: audioFile.type || "audio/webm",
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return safeJsonError("Failed to store audio file", 500, origin);
    }

    // ── 3. Transcribe via Whisper ─────────────��───────────────────────────
    const openAiKey = OPENAI_API_KEY || Deno.env.get("OPENAI_KEY");
    if (!openAiKey) {
      return safeJsonError("OpenAI API key not configured", 500, origin);
    }

    const whisperForm = new FormData();
    whisperForm.append("file", new File([audioBuffer], `recording.${ext}`, { type: audioFile.type || "audio/webm" }));
    whisperForm.append("model", "whisper-1");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: whisperForm,
      signal: AbortSignal.timeout(30_000),
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error("Whisper error:", errText);
      return safeJsonError("Transcription failed", 500, origin);
    }

    const whisperData = await whisperRes.json();
    const transcript = whisperData.text?.trim() ?? "";

    if (!transcript) {
      return safeJsonError("No speech detected in the recording.", 422, origin);
    }

    // ── 3.5. Idea / process-improvement short-circuit ─────────────────────
    // Two-pass detection:
    //   Pass A: regex over known lead phrases (fast, zero network cost)
    //   Pass B: GPT-4o-mini classifier if regex missed and transcript is
    //           short enough (<300 chars) that it's PROBABLY a standalone
    //           thought rather than customer field notes
    //
    // The classifier also buckets the idea into a category so we can
    // later route by tag.
    const ideaSignal = await detectIdea(transcript, openAiKey);

    if (ideaSignal.isIdea) {
      const rawTitle = ideaSignal.title || transcript.substring(0, 200);
      const title = rawTitle.substring(0, 200) || "Captured idea";
      const body = transcript.length > title.length ? transcript : null;

      const tagsArray: string[] = [];
      if (ideaSignal.category) tagsArray.push(ideaSignal.category);
      if (ideaSignal.matchedVia) tagsArray.push(`detected:${ideaSignal.matchedVia}`);

      const { data: ideaRow, error: ideaErr } = await supabaseAdmin
        .from("qrm_idea_backlog")
        .insert({
          workspace_id: workspace,
          title,
          body,
          source: "voice",
          status: "new",
          priority: ideaSignal.priority ?? "medium",
          tags: tagsArray,
          captured_by: user.id,
          ai_confidence: ideaSignal.confidence,
        })
        .select("id")
        .single();

      if (ideaErr) {
        console.error("[voice-to-qrm] idea backlog insert failed:", ideaErr);
        // Fall through to normal extraction — don't lose the transcript
      } else {
        return safeJsonOk({
          routed_to: "idea_backlog",
          idea_id: ideaRow?.id,
          title,
          transcript,
          category: ideaSignal.category,
          confidence: ideaSignal.confidence,
          matched_via: ideaSignal.matchedVia,
        }, origin);
      }
    }

    // ── 4. Extract structured data via enhanced GPT prompt ────────────────
    const extractionStart = Date.now();

    const extractionRes = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content: "Extract QRM-ready dealership field-note data. Return valid JSON only.",
          },
          { role: "user", content: EXTRACTION_PROMPT_TEMPLATE(transcript) },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!extractionRes.ok) {
      const errText = await extractionRes.text();
      console.error("Extraction error:", errText);
      return safeJsonError("Data extraction failed", 500, origin);
    }

    const extractionData = await extractionRes.json();
    const rawJson = extractionData.choices?.[0]?.message?.content?.trim();
    if (!rawJson) {
      return safeJsonError("Extraction returned no content", 500, origin);
    }

    let extracted: VoiceQrmExtraction;
    try {
      extracted = JSON.parse(rawJson) as VoiceQrmExtraction;
    } catch (parseErr) {
      console.error("voice-to-qrm JSON parse failed:", parseErr, "raw:", rawJson?.substring(0, 500));
      return safeJsonError("Data extraction returned malformed JSON", 422, origin);
    }
    const extractionDuration = Date.now() - extractionStart;

    // ── 5. Entity resolution: fuzzy match or create ───────────────────────
    const entityStart = Date.now();
    const errors: string[] = [];
    // 5a. Company resolution
    let companyId: string | null = null;
    let companyMatchMethod: string | null = null;
    let companyConfidence: number | null = null;

    if (extracted.company?.name) {
      const { data: companyMatches } = await supabaseAdmin
        .rpc("fuzzy_match_company", {
          p_workspace_id: workspace,
          p_company_name: extracted.company.name,
        });

      if (companyMatches && companyMatches.length > 0 && companyMatches[0].name_similarity >= 0.5) {
        companyId = companyMatches[0].company_id;
        companyMatchMethod = companyMatches[0].match_method;
        companyConfidence = companyMatches[0].name_similarity;
      } else {
        // Auto-create company
        const { data: newCompany, error: companyError } = await supabaseAdmin
          .from("crm_companies")
          .insert({
            workspace_id: workspace,
            name: extracted.company.name,
            metadata: extracted.company.location
              ? { location: extracted.company.location }
              : {},
          })
          .select("id")
          .single();

        if (companyError) {
          errors.push(`Company creation failed: ${companyError.message}`);
        } else {
          companyId = newCompany.id;
          companyMatchMethod = "created";
          companyConfidence = 1.0;
        }
      }
    }

    // 5b. Contact resolution
    let contactId: string | null = null;
    let contactMatchMethod: string | null = null;
    let contactConfidence: number | null = null;

    if (extracted.contact?.first_name || extracted.contact?.last_name) {
      const { data: contactMatches } = await supabaseAdmin
        .rpc("fuzzy_match_contact", {
          p_workspace_id: workspace,
          p_first_name: extracted.contact.first_name || "",
          p_last_name: extracted.contact.last_name || "",
        });

      if (contactMatches && contactMatches.length > 0 && contactMatches[0].name_similarity >= 0.5) {
        contactId = contactMatches[0].contact_id;
        contactMatchMethod = contactMatches[0].match_method;
        contactConfidence = contactMatches[0].name_similarity;
      } else {
        // Auto-create contact
        const { data: newContact, error: contactError } = await supabaseAdmin
          .from("crm_contacts")
          .insert({
            workspace_id: workspace,
            first_name: extracted.contact.first_name,
            last_name: extracted.contact.last_name,
            company_id: companyId,
            metadata: {
              ...(extracted.contact.role ? { role: extracted.contact.role } : {}),
              ...(extracted.contact.phone ? { phone: extracted.contact.phone } : {}),
              ...(extracted.contact.email ? { email: extracted.contact.email } : {}),
            },
          })
          .select("id")
          .single();

        if (contactError) {
          errors.push(`Contact creation failed: ${contactError.message}`);
        } else {
          contactId = newContact.id;
          contactMatchMethod = "created";
          contactConfidence = 1.0;
        }
      }
    }

    // 5c. Deal resolution
    let dealId: string | null = dealIdParam;
    let dealAction: string | null = null;

    if (!dealId) {
      // Determine pipeline stage
      let stageId: string | null = null;
      const suggestedStage = extracted.deal?.stage_suggestion || 3; // Default to Needs Assessment

      const { data: stage } = await supabaseAdmin
        .from("crm_deal_stages")
        .select("id")
        .eq("workspace_id", workspace)
        .eq("sort_order", suggestedStage)
        .single();

      if (stage) stageId = stage.id;

      if (stageId) {
        const dealName = extracted.company?.name
          ? `${extracted.company.name} - ${extracted.needs_assessment?.machine_interest || "New Opportunity"}`
          : `${extracted.contact?.first_name || "New"} ${extracted.contact?.last_name || "Deal"}`;

        const { data: newDeal, error: dealError } = await supabaseAdmin
          .from("crm_deals")
          .insert({
            workspace_id: workspace,
            name: dealName,
            stage_id: stageId,
            primary_contact_id: contactId,
            company_id: companyId,
            assigned_rep_id: user.id,
            amount: extracted.deal?.estimated_value || null,
          })
          .select("id")
          .single();

        if (dealError) {
          errors.push(`Deal creation failed: ${dealError.message}`);
        } else {
          dealId = newDeal.id;
          dealAction = "created";
        }
      }
    } else {
      dealAction = "matched";
      // Update existing deal with any new info
      const updates: Record<string, unknown> = {};
      if (contactId && !dealIdParam) updates.primary_contact_id = contactId;
      if (companyId) updates.company_id = companyId;
      if (extracted.deal?.estimated_value) updates.amount = extracted.deal.estimated_value;

      if (Object.keys(updates).length > 0) {
        await supabaseAdmin
          .from("crm_deals")
          .update(updates)
          .eq("id", dealId);
        dealAction = "updated";
      }
    }

    // ── 6. Create needs assessment ───────────��────────────────────────────
    let needsAssessmentId: string | null = null;
    const na = extracted.needs_assessment;

    if (dealId && na) {
      const { data: assessment, error: naError } = await supabaseAdmin
        .from("needs_assessments")
        .insert({
          workspace_id: workspace,
          deal_id: dealId,
          contact_id: contactId,
          application: na.application,
          work_type: na.application, // Alias
          terrain_material: na.terrain_material,
          current_equipment: na.current_equipment,
          current_equipment_issues: na.current_equipment_issues,
          machine_interest: na.machine_interest,
          attachments_needed: na.attachments_needed || [],
          brand_preference: na.brand_preference,
          timeline_description: na.timeline,
          timeline_urgency: na.timeline_urgency,
          budget_type: na.budget_type,
          budget_amount: na.budget_amount,
          monthly_payment_target: na.monthly_payment_target,
          financing_preference: na.financing_preference,
          has_trade_in: na.trade_in || false,
          trade_in_details: na.trade_in_details,
          is_decision_maker: na.decision_maker,
          decision_maker_name: na.decision_maker_name,
          next_step: na.next_step || extracted.deal?.next_step,
          entry_method: "voice",
          qrm_narrative: extracted.qrm_narrative,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (naError) {
        errors.push(`Needs assessment creation failed: ${naError.message}`);
      } else {
        needsAssessmentId = assessment.id;

        // Link to deal
        await supabaseAdmin
          .from("crm_deals")
          .update({ needs_assessment_id: assessment.id })
          .eq("id", dealId);
      }
    }

    // ── 7. Create follow-up cadence ──────────���────────────────────────────
    let cadenceId: string | null = null;

    if (dealId) {
      const { data: cadenceResult, error: cadenceError } = await supabaseAdmin
        .rpc("create_sales_cadence", {
          p_deal_id: dealId,
          p_contact_id: contactId,
          p_assigned_to: user.id,
          p_workspace_id: workspace,
        });

      if (cadenceError) {
        errors.push(`Cadence creation failed: ${cadenceError.message}`);
      } else if (cadenceResult) {
        cadenceId = cadenceResult;
      }
    }

    // ── 7b. Multi-deal extraction ──────────────────────────────────────────
    const additionalDealIds: string[] = [];
    if (Array.isArray(extracted.additional_deals) && extracted.additional_deals.length > 0) {
      // Find a stage id for default sort_order = 3 (needs assessment)
      const { data: fallbackStage } = await supabaseAdmin
        .from("crm_deal_stages")
        .select("id")
        .eq("workspace_id", workspace)
        .eq("sort_order", 3)
        .maybeSingle();

      for (const extraDeal of extracted.additional_deals) {
        let extraStageId: string | null = fallbackStage?.id ?? null;
        if (extraDeal.stage_suggestion) {
          const { data: specificStage } = await supabaseAdmin
            .from("crm_deal_stages")
            .select("id")
            .eq("workspace_id", workspace)
            .eq("sort_order", extraDeal.stage_suggestion)
            .maybeSingle();
          if (specificStage) extraStageId = specificStage.id;
        }

        if (!extraStageId) continue;

        const extraName = extraDeal.description
          || (extracted.company?.name ? `${extracted.company.name} — ${extraDeal.machine_interest || "Additional Unit"}` : "Additional Opportunity");

        const { data: extraDealRow, error: extraDealErr } = await supabaseAdmin
          .from("crm_deals")
          .insert({
            workspace_id: workspace,
            name: extraName,
            stage_id: extraStageId,
            primary_contact_id: contactId,
            company_id: companyId,
            assigned_rep_id: user.id,
            amount: extraDeal.estimated_value || null,
          })
          .select("id")
          .single();

        if (extraDealErr) {
          errors.push(`Additional deal creation failed: ${extraDealErr.message}`);
        } else if (extraDealRow) {
          additionalDealIds.push(extraDealRow.id);
        }
      }
    }

    // ── 7c. Equipment mentions: deferred until after voice_capture insert ──
    // (See section 8b — needs voice_capture_id)
    const extractedEquipmentIds: string[] = [];
    const createdCrmEquipmentIds: string[] = [];

    // ── 7d. Budget timeline capture ────────────────────────────────────────
    let budgetCaptured = false;
    if (extracted.budget_timeline && (extracted.budget_timeline.cycle_month || extracted.budget_timeline.fiscal_year_end_month)) {
      if (companyId) {
        // Upsert customer_profiles_extended with budget fields (matched by company_name)
        const { data: existingProfile } = await supabaseAdmin
          .from("customer_profiles_extended")
          .select("id")
          .eq("company_name", extracted.company?.name ?? "")
          .maybeSingle();

        if (existingProfile) {
          await supabaseAdmin
            .from("customer_profiles_extended")
            .update({
              budget_cycle_month: extracted.budget_timeline.cycle_month ?? undefined,
              fiscal_year_end_month: extracted.budget_timeline.fiscal_year_end_month ?? undefined,
              budget_cycle_notes: extracted.budget_timeline.notes ?? undefined,
            })
            .eq("id", existingProfile.id);
          budgetCaptured = true;
        } else if (extracted.company?.name) {
          // Create new profile with budget timeline
          await supabaseAdmin
            .from("customer_profiles_extended")
            .insert({
              customer_name: extracted.company.name,
              company_name: extracted.company.name,
              budget_cycle_month: extracted.budget_timeline.cycle_month ?? null,
              fiscal_year_end_month: extracted.budget_timeline.fiscal_year_end_month ?? null,
              budget_cycle_notes: extracted.budget_timeline.notes ?? null,
            });
          budgetCaptured = true;
        }
      }
    }

    // ── 7e. Future-dated follow-up tasks ────────────────────────────────────
    const scheduledFollowUpIds: string[] = [];
    if (Array.isArray(extracted.future_tasks) && extracted.future_tasks.length > 0) {
      for (const task of extracted.future_tasks) {
        if (!task.title || !task.scheduled_for) continue;

        // Validate date format
        const taskDate = new Date(task.scheduled_for);
        if (isNaN(taskDate.getTime())) continue;

        const { data: futureTask, error: taskErr } = await supabaseAdmin
          .from("scheduled_follow_ups")
          .insert({
            workspace_id: workspace,
            assigned_to: user.id,
            created_by: user.id,
            deal_id: dealId,
            contact_id: contactId,
            company_id: companyId,
            title: task.title,
            description: task.description || null,
            scheduled_for: task.scheduled_for,
            source: "voice_extraction",
            extraction_confidence: 0.8,
          })
          .select("id")
          .single();

        if (taskErr) {
          errors.push(`Future task creation failed: ${taskErr.message}`);
        } else if (futureTask) {
          scheduledFollowUpIds.push(futureTask.id);
        }
      }
    }

    // ── 8. Save voice capture record ───────────��──────────────────────────
    const { data: capture } = await supabaseAdmin
      .from("voice_captures")
      .insert({
        user_id: user.id,
        workspace_id: workspace,
        audio_url: storagePath,
        transcript,
        extracted_data: extracted,
        sync_status: "completed",
        deal_id: dealId,
      })
      .select("id")
      .single();

    // ── 8b. Equipment mentions → crm_equipment + voice_extracted_equipment ──
    // For current_fleet / trade_in mentions tied to a known company we create
    // a first-class crm_equipment row so the machine becomes addressable
    // throughout the dealership (parts, service, fleet view, deal linking).
    // Every mention is also recorded in voice_extracted_equipment for audit.
    if (capture && Array.isArray(extracted.equipment_mentions) && extracted.equipment_mentions.length > 0) {
      for (const eq of extracted.equipment_mentions) {
        if (!eq.make && !eq.model) continue;

        let crmEquipmentId: string | null = null;
        const shouldCreateCrmEquipment =
          companyId &&
          (eq.mentioned_as === "current_fleet" || eq.mentioned_as === "trade_in");

        if (shouldCreateCrmEquipment) {
          const equipmentName = [eq.year, eq.make, eq.model]
            .filter((v) => v != null && v !== "")
            .join(" ") || (eq.model || eq.make || "Equipment");

          const { data: crmEqRow, error: crmEqErr } = await supabaseAdmin
            .from("crm_equipment")
            .insert({
              workspace_id: workspace,
              company_id: companyId,
              primary_contact_id: contactId,
              name: equipmentName,
              make: eq.make || null,
              model: eq.model || null,
              year: eq.year || null,
              engine_hours: eq.hours || null,
              ownership: eq.mentioned_as === "trade_in" ? "customer_owned" : "customer_owned",
              availability: "available",
              metadata: {
                source: "voice_extraction",
                voice_capture_id: capture.id,
                raw_mention: eq.raw_mention || null,
              },
            })
            .select("id")
            .single();

          if (crmEqErr) {
            errors.push(`crm_equipment insert failed: ${crmEqErr.message}`);
          } else if (crmEqRow) {
            crmEquipmentId = crmEqRow.id;
            createdCrmEquipmentIds.push(crmEqRow.id);

            // Link trade-in to the deal via crm_deal_equipment if applicable
            if (eq.mentioned_as === "trade_in" && dealId) {
              await supabaseAdmin.from("crm_deal_equipment").insert({
                workspace_id: workspace,
                deal_id: dealId,
                equipment_id: crmEqRow.id,
                role: "trade_in",
              });
            }
          }
        }

        const { data: eqRow, error: eqErr } = await supabaseAdmin
          .from("voice_extracted_equipment")
          .insert({
            workspace_id: workspace,
            voice_capture_id: capture.id,
            company_id: companyId,
            crm_equipment_id: crmEquipmentId,
            make: eq.make || null,
            model: eq.model || null,
            year: eq.year || null,
            hours: eq.hours || null,
            mentioned_as: eq.mentioned_as || "interest",
            raw_mention: eq.raw_mention || null,
            linked_deal_id: dealId,
          })
          .select("id")
          .single();

        if (eqErr) {
          errors.push(`Equipment extraction failed: ${eqErr.message}`);
        } else if (eqRow) {
          extractedEquipmentIds.push(eqRow.id);
        }
      }
    }

    // ── 9. Save QRM result audit trail ─────────────���──────────────────────
    const entityDuration = Date.now() - entityStart;
    const totalDuration = Date.now() - pipelineStart;

    // Map sentiment to numeric score (used in result + response)
    const sentimentMap: Record<string, number> = { positive: 0.8, neutral: 0.5, negative: 0.2 };

    if (capture) {
      const sentimentScore = sentimentMap[extracted.intelligence?.sentiment ?? ""] ?? null;

      await supabaseAdmin.from("voice_qrm_results").insert({
        workspace_id: workspace,
        voice_capture_id: capture.id,
        contact_id: contactId,
        contact_match_method: contactMatchMethod,
        contact_match_confidence: contactConfidence,
        company_id: companyId,
        company_match_method: companyMatchMethod,
        company_match_confidence: companyConfidence,
        deal_id: dealId,
        deal_action: dealAction,
        needs_assessment_id: needsAssessmentId,
        cadence_id: cadenceId,
        qrm_narrative: extracted.qrm_narrative,
        additional_deal_ids: additionalDealIds,
        extracted_equipment_ids: extractedEquipmentIds,
        scheduled_follow_up_ids: scheduledFollowUpIds,
        budget_cycle_captured: budgetCaptured,
        sentiment_score: sentimentScore,
        content_type: extracted.content_type ?? "general",
        follow_up_suggestions: extracted.follow_up_suggestions ?? [],
        extraction_duration_ms: extractionDuration,
        entity_creation_duration_ms: entityDuration,
        total_duration_ms: totalDuration,
        errors: errors.length > 0 ? errors : [],
      });

      // Smart routing: notify appropriate department based on content type
      const contentType = extracted.content_type ?? "general";
      if (contentType !== "general") {
        const { data: routingRule } = await supabaseAdmin
          .from("voice_routing_rules")
          .select("route_to_role, route_to_user_id")
          .eq("workspace_id", workspace)
          .eq("content_type", contentType)
          .eq("is_active", true)
          .maybeSingle();

        if (routingRule) {
          // Find users matching the target role
          const targetUsers: string[] = [];
          if (routingRule.route_to_user_id) {
            targetUsers.push(routingRule.route_to_user_id);
          } else if (routingRule.route_to_role) {
            const { data: roleUsers } = await supabaseAdmin
              .from("profiles")
              .select("id")
              .eq("iron_role", routingRule.route_to_role)
              .limit(5);
            if (roleUsers) targetUsers.push(...roleUsers.map((u: { id: string }) => u.id));
          }

          const snippet = extracted.qrm_narrative?.substring(0, 200) || "New voice capture routed to your department.";

          // Notifications still fire for in-app visibility
          for (const uid of targetUsers) {
            await supabaseAdmin.from("crm_in_app_notifications").insert({
              workspace_id: workspace,
              user_id: uid,
              kind: "voice_routing",
              title: `Voice Note: ${contentType.replace(/_/g, " ")}`,
              body: snippet,
              deal_id: dealId,
              metadata: {
                voice_capture_id: capture.id,
                content_type: contentType,
                sentiment_score: sentimentScore,
              },
            });
          }

          // ── Create actual downstream work (not just notifications) ────
          // For non-sales content types, create a scheduled follow-up task
          // assigned to the target user so it shows up in their task list.
          const shouldCreateTask = ["parts", "service", "process_improvement"].includes(contentType);
          if (shouldCreateTask && targetUsers.length > 0) {
            const primaryAssignee = targetUsers[0];
            const taskTitle = contentType === "parts"
              ? `Parts request from voice capture`
              : contentType === "service"
                ? `Service issue from voice capture`
                : `Process improvement idea from voice capture`;

            const { data: routedTask, error: routedTaskErr } = await supabaseAdmin
              .from("scheduled_follow_ups")
              .insert({
                workspace_id: workspace,
                assigned_to: primaryAssignee,
                created_by: user.id,
                deal_id: dealId,
                contact_id: contactId,
                company_id: companyId,
                voice_capture_id: capture.id,
                title: taskTitle,
                description: snippet,
                scheduled_for: new Date().toISOString().split("T")[0],
                source: "voice_extraction",
                extraction_confidence: 0.9,
              })
              .select("id")
              .single();

            if (routedTaskErr) {
              errors.push(`Routed task creation failed: ${routedTaskErr.message}`);
            } else if (routedTask) {
              scheduledFollowUpIds.push(routedTask.id);
            }
          }
        }
      }
    }

    // ── 10. Create QRM activity note ──────────────────────────────────────
    // crm_activities_check: exactly one of contact_id / deal_id / company_id (migration 021).
    if (dealId) {
      await supabaseAdmin.from("crm_activities").insert({
        workspace_id: workspace,
        activity_type: "note",
        body: extracted.qrm_narrative || `Voice capture: ${transcript.substring(0, 500)}`,
        deal_id: dealId,
        contact_id: null,
        company_id: null,
        created_by: user.id,
        metadata: {
          source: "voice_to_qrm",
          voice_capture_id: capture?.id,
          buying_intent: extracted.intelligence?.buying_intent,
          sentiment: extracted.intelligence?.sentiment,
          resolved_contact_id: contactId,
          resolved_company_id: companyId,
        },
      });
    }

    // ── 11. Voice → Escalation (Slice 2.5) ──────────────────────────────────
    // When the transcript carries a credible escalation signal, fire the
    // existing escalation-router function fire-and-forget so the rep's
    // voice capture can close without waiting on OpenAI + email drafting.
    // Failures are logged but do not fail the voice pipeline — a missed
    // escalation is a soft failure; a failed voice capture is a hard one.
    let escalationTriggered = false;
    const escalationPayload = detectEscalationFromVoice(extracted, {
      dealId,
      contactId,
    });
    if (escalationPayload) {
      escalationTriggered = true;
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (supabaseUrl && serviceRoleKey) {
        // Fire-and-forget: do not await. Errors are captured in Sentry.
        fetch(`${supabaseUrl}/functions/v1/escalation-router`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            deal_id: escalationPayload.deal_id,
            contact_id: escalationPayload.contact_id ?? undefined,
            issue_description: escalationPayload.issue_description,
            department: escalationPayload.department ?? undefined,
            severity: escalationPayload.severity ?? undefined,
            source: escalationPayload.source,
            detection_reason: escalationPayload.reason,
            voice_capture_id: capture?.id ?? null,
          }),
        }).catch((err) => {
          console.error("[voice-to-qrm] escalation dispatch failed:", err);
          captureEdgeException(err, {
            fn: "voice-to-qrm",
            extra: {
              stage: "escalation_dispatch",
              deal_id: escalationPayload.deal_id,
              reason: escalationPayload.reason,
            },
          });
        });
      }
    }

    return safeJsonOk({
      success: true,
      pipeline_duration_ms: totalDuration,
      transcript,
      qrm_narrative: extracted.qrm_narrative,
      escalation_triggered: escalationTriggered,
      escalation_reason: escalationPayload?.reason ?? null,
      entities: {
        contact: {
          id: contactId,
          match_method: contactMatchMethod,
          confidence: contactConfidence,
          name: `${extracted.contact?.first_name || ""} ${extracted.contact?.last_name || ""}`.trim(),
        },
        company: {
          id: companyId,
          match_method: companyMatchMethod,
          confidence: companyConfidence,
          name: extracted.company?.name,
        },
        deal: {
          id: dealId,
          action: dealAction,
          stage_suggestion: extracted.deal?.stage_suggestion,
        },
        needs_assessment: {
          id: needsAssessmentId,
          completeness: na ? Object.values(na).filter(v => v != null && v !== false && !(Array.isArray(v) && v.length === 0)).length : 0,
        },
        cadence: { id: cadenceId },
        additional_deals: { count: additionalDealIds.length, ids: additionalDealIds },
        equipment: {
          count: extractedEquipmentIds.length,
          ids: extractedEquipmentIds,
          crm_equipment_ids: createdCrmEquipmentIds,
        },
        scheduled_follow_ups: { count: scheduledFollowUpIds.length, ids: scheduledFollowUpIds },
        budget_timeline_captured: budgetCaptured,
      },
      intelligence: extracted.intelligence,
      content_type: extracted.content_type ?? "general",
      follow_up_suggestions: extracted.follow_up_suggestions ?? [],
      sentiment_score: sentimentMap[extracted.intelligence?.sentiment ?? ""] ?? null,
      voice_capture_id: capture?.id,
      errors: errors.length > 0 ? errors : undefined,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "voice-to-qrm", req });
    console.error("voice-to-qrm error:", err);
    // Log full error server-side, return generic message to client
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});

/* ── Idea detection helpers (Enhancement 2) ─────────────────────── */

type IdeaCategory = "idea" | "process_improvement" | "bug_report" | "feature_request";

interface IdeaSignal {
  isIdea: boolean;
  title?: string;
  category?: IdeaCategory;
  confidence: number;
  priority?: "low" | "medium" | "high" | "critical";
  matchedVia?: "regex" | "classifier";
}

const IDEA_LEAD_PATTERNS: Array<{ re: RegExp; category: IdeaCategory }> = [
  { re: /^\s*idea\s*[:\-]/i,                                          category: "idea" },
  { re: /^\s*process\s+improvement\s*[:\-]/i,                         category: "process_improvement" },
  { re: /^\s*bug\s*[:\-]/i,                                           category: "bug_report" },
  { re: /^\s*feature\s+request\s*[:\-]/i,                             category: "feature_request" },
  { re: /^\s*we\s+should\b/i,                                         category: "idea" },
  { re: /^\s*we\s+need\s+to\b/i,                                      category: "process_improvement" },
  { re: /^\s*(?:can|could)\s+we\s+(?:add|build|improve|change)\b/i,   category: "feature_request" },
  { re: /^\s*(?:here['']?s|here\s+is)\s+an?\s+idea\b/i,               category: "idea" },
  { re: /^\s*what\s+if\s+we\b/i,                                      category: "idea" },
  { re: /^\s*one\s+thing\s+that\s+(?:bugs|annoys|bothers)\s+me\b/i,   category: "bug_report" },
];

/**
 * Two-pass idea detector:
 *   Pass A (regex, zero-cost) — known lead phrases
 *   Pass B (GPT classifier, only for short transcripts) — natural phrasings
 */
async function detectIdea(transcript: string, openAiKey: string): Promise<IdeaSignal> {
  // Pass A: regex — fast path
  for (const { re, category } of IDEA_LEAD_PATTERNS) {
    if (re.test(transcript)) {
      const firstSentence = transcript.match(/^[^.!?\n]+/)?.[0] ?? transcript.substring(0, 200);
      const cleanedTitle = firstSentence
        .replace(/^\s*(idea|process improvement|bug|feature request)\s*[:\-]\s*/i, "")
        .replace(/^\s*we\s+should\s+/i, "")
        .replace(/^\s*we\s+need\s+to\s+/i, "")
        .trim();
      return {
        isIdea: true,
        title: cleanedTitle,
        category,
        confidence: 0.9,
        priority: "medium",
        matchedVia: "regex",
      };
    }
  }

  // Pass B: GPT classifier — only for transcripts short enough to
  // plausibly be a standalone thought. Anything longer is probably
  // field notes and should flow through the full QRM extraction.
  if (transcript.length > 300 || !openAiKey) {
    return { isIdea: false, confidence: 0 };
  }

  try {
    const classifierRes = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content: `You classify short voice transcripts from a heavy equipment dealership's internal tools.
Decide if the transcript is:
  A. A customer field note / activity capture (deal, contact, equipment observation, sales call recap)
  B. An internal IDEA, process improvement, bug report, or feature request

Output JSON only:
{
  "is_idea": boolean,
  "category": "idea" | "process_improvement" | "bug_report" | "feature_request" | null,
  "title": "string ≤120 chars, imperative phrasing",
  "confidence": 0.0-1.0,
  "priority": "low" | "medium" | "high" | "critical"
}

Examples:
- "What if we automated the PM reminders?" → idea, 0.85 confidence
- "Met with Acme, they want to trade in the DX225" → NOT an idea (field note)
- "The quote builder is broken on mobile" → bug_report, 0.95 confidence
- "Budget opens October for Bob's Excavating" → NOT an idea (timing note)
Lean toward is_idea=false when uncertain.`,
          },
          { role: "user", content: transcript },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!classifierRes.ok) return { isIdea: false, confidence: 0 };
    const data = await classifierRes.json();
    const rawContent = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(rawContent);

    if (parsed.is_idea && (parsed.confidence ?? 0) >= 0.7) {
      return {
        isIdea: true,
        title: typeof parsed.title === "string" ? parsed.title : undefined,
        category: (["idea", "process_improvement", "bug_report", "feature_request"] as const)
          .includes(parsed.category) ? parsed.category : "idea",
        confidence: Number(parsed.confidence),
        priority: (["low", "medium", "high", "critical"] as const)
          .includes(parsed.priority) ? parsed.priority : "medium",
        matchedVia: "classifier",
      };
    }
    return { isIdea: false, confidence: Number(parsed.confidence ?? 0) };
  } catch (err) {
    console.warn("[voice-to-qrm] idea classifier failed:", err);
    return { isIdea: false, confidence: 0 };
  }
}

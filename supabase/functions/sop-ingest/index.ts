/**
 * SOP Ingest Edge Function
 *
 * Moonshot 7 gap closure: AI-powered SOP document parser.
 *
 * Ryan: "I took all those processes, dumped them all in Cowork, and then
 *        it flipped them over to the QEP SOP template."
 *
 * Now QEP OS does it natively. Upload a document → AI parses into
 * sop_templates + sop_steps with trigger, role, and escalation extraction.
 *
 * POST /parse — accepts document text or document_id
 *   Body: { text?: string, document_id?: string, department?: string, title?: string }
 *
 * Auth: admin/manager/owner
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

interface ParsedStep {
  sort_order: number;
  title: string;
  instructions?: string;
  required_role?: string;
  estimated_duration_minutes?: number;
  is_decision_point?: boolean;
  decision_options?: Array<{ label: string; next_step?: number }>;
}

interface ParsedSop {
  title: string;
  description?: string;
  department?: string;
  tags?: string[];
  steps: ParsedStep[];
}

async function parseDocumentToSop(text: string, hintDepartment?: string): Promise<{ parsed: ParsedSop | null; confidence: number; errors: string[] }> {
  if (!OPENAI_API_KEY) {
    return {
      parsed: null,
      confidence: 0,
      errors: ["OpenAI API key not configured — cannot parse SOP documents without AI."],
    };
  }

  const systemPrompt = `You are an SOP (Standard Operating Procedure) parser for QEP, a heavy equipment dealership.

Parse the uploaded document text into a structured SOP with trigger events, steps, responsible roles, decision points, and escalation rules.

Roles at QEP:
- iron_advisor (sales rep / field advisor)
- iron_woman (sales admin / deposits / credit apps)
- iron_man (service tech / equipment prep / PDI)
- iron_manager (sales manager / approvals / oversight)

Return ONLY valid JSON matching this schema:
{
  "title": "SOP title",
  "description": "Brief description of what this SOP covers",
  "department": "sales | service | parts | admin | all",
  "tags": ["tag1", "tag2"],
  "steps": [
    {
      "sort_order": 1,
      "title": "Step name",
      "instructions": "Detailed instructions",
      "required_role": "iron_advisor | iron_woman | iron_man | iron_manager | null",
      "estimated_duration_minutes": 15,
      "is_decision_point": false,
      "decision_options": [{"label": "Yes", "next_step": 3}, {"label": "No", "next_step": 4}]
    }
  ]
}

Rules:
- Extract EVERY step mentioned in the document
- sort_order must be sequential starting from 1
- Set is_decision_point=true when the step has branching logic
- estimated_duration_minutes should be a realistic estimate (5-120)
- Use null for unknown fields, not empty strings`;

  try {
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
          { role: "system", content: systemPrompt },
          { role: "user", content: `Department hint: ${hintDepartment || "unknown"}\n\nDocument text:\n\n${text.substring(0, 15000)}` },
        ],
        max_tokens: 2000,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { parsed: null, confidence: 0, errors: [`OpenAI error: ${errText}`] };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return { parsed: null, confidence: 0, errors: ["Empty response from OpenAI"] };
    }

    const parsed = JSON.parse(content) as ParsedSop;

    // Basic validation
    if (!parsed.title || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return { parsed: null, confidence: 0.3, errors: ["Parsed SOP has no steps or title"] };
    }

    // Confidence heuristic
    const hasRoles = parsed.steps.filter((s) => s.required_role).length / parsed.steps.length;
    const hasInstructions = parsed.steps.filter((s) => s.instructions && s.instructions.length > 10).length / parsed.steps.length;
    const confidence = Math.round((hasRoles * 0.4 + hasInstructions * 0.6) * 100) / 100;

    return { parsed, confidence, errors: [] };
  } catch (err) {
    console.error("sop-ingest parse error:", err);
    return { parsed: null, confidence: 0, errors: [String(err)] };
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) return safeJsonError("Unauthorized", 401, origin);

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
    if (authError || !user) return safeJsonError("Unauthorized", 401, origin);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role, workspace_id")
      .eq("id", user.id)
      .single();

    if (!profile || !["admin", "manager", "owner"].includes(profile.role)) {
      return safeJsonError("SOP ingestion requires admin, manager, or owner role", 403, origin);
    }

    const workspace = profile.workspace_id || "default";

    const body = await req.json();
    let documentText = body.text || "";
    let documentId = body.document_id || null;

    // If a document_id was provided, load its text from documents table
    if (documentId && !documentText) {
      const { data: doc } = await supabaseAdmin
        .from("documents")
        .select("raw_text, title")
        .eq("id", documentId)
        .maybeSingle();
      if (doc) {
        documentText = doc.raw_text || "";
      }
    }

    if (!documentText || documentText.length < 50) {
      return safeJsonError("Document text required (min 50 chars)", 400, origin);
    }

    // Create ingestion run record
    const { data: runRow } = await supabaseAdmin
      .from("sop_ingestion_runs")
      .insert({
        workspace_id: workspace,
        document_id: documentId,
        source_filename: body.source_filename || null,
        status: "pending",
        ai_model: "gpt-4o-mini",
        uploaded_by: user.id,
      })
      .select("id")
      .single();

    // Parse the document
    const { parsed, confidence, errors } = await parseDocumentToSop(documentText, body.department);

    if (!parsed) {
      if (runRow) {
        await supabaseAdmin
          .from("sop_ingestion_runs")
          .update({ status: "failed", parse_errors: errors, parse_confidence: confidence })
          .eq("id", runRow.id);
      }
      return safeJsonError(`Parse failed: ${errors.join("; ")}`, 422, origin);
    }

    // Create the SOP template (draft status)
    const { data: template, error: templateErr } = await supabaseAdmin
      .from("sop_templates")
      .insert({
        workspace_id: workspace,
        title: body.title || parsed.title,
        description: parsed.description || null,
        department: parsed.department || body.department || "all",
        status: "draft",
        document_id: documentId,
        tags: parsed.tags || [],
        created_by: user.id,
      })
      .select("id")
      .single();

    if (templateErr || !template) {
      if (runRow) {
        await supabaseAdmin
          .from("sop_ingestion_runs")
          .update({ status: "failed", parse_errors: [...errors, templateErr?.message || "Template creation failed"] })
          .eq("id", runRow.id);
      }
      return safeJsonError("Template creation failed", 500, origin);
    }

    // Insert steps
    let stepsInserted = 0;
    for (const step of parsed.steps) {
      const { error: stepErr } = await supabaseAdmin
        .from("sop_steps")
        .insert({
          workspace_id: workspace,
          sop_template_id: template.id,
          sort_order: step.sort_order,
          title: step.title,
          instructions: step.instructions || null,
          required_role: step.required_role || null,
          estimated_duration_minutes: step.estimated_duration_minutes || null,
          is_decision_point: step.is_decision_point || false,
          decision_options: step.decision_options || null,
        });
      if (!stepErr) stepsInserted++;
    }

    // Update ingestion run
    if (runRow) {
      await supabaseAdmin
        .from("sop_ingestion_runs")
        .update({
          status: stepsInserted === parsed.steps.length ? "success" : "partial",
          steps_extracted: stepsInserted,
          sop_template_id: template.id,
          parse_confidence: confidence,
        })
        .eq("id", runRow.id);
    }

    return safeJsonOk({
      ok: true,
      template_id: template.id,
      template_title: parsed.title,
      steps_extracted: stepsInserted,
      total_steps_parsed: parsed.steps.length,
      parse_confidence: confidence,
      status: "draft", // Always created as draft — user reviews and publishes
      next_action: "Review the parsed template and publish when ready",
    }, origin);
  } catch (err) {
    console.error("sop-ingest error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});

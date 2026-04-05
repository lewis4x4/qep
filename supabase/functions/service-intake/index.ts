/**
 * Service Intake — AI-assisted service request creation.
 *
 * Receives customer_id + machine_id (or lookup hints), fetches machine
 * history, queries job_codes, and returns diagnosis suggestions.
 *
 * Auth: user JWT
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

interface IntakeRequest {
  customer_id?: string;
  machine_id?: string;
  customer_search?: string;
  machine_search?: string;
  symptom?: string;
  request_type?: string;
}

interface JobCodeSuggestion {
  id: string;
  job_name: string;
  make: string;
  model_family: string | null;
  manufacturer_estimated_hours: number | null;
  shop_average_hours: number | null;
  parts_template: unknown[];
  confidence_score: number | null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;

    const body: IntakeRequest = await req.json();

    // Resolve machine context
    let machine: Record<string, unknown> | null = null;
    if (body.machine_id) {
      const { data } = await supabase
        .from("crm_equipment")
        .select("id, make, model, serial_number, year, category, condition")
        .eq("id", body.machine_id)
        .single();
      machine = data;
    } else if (body.machine_search) {
      const { data } = await supabase
        .from("crm_equipment")
        .select("id, make, model, serial_number, year, category, condition")
        .or(
          `serial_number.ilike.%${body.machine_search}%,model.ilike.%${body.machine_search}%,make.ilike.%${body.machine_search}%`,
        )
        .limit(5);
      if (data && data.length === 1) machine = data[0];
    }

    // Fetch prior service history for this machine
    let serviceHistory: unknown[] = [];
    if (machine?.id) {
      const { data } = await supabase
        .from("service_jobs")
        .select("id, request_type, current_stage, customer_problem_summary, created_at, closed_at")
        .eq("machine_id", machine.id as string)
        .order("created_at", { ascending: false })
        .limit(10);
      serviceHistory = data ?? [];
    }

    // Query matching job codes
    let suggestedJobCodes: JobCodeSuggestion[] = [];
    if (machine?.make) {
      const { data } = await supabase
        .from("job_codes")
        .select("id, job_name, make, model_family, manufacturer_estimated_hours, shop_average_hours, parts_template, confidence_score")
        .eq("make", machine.make as string)
        .order("confidence_score", { ascending: false })
        .limit(10);
      suggestedJobCodes = (data ?? []) as JobCodeSuggestion[];
    }

    // Derive likely parts from top job code template
    const likelyParts: unknown[] = suggestedJobCodes.length > 0
      ? (suggestedJobCodes[0].parts_template ?? [])
      : [];

    // Estimate hours from best match
    const estimatedHours = suggestedJobCodes.length > 0
      ? suggestedJobCodes[0].shop_average_hours ??
        suggestedJobCodes[0].manufacturer_estimated_hours ??
        null
      : null;

    // Determine haul requirement heuristic
    const haulRequired = false; // Default; UI allows override

    // Confidence based on match quality
    let confidence = suggestedJobCodes.length > 0
      ? suggestedJobCodes[0].confidence_score ?? 0.3
      : 0.1;

    let knowledge_notes: Array<{ id: string; content: string; note_type: string }> = [];
    if (machine?.id) {
      const { data: kn } = await supabase
        .from("machine_knowledge_notes")
        .select("id, content, note_type")
        .eq("equipment_id", machine.id as string)
        .order("created_at", { ascending: false })
        .limit(12);
      knowledge_notes = (kn ?? []) as typeof knowledge_notes;
    }

    let llm_diagnosis: Record<string, unknown> | null = null;
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (apiKey && suggestedJobCodes.length > 0 && body.symptom && String(body.symptom).trim().length > 0) {
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "You assist heavy equipment service intake. Given a symptom and job code list, return compact JSON: { ranked_job_code_ids: string[], reasoning: string, confidence_0_to_1: number }",
              },
              {
                role: "user",
                content: JSON.stringify({
                  symptom: body.symptom,
                  machine,
                  job_codes: suggestedJobCodes.map((j) => ({
                    id: j.id,
                    job_name: j.job_name,
                    hours: j.shop_average_hours ?? j.manufacturer_estimated_hours,
                  })),
                  prior_service_history: serviceHistory,
                  institutional_notes: knowledge_notes.map((k) => k.content).slice(0, 6),
                }),
              },
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          const text = json.choices?.[0]?.message?.content;
          if (text) {
            llm_diagnosis = JSON.parse(text) as Record<string, unknown>;
            const c = Number(llm_diagnosis.confidence_0_to_1);
            if (!Number.isNaN(c)) confidence = Math.min(1, Math.max(0.05, c));
          }
        }
      } catch (e) {
        console.warn("service-intake LLM skipped:", e);
      }
    }

    const knowledgeNoteIds = knowledge_notes.map((k) => k.id).filter(Boolean);

    return safeJsonOk({
      machine,
      service_history: serviceHistory,
      suggested_job_codes: suggestedJobCodes,
      likely_parts: likelyParts,
      estimated_hours: estimatedHours,
      haul_required: haulRequired,
      confidence,
      knowledge_notes,
      knowledge_note_ids: knowledgeNoteIds,
      llm_diagnosis,
      suggested_next_step: suggestedJobCodes.length > 0
        ? "Select job code and create service request"
        : "Manual diagnosis required — no matching job codes found",
    }, origin);
  } catch (err) {
    console.error("service-intake error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
